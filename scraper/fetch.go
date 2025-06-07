package main

import (
    "bufio"
    "fmt"
	"os"
	"net/http"
	"net/url"

	"github.com/joho/godotenv"
)

func FetchScraperWorker(url string) (string, error) {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("error loading .env file: %w", err)
	}

	worker := os.Getenv("SCRAPER_WORKER")
	if worker == "" {
		return "", fmt.Errorf("SCRAPER_WORKER not set in environment")
	}

	resp, err := http.Get(worker + EncodeParam(url))
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	// Print the HTTP response status.
	fmt.Println("Response status:", resp.Status)

	// Print the first 5 lines of the response body.
	scanner := bufio.NewScanner(resp.Body)
	for i := 0; scanner.Scan() && i < 5; i++ {
		fmt.Println(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		panic(err)
	}

	return worker, nil
}

func EncodeParam(s string) string {
    return url.QueryEscape(s)
}