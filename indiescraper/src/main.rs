use reqwest;
use scraper::{Html, Selector};
use sqlx::postgres::PgPoolOptions;
use sqlx::Postgres;
use sqlx::Pool;
use sqlx::Row;
use dotenv::dotenv;
use image;

static PROHIBITED_LINKS: [&str; 32] = [
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
    "t.co",
    "bit.ly",
    "tinyurl.com",
    "goo.gl",
    "ow.ly",
    "ftp://",
];

const scraper_worker: String = env.var("SCRAPER_WORKER").expect("SCRAPER_WORKER must be set");

async fn check_button(buffer: &[u8], url: &str) -> Result<bool, image::ImageError> {
    let img = image::load_from_memory(buffer)?;
    let (width, height) = img.dimensions();
    if width == 88 && height == 31 {
        println!("Found button: {}", url);
        return Ok(true);
    }
    Ok(false)
}

async fn scrape_path(path: &str, pool: Pool<Postgres> ) -> Result<String, reqwest::Error> {
    let url: String = path.to_string();
    if path.starts_with("http") {
        url = path.replace("http://", "https://").replace("https://", "");
    }
    let response_result = reqwest::get(&url).await;
    let response = match response_result {
        Ok(resp) => resp,
        Err(e) => {
            println!("Failed to fetch {}: {}", url, e);
            return Err(e);
        }
    };

    if !response.status().is_success() {
        println!("Failed to fetch {}: {}", url, response.status());
        let _ = sqlx::query(
            r#"
            INSERT INTO websites (url, status_code)
            VALUES ($1, $2)
            ON CONFLICT (url) DO UPDATE SET status_code = $2
            "#,
        )
        .bind(&url)
        .bind(response.status().as_u16() as i32)
        .execute(&pool)
        .await;
        return Ok(String::new());
    }

    let status_code = response.status();
    let body = response.text().await?;
    let document = Html::parse_document(&body);

    let title_selector = Selector::parse("title").unwrap();
    let meta_desc_selector = Selector::parse("meta[name='description']").unwrap();

    let title = document.select(&title_selector).next().map(|element| element.inner_html());
    let description = document.select(&meta_desc_selector).next().and_then(|element| {
        element.value().attr("content").map(|s| s.to_string())
    });

    let img_selector = Selector::parse("img").unwrap();
    for img in document.select(&img_selector) {
        let src = match img.value().attr("src") {
            Some(src) => src,
            None => continue,
        };
        
        if PROHIBITED_LINKS.iter().any(|prohibited| src.contains(prohibited)) {
            continue;
        }
        
        let img_url = if src.starts_with("http") {
            src.to_string()
        } else if src.starts_with("/") {
            format!("https://{}{}", url, src)
        } else {
            format!("https://{}/{}", url, src)
        };
        
        let alt = img.value().attr("alt").unwrap_or("");
        
        let mut links_to = None;
        let mut parent = img.parent();
        while let Some(parent_element) = parent {
            if let Some(element) = parent_element.value().as_element() {
                if element.name() == "a" {
                    if let Some(href) = element.attr("href") {
                        links_to = Some(href.to_string());
                        break;
                    }
                }
            }
            parent = parent_element.parent();
        }
        
        if let Ok(img_response) = reqwest::get(&img_url).await {
            if img_response.status().is_success() {
                if let Ok(content) = img_response.bytes().await {
                    println!("Found button: {} (links to: {:?})", img_url, links_to);
                    
                    let _ = sqlx::query(
                        "INSERT INTO buttons (url, status_code, alt, title, content) 
                         VALUES ($1, $2, $3, $4, $5) 
                         ON CONFLICT (url) DO UPDATE SET 
                         status_code = $2, alt = $3, title = $4, content = $5"
                    )
                    .bind(&img_url)
                    .bind(img_response.status().as_u16() as i32)
                    .bind(alt)
                    .bind(links_to)
                    .bind(&content.to_vec())
                    .execute(&pool)
                    .await;
                }
            }
        }
    }


    let links = extract_urls_from_html(body, path.to_string(), &pool).await;
    let _ = sqlx::query(
        r#"
        INSERT INTO websites (url, status_code, title, description) 
        VALUES ($1, $2, $3, $4) 
        ON CONFLICT (url) DO UPDATE SET status_code = $2, title = $3, description = $4
        "#,
    )
    .bind(&url)
    .bind(status_code.as_u16() as i32) // Bind status_code as i32 for $2
    .bind(&title)                      // Bind title for $3
    .bind(description)                 // Bind description for $4
    .execute(&pool)
    .await;
    println!("Scraped {}: {} - {}", url, status_code, title.unwrap_or_default());
    Ok(links)
}

async fn initialize_db() -> Result<Pool<Postgres>, sqlx::Error> {
    let db_url = dotenv::var("DB_URL").expect("DB_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&db_url)
        .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS found_links (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS websites (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            title TEXT,
            description TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS pages (
            id SERIAL PRIMARY KEY,
            website_id INTEGER REFERENCES websites(id),
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            description TEXT,
            title TEXT,
            UNIQUE(url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

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
            UNIQUE(url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS buttons_relations (
            id SERIAL PRIMARY KEY,
            button_id INTEGER REFERENCES buttons(id),
            page_id INTEGER REFERENCES pages(id),
            UNIQUE(button_id, page_id)
        );
        "#,
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

async fn insert_link(pool: &Pool<Postgres>, link: &str) -> Result<(), sqlx::Error> {
    if sqlx::query("SELECT EXISTS(SELECT 1 FROM found_links WHERE url = $1)")
        .bind(link)
        .fetch_one(pool)
        .await?
        .get::<bool, _>(0)
    {
        return Ok(());
    }
    sqlx::query("INSERT INTO found_links (url) VALUES ($1) ON CONFLICT (url) DO NOTHING")
        .bind(link)
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let pool = initialize_db().await.expect("Failed to initialize database");
    let row = sqlx::query("SELECT COUNT(*) FROM found_links")
        .fetch_one(&pool)
        .await?;
    let count: i64 = row.get(0);
    if count == 0 {
        scrape_path("nekoweb.org", pool.clone()).await?;
    }
    loop {
        let link_row = sqlx::query(
            r#"
            SELECT url FROM found_links 
            WHERE url NOT IN (SELECT url FROM websites) 
            ORDER BY scraped_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        if let Some(row) = link_row {
            let link: String = row.get(0);
            println!("Processing link: {}", link);
            match scrape_path(&link, pool.clone()).await {
                Ok(_) => {
                }
                Err(e) => {
                    eprintln!("Failed to scrape {}: {}", link, e);
                     let _ = sqlx::query(
                        r#"
                        INSERT INTO websites (url, status_code)
                        VALUES ($1, $2)
                        ON CONFLICT (url) DO UPDATE SET status_code = $2
                        "#,
                    )
                    .bind(&link)
                    .bind(-1i32) // Use a specific code for scraping errors
                    .execute(&pool)
                    .await;
                }
            }
        } else {
            println!("No new links to scrape. Exiting.");
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    Ok(())
}