package main

import (
	"strings"

	"github.com/jmoiron/sqlx"

	"log"
	"time"
	"fmt"
)

type Button struct {
	URL          string `db:"url" json:"url"`
	StatusCode   int    `db:"status_code" json:"status_code"`
	ColorTag     string `db:"color_tag" json:"color_tag"`
	ColorAverage string `db:"color_average" json:"color_average"`
	ScrapedAt    string `db:"scraped_at" json:"scraped_at"`
	Alt          string `db:"alt" json:"alt"`
	Content      []byte `db:"content" json:"content"`
}

type Website struct {
	ID              int        `db:"id" json:"id"`
	URL             string     `db:"url" json:"url"`
	IsScraped       bool       `db:"is_scraped" json:"is_scraped"`
	StatusCode      int        `db:"status_code" json:"status_code"`
	Title           string     `db:"title" json:"title"`
	Description     string     `db:"description" json:"description"`
	RawText         string     `db:"raw_text" json:"raw_text"`
	ScrapedAt       time.Time  `db:"scraped_at" json:"scraped_at"`
	AmountOfButtons int        `db:"amount_of_buttons" json:"amount_of_buttons"`
}

func InsertButton(db *sqlx.DB, button Button) error {
	query := `INSERT INTO buttons (url, status_code, color_tag, color_average, scraped_at, alt, content)
			  VALUES (:url, :status_code, :color_tag, :color_average, :scraped_at, :alt, :content)
			  ON CONFLICT (url) DO NOTHING;`
	if button.ScrapedAt == "" {
		button.ScrapedAt = "now()"
	}
	_, err := db.NamedExec(query, button)
	if err == nil {
		log.Println("Inserted button:", button.URL)
	}
	return err
}

func InsertWebsite(db *sqlx.DB, url string, statusCodes ...int) error {
	var (
		query string
		args  []interface{}
	)

	args = append(args, url)

	for _, fw := range FORBIDDEN_WEBSITES {
		if strings.Contains(url, fw) {
			return fmt.Errorf("skipping insertion for forbidden website: %s", url)
		}
	}

	if len(statusCodes) > 0 {
		query = `INSERT INTO websites (url, status_code) VALUES ($1, $2) ON CONFLICT (url) DO NOTHING;`
		args = append(args, statusCodes[0])
	} else {
		query = `INSERT INTO websites (url) VALUES ($1) ON CONFLICT (url) DO NOTHING;`
	}

	_, err := db.Exec(query, args...)
	return err
}

func InsertKeywords(db *sqlx.DB, url string, keywords map[string]int) error {
	if len(keywords) == 0 {
		return nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for keyword, count := range keywords {
		if strings.TrimSpace(keyword) == "" {
			continue
		}

		var keywordID int
		getKeywordQuery := `SELECT id FROM keywords WHERE word = $1;`
		err = tx.Get(&keywordID, getKeywordQuery, strings.TrimSpace(keyword))
		if err != nil {
			// oh noooo, the keyword doesn't exist! JUST FUCKING INSERT IT AHDLSHFLhflwlefhkewlhawlkf
			insertKeywordQuery := `INSERT INTO keywords (word) VALUES ($1) RETURNING id;`
			err = tx.Get(&keywordID, insertKeywordQuery, strings.TrimSpace(keyword))
			if err != nil {
				return err
			}
		}

		indexQuery := `INSERT INTO keyword_index (keyword_id, url, frequency) VALUES ($1, $2, $3) 
					   ON CONFLICT (keyword_id, url) DO UPDATE SET frequency = keyword_index.frequency + $3;`
		_, err = tx.Exec(indexQuery, keywordID, url, count)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func UpdateWebsite(db *sqlx.DB, website Website) error {
	query := `UPDATE websites SET is_scraped = $1, status_code = $2, title = $3, description = $4 scraped_at = $5, amount_of_buttons = $6
			  WHERE url = $8;`
	_, err := db.Exec(query, website.IsScraped, website.StatusCode, website.Title, website.Description, website.RawText, website.ScrapedAt, website.AmountOfButtons, website.URL)
	return err
}

func DoesButtonExist(db *sqlx.DB, url string) (bool, error) {
	var exists bool
	query := `SELECT EXISTS(SELECT 1 FROM buttons WHERE url = $1);`
	err := db.Get(&exists, query, url)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func RetrievePendingWebsites(db *sqlx.DB) ([]Website, error) {
	var websites []Website
	query := `
		SELECT id, url
		FROM websites
		WHERE (is_scraped = false AND status_code IS NULL) AND (LENGTH(url) - LENGTH(REPLACE(url, '/', ''))) = 2
		LIMIT 100;
	`
	if err := db.Select(&websites, query); err != nil {
		log.Println("Error retrieving pending websites:", err)
		return nil, err
	}
	return websites, nil
}

func RetrieveStats(db *sqlx.DB) {
	var totalButtons, totalWebsites, pendingWebsites int
	err := db.Get(&totalButtons, "SELECT COUNT(*) FROM buttons;")
	if err != nil {
		log.Println("Error retrieving total buttons:", err)
		return
	}
	err = db.Get(&totalWebsites, "SELECT COUNT(*) FROM websites;")
	if err != nil {
		log.Println("Error retrieving total websites:", err)
		return
	}
	err = db.Get(&pendingWebsites, "SELECT COUNT(*) FROM websites WHERE is_scraped = false AND status_code IS NULL;")
	if err != nil {
		log.Println("Error retrieving pending websites:", err)
		return
	}
	log.Printf("Total Buttons: %d, Total Websites: %d, Websites in the queue: %d", totalButtons, totalWebsites, pendingWebsites)
}