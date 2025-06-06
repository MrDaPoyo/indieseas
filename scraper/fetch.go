package main

import (
	"encoding/json"
	"strings"
	"bufio"
	"fmt"
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

	return resp, nil
}

func EncodeParam(s string) string {
    return url.QueryEscape(s)
}

func FetchButton(url string) []byte {
	resp, err := http.Get(url)
	if err != nil {
		fmt.Printf("Error fetching URL: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || (contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/gif") {
		fmt.Println("URL is not an image")
		return nil
	}

	img, _, err := image.Decode(resp.Body)
	if err != nil {
		fmt.Printf("Error decoding image: %v\n", err)
		return nil
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	if width == 88 && height == 31 {
		fmt.Println("Image is 88x31 pixels")
		resp.Body.Close()
		resp, err = http.Get(url)
		if err != nil {
			fmt.Printf("Error re-fetching URL: %v\n", err)
			return nil
		}
		defer resp.Body.Close()
		
		buffer := make([]byte, 0)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Split(bufio.ScanBytes)
		for scanner.Scan() {
			buffer = append(buffer, scanner.Bytes()...)
		}

		return buffer
	} else {
		fmt.Printf("Image is %dx%d pixels, not 88x31\n", width, height)
	}
	return nil
}

func VectorizeText(text string) []string {
	jsonData := fmt.Sprintf(`{"text": "%s"}`, strings.ReplaceAll(text, `"`, `\"`))
	resp, err := http.Post(os.Getenv("AI_API_EMBEDDING_URL"), "application/json", strings.NewReader(jsonData))
	if err != nil {
		fmt.Printf("Error vectorizing text: %v\n", err)
		return nil
	}
	defer resp.Body.Close()
	
	var result struct {
		Vectors [][]float64 `json:"vectors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fmt.Printf("Error decoding JSON response: %v\n", err)
		return nil
	}
	
	if len(result.Vectors) > 0 {
		embeddings := make([]string, len(result.Vectors[0]))
		for i, v := range result.Vectors[0] {
			embeddings[i] = fmt.Sprintf("%f", v)
		}
		return embeddings
	}
	return nil
}