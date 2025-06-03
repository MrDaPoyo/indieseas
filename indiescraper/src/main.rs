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
use colorize::ColorAnalyzer;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Instant;

static PROHIBITED_LINKS: [&str; 42] = [
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
	"bit.ly",
	"tinyurl.com",
	"goo.gl",
	"google.com",
	"g.co",
	"archive.org",
	"ftp://",
	"bsky.app",
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

struct ScraperResponse {
	raw_text: String,
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
        
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        let response = client.get(&request_url).send().await?;
        let status = response.status();
        
        if !status.is_success() {
            let error_body: Value = response.json().await.unwrap_or_else(|_| "Failed to read error body".into());
            return Err(format!("Worker returned status {}: {}", status, error_body).into());
        }

        let full_response = response.text().await?;

        let json_response: JsonWorkerResponse = match serde_json::from_str(&full_response) {
            Ok(data) => data,
            Err(e) => {
                return Err(e.into());
            }
        };

		let links = json_response.links
			.into_iter()
			.filter_map(|link| {
				link.href.map(|href| {
					if !PROHIBITED_LINKS.iter().any(|&prohibited| href.contains(prohibited)) {
						Some(LinkResponse {
							href,
							text: link.text,
						})
					} else {
						None
					}
				}).flatten()
			})
			.collect();

        Ok(ScraperResponse {
            raw_text: json_response.raw_text,
            title: json_response.title,
            description: json_response.description,
            links,
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
	let pool = PgPoolOptions::new().max_connections(20).connect(&db_url).await?;

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

	Ok(pool)
}

async fn insert_website(
	pool: &Pool<Postgres>,
	url: &str,
	title: Option<String>,
	description: Option<String>,
	raw_text: &str
) -> Result<i32, Box<dyn Error + Send + Sync>> {
	let url = if !url.ends_with("/") { format!("{}/", url) } else { url.to_string() };
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
			let analysis = ColorAnalyzer::new().analyze_image(&img);
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

async fn is_image_url(url: &str) -> bool {
	let image_extensions = ["jpg", "jpeg", "png", "gif", "webp"];
	image_extensions.iter().any(|ext| url.ends_with(ext)) as bool
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	dotenv().ok();
	let args: Vec<String> = env::args().collect();
	let pool = initialize_db().await?;
	println!("Database initialized successfully.");

	let queue: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
	let visited: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
	let scraped_count: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
	let button_count: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
	let website_counts: Arc<Mutex<HashMap<String, usize>>> = Arc::new(Mutex::new(HashMap::new()));
	let subfolder_counts: Arc<Mutex<HashMap<String, usize>>> = Arc::new(Mutex::new(HashMap::new()));
	let latest_scraped_url: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
	const MAX_PAGES_PER_WEBSITE: usize = 75;
	const MAX_PAGES_PER_SUBFOLDER: usize = 10;
	const MAX_CONCURRENT_TASKS: usize = 10;
	let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_TASKS));

	if args.len() < 2 || args[1] == "--clean" || args[1] == "-c" {
		println!("Cleaning links containing blacklisted items...");
		
		let mut blacklisted_items = PROHIBITED_LINKS.to_vec();
		
		if args.len() > 2 {
			for arg in &args[2..] {
				blacklisted_items.push(arg.as_str());
			}
		}
		
		for item in &blacklisted_items {
			sqlx::query(
				"DELETE FROM buttons_relations WHERE button_id IN (SELECT id FROM buttons WHERE url LIKE $1)"
			)
			.bind(format!("%{}%", item))
			.execute(&pool).await?;
			
			sqlx::query(
				"DELETE FROM buttons_relations WHERE website_id IN (SELECT id FROM websites WHERE url LIKE $1)"
			)
			.bind(format!("%{}%", item))
			.execute(&pool).await?;
			
			let affected_websites = sqlx::query_scalar::<_, i64>(
				"SELECT COUNT(*) FROM websites WHERE url LIKE $1"
			)
			.bind(format!("%{}%", item))
			.fetch_optional(&pool).await?
			.unwrap_or(0);
			
			sqlx::query(
				"DELETE FROM websites WHERE url LIKE $1"
			)
			.bind(format!("%{}%", item))
			.execute(&pool).await?;
			
			let affected_buttons = sqlx::query_scalar::<_, i64>(
				"SELECT COUNT(*) FROM buttons WHERE url LIKE $1"
			)
			.bind(format!("%{}%", item))
			.fetch_optional(&pool).await?
			.unwrap_or(0);
			
			sqlx::query(
				"DELETE FROM buttons WHERE url LIKE $1"
			)
			.bind(format!("%{}%", item))
			.execute(&pool).await?;
			
			if affected_websites > 0 || affected_buttons > 0 {
				println!("Removed {} websites and {} buttons containing '{}'", affected_websites, affected_buttons, item);
			}
		}

		// Fix malformed URLs with trailing slashes after file extensions
		let malformed_urls = sqlx::query_as::<_, (String,)>(
			"SELECT url FROM websites WHERE url ~ '\\.(html|htm|php|asp|aspx|jsp|cgi|pl|py|rb|js|css|xml|json|txt|pdf|doc|docx|zip|tar|gz|rar|7z|exe|dmg|pkg|deb|rpm)/$'"
		)
		.fetch_all(&pool).await?;

		for (url,) in malformed_urls {
			let corrected_url = url.trim_end_matches('/');
			if corrected_url != url {
				println!("Fixing malformed URL: {} -> {}", url, corrected_url);
				
				sqlx::query("UPDATE websites SET url = $1 WHERE url = $2")
					.bind(corrected_url)
					.bind(&url)
					.execute(&pool).await?;
				
				sqlx::query("UPDATE websites_index SET website = $1 WHERE website = $2")
					.bind(corrected_url)
					.bind(&url)
					.execute(&pool).await?;
				
				sqlx::query("UPDATE buttons_relations SET links_to_url = $1 WHERE links_to_url = $2")
					.bind(corrected_url)
					.bind(&url)
					.execute(&pool).await?;
			}
		}
		
		println!("Database cleanup completed.");
		return Ok(());
	}


	let pb = ProgressBar::new(100000);
	pb.set_style(
		ProgressStyle::default_bar()
			.template("{spinner:.green} [{elapsed_precise}] {bar:40.cyan/blue} {pos:>4}/{len:4} Pages | {msg}")
			.unwrap()
			.progress_chars("##-"),
	);

	let start_time = Instant::now();
	let scraped_count_for_progress = scraped_count.clone();
	let button_count_for_progress = button_count.clone();
	let latest_scraped_url_for_progress = latest_scraped_url.clone();

	// Spawn progress update task
	let pb_clone = pb.clone();
	tokio::spawn(async move {
		loop {
			tokio::time::sleep(Duration::from_millis(200)).await;
			let pages = *scraped_count_for_progress.lock().await;
			let buttons = *button_count_for_progress.lock().await;
			let latest_url = latest_scraped_url_for_progress.lock().await.clone();
			let elapsed = start_time.elapsed().as_secs_f64();
			
			let buttons_per_sec = if elapsed > 0.0 { buttons as f64 / elapsed } else { 0.0 };
			
			pb_clone.set_position(pages as u64);
			pb_clone.set_message(format!(
				"Buttons: {} ({:.1}/s) | {}",
				buttons, buttons_per_sec, latest_url
			));
		}
	});

	fn normalize_url(url: &str) -> String {
		if let Ok(parsed) = url::Url::parse(url) {
			let mut normalized = parsed.clone();
			normalized.set_query(None);
			normalized.to_string()
		} else {
			url.to_string()
		}
	}

	let rows = sqlx
		::query(r#"SELECT url FROM websites WHERE is_scraped = FALSE"#)
		.fetch_all(&pool).await?;

	let mut urls_to_scrape: Vec<String> = rows
		.into_iter()
		.map(|row| row.get::<String, _>("url"))
		.collect();

	if args.len() > 1 {
		let input_urls: Vec<String> = args[1..].iter().map(|s| s.to_string()).collect();
		for url in input_urls {
			if !url.starts_with("http") {
				println!("Skipping invalid URL: {}", url);
				continue;
			}
			if !is_allowed(&url).await.unwrap_or(false) {
				println!("URL not allowed by robots.txt: {}", url);
				continue;
			}
			queue.lock().await.push_back(url.clone());
			urls_to_scrape.push(url);
		}
	}

	if urls_to_scrape.is_empty() {
		println!("No URLs found to scrape. Exiting...");
		return Ok(());
	}

	for mut url in urls_to_scrape {
		if !url.ends_with("/") {
			if !url.ends_with(".php") && !url.ends_with(".html") && !url.ends_with(".htm") && !url.ends_with(".asp") && !url.ends_with(".aspx") {
				url = format!("{}/", url);
			}
			queue.lock().await.push_back(url);
		} else {
			queue.lock().await.push_back(url);
		}
	}

	let mut join_set = JoinSet::new();
	while scraped_count.lock().await.clone() < 100000 {
		let current_url = {
			let mut queue_guard = queue.lock().await;
			queue_guard.pop_front()
		};

		if let Some(url) = current_url {
			let permit = semaphore.clone().acquire_owned().await.unwrap();
			let pool_clone = pool.clone();
			let queue_clone = queue.clone();
			let visited_clone = visited.clone();
			let scraped_count_clone = scraped_count.clone();
			let button_count_clone = button_count.clone();
			let website_counts_clone = website_counts.clone();
			let subfolder_counts_clone = subfolder_counts.clone();
			let latest_scraped_url_clone = latest_scraped_url.clone();

			join_set.spawn(async move {
				let _permit = permit;
				
				let normalized_url = normalize_url(&url);
				
				if visited_clone.lock().await.contains(&normalized_url) {
					return;
				}
				
				visited_clone.lock().await.insert(normalized_url.clone());
				
				let parsed_url = url::Url::parse(&url).ok();
				let domain = parsed_url.as_ref()
					.and_then(|u| u.host_str().map(|s| s.to_string()));
				
				let subfolder = parsed_url.as_ref()
					.map(|u| {
						let path = u.path();
						let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
						if segments.len() > 1 {
							format!("{}/{}", u.host_str().unwrap_or(""), segments[0])
						} else {
							u.host_str().unwrap_or("").to_string()
						}
					});
				
				// Check domain limit
				if let Some(domain) = &domain {
					let mut counts = website_counts_clone.lock().await;
					let count = counts.entry(domain.clone()).or_insert(0);
					if *count >= MAX_PAGES_PER_WEBSITE {
						return;
					}
					*count += 1;
				}
				
				// Check subfolder limit
				if let Some(subfolder_key) = &subfolder {
					let mut subfolder_counts = subfolder_counts_clone.lock().await;
					let count = subfolder_counts.entry(subfolder_key.clone()).or_insert(0);
					if *count >= MAX_PAGES_PER_SUBFOLDER {
						return;
					}
					*count += 1;
				}

				match ScraperResponse::get(&url).await {
					Ok(scraper_response) => {
						*latest_scraped_url_clone.lock().await = url.clone();
						
						match insert_website(
							&pool_clone,
							&url,
							scraper_response.title,
							scraper_response.description,
							&scraper_response.raw_text
						).await {
							Ok(website_id) => {
								let mut page_button_count = 0;
								
								for (_, button_details) in &scraper_response.buttons {
									if is_image_url(&button_details.src).await {
										match sqlx::query_scalar::<_, bool>(
											"SELECT EXISTS(SELECT 1 FROM buttons WHERE url = $1)"
										)
										.bind(&button_details.src)
										.fetch_one(&pool_clone).await {
											Ok(exists) if !exists => {
												match process_button_image(
													&pool_clone,
													&button_details.src,
													button_details.alt.clone(),
													button_details.links_to.clone()
												).await {
													Ok(Some(button_id)) => {
														page_button_count += 1;
														if let Err(e) = sqlx::query(
															r#"
															INSERT INTO buttons_relations (button_id, website_id, links_to_url)
															VALUES ($1, $2, $3)
															ON CONFLICT (button_id, website_id) DO UPDATE SET links_to_url = $3
															"#
														)
														.bind(button_id)
														.bind(website_id)
														.bind(button_details.links_to.clone())
														.execute(&pool_clone).await {
															eprintln!("Failed to insert button relation: {}", e);
														}
													},
													Ok(None) => {},
													Err(e) => {}
												}
											},
											Ok(_) => {}, // Button already exists, skip processing
											Err(e) => eprintln!("Failed to check button existence for {}: {}", button_details.src, e),
										}
									}
								}
								
								// Update button count
								*button_count_clone.lock().await += page_button_count;
								
								if let Err(e) = sqlx::query(
									"UPDATE websites SET amount_of_buttons = $1, is_scraped = TRUE WHERE id = $2"
								)
								.bind(page_button_count as i32)
								.bind(website_id)
								.execute(&pool_clone).await {
									eprintln!("Failed to update button count: {}", e);
								}

								// Queue new URLs from links and buttons
								for link in scraper_response.links {
									if link.href.trim().is_empty() || link.text.trim().is_empty() {
										continue;
									}
									
									let link_url = if link.href.starts_with("http") {
										link.href
									} else if link.href.starts_with("/") {
										format!("{}{}", url.trim_end_matches('/'), link.href)
									} else {
										format!("{}/{}", url.trim_end_matches('/'), link.href)
									};

									let normalized_link_url = normalize_url(&link_url);

									if !PROHIBITED_LINKS.iter().any(|&prohibited| link_url.contains(prohibited)) &&
									   !is_image_url(&link_url).await &&
									   !is_url_already_scraped(&pool_clone, &normalized_link_url).await.unwrap_or(true) &&
									   !visited_clone.lock().await.contains(&normalized_link_url) {
										queue_clone.lock().await.push_back(link_url);
									}
								}

								for (_, button_details) in &scraper_response.buttons {
									if let Some(links_to) = &button_details.links_to {
										let normalized_links_to = normalize_url(links_to);
										
										if !PROHIBITED_LINKS.iter().any(|&prohibited| links_to.contains(prohibited)) &&
										   !is_image_url(links_to).await &&
										   !is_url_already_scraped(&pool_clone, &normalized_links_to).await.unwrap_or(true) &&
										   !visited_clone.lock().await.contains(&normalized_links_to) {
											queue_clone.lock().await.push_back(links_to.clone());
										}
									}
								}
							},
							Err(e) => eprintln!("Failed to insert website {}: {}", url, e),
						}
					},
					Err(e) => {}
				}

				*scraped_count_clone.lock().await += 1;
			});

			while join_set.len() >= MAX_CONCURRENT_TASKS {
				join_set.join_next().await;
			}
		} else {
			sleep(Duration::from_millis(10)).await;
			if join_set.is_empty() {
				break;
			}
		}
	}

	while let Some(_) = join_set.join_next().await {}
	
	pb.finish_with_message("Scraping completed!");
	
	Ok(())
}
