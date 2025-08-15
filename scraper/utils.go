package main

import (
	"net/url"
	"strings"
)

func contains(slice []string, element string) bool {
	for _, v := range slice {
		if v == element {
			return true
		}
	}
	return false
}

func normalizeImageURL(base *url.URL, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	lc := strings.ToLower(raw)
	if strings.HasPrefix(lc, "data:") || strings.HasPrefix(lc, "blob:") || strings.HasPrefix(lc, "javascript:") || strings.HasPrefix(lc, "mailto:") {
		return "", false
	}
	if strings.HasPrefix(raw, "//") && base != nil && base.Scheme != "" {
		raw = base.Scheme + ":" + raw
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	if base != nil && u.Scheme == "" {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	if u.Host == "" {
		return "", false
	}
	return u.String(), true
}

func pickFromSrcset(s string) string {
	parts := strings.Split(s, ",")
	if len(parts) == 0 {
		return ""
	}
	first := strings.TrimSpace(parts[0])
	fields := strings.Fields(first)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func isValidURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// normalizePageURL resolves a raw link against a base URL, ensures http/https,
// strips fragments, and returns a canonical absolute URL string.
func normalizePageURL(base *url.URL, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	// Ignore non-navigational schemes outright
	lc := strings.ToLower(raw)
	if strings.HasPrefix(lc, "javascript:") || strings.HasPrefix(lc, "mailto:") || strings.HasPrefix(lc, "data:") || strings.HasPrefix(lc, "blob:") {
		return "", false
	}
	if strings.HasPrefix(raw, "//") && base != nil && base.Scheme != "" {
		raw = base.Scheme + ":" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	if u.Host == "" {
		return "", false
	}
	// Canonicalize path: treat empty path as '/', and remove trailing slash for non-root
	if u.Path == "" {
		u.Path = "/"
	} else if u.Path != "/" && strings.HasSuffix(u.Path, "/") {
		u.Path = strings.TrimRight(u.Path, "/")
	}
	// Strip fragment
	u.Fragment = ""
	// Normalize hostname to lowercase
	host := strings.ToLower(u.Host)
	u.Host = host
	return u.String(), true
}
