package main

import (
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

// Button represents a button entry in the database
type Button struct {
	URL          string `db:"url" json:"url"`
	StatusCode   int    `db:"status_code" json:"status_code"`
	ColorTag     string `db:"color_tag" json:"color_tag"`
	ColorAverage string `db:"color_average" json:"color_average"`
	ScrapedAt    string `db:"scraped_at" json:"scraped_at"`
	Alt          string `db:"alt" json:"alt"`
	Content      []byte `db:"content" json:"content"`
}

func InsertButton(db *sqlx.DB, button Button) error {
	query := `INSERT INTO buttons (url, status_code, color_tag, color_average, scraped_at, alt, content)
			  VALUES (:url, :status_code, :color_tag, :color_average, :scraped_at, :alt, :content)
			  ON CONFLICT (url) DO NOTHING;`
	if button.ScrapedAt == "" {
		button.ScrapedAt = "now()"
	}
	_, err := db.NamedExec(query, button)
	return err
}

func InsertWebsite(db *sqlx.DB, url string) error {
	query := `INSERT INTO websites (url) VALUES ($1) ON CONFLICT (url) DO NOTHING;`
	_, err := db.Exec(query, url)
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