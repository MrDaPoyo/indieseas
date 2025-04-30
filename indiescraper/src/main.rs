use reqwest;
use scraper::{Html, Selector};
use sqlx::postgres::PgPoolOptions;
use sqlx::Postgres;
use sqlx::Pool;
use dotenv::dotenv;

static PROHIBITED_LINKS: [&str; 26] = [
    "mailto:",
    "tel:",
    "javascript:",
    "discord.com",
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

async fn extract_urls_from_html(body: String, path: String, pool: &Pool<Postgres>) -> String {
    let document = Html::parse_document(&body);
    let selector = Selector::parse("a").unwrap();
    let mut links = Vec::new();
    for element in document.select(&selector) {
        if let Some(link) = element.value().attr("href") {
            let mut new_link: String;
            if link.starts_with("http") {
                new_link = link.to_string();
            } else if link.starts_with("//") {
                new_link = format!("https:{}", link);
            } else if link.starts_with("/") {
                new_link = format!("https://{}/{}", path, &link[1..]);
            } else {
                new_link = format!("https://{}/{}", path, link);
            }

            if new_link.ends_with('/') {
                new_link = new_link[..new_link.len() - 1].to_string();
            }

            let is_prohibited = PROHIBITED_LINKS.iter().any(|&prohibited| new_link.contains(prohibited));
            new_link = new_link.to_lowercase();
            if new_link != path && !is_prohibited && !links.contains(&new_link) {
                links.push(new_link.clone());
                let push_link: &str = &new_link.clone();
                insert_link(pool, &push_link).await.unwrap_or_else(|_| {
                    println!("Failed to insert link: {}", push_link);
                });
            }
        }
    }
    let mut unique_links = links.clone();
    unique_links.sort();
    unique_links.dedup();
    println!("Unique links: {:?}", unique_links);
    unique_links.join("")
}

async fn scrape_path(path: &str, pool: Pool<Postgres> ) -> Result<String, reqwest::Error> {
    let url = format!("https://{}", path);
    let response = reqwest::get(&url).await?;
    let body = response.text().await?;
    let links = extract_urls_from_html(body, path.to_string(), &pool).await;
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
        CREATE TABLE IF NOT EXISTS websites (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            title TEXT,
            description TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(url)
        );
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
        CREATE TABLE IF NOT EXISTS buttons (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            status_code INTEGER,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            alt TEXT,
            title TEXT,
            content BLOB,
            UNIQUE(url)
        );
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
    sqlx::query("INSERT INTO found_links (url) VALUES ($1)")
        .bind(link)
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let pool = initialize_db().await.expect("Failed to initialize database");
    scrape_path("nekoweb.org", pool).await?;
    Ok(())
}