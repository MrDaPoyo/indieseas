package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"github.com/jimsmart/grobotstxt"
)

const (
	USER_AGENT = "indieseas"
)

func fetchRobotsTxt(url string) (string, error) {
	client := &http.Client{}
	req, err := http.NewRequest("GET", url+"/robots.txt", nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", USER_AGENT)
	resp, err := client.Do(req)

	if err != nil {
		return "", err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to fetch robots.txt: %s", resp.Status)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(respBody), nil
}

func main() {
	url := "https://uwu.ze.wtf"
	robotsData, err := fetchRobotsTxt(url)

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching robots.txt: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Robots.txt for %s:\n", url)
	fmt.Println(robotsData)
	fmt.Println("----------")
	
	ok := grobotstxt.AgentAllowed(robotsData, USER_AGENT, "/")
	if ok {
		fmt.Println("Access to / is allowed")
	} else {
		fmt.Println("Access to / is disallowed")
	}
}
