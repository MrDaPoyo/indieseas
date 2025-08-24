package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jimsmart/grobotstxt"
)

const (
	USER_AGENT = "indieseas"
)

func fetchRobotsTxt(Url string) (string, error) {
	url, err := url.ParseRequestURI(Url)
	if err != nil {
		return "", err
	}

	client := &http.Client{}
	req, err := http.NewRequest("GET", fmt.Sprintf("https://%s/robots.txt", url.Host), nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", USER_AGENT)
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := client.Do(req)

	if err != nil {
		return "", err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return "", nil
		}
		return "", fmt.Errorf("failed to fetch robots.txt: %s", resp.Status)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(respBody), nil
}

func crawlWithRobotsAndCrawlSite(startingURL string, maxPages int, delay time.Duration) {
	if startingURL == "" {
		return
	}

	if !strings.Contains(startingURL, "https://") && !strings.Contains(startingURL, "http://") {
		startingURL = "http://" + startingURL
	}

	provisionalURL, err := url.Parse(startingURL)
	if err != nil {
		return
	}

	startingURL = provisionalURL.String()

	provisionalURL, _ = url.Parse(startingURL)
	host := provisionalURL.Hostname()
	fetched, _, err := getRobotsStatus(host)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error checking robots status: %v\n", err)
	}

	var robotsData string
	if !fetched {
		robotsData, err = fetchRobotsTxt(startingURL)
		if err != nil {
			_ = markRobotsFetched(host, true)
			fmt.Fprintf(os.Stderr, "Error fetching robots.txt: %v\n", err)
			robotsData = ""
		} else {
			_ = markRobotsFetched(host, false)
		}
	}

	fmt.Println("----------")

	startingPoint := "/"
	if grobotstxt.AgentAllowed(robotsData, USER_AGENT, startingPoint) {
		fmt.Println("Access to / is allowed")
	} else if grobotstxt.AgentAllowed(robotsData, USER_AGENT, "/index.html") {
		fmt.Println("Access to /index.html is allowed")
		startingPoint = "/index.html"
	} else {
		startingPoint = ""
		fmt.Println("Access to /index.html is disallowed")
	}

	fmt.Println("----------")

	if startingPoint != "" {
		start := fmt.Sprintf("%s%s", startingURL, startingPoint)
		CrawlSite(start, maxPages, delay)
	}
}

func main() {
	initDB()

	var maxPages int = 75
	var queue []string = retrieveWebsitesToScrape()

	if len(queue) == 0 {
		var startingUrl string = "https://thinliquid.dev"

		crawlWithRobotsAndCrawlSite(startingUrl, maxPages, time.Second)
		time.Sleep(2 * time.Second)
	}

	for _, site := range queue {
		crawlWithRobotsAndCrawlSite(site, maxPages, time.Second)
		time.Sleep(2 * time.Second)
	}
}
