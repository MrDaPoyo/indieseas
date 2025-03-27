import { relations } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const buttons = sqliteTable("buttons", {
  id: integer("id").primaryKey(),
  filename: text().notNull(),
  scraped_date: integer(),
  found_url: text().notNull(),
  hash: text().unique().notNull(),
  image: text().notNull(),
  src: text().notNull(),
});

export const scrapedURLs = sqliteTable("scrapedURLs", {
  id: integer("id").primaryKey(),
  url: text().notNull(),
  scraped_date: integer(),
  hash: text().unique().notNull(),
  buttons: integer("buttons").notNull().references(() => buttons.id),
});

export type Button = {
  image: string;
  filename: string;
  scraped_date: number | null;
  found_url: string;
  hash: string;
  src: string;
};