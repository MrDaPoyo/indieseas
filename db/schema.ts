import { arrayContained, relations } from "drizzle-orm";
import { sqliteTable, text, integer, SQLiteBoolean } from "drizzle-orm/sqlite-core";

export const scrapedURLs = sqliteTable("scrapedURLs", {
  id: integer("id").primaryKey(),
  url: text().notNull(),
  scraped_date: integer(),
  scraped: integer({ mode: 'boolean' }).notNull().default(false),
  hash: text().unique().notNull(),
});

export const buttons = sqliteTable("buttons", {
  id: integer("id").primaryKey(),
  filename: text().notNull(),
  scraped_date: integer(),
  found_url: text().notNull(),
  hash: text().unique().notNull(),
  image: text().unique().notNull(),
  src: text().notNull(),
  found_in_which_website: integer("id").references(() => scrapedURLs.id)
});

export type Button = {
  image: string;
  filename: string;
  scraped_date: number | null;
  found_url: string;
  hash: string;
  src: string;
};

export type ScrapedURL = {
  url: string;
  scraped_date: number | null;
  hash: string;
};