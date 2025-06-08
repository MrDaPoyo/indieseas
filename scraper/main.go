package main

import (
	"encoding/json"
	"fmt"
	"io"
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
		return href
	}
	
	if strings.HasPrefix(href, "/") {
		// Extract protocol and hostname from baseURL
		if strings.HasPrefix(baseURL, "https://") {
			hostname := strings.Split(baseURL[8:], "/")[0]
			return "https://" + hostname + href
		}
		if strings.HasPrefix(baseURL, "http://") {
			hostname := strings.Split(baseURL[7:], "/")[0]
			return "http://" + hostname + href
		}
	} else {

		if strings.HasSuffix(baseURL, "/") {
			return baseURL + href
		}
		return baseURL + href
	}
	
	
	if strings.HasPrefix(href, "/") {
		return baseURL + href
	}
	if strings.Contains(href, ".") && !strings.Contains(href, "/") {
		if strings.HasSuffix(baseURL, "/") {
			return baseURL + href
		}
		return baseURL + "/" + href
	}
	if strings.HasSuffix(baseURL, "/") {
		return baseURL + href
	}
	return baseURL + "/" + href
}

func ProcessButton(Db *sqlx.DB, url string, button ScraperButton) (*Button, error) {
	if exists, _ := DoesButtonExist(Db, url); exists {
		log.Printf("Button already exists in database: %s", url)
		return nil, fmt.Errorf("button already exists in database: %s", url)
	}
	var buttonContents, statusCode = FetchButton(url)
	if buttonContents == nil {
		log.Printf("Failed to fetch button image from %s", url)
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
					found_links = append(found_links, ScraperLink{Href: to, Text: button.Alt})
					linkHrefSet[to] = struct{}{}
				}
			} else {
				if _, seen := linkHrefSet[src]; !seen {
					internal_links = append(internal_links, ScraperLink{Href: src, Text: button.Alt})
					linkHrefSet[src] = struct{}{}
				}
			}
		}
	}

	for _, link := range response.Links {
		href := link.Href
		if _, seen := linkHrefSet[href]; seen {
			continue
		}
		if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
			found_links = append(found_links, link)
		} else {
			internal_links = append(internal_links, link)
		}
		linkHrefSet[href] = struct{}{}
	}

	return &response, raw_text, found_buttons, found_links, internal_links, nil
}

func ScrapeEntireWebsite(Db *sqlx.DB, rootURL string) ([]ScraperWorkerResponse, error) {
	robots, err := CheckRobotsTxt(rootURL)
	if err != nil {
		return nil, fmt.Errorf("failed to check robots.txt: %w", err)
	}
	if robots == nil {
		robots = &RobotsResult{
			Allowed:    []string{rootURL},
			Disallowed: []string{},
		}
	}

	var pages []ScraperWorkerResponse

	if len(robots.Allowed) == 1 && robots.Allowed[0] == "*" {
		resp, _, buttons, links, internalLinks, err := ScrapeSinglePage(rootURL)
		if err != nil {
			log.Printf("error scraping root url %q: %v", rootURL, err)
		} else {
			pages = append(pages, *resp)
			
			for _, link := range links {
				if err := InsertWebsite(Db, link.Href); err != nil {
					log.Printf("error inserting website %q: %v", link.Href, err)
				}
			}
			
			for _, button := range buttons {
				log.Printf("Found button: src=%s, linksTo=%s, alt=%s", button.Src, button.LinksTo, button.Alt)
				if button.LinksTo != "" && (strings.HasPrefix(button.LinksTo, "http://") || strings.HasPrefix(button.LinksTo, "https://")) {
					if err := InsertWebsite(Db, button.LinksTo); err != nil {
						log.Printf("error inserting website from button LinksTo %q: %v", button.LinksTo, err)
					}
				}
			}

			scrapedUrls := make(map[string]struct{})
			scrapedUrls[rootURL] = struct{}{}

			for _, link := range internalLinks {
				if _, scraped := scrapedUrls[link.Href]; !scraped {
					resp, _, buttons, moreLinks, moreInternalLinks, err := ScrapeSinglePage(link.Href)
					if err != nil {
						log.Printf("error scraping internal url %q: %v", link.Href, err)
						continue
					}
					pages = append(pages, *resp)
					scrapedUrls[link.Href] = struct{}{}

					for _, link := range moreLinks {
						if err := InsertWebsite(Db, link.Href); err != nil {
							log.Printf("error inserting website %q: %v", link.Href, err)
						}
					}

					for _, newLink := range moreInternalLinks {
						if _, scraped := scrapedUrls[newLink.Href]; !scraped {
							internalLinks = append(internalLinks, newLink)
						}
					}

					for _, button := range buttons {
						log.Printf("Found button: src=%s, linksTo=%s, alt=%s", button.Src, button.LinksTo, button.Alt)
						if button.LinksTo != "" && (strings.HasPrefix(button.LinksTo, "http://") || strings.HasPrefix(button.LinksTo, "https://")) {
							if err := InsertWebsite(Db, button.LinksTo); err != nil {
								log.Printf("error inserting website from button LinksTo %q: %v", button.LinksTo, err)
							}
						}
					}
				}
			}
		}
	} else {
		scrapedUrls := make(map[string]struct{})

		for _, u := range robots.Allowed {
			if _, scraped := scrapedUrls[u]; scraped {
				continue
			}

			resp, _, buttons, links, internalLinks, err := ScrapeSinglePage(u)
			if err != nil {
				log.Printf("error scraping allowed url %q: %v", u, err)
				continue
			}
			pages = append(pages, *resp)
			scrapedUrls[u] = struct{}{}

			// Add external links to database
			for _, link := range links {
				if err := InsertWebsite(Db, link.Href); err != nil {
					log.Printf("error inserting website %q: %v", link.Href, err)
				}
			}

			for _, link := range internalLinks {
				if _, scraped := scrapedUrls[link.Href]; !scraped {
					fullURL := link.Href
					if !strings.HasPrefix(fullURL, "http://") && !strings.HasPrefix(fullURL, "https://") {
						baseURL := strings.TrimSuffix(u, "/")
						if strings.HasPrefix(link.Href, "/") {
							fullURL = baseURL + link.Href
						} else {
							fullURL = baseURL + "/" + link.Href
						}
					}
					resp, _, _, moreLinks, moreInternalLinks, err := ScrapeSinglePage(fullURL)
					if err != nil {
						log.Printf("error scraping internal url %q: %v", link.Href, err)
						continue
					}
					pages = append(pages, *resp)
					scrapedUrls[link.Href] = struct{}{}

					// Add external links to database
					for _, link := range moreLinks {
						if err := InsertWebsite(Db, link.Href); err != nil {
							log.Printf("error inserting website %q: %v", link.Href, err)
						}
					}

					// Add newly found internal links to scrape
					for _, newLink := range moreInternalLinks {
						if _, scraped := scrapedUrls[newLink.Href]; !scraped {
							internalLinks = append(internalLinks, newLink)
						}
					}
				}
			}

			for _, button := range buttons {
				if _, err := ProcessButton(Db, button.Src, button); err != nil {
					log.Printf("error processing button %q: %v", button.Src, err)
				} else {
					log.Printf("Processed button: src=%s, linksTo=%s, alt=%s", button.Src, button.LinksTo, button.Alt)
				}
				
				// Add button LinksTo to database if it's a URL
				if button.LinksTo != "" && (strings.HasPrefix(button.LinksTo, "http://") || strings.HasPrefix(button.LinksTo, "https://")) {
					if err := InsertWebsite(Db, button.LinksTo); err != nil {
						log.Printf("error inserting website from button LinksTo %q: %v", button.LinksTo, err)
					}
				}
			}
		}
	}

	for _, u := range robots.Disallowed {
		pages = append(pages, ScraperWorkerResponse{
			Title:       fmt.Sprintf("DISALLOWED [900] %s", u),
			Description: "Scraping disallowed by robots.txt, status=900",
			RawText:     "",
			Buttons:     nil,
			Links:       nil,
		})
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

	var response ScraperWorkerResponse
	data, err := FetchScraperWorker("https://toastofthesewn.nekoweb.org/")

	if err != nil {
		log.Println("Error fetching scraper worker data:", err)
		return
	}

	body, err := io.ReadAll(data.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return
	}

	if err := json.Unmarshal(body, &response); err != nil {
		log.Printf("Error unmarshalling JSON: %v", err)
		return
	}

	// log.Println(Declutter(response.RawText))
	// log.Println(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif"))
	// log.Println(ScrapeSinglePage("https://toastofthesewn.nekoweb.org/"))
	// log.Println(NewColorAnalyzer().AnalyzeImage(FetchButton("https://raw.githubusercontent.com/ThinLiquid/buttons/main/img/maxpixels.gif")))
	// log.Println(ScrapeEntireWebsite("https://illiterate.nekoweb.org/")) // example of a website that disallows scraping
	// log.Println(ScrapeEntireWebsite(db, "https://toastofthesewn.nekoweb.org/")) // example of a website that allows scraping
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test", "/img/maxpixels.gif")) 
	// log.Println(AppendLink("https://toastofthesewn.nekoweb.org/test/", "img/maxpixels.gif"))
}
