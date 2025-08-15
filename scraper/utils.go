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