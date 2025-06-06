use reqwest;
use std::collections::HashMap;
use std::error::Error;
use url::Url;

#[derive(Debug, Clone)]
pub struct RobotsRule {
    pub user_agent: String,
    pub allowed_paths: Vec<String>,
    pub disallowed_paths: Vec<String>,
}

#[derive(Debug)]
pub struct RobotsResult {
    pub allowed: Vec<String>,
    pub disallowed: Vec<String>,
}

pub async fn check_robots_txt(url: &str) -> Result<Option<RobotsResult>, Box<dyn Error>> {
    let base_url = Url::parse(url)?;
    let robots_url = format!("{}/robots.txt", base_url.origin().ascii_serialization());
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    
    let response = client.get(&robots_url).send().await?;
    
    if !response.status().is_success() {
        return Ok(None);
    }
    
    let content = response.text().await?;
    
    if content.is_empty() {
        return Ok(None);
    }
    
    if content.len() > 5000 {
        return Ok(None);
    }
    
    let rules = parse_robots_txt(&content);
    let allowed_paths = get_allowed_paths(&rules, &["*", "indieseas"], &base_url.origin().ascii_serialization());
    
    let wildcard = allowed_paths.get("*").cloned().unwrap_or_default();
    let indieseas = allowed_paths.get("indieseas").cloned().unwrap_or_default();
    
    Ok(Some(RobotsResult {
        allowed: [wildcard.allowed, indieseas.allowed].concat(),
        disallowed: [wildcard.disallowed, indieseas.disallowed].concat(),
    }))
}

fn parse_robots_txt(content: &str) -> Vec<RobotsRule> {
    let lines: Vec<&str> = content.lines().collect();
    let mut rules = Vec::new();
    let mut current_rule: Option<RobotsRule> = None;
    
    if lines.is_empty() {
        return rules;
    }
    
    for line in lines {
        let line = line.split('#').next().unwrap_or("").trim().to_lowercase();
        if line.is_empty() {
            continue;
        }
        
        if line.starts_with("user-agent:") {
            let user_agent = line.strip_prefix("user-agent:").unwrap_or("").trim().to_string();
            
            if let Some(ref mut rule) = current_rule {
                if rule.user_agent == user_agent {
                    continue;
                }
            }
            
            let new_rule = RobotsRule {
                user_agent,
                allowed_paths: Vec::new(),
                disallowed_paths: Vec::new(),
            };
            
            if let Some(rule) = current_rule.take() {
                rules.push(rule);
            }
            current_rule = Some(new_rule);
        } else if line.starts_with("allow:") {
            let path = line.strip_prefix("allow:").unwrap_or("").trim();
            if !path.is_empty() {
                if let Some(ref mut rule) = current_rule {
                    rule.allowed_paths.push(path.to_string());
                } else {
                    current_rule = Some(RobotsRule {
                        user_agent: "*".to_string(),
                        allowed_paths: vec![path.to_string()],
                        disallowed_paths: Vec::new(),
                    });
                }
            }
        } else if line.starts_with("disallow:") {
            let path = line.strip_prefix("disallow:").unwrap_or("").trim();
            if !path.is_empty() {
                if let Some(ref mut rule) = current_rule {
                    rule.disallowed_paths.push(path.to_string());
                } else {
                    current_rule = Some(RobotsRule {
                        user_agent: "*".to_string(),
                        allowed_paths: Vec::new(),
                        disallowed_paths: vec![path.to_string()],
                    });
                }
            }
        }
    }
    
    if let Some(rule) = current_rule {
        rules.push(rule);
    }
    
    rules
}

#[derive(Debug, Default, Clone)]
struct PathResult {
    allowed: Vec<String>,
    disallowed: Vec<String>,
}

fn get_allowed_paths(rules: &[RobotsRule], user_agents: &[&str], base_url: &str) -> HashMap<String, PathResult> {
    let mut result = HashMap::new();
    let normalized_user_agents: Vec<String> = user_agents.iter().map(|ua| ua.to_lowercase()).collect();
    
    // Initialize result with all requested user agents
    for ua in &normalized_user_agents {
        result.insert(ua.clone(), PathResult::default());
    }
    
    // Find wildcard rules first to use as fallback
    let wildcard_rules: Vec<&RobotsRule> = rules.iter().filter(|rule| rule.user_agent == "*").collect();
    
    // Find applicable rules for each user agent
    for ua in &normalized_user_agents {
        let specific_rules: Vec<&RobotsRule> = rules.iter().filter(|rule| rule.user_agent == *ua).collect();
        let applicable_rules = if !specific_rules.is_empty() { specific_rules } else { wildcard_rules.clone() };
        
        let mut path_result = PathResult::default();
        
        if applicable_rules.is_empty() {
            // No specific rules and no wildcard rules, so everything is allowed by default
            path_result.allowed.push(format!("{}/", base_url));
        } else {
            for rule in applicable_rules {
                // If no disallow rules, everything is allowed
                if rule.disallowed_paths.is_empty() {
                    path_result.allowed.push(format!("{}/", base_url));
                    continue;
                }
                
                // Add all explicitly allowed paths
                for path in &rule.allowed_paths {
                    let mut normalized_path = path.replace('*', "");
                    if !normalized_path.starts_with('/') {
                        normalized_path = format!("/{}", normalized_path);
                    }
                    path_result.allowed.push(format!("{}{}", base_url, normalized_path));
                }
                
                // Add all disallowed paths
                for path in &rule.disallowed_paths {
                    let mut normalized_path = path.replace('*', "");
                    if !normalized_path.starts_with('/') {
                        normalized_path = format!("/{}", normalized_path);
                    }
                    path_result.disallowed.push(format!("{}{}", base_url, normalized_path));
                }
            }
            
            // If no specific allowed paths but disallow paths exist, root path is allowed
            let root_path = format!("{}/", base_url);
            if path_result.allowed.is_empty() && !path_result.disallowed.contains(&root_path) {
                path_result.allowed.push(root_path);
            }
        }
        
        result.insert(ua.clone(), path_result);
    }
    
    result
}

pub async fn is_allowed(domain: &str) -> Result<bool, Box<dyn Error>> {
    let robots_url = if domain.ends_with('/') {
        format!("{}robots.txt", domain)
    } else {
        format!("{}/robots.txt", domain)
    };
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let response = client.get(&robots_url).send().await?;
    let content = response.text().await?;
    
    let mut applies_to_indieseas = false;
    
    for line in content.lines() {
        let line = line.trim();
        
        if line.starts_with("User-agent:") {
            let agent = line.split(':').nth(1).unwrap_or("").trim();
            applies_to_indieseas = agent == "*" || agent.to_lowercase() == "indieseas";
        } else if line.starts_with("Disallow:") && applies_to_indieseas {
            let path = line.split(':').nth(1).unwrap_or("").trim();
            if path == "/" {
                return Ok(false);
            }
        } else if line.is_empty() {
            applies_to_indieseas = false;
        }
    }
    
    Ok(true)
}