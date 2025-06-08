package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	"sync"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"

	"github.com/joho/godotenv"
)

var FORBIDDEN_WEBSITES = []string{
	".google.com",
	".facebook.com",
	".twitter.com",
	".instagram.com",
	".linkedin.com",
	".youtube.com",
	".tiktok.com",
	".pinterest.com",
	".reddit.com",
	".wikipedia.org",
	".github.com",
	".gitlab.com",
	".bitbucket.org",
	".stackoverflow.com",
	".quora.com",
	".amazon.com",
	".ebay.com",
	".newground.com",
	".tumblr.com",
	".yahoo.com",
	".bing.com",
	".yandex.com",
	".baidu.com",
	".vk.com",
	".weibo.com",
	".twitch.tv",
	".discord.com",
	".whatsapp.com",
	".telegram.org",
	".signal.org",
	".slack.com",
	".microsoft.com",
	".apple.com",
	".adobe.com",
	".paypal.com",
	".bsky.app",
	"://g.co",
}

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

func isForbidden(url string) bool {
	for _, fw := range FORBIDDEN_WEBSITES {
		if strings.Contains(url, fw) {
			return true
		}
	}
	return false
}

func AppendLink(baseURL, href string) string {
	// strip off any fragment identifiers to prevent repeated “#/” loops
	if i := strings.Index(href, "#"); i != -1 {
		href = href[:i]
	}
	// if href is now empty, just return the base URL (normalized)
	if href == "" {
		return strings.TrimSuffix(baseURL, "/") + "/"
	}

	// fully qualified URL
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return strings.TrimSuffix(href, "/") + "/"
	}

	// absolute path on same host
	if strings.HasPrefix(href, "/") {
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

	// relative path
	href = strings.TrimSuffix(href, "/")
	base := strings.TrimSuffix(baseURL, "/")
	return base + "/" + href
}

func ProcessButton(Db *sqlx.DB, url string, button ScraperButton) (*Button, error) {
	if exists, _ := DoesButtonExist(Db, url); exists {
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
	InsertButton(Db, ButtonData)

	return &ButtonData, nil
}

func ScrapeSinglePage(url string, baseURL string) (*ScraperWorkerResponse, string, []ScraperButton, []ScraperLink, []ScraperLink, int, error) {
	resp, err := FetchScraperWorker(url)
	if err != nil {
		return nil, "", nil, nil, nil, 0, fmt.Errorf("error fetching scraper worker: %w", err)
	}
	defer resp.Body.Close()

	statusCode := resp.StatusCode

	var response ScraperWorkerResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, "", nil, nil, nil, statusCode, fmt.Errorf("error decoding JSON response: %w", err)
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

		if _, seenGlobally := globalScrapedButtons[src]; seenGlobally {
			continue
		}

		// external image-button
		if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			if _, seen := buttonSrcSet[src]; !seen {
				found_buttons = append(found_buttons, button)
				buttonSrcSet[src] = struct{}{}
				globalScrapedButtons[src] = struct{}{}
			}
			continue
		}

		// non-http src: treat button.LinksTo as link
		to := strings.TrimSpace(button.LinksTo)
		if to != "" {
			to = AppendLink(baseURL, to)
			if strings.HasPrefix(to, "http://") || strings.HasPrefix(to, "https://") {
				if _, seen := linkHrefSet[to]; !seen {
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

	return &response, raw_text, found_buttons, found_links, internal_links, statusCode, nil
}

// normalizeURL removes any trailing slash so URLs are compared consistently
func normalizeURL(u string) string {
	return strings.TrimSuffix(u, "/")
}

func ScrapeEntireWebsite(db *sqlx.DB, rootURL string) ([]ScraperWorkerResponse, error) {
	var (
		pages []ScraperWorkerResponse
		queue = []string{normalizeURL(rootURL)}
		seen  = make(map[string]struct{})
	)

	robots, err := CheckRobotsTxt(rootURL)
	if err != nil {
		log.Printf("error checking robots.txt for %q: %v", rootURL, err)
		return nil, fmt.Errorf("error checking robots.txt for %q: %w", rootURL, err)
	}
	if robots != nil {
		for _, path := range robots.Disallowed {
			disURL := normalizeURL(AppendLink(rootURL, path))
			seen[disURL] = struct{}{}
			if err := InsertWebsite(db, disURL, 999); err != nil {
				log.Printf("error inserting disallowed URL %q with status 999: %v", disURL, err)
			}
		}
	}

	type pageInfo struct {
		url        string
		resp       *ScraperWorkerResponse
		rawText    string
		buttons    []ScraperButton
		statusCode int
	}
	var pageInfos []pageInfo

	for len(queue) > 0 && len(pages) < 75 {
		raw := queue[0]
		queue = queue[1:]
		url := normalizeURL(raw)
		if _, ok := seen[url]; ok {
			continue
		}
		seen[url] = struct{}{}

		time.Sleep(500 * time.Millisecond)

		resp, rawText, buttons, links, internalLinks, statusCode, err :=
			ScrapeSinglePage(url, rootURL)
		if err != nil {
			continue
		}

		pages = append(pages, *resp)
		pageInfos = append(pageInfos, pageInfo{url, resp, rawText, buttons, statusCode})

		// enqueue/discover links under the same root; external ones go to DB
		for _, link := range links {
			href := normalizeURL(AppendLink(url, link.Href))
			if strings.HasPrefix(href, rootURL) {
				if _, ok := seen[href]; !ok {
					queue = append(queue, href)
				}
			} else {
				InsertWebsite(db, href)
			}
		}

		// process buttons (images) and enqueue any button‐linked pages under root
		for _, btn := range buttons {
			ProcessButton(db, btn.Src, btn)
			to := normalizeURL(btn.LinksTo)
			if strings.HasPrefix(to, "http://") || strings.HasPrefix(to, "https://") {
				if strings.HasPrefix(to, rootURL) {
					if _, ok := seen[to]; !ok {
						queue = append(queue, to)
					}
				} else {
					InsertWebsite(db, to)
				}
			}
		}

		// also enqueue explicitly identified internal links
		for _, l := range internalLinks {
			if len(pages) >= 75 {
				break
			}
			next := normalizeURL(AppendLink(url, l.Href))
			if _, ok := seen[next]; !ok {
				queue = append(queue, next)
			}
		}
	}

	// index & mark every scraped page
	for _, info := range pageInfos {
		rawText := strings.TrimSpace(info.rawText)
		resp := info.resp

		resp.Title = strings.TrimSpace(resp.Title)
		resp.Description = strings.TrimSpace(resp.Description)
		if len(resp.Title) > 500 {
			resp.Title = resp.Title[:500]
		}
		if len(resp.Description) > 500 {
			resp.Description = resp.Description[:500]
		}
		if len(rawText) > 5000 {
			rawText = rawText[:5000]
		}

		InsertWebsite(db, info.url, info.statusCode)
		if rawText != "" && info.statusCode >= 200 && info.statusCode < 300 {
			InsertEmbeddings(db, info.url, VectorizeText(rawText), "body")
			if resp.Title != "" {
				InsertEmbeddings(db, info.url, VectorizeText(resp.Title), "title")
			}
			if resp.Description != "" {
				InsertEmbeddings(db, info.url, VectorizeText(resp.Description), "description")
			}
		}

		UpdateWebsite(db, Website{
			URL:             info.url,
			IsScraped:       true,
			StatusCode:      info.statusCode,
			Title:           resp.Title,
			Description:     resp.Description,
			RawText:         rawText,
			ScrapedAt:       time.Now(),
			AmountOfButtons: len(info.buttons),
		})
	}

	log.Printf("Scraped %d pages from %s", len(seen), rootURL)
	for u := range seen {
		log.Println(u)
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

	var website_queue, _ = RetrievePendingWebsites(db)

	if os.Args != nil && len(os.Args) > 1 {
		rootURL := os.Args[1]
		log.Printf("Starting scrape for root URL: %s", rootURL)
		if _, err := ScrapeEntireWebsite(db, rootURL); err != nil {
			log.Printf("Error scraping root URL %s: %v", rootURL, err)
			return
		}
		log.Printf("Successfully scraped root URL: %s", rootURL)
		return
	}

	log.Printf("Retrieved %d pending websites to scrape.", len(website_queue))

	// limit concurrency using a semaphore pattern
	workerCount := 10
	sem := make(chan struct{}, workerCount)
	var wg sync.WaitGroup

	for _, site := range website_queue {		
		if isForbidden(site.URL) {
			log.Printf("Skipping prohibited website: %s", site.URL)
			continue
		}

		// acquire semaphore slot and increment wait group
		sem <- struct{}{}
		wg.Add(1)

		go func(site Website) {
			defer wg.Done()
			defer func() { <-sem }() // release the slot

			log.Printf("Processing website: %s", site.URL)
			if _, err := ScrapeEntireWebsite(db, site.URL); err != nil {
				log.Printf("Error scraping website %s: %v", site.URL, err)
			} else {
				log.Printf("Successfully scraped website: %s", site.URL)
			}
		}(site)
	}

	// wait for all workers to finish before refreshing the queue
	wg.Wait()

	// refresh the queue with any newly added pending websites
	website_queue, _ = RetrievePendingWebsites(db)

	// log.Println(Declutter(response.RawText))
	// log.Println(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif"))
	// log.Println(ScrapeSinglePage("https://toastofthesewn.nekoweb.org/"))
	// log.Println(NewColorAnalyzer().AnalyzeImage(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif")))
	// ScrapeEntireWebsite(db, "https://illiterate.nekoweb.org/") // example of a website that disallows scraping
	// ScrapeEntireWebsite(db, "https://toastofthesewn.nekoweb.org/") // example of a website that allows scraping
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test", "/img/maxpixels.gif"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "/img/maxpixels/"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "img/maxpixels.gif"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "img/maxpixels.gif/"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test", "https://poyoweb.org/index.html"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "https://poyoweb.org/index.html/"))
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test.html/", "second.html"))
	// InsertEmbeddings(db, "test_url", VectorizeText("This is a test sentence."), "test_kind") -- Successful!!1! :D
}

