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

type ScraperWorkerResponse struct {
	RawText     string          `json:"rawText"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Buttons     []ScraperButton `json:"buttons"`
	Links       []ScraperLink   `json:"links"`
}

type ScraperButton struct {
	Src     string `json:"src"`
	LinksTo string `json:"links_to"`
	Alt     string `json:"alt,omitempty"`
}

type ScraperLink struct {
	Href string `json:"href"`
	Text string `json:"text"`
}

var globalScrapedButtons = make(map[string]struct{})

func AppendLink(baseURL string, href string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return strings.TrimSuffix(href, "/") + "/"
	}

	if strings.HasPrefix(href, "/") {
		// Extract scheme and host
		var protoHost string
		if idx := strings.Index(baseURL, "://"); idx != -1 {
			rest := baseURL[idx+3:]
			host := strings.Split(rest, "/")[0]
			protoHost = baseURL[:idx+3] + host
		} else {
			protoHost = baseURL
		}
		return strings.TrimSuffix(protoHost, "/") + href
	}

	href = strings.TrimSuffix(href, "/")

	base := strings.TrimSuffix(baseURL, "/")
	return base + "/" + href
}

func ProcessButton(Db *sqlx.DB, url string, button ScraperButton) (*Button, error) {
	if exists, _ := DoesButtonExist(Db, url); exists {
		log.Printf("Button already exists in database: %s", url)
		return nil, fmt.Errorf("button already exists in database: %s", url)
	}
	var buttonContents, statusCode = FetchButton(url)
	if buttonContents == nil {
		return nil, fmt.Errorf("failed to fetch button image from %s", url)
	}
	var ColorAnalysis = NewColorAnalyzer().AnalyzeImage(buttonContents)
	colorTagStr := strings.Join(ColorAnalysis.Tags, ",")
	var ButtonData = Button{
		URL:          url,
		StatusCode:   statusCode,
		ColorTag:     colorTagStr,
		ColorAverage: ColorAnalysis.HexAverage,
		Alt:          button.Alt,
		Content:      buttonContents,
	}
	var err = InsertButton(Db, ButtonData)
	if err != nil {
		log.Printf("Failed to insert button data into database: %v", err)
	}

	return &ButtonData, err
}

func ScrapeSinglePage(url string) (*ScraperWorkerResponse, string, []ScraperButton, []ScraperLink, []ScraperLink, error) {
	resp, err := FetchScraperWorker(url)
	if err != nil {
		return nil, "", nil, nil, nil, fmt.Errorf("error fetching scraper worker: %w", err)
	}
	defer resp.Body.Close()

	var response ScraperWorkerResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, "", nil, nil, nil, fmt.Errorf("error decoding JSON response: %w", err)
	}

	var found_links []ScraperLink
	var internal_links []ScraperLink
	var found_buttons []ScraperButton
	var raw_text = Declutter(response.RawText)

	// prevent duplicates on this page
	buttonSrcSet := make(map[string]struct{})
	linkHrefSet := make(map[string]struct{})

	for _, button := range response.Buttons {
		src := button.Src

		// skip if we've already scraped this URL in a previous page
		if _, seenGlobally := globalScrapedButtons[src]; seenGlobally {
			continue
		}

		// external image-button
		if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			if _, seen := buttonSrcSet[src]; !seen {
				found_buttons = append(found_buttons, button)
				buttonSrcSet[src] = struct{}{}
				globalScrapedButtons[src] = struct{}{} // mark globally scraped
			}
			continue
		}

		// non-http src: treat button.LinksTo as link
		to := strings.TrimSpace(button.LinksTo)
		if to != "" {

			if strings.HasPrefix(to, "http://") || strings.HasPrefix(to, "https://") {
				if _, seen := linkHrefSet[to]; !seen {
					to = AppendLink(url, to)
					log.Printf("Found external link from button: %s -> %s", src, to)
					found_links = append(found_links, ScraperLink{Href: to, Text: button.Alt})
					linkHrefSet[to] = struct{}{}
				}
			} else {
				if _, seen := linkHrefSet[src]; !seen {
					internal_links = append(internal_links, ScraperLink{Href: AppendLink(url, src), Text: button.Alt})
					linkHrefSet[src] = struct{}{}
				}
			}
		}
	}

	for _, link := range response.Links {
		href := AppendLink(url, link.Href)
		if _, seen := linkHrefSet[href]; seen {
			continue
		}
		if strings.HasPrefix(href, url) {
			internal_links = append(internal_links, link)
		} else {
			found_links = append(found_links, link)
		}
		linkHrefSet[href] = struct{}{}
	}

	return &response, raw_text, found_buttons, found_links, internal_links, nil
}

func ScrapeEntireWebsite(db *sqlx.DB, rootURL string) ([]ScraperWorkerResponse, error) {
	var (
		pages []ScraperWorkerResponse
		queue = []string{rootURL}
		seen  = make(map[string]struct{})
	)

	robots, err := CheckRobotsTxt(rootURL)

	if err != nil {
		log.Printf("error checking robots.txt for %q: %v", rootURL, err)
		return nil, fmt.Errorf("error checking robots.txt for %q: %w", rootURL, err)
	}

	if robots != nil {
		for _, path := range robots.Disallowed {
			disallowedURL := AppendLink(rootURL, path)

			// enqueue it so we still “visit” it, but mark as disallowed
			seen[disallowedURL] = struct{}{}
			log.Println("Disallowed URL found:", disallowedURL)

			// insert into DB with special status code 999
			if err := InsertWebsite(db, disallowedURL, 999); err != nil {
				log.Printf("error inserting disallowed URL %q with status 999: %v", disallowedURL, err)
			}
		}
	}

	for len(queue) > 0 {
		url := queue[0]
		queue = queue[1:]
		if _, ok := seen[url]; ok {
			continue
		}
		seen[url] = struct{}{}

		resp, _, buttons, links, internalLinks, err := ScrapeSinglePage(url)
		if err != nil {
			log.Printf("error scraping %q: %v", url, err)
			continue
		}
		pages = append(pages, *resp)

		// insert external links into DB
		for _, link := range links {
			link.Href = AppendLink(url, link.Href)
			if err := InsertWebsite(db, link.Href); err != nil {
				log.Printf("error inserting website %q: %v", link.Href, err)
			}
		}

		// process buttons
		for _, btn := range buttons {
			if _, err := ProcessButton(db, btn.Src, btn); err != nil {}
			if to := btn.LinksTo; strings.HasPrefix(to, "http://") || strings.HasPrefix(to, "https://") {
				if err := InsertWebsite(db, to); err != nil {
					log.Printf("error inserting website from button %q: %v", to, err)
				}
			}
		}

		// enqueue internal links for further scraping
		for _, l := range internalLinks {
			next := AppendLink(url, l.Href)
			if _, ok := seen[next]; !ok {
				queue = append(queue, next)
			}
		}
	}

	log.Printf("Scraped %d pages from %s", len(seen), rootURL)
	for url := range seen {
		log.Println(url)
	}
	return pages, nil
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

	// log.Println(Declutter(response.RawText))
	// log.Println(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif"))
	// log.Println(ScrapeSinglePage("https://toastofthesewn.nekoweb.org/"))
	// log.Println(NewColorAnalyzer().AnalyzeImage(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif")))
	// ScrapeEntireWebsite(db, "https://illiterate.nekoweb.org/") // example of a website that disallows scraping
	ScrapeEntireWebsite(db, "https://toastofthesewn.nekoweb.org/") // example of a website that allows scraping
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test", "/img/maxpixels.gif"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "/img/maxpixels/"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "img/maxpixels.gif"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "img/maxpixels.gif/"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test", "https://poyoweb.org/index.html"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "https://poyoweb.org/index.html/"))
}
