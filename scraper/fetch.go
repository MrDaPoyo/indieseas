package main

import (
	"encoding/json"
	"strings"
	"bufio"
	"fmt"
	"io"
	"os"
	"net/http"
	"net/url"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/joho/godotenv"
)

func FetchScraperWorker(url string) (*http.Response, error) {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("error loading .env file: %w", err)
	}

	worker := os.Getenv("SCRAPER_WORKER")
	if worker == "" {
		return nil, fmt.Errorf("SCRAPER_WORKER not set in environment")
	}

	resp, err := http.Get(worker + EncodeParam(url))
	if err != nil {
		panic(err)
	}
	
	if resp.StatusCode == http.StatusTooManyRequests {
		fmt.Fprintln(os.Stderr, "Error: received 429 Too Many Requests, exiting.")
		os.Exit(1)
	}

	return resp, nil
}

func EncodeParam(s string) string {
    return url.QueryEscape(s)
}

func FetchButton(url string) ([]byte, int) {
	resp, err := http.Get(url)
	if err != nil {
		fmt.Printf("Error fetching URL: %v\n", err)
		return nil, 0
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || (contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/gif") {
		return nil, 0
	}

	img, _, err := image.Decode(resp.Body)
	if err != nil {
		fmt.Printf("Error decoding image: %v\n", err)
		return nil, 0
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	if width == 88 && height == 31 {
		resp.Body.Close()
		resp, err = http.Get(url)
		if err != nil {
			fmt.Printf("Error re-fetching URL: %v\n", err)
			return nil, 0
		}
		defer resp.Body.Close()
		
		buffer := make([]byte, 0)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Split(bufio.ScanBytes)
		for scanner.Scan() {
			buffer = append(buffer, scanner.Bytes()...)
		}

		return buffer, 200
	}
	return nil, 0
}
func VectorizeText(text string) []float64 {
	// load environment
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		fmt.Printf("Error loading .env file: %v\n", err)
		return nil
	}
	apiURL := os.Getenv("AI_API_EMBEDDING_URL")
	if apiURL == "" {
		fmt.Println("AI_API_EMBEDDING_URL not set in environment")
		return nil
	}

	jsonData := fmt.Sprintf(`{"text": "%s"}`, strings.ReplaceAll(text, `"`, `\"`))
	resp, err := http.Post(apiURL, "application/json", strings.NewReader(jsonData))
	if err != nil {
		fmt.Printf("Error vectorizing text: %v\n", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		fmt.Printf("Non-OK HTTP status: %s, body: %s\n", resp.Status, string(bodyBytes))
		return nil
	}

	var result struct {
		Vectors [][]float64 `json:"vectors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fmt.Printf("Error decoding JSON response: %v\n", err)
		return nil
	}
	
	return result.Vectors[0]
}