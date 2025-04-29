use reqwest;
use scraper::{Html, Selector};

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

fn extract_urls_from_html(body: String, path: String) -> String {
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
            let is_prohibited = PROHIBITED_LINKS.iter().any(|&prohibited| new_link.contains(prohibited));
            new_link = new_link.to_lowercase();
            if new_link != path && !is_prohibited && !links.contains(&new_link) {
                links.push(new_link);
            }
        }
    }
    let mut unique_links = links.clone();
    unique_links.sort();
    unique_links.dedup();
    println!("Unique links: {:?}", unique_links);
    unique_links.join("")
}

fn scrape_path(path: &str) -> Result<String, reqwest::Error> {
    let url = format!("https://{}", path);
    let response = reqwest::blocking::get(&url)?;
    let body = response.text()?;
    let links = extract_urls_from_html(body, path.to_string());
    Ok(links)
}

fn main() {
    let _ = scrape_path("nekoweb.org");
}