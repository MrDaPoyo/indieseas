use reqwest;
use sqlx::postgres::PgPoolOptions;
use sqlx::Postgres;
use sqlx::Pool;
use sqlx::Row;
use dotenv::dotenv;
use image;
use image::GenericImageView;
use once_cell::sync::Lazy;
use serde_derive::{ Deserialize, Serialize };
use serde_json::Value;
use std::collections::{ HashMap, HashSet, VecDeque };
use std::env;
use std::error::Error;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::time::sleep;

mod robots;
mod colorize;
use robots::is_allowed;
mod declutter;
use declutter::analyze_text_frequency;
use colorize::ColorAnalyzer;
use indicatif::{ ProgressBar, ProgressStyle };

static PROHIBITED_LINKS: [&str; 50] = [
	"mailto:",
	"tel:",
	"itch.io",
	"archlinux.org",
	"wiki.archlinux.org",
	"osu.ppy.sh",
	"javascript:",
	"github.com",
	"gitlab.com",
	"bitbucket.org",
	"reddit.com",
	"discord.com",
	"discord.gg",
	"steamcommunity.com",
	"steamstatic.com",
	"steamcdn.net",
	"catbox.moe",
	"litterbox.catbox.moe",
	"twitch.tv",
	"youtube.com",
	"twitter.com",
	"facebook.com",
	"instagram.com",
	"reddit.com",
	"tumblr.com",
	"pinterest.com",
	"linkedin.com",
	"vimeo.com",
	"foursquare.com",
	"snapchat.com",
	"ze.wtf",
	"t.me",
	"x.com",
	"t.co",
	"g.co",
	"microsoft.com",
	"apple.com",
	"bit.ly",
	"tinyurl.com",
	"goo.gl",
	"google.com",
	"g.co",
	"archive.org",
	"ftp://",
	"bsky.app",
	"codeberg.org",
	"sourcehut.org",
	"git.sr.ht",
	"gitea.com",
	"gitee.com",
];

static SCRAPER_WORKER: Lazy<String> = Lazy::new(|| {
	env::var("WORKER_URL").unwrap_or_else(|_| {
		panic!("WORKER_URL environment variable is required")
	})
});

#[derive(Deserialize, Serialize, Debug)]
struct ButtonResponse {
	url: String,
	alt: Option<String>,
	title: Option<String>,
}

#[derive(Debug, Clone)]
struct LinkResponse {
	href: String,
	text: String,
}

#[derive(Debug)]
struct ScraperResponse {
	raw_text: HashMap<String, usize>,
	title: Option<String>,
	description: Option<String>,
	links: Vec<LinkResponse>,
	buttons: HashMap<String, JsonButtonDetail>,
}

#[derive(Deserialize, Debug)]
struct JsonWorkerResponse {
	buttons: HashMap<String, JsonButtonDetail>,
	title: Option<String>,
	description: Option<String>,
	#[serde(rename = "rawText")]
	raw_text: String,
	links: Vec<JsonLinkDetail>,
}

#[derive(Deserialize, Debug, Clone)]
struct JsonButtonDetail {
	src: String,
	links_to: Option<String>,
	alt: Option<String>,
}

#[derive(Deserialize, Debug)]
struct JsonLinkDetail {
	href: Option<String>,
	text: String,
}

async fn is_url_already_scraped(pool: &Pool<Postgres>, url: &str) -> Result<bool, sqlx::Error> {
	let exists: bool = sqlx
		::query_scalar("SELECT EXISTS(SELECT 1 FROM websites WHERE url = $1)")
		.bind(url)
		.fetch_one(pool).await?;
	Ok(exists)
}

impl ScraperResponse {
	async fn get(url: &str) -> Result<ScraperResponse, Box<dyn std::error::Error + Send + Sync>> {
		let request_url = format!("{}{}", *SCRAPER_WORKER, urlencoding::encode(url));

		let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;

		let response = client.get(&request_url).send().await?;
		let status = response.status();

		if !status.is_success() {
			let error_body: Value = response
				.json().await
				.unwrap_or_else(|_| "Failed to read error body".into());
			return Err(format!("Worker returned status {}: {}", status, error_body).into());
		}

		let full_response = response.text().await?;

		let json_response: JsonWorkerResponse = match serde_json::from_str(&full_response) {
			Ok(data) => data,
			Err(e) => {
				return Err(e.into());
			}
		};

		let links: Vec<LinkResponse> = json_response.links
			.into_iter()
			.filter_map(|link| {
				link.href
					.map(|href| {
						if !PROHIBITED_LINKS.iter().any(|&prohibited| href.contains(prohibited)) {
							Some(LinkResponse {
								href,
								text: link.text,
							})
						} else {
							None
						}
					})
					.flatten()
			})
			.collect();

		let mut link_groups: HashMap<String, Vec<&LinkResponse>> = HashMap::new();
		for link in &links {
			let normalized = link.href
				.trim_start_matches("https://")
				.trim_start_matches("http://")
				.trim_start_matches("/")
				.trim_end_matches("/")
				.to_lowercase();

			link_groups.entry(normalized).or_insert_with(Vec::new).push(link);
		}

		let mut seen_normalized = HashSet::new();
		let links = links
			.into_iter()
			.filter(|link| {
				let normalized = link.href
					.trim_start_matches("https://")
					.trim_start_matches("http://")
					.trim_start_matches("/")
					.trim_end_matches("/")
					.to_lowercase();

				if seen_normalized.contains(&normalized) {
					false
				} else {
					seen_normalized.insert(normalized);
					true
				}
			})
			.collect::<Vec<_>>();

		Ok(ScraperResponse {
			raw_text: analyze_text_frequency(&json_response.raw_text),
			title: json_response.title,
			description: json_response.description,
			links: links
				.into_iter()
				.filter(|link| {
					!PROHIBITED_LINKS.iter().any(|&prohibited| link.href.contains(prohibited)) &&
						!link.href.contains('\n')
				})
				.collect(),
			buttons: json_response.buttons,
		})
	}
}

async fn check_button(buffer: &[u8], _url: &str) -> Result<bool, image::ImageError> {
	let img = image::load_from_memory(buffer)?;
	let (width, height) = img.dimensions();
	if width == 88 && height == 31 {
		return Ok(true);
	}
	Ok(false)
}

async fn initialize_db() -> Result<Pool<Postgres>, sqlx::Error> {
	let db_url = env::var("DB_URL").expect("DB_URL must be set");
	let pool = PgPoolOptions::new().max_connections(50).connect(&db_url).await?;

	sqlx
		::query(
			r#"
		CREATE TABLE IF NOT EXISTS websites (
			id SERIAL PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			is_scraped BOOLEAN DEFAULT FALSE,
			status_code INTEGER,
			title TEXT,
			description TEXT,
			raw_text TEXT,
			scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			amount_of_buttons INTEGER DEFAULT 0
		);
		"#
		)
		.execute(&pool).await?;

	sqlx
		::query(
			r#"
		CREATE TABLE IF NOT EXISTS buttons (
			id SERIAL PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			status_code INTEGER,
			color_tag TEXT,
			color_average TEXT,
			scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			alt TEXT,
			title TEXT,
			content BYTEA NOT NULL UNIQUE	
		);
		"#
		)
		.execute(&pool).await?;

	sqlx
		::query(
			r#"
		CREATE TABLE IF NOT EXISTS buttons_relations (
			id SERIAL PRIMARY KEY,
			button_id INTEGER REFERENCES buttons(id),
			website_id INTEGER REFERENCES websites(id),
			links_to_url TEXT,
			UNIQUE(button_id, website_id)
		);
		"#
		)
		.execute(&pool).await?;

	sqlx::query("CREATE EXTENSION IF NOT EXISTS vector;").execute(&pool).await?;

	sqlx
		::query(
			r#"
			CREATE TABLE IF NOT EXISTS websites_index (
				id SERIAL PRIMARY KEY,
				website TEXT NOT NULL,
				embedding vector(512) NOT NULL,
				type TEXT NOT NULL
			);
			"#
		)
		.execute(&pool).await?;

	sqlx
		::query(
			r#"
        CREATE INDEX IF NOT EXISTS embeddingIndex ON websites_index USING hnsw (embedding vector_cosine_ops);
        "#
		)
		.execute(&pool).await?;

	sqlx
		::query(
			r#"
		CREATE TABLE IF NOT EXISTS robots (
			id SERIAL PRIMARY KEY,
			website_id INTEGER REFERENCES websites(id),
			allowed BOOLEAN DEFAULT TRUE,
			last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		"#
		)
		.execute(&pool).await?;

	Ok(pool)
}

async fn insert_website(
	pool: &Pool<Postgres>,
	url: &str,
	title: Option<String>,
	description: Option<String>,
	raw_text: &str
) -> Result<i32, Box<dyn Error + Send + Sync>> {
	let url = if
		!url.ends_with("/") &&
		!url.contains('?') &&
		!url.contains('#') &&
		!regex::Regex::new(r"\.(html|htm|php|asp|aspx|jsp|cgi|pl|py|rb|js|css|xml|json|txt|pdf|doc|docx|zip|tar|gz|rar|7z|exe|dmg|pkg|deb|rpm)$")
			.unwrap()
			.is_match(url)
	{
		format!("{}/", url)
	} else {
		url.to_string()
	};
	let row = sqlx
		::query(
			r#"
		INSERT INTO websites (url, status_code, title, description, raw_text)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (url) DO UPDATE SET status_code = $2, title = $3, description = $4, raw_text = $5
		RETURNING id
		"#
		)
		.bind(&url)
		.bind(200i32)
		.bind(title.clone().unwrap_or_default())
		.bind(description.clone().unwrap_or_default())
		.bind(raw_text)
		.fetch_one(pool).await?;

	let website_id = row.get::<i32, _>("id");

	if let Some(title_text) = title {
		if !title_text.is_empty() {
			match vectorize_text(&title_text).await {
				Ok(vector) => {
					if
						let Err(e) = sqlx
							::query(
								r#"
						INSERT INTO websites_index (website, embedding, type)
						VALUES ($1, $2, $3)
						ON CONFLICT DO NOTHING
						"#
							)
							.bind(&url)
							.bind(vector)
							.bind("title")
							.execute(pool).await
					{
						eprintln!("Failed to insert title embedding for {}: {}", url, e);
					}
				}
				Err(e) => {
					eprintln!("Failed to vectorize title for {}: {}", url, e);
				}
			}
		}
	}

	if let Some(description_text) = description {
		if !description_text.is_empty() {
			match vectorize_text(&description_text).await {
				Ok(vector) => {
					if
						let Err(e) = sqlx
							::query(
								r#"
						INSERT INTO websites_index (website, embedding, type)
						VALUES ($1, $2, $3)
						ON CONFLICT DO NOTHING
						"#
							)
							.bind(&url)
							.bind(vector)
							.bind("description")
							.execute(pool).await
					{
						eprintln!("Failed to insert description embedding for {}: {}", url, e);
					}
				}
				Err(e) => {
					eprintln!("Failed to vectorize description for {}: {}", url, e);
				}
			}
		}
	}

	if !raw_text.is_empty() {
		let chunks: Vec<String> = raw_text
			.chars()
			.collect::<Vec<char>>()
			.chunks(500)
			.map(|chunk| chunk.iter().collect::<String>())
			.collect();

		for (i, chunk) in chunks.iter().enumerate() {
			match vectorize_text(chunk).await {
				Ok(vector) => {
					if
						let Err(e) = sqlx
							::query(
								r#"
						INSERT INTO websites_index (website, embedding, type)
						VALUES ($1, $2, $3)
						ON CONFLICT DO NOTHING
						"#
							)
							.bind(&url)
							.bind(vector)
							.bind(format!("raw_text_chunk_{}", i))
							.execute(pool).await
					{
						eprintln!(
							"Failed to insert raw text chunk {} embedding for {}: {}",
							i,
							url,
							e
						);
					}
				}
				Err(e) => {
					eprintln!("Failed to vectorize raw text chunk {} for {}: {}", i, url, e);
				}
			}
		}
	}

	Ok(website_id)
}

async fn vectorize_text(text: &str) -> Result<Vec<f32>, Box<dyn Error + Send + Sync>> {
	let ai_url = env::var("AI_URL").unwrap_or_else(|_| "http://localhost:8888".to_string());

	let client = reqwest::Client::new();
	let response = client
		.post(format!("{}/vectorize", ai_url))
		.json(&serde_json::json!({"text": text}))
		.send().await?;

	let vector_data: serde_json::Value = response.json().await?;

	let vectors: Vec<Vec<f32>> = vector_data["vectors"]
		.as_array()
		.ok_or("Invalid vectors format")?
		.iter()
		.map(|v| {
			v.as_array()
				.unwrap_or(&vec![])
				.iter()
				.map(|f| f.as_f64().unwrap_or(0.0) as f32)
				.collect()
		})
		.collect();

	let vector = vectors.into_iter().next().ok_or("No vector returned")?;

	Ok(vector)
}

async fn process_button_image(
	pool: &Pool<Postgres>,
	button_src_url: &str,
	alt: Option<String>,
	_button_links_to: Option<String>
) -> Result<Option<i32>, Box<dyn Error + Send + Sync>> {
	let client = reqwest::Client::new();
	let response = client.get(button_src_url).send().await?;
	let status_code = response.status().as_u16() as i32;

	if !response.status().is_success() {
		return Ok(None);
	}

	let buffer = response.bytes().await?.to_vec();

	let is_standard_size = check_button(&buffer, button_src_url).await?;
	if !is_standard_size {
		return Ok(None);
	}

	let (color_tags, color_average) = match image::load_from_memory(&buffer) {
		Ok(img) => {
			let analysis = tokio::task
				::spawn_blocking(move || { ColorAnalyzer::new().analyze_image(&img) }).await
				.unwrap();
			(analysis.tags.join(","), analysis.hex_average)
		}
		Err(_) => (String::new(), String::new()),
	};

	let row = sqlx
		::query(
			r#"
		INSERT INTO buttons (url, status_code, alt, content, color_tag, color_average)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (url) DO UPDATE SET status_code = $2, alt = $3, content = $4, color_tag = $5, color_average = $6
		RETURNING id
		"#
		)
		.bind(button_src_url)
		.bind(status_code)
		.bind(alt)
		.bind(buffer)
		.bind(color_tags)
		.bind(color_average)
		.fetch_one(pool).await?;

	Ok(Some(row.get::<i32, _>("id")))
}

fn is_image_url(url: &str) -> bool {
	let image_extensions = ["jpg", "jpeg", "png", "gif", "webp"];
	image_extensions.iter().any(|ext| url.ends_with(ext))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
	dotenv().ok();
	let pool = initialize_db().await?;
	println!("Database initialized successfully.");

	const DEFAULT_URL: &str = "https://thinliquid.dev/";
	const MAX_CONCURRENT_REQUESTS: usize = 10;

	// sqlx::query is used for querying the database, and sqlx::query_scalar is used for "scalar" ( single value ) queries
	let website_queue_check = sqlx::query("SELECT url FROM websites WHERE is_scraped = FALSE");

	if website_queue_check.fetch_one(&pool).await.is_err() {
		println!("Adding default URL: {}", DEFAULT_URL);
		sqlx
			::query(
				"INSERT INTO websites (url, is_scraped) VALUES ($1, FALSE) ON CONFLICT (url) DO NOTHING"
			)
			.bind(DEFAULT_URL)
			.execute(&pool).await?;
	}

	let rows = sqlx
		::query("SELECT url FROM websites WHERE is_scraped = FALSE")
		.fetch_all(&pool).await?;
	let page_queue: VecDeque<String> = rows
		.into_iter()
		.map(|row| row.get::<String, _>("url"))
		.collect();

	let page_scraped = Arc::new(Mutex::new(HashSet::new()));
	let page_queue = Arc::new(Mutex::new(page_queue));

	let max_pages = 100000;
	let scraped_count = Arc::new(Mutex::new(0));

	let unscraped_rows = sqlx
		::query("SELECT url FROM websites WHERE is_scraped = FALSE")
		.fetch_all(&pool).await?;

	for row in unscraped_rows {
		let url = row.get::<String, _>("url");
		let mut queue = page_queue.lock().await;
		if !queue.iter().any(|u| u == &url) {
			queue.push_back(url);
		}
	}

	let pb = ProgressBar::new(max_pages as u64);
	pb.set_style(
		ProgressStyle::default_bar()
			.template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} {msg}")
			.unwrap()
			.progress_chars("#>:3<")
	);

	let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
	let mut tasks: JoinSet<(Vec<String>, String)> = JoinSet::new();

	loop {
		// Check if we've reached the max pages limit
		if *scraped_count.lock().await >= max_pages {
			break;
		}

		let url = {
			let mut queue = page_queue.lock().await;
			queue.pop_front()
		};

		let url = match url {
			Some(url) => url,
			None => {
				let rows = sqlx::query("SELECT url FROM websites WHERE is_scraped = FALSE ORDER BY scraped_at ASC NULLS FIRST LIMIT 100")
					.fetch_all(&pool).await.unwrap_or_default();
				
				if rows.is_empty() {
					break;
				}
				
				let mut queue = page_queue.lock().await;
				for row in rows {
					let db_url = row.get::<String, _>("url");
					if !page_scraped.lock().await.contains(&db_url) {
						queue.push_back(db_url);
					}
				}
				
				// Try to get URL again
				match queue.pop_front() {
					Some(url) => url,
					None => break,
				}
			}
		};

		// Check if already scraped
		if page_scraped.lock().await.contains(&url) {
			continue;
		}

		let url = if !url.ends_with("/") && 
			!url.contains('?') && 
			!url.contains('#') && 
			!regex::Regex::new(r"\.(html|htm|php|asp|aspx|jsp|cgi|pl|py|rb|js|css|xml|json|txt|pdf|doc|docx|zip|tar|gz|rar|7z|exe|dmg|pkg|deb|rpm)$")
				.unwrap()
				.is_match(&url) {
			format!("{}/", url)
		} else {
			url
		};

		match is_url_already_scraped(&pool, &url).await {
			Ok(true) => {
				match
					sqlx
						::query_scalar::<_, bool>("SELECT is_scraped FROM websites WHERE url = $1")
						.bind(&url)
						.fetch_one(&pool).await
				{
					Ok(true) => {
						continue;
					}
					Ok(false) => {} // Not scraped yet, proceed
					Err(_) => {
						continue;
					}
				}
			}
			Ok(false) => {}
			Err(e) => {
				eprintln!("Database error checking if URL already scraped: {}", e);
				continue;
			}
		}

		page_scraped.lock().await.insert(url.clone());

		{
			let mut count = scraped_count.lock().await;
			*count += 1;
		}

		match is_allowed(&url).await {
			Ok(false) => {
				if
					let Err(e) = sqlx
						::query("UPDATE websites SET is_scraped = TRUE WHERE url = $1")
						.bind(&url)
						.execute(&pool).await
				{
					eprintln!("Failed to mark robots-blocked website as scraped: {}", e);
				}
				continue;
			}
			Ok(true) => {}
			Err(e) => {
				let err_str = e.to_string();
				if
					let Err(_) = sqlx
						::query("UPDATE websites SET is_scraped = TRUE WHERE url = $1")
						.bind(&url)
						.execute(&pool).await
				{
					eprintln!("Failed to mark website as scraped due to robots.txt error");
				}
				eprintln!("Error in is_allowed for {}: {}", url, err_str);
				continue;
			}
		}

		// Check robots.txt from database first
		let mut robots_allowed = None;
		if let Ok(row) = sqlx::query("SELECT allowed FROM robots WHERE website_id = (SELECT id FROM websites WHERE url = $1) ORDER BY last_checked DESC LIMIT 1")
			.bind(&url)
			.fetch_optional(&pool).await {
			if let Some(row) = row {
				robots_allowed = Some(row.get::<bool, _>("allowed"));
			}
		}

		// If not in database, check with robots::is_allowed
		let is_robots_allowed = match robots_allowed {
			Some(allowed) => allowed,
			None => {
				match is_allowed(&url).await {
					Ok(allowed) => {
						// Store result in database
						if let Ok(website_id) = sqlx::query_scalar::<_, i32>("SELECT id FROM websites WHERE url = $1")
							.bind(&url)
							.fetch_optional(&pool).await {
							if let Some(website_id) = website_id {
								let _ = sqlx::query("INSERT INTO robots (website_id, allowed) VALUES ($1, $2) ON CONFLICT (website_id) DO UPDATE SET allowed = $2, last_checked = CURRENT_TIMESTAMP")
									.bind(website_id)
									.bind(allowed)
									.execute(&pool).await;
							}
						}
						allowed
					}
					Err(e) => {
						eprintln!("Error checking robots.txt for {}: {}", url, e);
						false
					}
				}
			}
		};

		if !is_robots_allowed {
			if let Err(e) = sqlx::query("UPDATE websites SET is_scraped = TRUE WHERE url = $1")
				.bind(&url)
				.execute(&pool).await {
				eprintln!("Failed to mark robots-blocked website as scraped: {}", e);
			}
			continue;
		}

		match ScraperResponse::get(&url).await {
			Ok(mut response) => {
				let raw_text_string = response.raw_text
					.iter()
					.map(|(word, count)| format!("{}: {}", word, count))
					.collect::<Vec<_>>()
					.join(", ");

				match
					insert_website(
						&pool,
						&url,
						response.title.clone(),
						response.description.clone(),
						&raw_text_string
					).await
				{
					Ok(website_id) => {
						if
							let Err(e) = sqlx
								::query("UPDATE websites SET is_scraped = TRUE WHERE url = $1")
								.bind(&url)
								.execute(&pool).await
						{
							eprintln!("Failed to mark website as scraped: {}", e);
						}

						for (_button_key, button_detail) in response.buttons {
							if is_image_url(&button_detail.src) {
								match
									process_button_image(
										&pool,
										&button_detail.src,
										button_detail.alt.clone(),
										button_detail.links_to.clone()
									).await
								{
									Ok(Some(button_id)) => {
										if
											let Err(e) = sqlx
												::query(
													"INSERT INTO buttons_relations (button_id, website_id, links_to_url) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
												)
												.bind(button_id)
												.bind(website_id)
												.bind(button_detail.links_to.clone())
												.execute(&pool).await
										{
											eprintln!("Failed to insert button relation: {}", e);
										}
									}
									Ok(None) => {}
									Err(_e) => {}
								}
							}

							// Insert button link target to database
							if let Some(links_to_url) = &button_detail.links_to {
								if
									!PROHIBITED_LINKS.iter().any(|&prohibited|
										links_to_url.contains(prohibited)
									)
								{
									let _ = sqlx::query(
										"INSERT INTO websites (url, is_scraped) VALUES ($1, FALSE) ON CONFLICT (url) DO NOTHING"
									)
									.bind(links_to_url)
									.execute(&pool).await;
								}
							}

							// Insert button source URL to database if it's not an image
							if
								!is_image_url(&button_detail.src) &&
								!PROHIBITED_LINKS.iter().any(|&prohibited|
									button_detail.src.contains(prohibited)
								)
							{
								let _ = sqlx::query(
									"INSERT INTO websites (url, is_scraped) VALUES ($1, FALSE) ON CONFLICT (url) DO NOTHING"
								)
								.bind(&button_detail.src)
								.execute(&pool).await;
							}
						}
					}
					Err(e) => {
						eprintln!("Failed to insert website {}: {}", url, e);
					}
				}
				
				for link in response.links.iter_mut() {
					if !link.href.starts_with("http://") && !link.href.starts_with("https://") {
						let base_url = url.trim_end_matches('/');
						let clean_link = link.href.trim_start_matches('/');
						let normalized_link = format!("{}/{}", base_url, clean_link);
						
						// Don't append trailing slash if it's a file
						let normalized_link = if normalized_link.matches(r"\.(html|htm|php|asp|aspx|jsp|cgi|pl|py|rb|js|css|xml|json|txt|pdf|doc|docx|zip|tar|gz|rar|7z|exe|dmg|pkg|deb|rpm)$").next().is_some() {
							normalized_link
						} else if !normalized_link.ends_with("/") {
							format!("{}/", normalized_link)
						} else {
							normalized_link
						};
						
						link.href = normalized_link;
					}

					// Insert link URLs to database
					if
						!PROHIBITED_LINKS.iter().any(|&prohibited|
							link.href.contains(prohibited)
						)
					{
						let _ = sqlx::query(
							"INSERT INTO websites (url, is_scraped) VALUES ($1, FALSE) ON CONFLICT (url) DO NOTHING"
						)
						.bind(&link.href)
						.execute(&pool).await;
					}
				}
			}
			Err(e) => {
				eprintln!("Error scraping {}: {}", url, e);
				if let Err(db_err) = sqlx
					::query("UPDATE websites SET is_scraped = TRUE WHERE url = $1")
					.bind(&url)
					.execute(&pool).await
				{
					eprintln!("Failed to mark website as scraped due to error: {}", db_err);
				}
			}
		}

		let current_count = *scraped_count.lock().await;
		pb.set_position(current_count as u64);
		pb.set_message(format!("Completed: {}", url));

		sleep(Duration::from_millis(100)).await;
	}

	// Wait for all remaining tasks to complete
	while let Some(result) = tasks.join_next().await {
		if let Ok((new_urls, completed_url)) = result {
			// Insert discovered URLs to database instead of adding to queue
			for new_url in new_urls {
				if
					!PROHIBITED_LINKS.iter().any(|&prohibited|
						new_url.contains(prohibited)
					)
				{
					let _ = sqlx::query(
						"INSERT INTO websites (url, is_scraped) VALUES ($1, FALSE) ON CONFLICT (url) DO NOTHING"
					)
					.bind(&new_url)
					.execute(&pool).await;
				}
			}

			let current_count = *scraped_count.lock().await;
			pb.set_position(current_count as u64);
			pb.set_message(format!("Completed: {}", completed_url));
		}
	}

	let final_count = *scraped_count.lock().await;
	pb.finish_with_message(format!("Scraping completed. Total pages scraped: {}", final_count));
	Ok(())
}
