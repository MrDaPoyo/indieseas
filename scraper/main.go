package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"

	"github.com/joho/godotenv"
)

type ScraperButton struct {
	Src     string  `json:"src"`
	LinksTo string `json:"links_to"`
	Alt     string  `json:"alt,omitempty"`
}

type ScraperLink struct {
	Href string `json:"href"`
	Text string `json:"text"`
}

type ScraperWorkerResponse struct {
	RawText     string          `json:"rawText"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Buttons     []ScraperButton `json:"buttons"`
	Links       []ScraperLink   `json:"links"`
}

func main() {

	if err := godotenv.Load(); err != nil {
		log.Fatalln("Error loading .env file:", err)
	}

	// Load the full database URL if set, otherwise fall back to individual vars
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbName := os.Getenv("DB_NAME")
		dbUser := os.Getenv("DB_USER")
		dbPassword := os.Getenv("DB_PASSWORD")
		dbHost := os.Getenv("DB_HOST")
		dbPort := os.Getenv("DB_PORT")
		dbSSL := os.Getenv("DB_SSL")

		dbURL = fmt.Sprintf(
			"postgresql://%s:%s@%s:%s/%s?sslmode=%s",
			dbUser, dbPassword, dbHost, dbPort, dbName, dbSSL,
		)
	}

	// disable SSL explicitly
	if !strings.Contains(dbURL, "sslmode=") {
		if strings.Contains(dbURL, "?") {
			dbURL += "&sslmode=disable"
		} else {
			dbURL += "?sslmode=disable"
		}
	}
	db, err := sqlx.Connect("postgres", dbURL)
	if err != nil {
		log.Fatalln(err)
	}
	defer db.Close()
	if err := CreateSchema(db); err != nil {
		log.Fatalf("Failed to create schema: %v", err)
	}

	log.Println("Schema setup complete.")

	var response ScraperWorkerResponse
	data, err := FetchScraperWorker("https://toastofthesewn.nekoweb.org/")

	if err != nil {
		log.Println("Error fetching scraper worker data:", err)
		return
	}

	log.Println(data)

	if err := json.Unmarshal([]byte(data), &response); err != nil {
		log.Printf("Error unmarshalling JSON: %v", err)
		return
	}
	
	log.Println(Declutter(response.RawText))
	log.Println(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif"))
}
