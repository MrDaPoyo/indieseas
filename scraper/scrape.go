package main

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

func scrapeSinglePath(path string, fetchedImages []string) {
	resp, err := http.Get(path)
	if err != nil {
		fmt.Printf("Error fetching %s: %v\n", path, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Failed to fetch %s: %s\n", path, resp.Status)
		return
	}

	doc, err := html.Parse(resp.Body)
	if err != nil {
		fmt.Printf("Error parsing HTML from %s: %v\n", path, err)
		return
	}

	var totalLinks []html.Node
	var totalLinksWithImages []html.Node
	var totalImages []html.Node

	var processLinksImages func(*html.Node)
	processLinksImages = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "a":
				for _, attr := range n.Attr {
					if attr.Key == "href" {
						totalLinks = append(totalLinks, *n)
						fmt.Printf("Found link: %s\n", attr.Val)
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
							totalLinksWithImages = append(totalLinksWithImages, *n)
							fmt.Println("Found image inside a link")
						}
					}
				}
			case "img":
				for _, attr := range n.Attr {
					if attr.Key == "src" || attr.Key == "data-src" {
						totalImages = append(totalImages, *n)
						fmt.Printf("Found image: %s\n", attr.Val)
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

	fmt.Printf("Total links found: %d\n", len(totalLinks))
	fmt.Printf("Total links with images found: %d\n", len(totalLinksWithImages))
	fmt.Printf("Total images found: %d\n", len(totalImages))

	fmt.Println("----------")

	var foundButtons [][]byte

	for _, img := range totalImages {
		for _, attr := range img.Attr {
			if attr.Key == "src" || attr.Key == "data-src" {
				parsedUrl, err := url.Parse(attr.Val)
				if err != nil {
					continue
				}

				normalizedUrl := parsedUrl.String()

				alreadyFetched := false
				for _, fetched := range fetchedImages {
					if fetched == normalizedUrl {
						alreadyFetched = true
						break
					}
				}
				if alreadyFetched {
					continue // skip if already fetched
				}

				attr.Val = normalizedUrl
			}
			
			if strings.HasPrefix(attr.Val, "/") {
				base, err := url.Parse(path)
				if err != nil {
					fmt.Printf("Error parsing base URL %s: %v\n", path, err)
					continue
				}
				u := base.ResolveReference(&url.URL{Path: attr.Val})
				attr.Val = u.String()
			}
			imageData := downloadImage(attr.Val)
			if verifyImageSize(imageData) {
				foundButtons = append(foundButtons, imageData)
			}
		}
	}
}

func downloadImage(imgUrl string) []byte {
	resp, err := http.Get(imgUrl)
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
		fmt.Printf("Error decoding image: %v\n", err)
		return false
	}

	if cfg.Width == 88 && cfg.Height == 31 {
		return true
	}
	return false
}
