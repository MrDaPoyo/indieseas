package main

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type RobotsRule struct {
	UserAgent      string
	AllowedPaths   []string
	DisallowedPaths []string
}

type RobotsResult struct {
	Allowed    []string
	Disallowed []string
}

func CheckRobotsTxt(rawURL string) (*RobotsResult, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url %q: %w", rawURL, err)
	}
	base := fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)
	robotsURL := base + "/robots.txt"

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(robotsURL)
	if err != nil {
		log.Printf("couldn't fetch robots.txt: %v", err)
		return nil, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading robots.txt: %w", err)
	}
	if len(body) == 0 {
		return nil, nil
	}
	if len(body) > 5000 {
		return nil, nil
	}

	rules := parseRobotsTxt(string(body))
	paths := getAllowedPaths(rules, []string{"*", "indieseas"}, base)

	allowed := append(paths["*"].Allowed, paths["indieseas"].Allowed...)
	disallowed := append(paths["*"].Disallowed, paths["indieseas"].Disallowed...)

	return &RobotsResult{Allowed: allowed, Disallowed: disallowed}, nil
}

func parseRobotsTxt(content string) []RobotsRule {
	scanner := bufio.NewScanner(strings.NewReader(content))
	var rules []RobotsRule
	var current *RobotsRule

	for scanner.Scan() {
		line := scanner.Text()
		// strip comments and whitespace
		if idx := strings.Index(line, "#"); idx >= 0 {
			line = line[:idx]
		}
		line = strings.TrimSpace(strings.ToLower(line))
		if line == "" {
			continue
		}

		switch {
		case strings.HasPrefix(line, "user-agent:"):
			ua := strings.TrimSpace(line[len("user-agent:"):])
			// start new rule if UA differs
			if current == nil || current.UserAgent != ua {
				r := RobotsRule{UserAgent: ua}
				rules = append(rules, r)
				current = &rules[len(rules)-1]
			}
		case strings.HasPrefix(line, "allow:"):
			if current != nil {
				path := strings.TrimSpace(line[len("allow:"):])
				if path != "" {
					current.AllowedPaths = append(current.AllowedPaths, path)
				}
			}
		case strings.HasPrefix(line, "disallow:"):
			if current != nil {
				path := strings.TrimSpace(line[len("disallow:"):])
				if path != "" {
					current.DisallowedPaths = append(current.DisallowedPaths, path)
				}
			}
		default:
			// if no current rule, assume wildcard
			if current == nil {
				r := RobotsRule{UserAgent: "*"}
				rules = append(rules, r)
				current = &rules[len(rules)-1]
			}
		}
	}
	return rules
}

type agentPaths struct {
	Allowed    []string
	Disallowed []string
}

func getAllowedPaths(rules []RobotsRule, userAgents []string, base string) map[string]agentPaths {
	res := make(map[string]agentPaths, len(userAgents))
	uaLower := make([]string, len(userAgents))
	for i, ua := range userAgents {
		uaLower[i] = strings.ToLower(ua)
		res[uaLower[i]] = agentPaths{}
	}

	// collect wildcard
	var wildcard []RobotsRule
	for _, r := range rules {
		if r.UserAgent == "*" {
			wildcard = append(wildcard, r)
		}
	}

	for _, ua := range uaLower {
		// find specific
		var applicable []RobotsRule
		for _, r := range rules {
			if r.UserAgent == ua {
				applicable = append(applicable, r)
			}
		}
		if len(applicable) == 0 {
			applicable = wildcard
		}
		if len(applicable) == 0 {
			// no rules => everything allowed
			res[ua] = agentPaths{Allowed: []string{base + "/"}}
			continue
		}

		ap := agentPaths{}
		for _, r := range applicable {
			if len(r.DisallowedPaths) == 0 {
				ap.Allowed = []string{base + "/"}
				break
			}
			for _, p := range r.AllowedPaths {
				p = strings.ReplaceAll(p, "*", "")
				if !strings.HasPrefix(p, "/") {
					p = "/" + p
				}
				ap.Allowed = append(ap.Allowed, base+p)
			}
			for _, p := range r.DisallowedPaths {
				p = strings.ReplaceAll(p, "*", "")
				if !strings.HasPrefix(p, "/") {
					p = "/" + p
				}
				ap.Disallowed = append(ap.Disallowed, base+p)
			}
		}
		if len(ap.Allowed) == 0 {
			root := base + "/"
			if !contains(ap.Disallowed, root) {
				ap.Allowed = append(ap.Allowed, root)
			}
		}
		res[ua] = ap
	}

	// filter wildcard disallowed from others
	if w, ok := res["*"]; ok && len(userAgents) > 1 {
		wset := make(map[string]struct{})
		for _, d := range w.Disallowed {
			wset[d] = struct{}{}
		}
		for _, ua := range uaLower {
			if ua == "*" {
				continue
			}
			ap := res[ua]
			filtered := ap.Disallowed[:0]
			for _, d := range ap.Disallowed {
				if _, blocked := wset[d]; !blocked || contains(ap.Allowed, d) {
					filtered = append(filtered, d)
				}
			}
			ap.Disallowed = filtered
			res[ua] = ap
		}
	}

	return res
}

func contains(slice []string, s string) bool {
	for _, x := range slice {
		if x == s {
			return true
		}
	}
	return false
}