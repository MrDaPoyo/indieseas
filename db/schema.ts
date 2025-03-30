import { sqliteTable, text, integer, customType, } from "drizzle-orm/sqlite-core";

const bytea = customType<{ data: Buffer | string; default: false }>({
  dataType() {
    return 'bytea';
  },
})("image");

export const scrapedURLs = sqliteTable("scrapedURLs", {
  url_id: integer("url_id").primaryKey(),
  url: text().notNull().unique(),
  scraped_date: integer(),
  scraped: integer({ mode: 'boolean' }).notNull().default(false),
  hash: text().unique().notNull(),
});

export const buttons = sqliteTable("buttons", {
  id: integer("button_id").primaryKey(),
  filename: text().notNull(),
  scraped_date: integer(),
  found_url: text().notNull(),
  hash: text().unique().notNull(),
  image: bytea,
  src: text().notNull(),
  links_to: text(),
});

export const visitedURLs = sqliteTable("visitedURLs", {
  url_id: integer("url_id").primaryKey(),
  path: text().notNull(),
  visited_date: integer().default(Date.now()),
  amount_of_buttons: integer(),
});

export const visitedURLsRelations = sqliteTable("visitedURLs_relations", {
  id: integer("id").primaryKey(),
  url_id: integer("url_id").references(() => scrapedURLs.url_id).notNull(),
  button_id: integer("button_id").references(() => buttons.id).notNull(),
});

export const buttonWebsiteRelations = sqliteTable("button_website_relations", {
  id: integer("id").primaryKey(),
  button_id: integer("button_id").references(() => buttons.id).notNull(),
  website_id: integer("website_id").references(() => scrapedURLs.url_id).notNull(),
});

export type Button = {
  image: any;
  filename: string;
  scraped_date: number | null;
  found_url: string;
  hash: string;
  src: string;
  website_id: number | null;
};

export type ScrapedURL = {
  url: string;
  scraped_date: number | null;
  hash: string;
};