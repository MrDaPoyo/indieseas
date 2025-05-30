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
use std::collections::{ HashMap, HashSet, VecDeque };
use std::env;
use std::error::Error;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

static PROHIBITED_LINKS: [&str; 30] = [
    "mailto:",
    "tel:",
    "javascript:",
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
    "ftp://",
];

static SCRAPER_WORKER: Lazy<String> = Lazy::new(||
    env::var("WORKER_URL").expect("WORKER_URL must be set")
);

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
    href: String,
    text: String,
}

#[derive(Deserialize, Debug)]
struct WebsiteData {
    buttons: HashMap<String, ButtonDetails>,
    title: String,
    description: String,
    raw_text: String,
    links: Vec<LinkDetails>,
}

#[derive(Deserialize, Debug)]
struct ButtonDetails {
    src: String,
    links_to: Option<String>,
    alt: String,
}

#[derive(Deserialize, Debug)]
struct LinkDetails {
    href: Option<String>,
    text: String,
}

fn parse_website_data_into_array(json_string: &str) -> Result<Vec<WebsiteData>, serde_json::Error> {
    let data: WebsiteData = serde_json::from_str(json_string)?;
    Ok(vec![data])
}

impl ScraperResponse {
    async fn get(url: &str) -> Result<ScraperResponse, reqwest::Error> {
        let request_url = format!("{}{}", &*SCRAPER_WORKER, url);

        let client = reqwest::Client::new();
        let response = client.get(&request_url).send().await?;

        if response.status().is_success() {
            let json_response: JsonWorkerResponse = response.json().await?;
            let mut links = Vec::new();
            for link in json_response.links {
                if !PROHIBITED_LINKS.iter().any(|&prohibited| link.href.contains(prohibited)) {
                    links.push(LinkResponse {
                        href: link.href,
                        text: link.text,
                    });
                }
            }

            let buttons = json_response.buttons;

            return Ok(ScraperResponse {
                raw_text: json_response.raw_text,
                title: json_response.title,
                description: json_response.description,
                links,
                buttons,
            });
        } else {
            let err = response.error_for_status().unwrap_err();
            return Err(err);
        }
    }
}

async fn check_button(buffer: &[u8], url: &str) -> Result<bool, image::ImageError> {
    let img = image::load_from_memory(buffer)?;
    let (width, height) = img.dimensions();
    if width == 88 && height == 31 {
        println!("Found 88x31 button image: {}", url);
        return Ok(true);
    }
    Ok(false)
}

async fn initialize_db() -> Result<Pool<Postgres>, sqlx::Error> {
    let db_url = env::var("DB_URL").expect("DB_URL must be set");
    let pool = PgPoolOptions::new().max_connections(20).connect(&db_url).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS found_links (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        "#
    ).execute(&pool).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS websites (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            title TEXT,
            description TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        "#
    ).execute(&pool).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS buttons (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            alt TEXT,
            title TEXT,
            content BYTEA,
            is_88x31 BOOLEAN DEFAULT FALSE
        );
        "#
    ).execute(&pool).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS buttons_relations (
            id SERIAL PRIMARY KEY,
            button_id INTEGER REFERENCES buttons(id),
            website_id INTEGER REFERENCES websites(id),
            links_to_url TEXT,
            UNIQUE(button_id, website_id)
        );
        "#
    ).execute(&pool).await?;

    Ok(pool)
}

async fn insert_link(pool: &Pool<Postgres>, link: &str) -> Result<(), sqlx::Error> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM found_links WHERE url = $1)")
        .bind(link)
        .fetch_one(pool)
        .await?;

    if exists {
        return Ok(());
    }

    sqlx::query("INSERT INTO found_links (url) VALUES ($1)")
        .bind(link)
        .execute(pool)
        .await?;

    Ok(())
}

async fn insert_website(pool: &Pool<Postgres>, url: &str, title: Option<String>, description: Option<String>) -> Result<i32, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO websites (url, status_code, title, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (url) DO UPDATE SET status_code = $2, title = $3, description = $4
        RETURNING id
        "#
    )
        .bind(url)
        .bind(200i32)
        .bind(title.unwrap_or_default())
        .bind(description.unwrap_or_default())
        .fetch_one(pool).await?;

    Ok(row.get::<i32, _>("id"))
}

async fn process_button_image(pool: &Pool<Postgres>, button_src_url: &str, alt: Option<String>) -> Result<i32, Box<dyn Error + Send + Sync>> {
    println!("Processing button image: {}", button_src_url);
    let client = reqwest::Client::new();
    let response = client.get(button_src_url).send().await?;
    let status_code = response.status().as_u16() as i32;
    let mut image_content: Option<Vec<u8>> = None;
    let mut is_88x31 = false;

    if response.status().is_success() {
        let buffer = response.bytes().await?.to_vec();
        if let Ok(is_standard_size) = check_button(&buffer, button_src_url).await {
            is_88x31 = is_standard_size;
            image_content = Some(buffer);
        } else {
            eprintln!("Failed to check button dimensions for {}: Image error", button_src_url);
        }
    } else {
        eprintln!("Failed to fetch button image {}: Status {}", button_src_url, status_code);
    }

    let row = sqlx::query(
        r#"
        INSERT INTO buttons (url, status_code, alt, content, is_88x31)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (url) DO UPDATE SET status_code = $2, alt = $3, content = $4, is_88x31 = $5
        RETURNING id
        "#
    )
        .bind(button_src_url)
        .bind(status_code)
        .bind(alt)
        .bind(image_content)
        .bind(is_88x31)
        .fetch_one(pool).await?;

    Ok(row.get::<i32, _>("id"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let pool = initialize_db().await?;
    println!("Database initialized successfully.");

    let queue: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let visited: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let scraped_count: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    const MAX_PAGES: usize = 100;
    const MAX_CONCURRENT_TASKS: usize = 10;
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_TASKS));

    let start_url = "https://nekoweb.org";
    {
        let mut q = queue.lock().await;
        let mut v = visited.lock().await;
        if v.insert(start_url.to_string()) {
             q.push_back(start_url.to_string());
        }
    }

    println!("Starting concurrent scraping...");

    let mut join_set = JoinSet::new();

    loop {
        let current_scraped_count = *scraped_count.lock().await;
        if current_scraped_count >= MAX_PAGES {
            println!("Reached maximum number of pages to scrape ({})", MAX_PAGES);
            break;
        }
        
        let next_url = {
            let mut q = queue.lock().await;
            q.pop_front()
        };

        if let Some(current_url) = next_url {
            let pool = pool.clone();
            let queue = Arc::clone(&queue);
            let visited = Arc::clone(&visited);
            let scraped_count = Arc::clone(&scraped_count);
            let semaphore = Arc::clone(&semaphore);

            join_set.spawn(async move {
                let _permit = semaphore.acquire().await.expect("Failed to acquire semaphore permit");
                println!("Scraping: {}", current_url);

                let task_logic = || async {
                    let response = ScraperResponse::get(&current_url).await?;
                    let website_id = insert_website(&pool, &current_url, response.title, response.description).await?;

                    for (_, button_detail) in response.buttons {
                        {
                            let mut q = queue.lock().await;
                            let mut v = visited.lock().await;

                            let button_src_url = &button_detail.src;
                            if !PROHIBITED_LINKS.iter().any(|&prohibited| button_src_url.contains(prohibited)) {
                                 if v.insert(button_src_url.clone()) {
                                     if button_src_url.contains('?') {
                                         q.push_back(button_src_url.clone());
                                     } else {
                                         q.push_front(button_src_url.clone());
                                     }
                                     if let Err(e) = insert_link(&pool, &button_src_url).await {
                                         eprintln!("Failed to insert button src link {}: {}", button_src_url, e);
                                     }
                                 }
                            }

                            if let Some(ref links_to_url) = button_detail.links_to {
                                if !PROHIBITED_LINKS.iter().any(|&prohibited| links_to_url.contains(prohibited)) {
                                    if v.insert(links_to_url.clone()) {
                                        if links_to_url.contains('?') {
                                            q.push_back(links_to_url.clone());
                                        } else {
                                            q.push_front(links_to_url.clone());
                                        }
                                        if let Err(e) = insert_link(&pool, &links_to_url).await {
                                            eprintln!("Failed to insert links_to link {}: {}", links_to_url, e);
                                        }
                                    }
                                }
                            }
                        }

                        let pool_clone = pool.clone();
                        let button_src_url_clone = button_detail.src.clone();
                        let alt_clone = button_detail.alt.clone();
                        let links_to_url_clone = button_detail.links_to.clone();
                        
                        tokio::spawn(async move {
                            match process_button_image(&pool_clone, &button_src_url_clone, alt_clone).await {
                                Ok(button_id) => {
                                    if let Err(e) = sqlx::query(
                                        r#"
                                        INSERT INTO buttons_relations (button_id, website_id, links_to_url)
                                        VALUES ($1, $2, $3)
                                        ON CONFLICT (button_id, website_id) DO NOTHING
                                        "#
                                    )
                                        .bind(button_id)
                                        .bind(website_id)
                                        .bind(links_to_url_clone)
                                        .execute(&pool_clone).await {
                                        eprintln!("Failed to insert button relation for button {} on website {}: {}", button_id, website_id, e);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Failed to process button image {}: {}", button_src_url_clone, e);
                                }
                            }
                        });
                    }
                    
                    let mut count = scraped_count.lock().await;
                    *count += 1;
                    println!("Successfully scraped and processed buttons from: {}. Pages scraped: {}", current_url, *count);

                    Ok::<(), Box<dyn Error + Send + Sync>>(())
                };

                if let Err(e) = task_logic().await {
                    eprintln!("Task failed for {}: {}", current_url, e);
                }
            });
        } else {
            if join_set.is_empty() {
                break;
            }
            if join_set.join_next().await.is_none() {
                 break;
            }
        }
    }

    while join_set.join_next().await.is_some() {}

    println!("Concurrent scraping finished. Scraped {} pages.", *scraped_count.lock().await);

    Ok(())
}
