import type { Config } from "drizzle-kit";

export default {
  out: './drizzle',
  schema: './db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DB_URL,
  },
} as Config;