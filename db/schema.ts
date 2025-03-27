import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const buttons = sqliteTable("buttons", {
  id: integer("id").primaryKey(),
  filename: text().notNull(),
  scraped_date: integer(),
  found_url: text().notNull(),
  hash: text().unique().notNull(),
  image: text().notNull(),
});

export type Button = {
  image: string;
  filename: string;
  scraped_date: number | null;
  found_url: string;
  hash: string;
};