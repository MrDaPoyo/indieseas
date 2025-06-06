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
use std::path::Path;
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
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Instant;

static PROHIBITED_LINKS: [&str; 45] = [
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
            raw_text: analyze_text_frequency(&json_response.raw_text),
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

	Ok(pool)
}

async fn insert_website(
	pool: &Pool<Postgres>,
	url: &str,
	title: Option<String>,
	description: Option<String>,
	raw_text: &str
) -> Result<i32, Box<dyn Error + Send + Sync>> {
	let url = if !url.ends_with("/") && !url.matches(r"\.(html|htm|php|asp|aspx|jsp|cgi|pl|py|rb|js|css|xml|json|txt|pdf|doc|docx|zip|tar|gz|rar|7z|exe|dmg|pkg|deb|rpm)$").next().is_some() { 
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

	const MAX_CONCURRENT_REQUESTS: usize = 10;
	let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
	let mut join_set = JoinSet::new();
	if args.len() < 2 {
		eprintln!("Usage: {} <url>", args[0]);
		return Ok(());
	}

	let start_url = "https://thinliquid.dev/";
	let mut queue = VecDeque::new();
	let mut visited = HashSet::new();
	queue.push_back(start_url.to_string());

	let progress_bar = ProgressBar::new(0);
	progress_bar.set_style(
		ProgressStyle::default_bar()
			.template("{spinner:.green} [{elapsed_precise}] {pos}/{len} {msg}")
			.unwrap()
	);

	while let Some(current_url) = queue.pop_front() {
		if visited.contains(&current_url) {
			continue;
		}
		visited.insert(current_url.clone());

		progress_bar.set_message(format!("Processing: {}", current_url));
		progress_bar.inc(1);

		let permit = semaphore.clone().acquire_owned().await.unwrap();
		let pool_clone = pool.clone();
		let queue_clone = Arc::new(Mutex::new(queue.clone()));

		join_set.spawn(async move {
			let _permit = permit;
			
			if is_url_already_scraped(&pool_clone, &current_url).await.unwrap_or(false) {
				return;
			}

			let response = match ScraperResponse::get(&current_url).await {
				Ok(resp) => resp,
				Err(e) => {
					eprintln!("Failed to scrape {}: {}", current_url, e);
					return;
				}
			};

			let mut button_ids = Vec::new();
			let mut website_id = None;

			// Process buttons first
			for (button_url, button_detail) in &response.buttons {
				if is_image_url(button_url).await {
					if let Ok(Some(button_id)) = process_button_image(
						&pool_clone,
						button_url,
						button_detail.alt.clone(),
						button_detail.links_to.clone()
					).await {
						button_ids.push((button_id, button_detail.links_to.clone()));
					}
				}
			}

			// Only insert website if it has 88x31 buttons
			if !button_ids.is_empty() {
				let raw_text_string = response.raw_text
					.iter()
					.map(|(word, count)| format!("{} ", word.repeat(*count)))
					.collect::<String>();

				match insert_website(
					&pool_clone,
					&current_url,
					response.title,
					response.description,
					&raw_text_string
				).await {
					Ok(id) => {
						website_id = Some(id);
						
						// Insert button relations
						for (button_id, links_to) in button_ids {
							let _ = sqlx::query(
								r#"
								INSERT INTO buttons_relations (button_id, website_id, links_to_url)
								VALUES ($1, $2, $3)
								ON CONFLICT DO NOTHING
								"#
							)
							.bind(button_id)
							.bind(id)
							.bind(links_to.clone())
							.execute(&pool_clone)
							.await;

							// Add links_to URLs to queue if they're not prohibited
							if let Some(ref link_url) = links_to {
								if !PROHIBITED_LINKS.iter().any(|&prohibited| link_url.contains(prohibited)) {
									let mut queue_guard = queue_clone.lock().await;
									queue_guard.push_back(link_url.clone());
								}
							}
						}

						// Add other links to queue
						for link in &response.links {
							if !PROHIBITED_LINKS.iter().any(|&prohibited| link.href.contains(prohibited)) {
								let mut queue_guard = queue_clone.lock().await;
								queue_guard.push_back(link.href.clone());
							}
						}
					}
					Err(e) => {
						eprintln!("Failed to insert website {}: {}", current_url, e);
					}
				}
			}
		});

		queue = queue_clone.lock().await.clone();
		
		// Limit queue size to prevent memory issues
		if queue.len() > 1000 {
			queue.truncate(500);
		}
	}

	while let Some(result) = join_set.join_next().await {
		if let Err(e) = result {
			eprintln!("Task failed: {}", e);
		}
	}

	progress_bar.finish_with_message("Scraping completed");

	let response: Result<ScraperResponse, Box<dyn std::error::Error + Send + Sync>> = ScraperResponse::get(&args[1]).await;
	println!("Scraper response: {:#?}", response);
	
	Ok(())
}
