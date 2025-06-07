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
			raw_text TEXT,
			scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			amount_of_buttons INTEGER DEFAULT 0
		);`,

		`CREATE TABLE IF NOT EXISTS buttons (
			id SERIAL PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			status_code INTEGER,
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

		`CREATE EXTENSION IF NOT EXISTS vector;`,

		`CREATE TABLE IF NOT EXISTS websites_index (
			id SERIAL PRIMARY KEY,
			website TEXT NOT NULL,
			embedding vector(512) NOT NULL,
			type TEXT NOT NULL
		);`,

		`CREATE INDEX IF NOT EXISTS embeddingIndex ON websites_index USING hnsw (embedding vector_cosine_ops);`,

		`CREATE TABLE IF NOT EXISTS robots (
			id SERIAL PRIMARY KEY,
			website_id INTEGER REFERENCES websites(id),
			allowed BOOLEAN DEFAULT TRUE,
			last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
