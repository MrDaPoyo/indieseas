package main

import (
	"regexp"
	"strings"
	"log"

	"github.com/reiver/go-porterstemmer"
)

func Declutter(input string) map[string]int {
	text := strings.ToLower(input)
	
	urlPattern := regexp.MustCompile(`https?://[^\s]+|www\.[^\s]+|\S+\.\S+`)
	text = urlPattern.ReplaceAllString(text, "")
	
	emailPattern := regexp.MustCompile(`\S+@\S+\.\S+`)
	text = emailPattern.ReplaceAllString(text, "")
	
	handlePattern := regexp.MustCompile(`@\w+`)
	text = handlePattern.ReplaceAllString(text, "")
	
	specialChars := regexp.MustCompile(`[^\w\s]`)
	text = specialChars.ReplaceAllString(text, " ")
	
	stopWords := []string{
		"the", "is", "at", "which", "on", "a", "an", "and", "or", "but", "in", "with", "to", "for", "of", "as", "by", "that", "this", "it", "from", "they", "we", "you", "i", "me", "my", "your", "are", "was", "were", "been", "be", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "can", "shall", "am", "who", "what", "where", "when", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "now", "just", "last", "till", "unless",
	}
	prepositions := []string{
		"about", "above", "across", "after", "against", "along", "among", "around", "before", "behind", "below", "beneath", "beside", "between", "beyond", "during", "except", "inside", "into", "near", "over", "through", "throughout", "toward", "under", "until", "upon", "within", "without", "outside", "underneath", "alongside", "amid", "amidst", "concerning", "regarding", "despite", "excluding", "following", "including", "pending", "plus", "versus", "via", "according", "because", "since", "although", "though", "however", "therefore", "moreover", "furthermore", "nevertheless", "meanwhile", "otherwise", "consequently", "accordingly", "hence", "thus",
	}

	for _ = range stopWords {
		stopWords = append(stopWords, prepositions...)
	}
	
	words := strings.Fields(text)
	
	frequencies := make(map[string]int)
	for _, word := range words {
		word = strings.TrimSpace(word)
		if len(word) > 3 && !containsBuzzword(stopWords, word) {
			word = RootOfWord(word)
			word = strings.Trim(word, ".,!?;:\"'()[]{}<>")
			word = strings.TrimSpace(word)
			frequencies[word]++
		}
	}
	
	return frequencies
}

func containsBuzzword(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func RootOfWord(word string) string {
	word = strings.ToLower(word)

	stemmed := porterstemmer.StemString(word)
	return stemmed
}