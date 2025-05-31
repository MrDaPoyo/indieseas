use reqwest;
use std::error::Error;

pub async fn is_allowed(domain: &str) -> Result<bool, Box<dyn Error>> {
    let robots_url = format!("{}robots.txt", domain);
    
    let response = reqwest::get(&robots_url).await?;
    let content = response.text().await?;
    
    let mut current_user_agent = "";
    let mut applies_to_indieseas = false;
    
    for line in content.lines() {
        let line = line.trim();
        
        if line.starts_with("User-agent:") {
            let agent = line.split(':').nth(1).unwrap_or("").trim();
            current_user_agent = agent;
            applies_to_indieseas = agent == "*" || agent.to_lowercase() == "indieseas";
        } else if line.starts_with("Disallow:") && applies_to_indieseas {
            let path = line.split(':').nth(1).unwrap_or("").trim();
            if path == "/" {
                return Ok(false);
            }
        }
    }
    
    Ok(true)
}