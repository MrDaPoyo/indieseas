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
	"time"

	"golang.org/x/net/html"
)

var fetchedImages = make(map[string]struct{})

func scrapeSinglePath(path string) {
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
							totalLinksWithImages = append(totalLinksWithImages, n)
							fmt.Println("Found image inside a link")
						}
					}
				}
			case "img":
				for _, attr := range n.Attr {
					if attr.Key == "src" || attr.Key == "data-src" {
						totalImages = append(totalImages, n)
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

	var foundButtons []Button
	baseURL := resp.Request.URL
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

		if raw == "" || !isValidURL(raw) {
			continue
		}

		norm, ok := normalizeImageURL(baseURL, raw)
		if !ok {
			fmt.Printf("Skipping image (invalid URL): %q\n", raw)
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
		if anchorHref != "" {
			if ah, err := url.Parse(anchorHref); err == nil {
				abs := baseURL.ResolveReference(ah)
				if abs.Host != "" && !strings.EqualFold(abs.Host, baseURL.Host) {
					linksTo = abs.String()
				}
			}
		}

		if hasImageBeenScrapedBefore(norm) {
			foundButtons = append(foundButtons, Button{
				Link:    norm,
				LinksTo: linksTo,
			})
			continue
		}

		if _, exists := fetchedImages[norm]; exists {
			foundButtons = append(foundButtons, Button{
				Link:    norm,
				LinksTo: linksTo,
			})
			continue
		}

		fetchedImages[norm] = struct{}{}
		imageData := downloadImage(norm)
		if verifyImageSize(imageData) {
			btn := Button{
				Value: imageData,
				Link:  norm,
			}
			if linksTo != "" {
				btn.LinksTo = linksTo
			}
			foundButtons = append(foundButtons, btn)
		}
	}

	upsertButtons(foundButtons)
}

func downloadImage(imgUrl string) []byte {
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
		fmt.Printf("Image matches size 88x31\n")
		return true
	}

	return false
}
