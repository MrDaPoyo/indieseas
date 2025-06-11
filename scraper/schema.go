package main

import (
	"log"
	"github.com/jmoiron/sqlx"
)

func CreateSchema(db *sqlx.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS websites (
			id SERIAL PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			is_scraped BOOLEAN DEFAULT FALSE,
			status_code INTEGER,
			title TEXT,
			description TEXT,
			scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			amount_of_buttons INTEGER DEFAULT 0
		);`,

		`CREATE TABLE IF NOT EXISTS buttons (
			id SERIAL PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			status_code INTEGER DEFAULT 0,
			color_tag TEXT,
			color_average TEXT,
			scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			alt TEXT,
			content BYTEA NOT NULL UNIQUE
		);`,

		`CREATE TABLE IF NOT EXISTS buttons_relations (
			id SERIAL PRIMARY KEY,
			button_id INTEGER REFERENCES buttons(id),
			website_id INTEGER REFERENCES websites(id),
			links_to_url TEXT,
			UNIQUE(button_id, website_id)
		);`,

		`CREATE TABLE IF NOT EXISTS keywords (
			id SERIAL PRIMARY KEY,
			word TEXT UNIQUE NOT NULL
		);`,

		`CREATE TABLE IF NOT EXISTS keyword_index (
			keyword_id INTEGER NOT NULL,
			url TEXT NOT NULL,
			frequency INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY (keyword_id, url),
			FOREIGN KEY (keyword_id) REFERENCES keywords(id)
		);`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			log.Printf("Error executing query:\n%s\nError: %v", q, err)
			return err
		}
	}

	return nil
}
