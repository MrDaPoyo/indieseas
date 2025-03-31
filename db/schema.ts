import { pgTable, text, integer, customType, boolean, serial, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer | string; default: false }>({
  dataType() {
    return 'bytea';
  },
})("image");

export const scrapedURLs = pgTable("scrapedURLs", {
  url_id: serial().primaryKey(),
  url: text().notNull().unique(),
  scraped_date: timestamp().defaultNow(),
  scraped: boolean().notNull().default(false),
  hash: text().unique().notNull(),
});

export const buttons = pgTable("buttons", {
  id: serial().primaryKey(),
  filename: text().notNull(),
  scraped_date: timestamp().defaultNow(),
  found_url: text().notNull(),
  hash: text().unique().notNull(),
  image: bytea,
  src: text().notNull(),
  links_to: text(),
});

export const visitedURLs = pgTable("visitedURLs", {
  url_id: serial().primaryKey(),
  path: text().notNull(),
  visited_date: timestamp().defaultNow(),
  amount_of_buttons: integer(),
});

export const visitedURLsRelations = pgTable("visitedURLs_relations", {
  id: serial().primaryKey(),
  url_id: integer("url_id").references(() => scrapedURLs.url_id).notNull(),
  button_id: integer("button_id").references(() => buttons.id).notNull(),
});

export const buttonWebsiteRelations = pgTable("button_website_relations", {
  id: serial().primaryKey(),
  button_id: integer("button_id").references(() => buttons.id).notNull(),
  website_id: integer("website_id").references(() => scrapedURLs.url_id).notNull(),
});

export type Button = {
  id?: number;
  image: any;
  filename: string;
  scraped_date: Date | null;
  found_url: string;
  hash: string;
  src: string;
  links_to?: string | null;
  website_id?: number | null;
};

export type ScrapedURL = {
  url_id?: number;
  scraped: boolean;
  url: string;
  scraped_date?: Date | null;
  hash: string;
};