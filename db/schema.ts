import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const buttons = sqliteTable("movies", {
  id: integer("id").primaryKey(),
  filename: text().notNull(),
  scraped_date: integer(),
  original_website: text().notNull(),
  hash: text(),
});