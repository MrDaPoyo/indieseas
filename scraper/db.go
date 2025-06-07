package main

import (
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

// Button represents a button entry in the database
type Button struct {
	URL            string         `db:"url" json:"url"`
	StatusCode     int            `db:"status_code" json:"status_code"`
	ColorTag       string         `db:"color_tag" json:"color_tag"`
	ColorAverage   string         `db:"color_average" json:"color_average"`
	ScrapedAt      string         `db:"scraped_at" json:"scraped_at"`
	Alt            string         `db:"alt" json:"alt"`
	Content        []byte         `db:"content" json:"content"`
}

func InsertButton(db *sqlx.DB, button Button) error {
	query := `INSERT INTO buttons (url, status_code, color_tag, color_average, scraped_at, alt, content)
			  VALUES (:url, :status_code, :color_tag, :color_average, :scraped_at, :alt, :content)
			  ON CONFLICT (url) DO UPDATE SET
			  status_code = EXCLUDED.status_code,
			  color_tag = EXCLUDED.color_tag,
			  color_average = EXCLUDED.color_average,
			  scraped_at = EXCLUDED.scraped_at,
			  alt = EXCLUDED.alt,
			  content = EXCLUDED.content;`
	_, err := db.NamedExec(query, button)
	return err
}