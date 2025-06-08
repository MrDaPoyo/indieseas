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
			log.Printf("Skipping insertion for forbidden website: %s", url)
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

func InsertEmbeddings(db *sqlx.DB, url string, embeddings []float64, kind string) error {
	// Build Postgres vector literal: [0.123,0.456,...]
	elems := make([]string, len(embeddings))
	for i, v := range embeddings {
		elems[i] = fmt.Sprintf("%g", v)
	}
	vectorLiteral := "[" + strings.Join(elems, ",") + "]"

	query := `
		INSERT INTO websites_index (website, embedding, type)
		VALUES ($1, $2::vector, $3)
		ON CONFLICT (website, type) DO UPDATE
		  SET embedding = EXCLUDED.embedding;
	`
	_, err := db.Exec(query, url, vectorLiteral, kind)
	return err
}

func UpdateWebsite(db *sqlx.DB, website Website) error {
	query := `UPDATE websites SET is_scraped = $1, status_code = $2, title = $3, description = $4, raw_text = $5, scraped_at = $6, amount_of_buttons = $7
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
		WHERE (is_scraped = false OR status_code IS NULL)
		  AND (status_code != 999 OR status_code IS NULL)
		LIMIT 10;
	`
	if err := db.Select(&websites, query); err != nil {
		log.Println("Error retrieving pending websites:", err)
		return nil, err
	}
	return websites, nil
}