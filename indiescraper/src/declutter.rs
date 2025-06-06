use std::collections::HashMap;

pub fn analyze_text_frequency(text: &str) -> HashMap<String, usize> {
    let clutter_words: std::collections::HashSet<&str> = [
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", 
        "of", "with", "by", "from", "as", "is", "are", "was", "were", "be", 
        "been", "have", "has", "had", "do", "does", "did", "will", "would", 
        "could", "should", "may", "might", "can", "this", "that", "these", 
        "those", "i", "you", "he", "she", "it", "we", "they", "me", "him", 
        "her", "us", "them", "my", "your", "his", "her", "its", "our", "their"
    ].iter().cloned().collect();

    let mut word_frequency = HashMap::new();

    let binding = text
        .to_lowercase();

    let words: Vec<&str> = binding
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphabetic())
        })
        .filter(|word| {
            !word.is_empty() && !clutter_words.contains(word) && word.len() > 2
        })
        .collect();

    for word in words {
        *word_frequency.entry(word.to_string()).or_insert(0) += 1;
    }

    word_frequency
}