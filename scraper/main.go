package main

import (
	"fmt"
	"github.com/jimsmart/grobotstxt"
	"io"
	"net/http"
	"net/url"
	"os"
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

func main() {
	startingUrl := "https://thinliquid.dev"
	robotsData, err := fetchRobotsTxt(startingUrl)

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching robots.txt: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Robots.txt for %s:\n", startingUrl)
	fmt.Println(robotsData)

	fmt.Println("----------")

	var startingPoint = "/"
	ok := grobotstxt.AgentAllowed(robotsData, USER_AGENT, startingPoint)
	if ok {
		fmt.Println("Access to / is allowed")
	} else {
		ok := grobotstxt.AgentAllowed(robotsData, USER_AGENT, "/index.html")
		if ok {
			fmt.Println("Access to /index.html is allowed")
			startingPoint = "/index.html"
		} else {
			startingPoint = ""
			fmt.Println("Access to /index.html is disallowed")
		}
	}

	fmt.Println("----------")

	if startingPoint != "" {
		scrapeSinglePath(fmt.Sprintf("%s%s", startingUrl, startingPoint), nil)
	}
}