import { text, integer, pgTable, boolean, customType, serial, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
	dataType() {
		return "bytea";
	},
});

export const scrapedURLs = pgTable("scrapedURLs", {
	url_id: serial("url_id").primaryKey(),
	url: text("url").notNull().unique(),
	scraped_date: integer("scraped_date")
    .default(sql`extract(epoch from now())`),
	scraped: boolean("scraped").notNull().default(false),
	hash: text("hash").unique().notNull(),
});

export const buttons = pgTable("buttons", {
	button_id: serial("button_id").primaryKey(),
	filename: text("filename").notNull(),
	scraped_date: integer("scraped_date")
    .default(sql`extract(epoch from now())`),
	found_url: text("found_url").notNull(),
	hash: text("hash").unique().notNull(),
	image: bytea("image"),
	src: text("src").notNull(),
});

export const visitedURLs = pgTable("visitedURLs", {
	url_id: serial("url_id").primaryKey(),
	path: text("path").notNull(),
	visited_date: integer("visited_date")
		.notNull()
		.default(sql`extract(epoch from now())`),
	amount_of_buttons: integer("amount_of_buttons"),
});

export const visitedURLsRelations = pgTable("visitedURLs_relations", {
	id: serial("id").primaryKey(),
	url_id: integer("url_id")
		.references(() => scrapedURLs.url_id)
		.notNull(),
	button_id: integer("button_id")
		.references(() => buttons.button_id)
		.notNull(),
});

export const buttonWebsiteRelations = pgTable("button_website_relations", {
	id: serial("id").primaryKey(),
	button_id: integer("button_id")
		.references(() => buttons.button_id)
		.notNull(),
	website_id: integer("website_id")
		.references(() => scrapedURLs.url_id)
		.notNull(),
});

export type Button = {
	id?: number;
	image: Uint8Array | null;
	filename: string;
	scraped_date: number | null; // Using number for timestamps
	found_url: string;
	hash: string;
	src: string;
};

export type ScrapedURL = {
	url_id: number;
	url: string;
	scraped_date: number | null;
	scraped: boolean;
	hash: string;
};
