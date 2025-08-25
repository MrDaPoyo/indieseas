package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/net/html"
)

var fetchedImages = make(map[string]bool)

func isIgnoredLink(s string) bool {
	ls := strings.ToLower(strings.TrimSpace(s))
	prohibitedPrefixes := []string{
		"//cdn.",
		"//dash.",
		"//static.",
		"//assets.",
		"//images.",
	}
	for _, prefix := range prohibitedPrefixes {
		if strings.HasPrefix(ls, prefix) {
			return true
		}
	}

	prohibitedWebsites := []string{
		"example.com",
		"test.com",
		"google.com",
		"bsky.app",
		"ze.wtf",
		"youtu.be",
		"youtube.com",
		"soundcloud.com",
		"bandlab.com",
		"x.com",
		"twitter.com",
		"reddit.com",
		"instagram.com",
		"pinterest.com",
		"tiktok.com",
		"linkedin.com",
		"flickr.com",
		"vimeo.com",
		"imgur.com",
		"catbox.moe",
	}
	for _, website := range prohibitedWebsites {
		if strings.Contains(ls, website) {
			return true
		}
	}

	return strings.Contains(ls, "cdn-cgi")
}

type WorkerButton struct {
	Src     string  `json:"src"`
	LinksTo *string `json:"links_to"`
	Alt     string  `json:"alt"`
	Title   string  `json:"title"`
}

type WorkerLink struct {
	Href string `json:"href"`
	Text string `json:"text"`
}

type WorkerResponse struct {
	Buttons     []WorkerButton `json:"buttons"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	RawText     string         `json:"rawText"`
	Links       []WorkerLink   `json:"links"`
}

func fetchThroughWorker(target string) (*WorkerResponse, error) {
	base := strings.TrimSpace(os.Getenv("SCRAPER_WORKER"))
	if base == "" {
		return nil, fmt.Errorf("SCRAPER_WORKER not set")
	}

	full := fmt.Sprintf("%s%s", base, url.QueryEscape(target))

	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest("GET", full, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "indieseas")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("worker returned %s", resp.Status)
	}

	var out WorkerResponse
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func scrapeSinglePath(path string) (sameHostLinks []string) {
	workerResp, werr := fetchThroughWorker(path)

	baseURL, _ := url.Parse(path)
	if baseURL == nil {
		baseURL, _ = url.Parse("http://example.com/")
	}

	if werr == nil && workerResp != nil {
		_ = markPathAsScraped(path)

		fmt.Println("----------")

		var foundButtons []Button
		seen := make(map[string]struct{})

		for _, wb := range workerResp.Buttons {
			raw := strings.TrimSpace(wb.Src)
			if raw == "" || !isValidURL(raw) || isIgnoredLink(raw) {
				continue
			}

			norm, ok := normalizeImageURL(baseURL, raw)
			if !ok || isIgnoredLink(norm) {
				continue
			}

			if _, exists := seen[norm]; exists {
				continue
			}
			seen[norm] = struct{}{}

			linksTo := ""
			if wb.LinksTo != nil {
				linksTo = strings.TrimSpace(*wb.LinksTo)
			}
			if linksTo != "" && !isIgnoredLink(linksTo) {
				if ah, err := url.Parse(linksTo); err == nil {
					abs := baseURL.ResolveReference(ah)
					if !isIgnoredLink(abs.String()) && abs.Host != "" && !strings.EqualFold(abs.Host, baseURL.Host) {
						linksTo = abs.String()
						ensureWebsiteQueued(linksTo)
					}
				}
			}

			if hasImageBeenScrapedBefore(norm) {
				if isBtn, ok := fetchedImages[norm]; ok && isBtn {
					foundButtons = append(foundButtons, Button{
						Link:    norm,
						LinksTo: linksTo,
						FoundOn: baseURL.String(),
					})
				}
				continue
			}

			if isBtn, exists := fetchedImages[norm]; exists {
				if isBtn {
					foundButtons = append(foundButtons, Button{
						Link:    norm,
						LinksTo: linksTo,
						FoundOn: baseURL.String(),
					})
				}
				continue
			}

			imageData := downloadImage(norm)
			if verifyImageSize(imageData) {
				fetchedImages[norm] = true
				btn := Button{
					Value:   imageData,
					Link:    norm,
					FoundOn: baseURL.String(),
				}
				if linksTo != "" {
					btn.LinksTo = linksTo
				}
				foundButtons = append(foundButtons, btn)
			} else {
				fetchedImages[norm] = false
			}
		}

		upsertButtons(foundButtons)

		baseHost := strings.ToLower(baseURL.Hostname())
		seenLinks := make(map[string]struct{})
		for _, wl := range workerResp.Links {
			href := strings.TrimSpace(wl.Href)
			if href == "" || isIgnoredLink(href) {
				continue
			}
			norm, ok := normalizePageURL(baseURL, href)
			if !ok || isIgnoredLink(norm) {
				continue
			}
			u, err := url.Parse(norm)
			if err != nil {
				continue
			}
			if strings.ToLower(u.Hostname()) != baseHost {
				ensureWebsiteQueued(norm)
				continue
			}
			if _, dup := seenLinks[norm]; dup {
				continue
			}
			seenLinks[norm] = struct{}{}
			sameHostLinks = append(sameHostLinks, norm)
		}

		priorityKeywords := []string{"/buttons", "/links", "/outbount", "/sitemap", "/about"}
		var prioritized []string
		var others []string
		for _, l := range sameHostLinks {
			ll := strings.ToLower(l)
			matched := false
			for _, kw := range priorityKeywords {
				if strings.Contains(ll, kw) {
					prioritized = append(prioritized, l)
					matched = true
					break
				}
			}
			if !matched {
				others = append(others, l)
			}
		}
		return append(prioritized, others...)
	}

	resp, err := http.Get(path)
	if err != nil {
		fmt.Printf("Error fetching %s: %v\n", path, err)
		return nil
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Failed to fetch %s: %s\n", path, resp.Status)
		return nil
	}

	_ = markPathAsScraped(path)

	doc, err := html.Parse(resp.Body)
	if err != nil {
		fmt.Printf("Error parsing HTML from %s: %v\n", path, err)
		return nil
	}

	var totalLinks []*html.Node
	var totalLinksWithImages []*html.Node
	var totalImages []*html.Node
	var processLinksImages func(*html.Node)

	processLinksImages = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "a":
				for _, attr := range n.Attr {
					if attr.Key == "href" {
						totalLinks = append(totalLinks, n)
					}
					if attr.Key == "href" {
						var containsImage func(*html.Node) bool
						containsImage = func(n *html.Node) bool {
							if n.Type == html.ElementNode && n.Data == "img" {
								return true
							}
							for c := n.FirstChild; c != nil; c = c.NextSibling {
								if containsImage(c) {
									return true
								}
							}
							return false
						}
						if containsImage(n) {
							totalLinksWithImages = append(totalLinksWithImages, n)
						}
					}
				}
			case "img":
				for _, attr := range n.Attr {
					if attr.Key == "src" || attr.Key == "data-src" {
						totalImages = append(totalImages, n)
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			processLinksImages(c)
		}
	}

	processLinksImages(doc)

	fmt.Println("----------")

	var foundButtons []Button
	baseURL = resp.Request.URL
	seen := make(map[string]struct{})

	for _, img := range totalImages {
		raw := ""
		for _, attr := range img.Attr {
			key := strings.ToLower(attr.Key)
			val := strings.TrimSpace(attr.Val)
			if val == "" {
				continue
			}
			if key == "src" && raw == "" {
				raw = val
			} else if key == "data-src" && raw == "" {
				raw = val
			} else if key == "srcset" && raw == "" {
				if first := pickFromSrcset(val); first != "" {
					raw = first
				}
			}
		}

		if raw == "" || !isValidURL(raw) || isIgnoredLink(raw) {
			continue
		}

		norm, ok := normalizeImageURL(baseURL, raw)
		if !ok {
			fmt.Printf("Skipping image (invalid URL): %q\n", raw)
			continue
		}
		if isIgnoredLink(norm) {
			continue
		}

		if _, exists := seen[norm]; exists {
			continue
		}
		seen[norm] = struct{}{}

		anchorHref := ""
		for p := img.Parent; p != nil; p = p.Parent {
			if p.Type == html.ElementNode && p.Data == "a" {
				for _, aAttr := range p.Attr {
					if aAttr.Key == "href" {
						anchorHref = strings.TrimSpace(aAttr.Val)
						break
					}
				}
				break
			}
		}

		linksTo := ""
		if anchorHref != "" && !isIgnoredLink(anchorHref) {
			if ah, err := url.Parse(anchorHref); err == nil {
				abs := baseURL.ResolveReference(ah)
				if !isIgnoredLink(abs.String()) && abs.Host != "" && !strings.EqualFold(abs.Host, baseURL.Host) {
					linksTo = abs.String()
					ensureWebsiteQueued(linksTo)
				}
			}
		}

		if hasImageBeenScrapedBefore(norm) {
			if isBtn, ok := fetchedImages[norm]; ok && isBtn {
				foundButtons = append(foundButtons, Button{
					Link:    norm,
					LinksTo: linksTo,
					FoundOn: baseURL.String(),
				})
			}
			continue
		}

		if isBtn, exists := fetchedImages[norm]; exists {
			if isBtn {
				foundButtons = append(foundButtons, Button{
					Link:    norm,
					LinksTo: linksTo,
					FoundOn: baseURL.String(),
				})
			}
			continue
		}

		imageData := downloadImage(norm)
		if verifyImageSize(imageData) {
			fetchedImages[norm] = true
			btn := Button{
				Value:   imageData,
				Link:    norm,
				FoundOn: baseURL.String(),
			}
			if linksTo != "" {
				btn.LinksTo = linksTo
			}
			foundButtons = append(foundButtons, btn)
		} else {
			fetchedImages[norm] = false
		}
	}

	upsertButtons(foundButtons)

	baseHost := strings.ToLower(resp.Request.URL.Hostname())
	seenLinks := make(map[string]struct{})
	for _, a := range totalLinks {
		for _, attr := range a.Attr {
			if attr.Key != "href" {
				continue
			}
			if isIgnoredLink(attr.Val) {
				continue
			}
			norm, ok := normalizePageURL(resp.Request.URL, attr.Val)
			if !ok {
				continue
			}
			if isIgnoredLink(norm) {
				continue
			}
			u, err := url.Parse(norm)
			if err != nil {
				continue
			}
			if strings.ToLower(u.Hostname()) != baseHost {
				ensureWebsiteQueued(norm)
				continue
			}
			if _, dup := seenLinks[norm]; dup {
				continue
			}
			seenLinks[norm] = struct{}{}
			sameHostLinks = append(sameHostLinks, norm)
		}
	}

	priorityKeywords := []string{"/buttons", "/links", "/outbount", "/sitemap", "/about"}

	var prioritized []string
	var others []string
	for _, l := range sameHostLinks {
		ll := strings.ToLower(l)
		matched := false
		for _, kw := range priorityKeywords {
			if strings.Contains(ll, kw) {
				prioritized = append(prioritized, l)
				matched = true
				break
			}
		}
		if !matched {
			others = append(others, l)
		}
	}

	return append(prioritized, others...)
}

func downloadImage(imgUrl string) []byte {
	if isIgnoredLink(imgUrl) {
		fmt.Printf("Skipping download (ignored URL): %q\n", imgUrl)
		return nil
	}

	u, err := url.Parse(imgUrl)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		fmt.Printf("Skipping download (invalid URL): %q\n", imgUrl)
		return nil
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", imgUrl, nil)
	if err != nil {
		fmt.Printf("Error creating request for image %s: %v\n", imgUrl, err)
		return nil
	}

	req.Header.Set("User-Agent", "indieseas")
	resp, err := client.Do(req)

	markImageAsScraped(imgUrl)

	if err != nil {
		fmt.Printf("Error downloading image %s: %v\n", imgUrl, err)
		return nil
	}

	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Failed to download image %s: %s\n", imgUrl, resp.Status)
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading image %s: %v\n", imgUrl, err)
		return nil
	}

	return body
}

func verifyImageSize(imageData []byte) bool {
	if len(imageData) == 0 {
		return false
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(imageData))
	if err != nil {
		return false
	}
	if cfg.Width == 88 && cfg.Height == 31 {
		fmt.Printf("88x31 Button Found! :D\n")
		return true
	}

	return false
}

func CrawlSite(startURL string, maxPages int, delay time.Duration) {
	if maxPages <= 0 {
		maxPages = 50
	}
	if delay <= 0 {
		delay = time.Second
	}

	start, err := url.Parse(startURL)
	if err != nil || start.Scheme == "" || start.Host == "" {
		fmt.Printf("Invalid start URL: %s\n", startURL)
		return
	}

	baseHost := strings.ToLower(start.Hostname())
	if isWebsiteScraped(baseHost) {
		fmt.Printf("Host %s has already been scraped. Skipping...\n", baseHost)
		return
	}

	queue := []string{start.String()}
	visited := make(map[string]struct{})
	var fetchedPages []string

	pagesCrawled := 0
	for len(queue) > 0 && pagesCrawled < maxPages {
		current := queue[0]
		queue = queue[1:]
		if _, seen := visited[current]; seen {
			continue
		}

		if hasPathBeenScrapedBefore(current) {
			continue
		}

		visited[current] = struct{}{}

		fmt.Printf("Crawling (%d/%d): %s\n", pagesCrawled+1, maxPages, current)
		links := scrapeSinglePath(current)
		pagesCrawled++
		fetchedPages = append(fetchedPages, current)

		for _, l := range links {
			u, err := url.Parse(l)
			if err != nil {
				continue
			}
			if strings.ToLower(u.Hostname()) != baseHost {
				continue
			}
			if _, seen := visited[l]; seen {
				continue
			}

			duplicate := false
			for _, q := range queue {
				if q == l {
					duplicate = true
					break
				}
			}
			if !duplicate {
				queue = append(queue, l)
			}
		}

		if len(queue) > 0 && pagesCrawled < maxPages {
			time.Sleep(delay)
		}
	}

	for _, link := range fetchedPages {
		fmt.Printf("Visited: %s\n", link)
	}

	markWebsiteAsScraped(start.Hostname())
	if len(fetchedPages) == 0 {
		fmt.Println("No pages were fetched for", start.Hostname())
	}

	fmt.Printf("Crawl finished. Pages crawled: %d (cap %d).\n", pagesCrawled, maxPages)
}
