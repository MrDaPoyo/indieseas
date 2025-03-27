import { drizzle } from "drizzle-orm/bun-sqlite";
import * as bcrypt from "bcryptjs";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database("indiesearch.db");
export let db = drizzle(sqlite, { schema: schema });

export function hash(image: string): string {
    return bcrypt.hashSync(image, 10);
}

export function retrieveAllButtons() {
    try {
        return db.query.buttons.findMany();
    } catch (error) {
        return false;
    }
}

export function insertButton(button: schema.Button) {
    try {
        db.insert(schema.buttons).values(button).then(() => {
            console.log("Inserted button: " + button.hash, Bun.color("black", "ansi"));
        });
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

export function retrieveAllScrapedURLs() {
    try {
        return db.query.scrapedURLs.findMany();
    } catch (error) {
        return false;
    }
}

export function retrieveURLsToScrape() {
    try {
        return db.query.scrapedURLs.findMany({ with: { scraped: false }});
    } catch (error) {
        return false;
    }
}

export function scrapedURL(url: string, hash: string) {
    try {
        db.insert(schema.scrapedURLs).values({ url: url, buttons: 0, hash: hash }).then(() => {
            console.log("Totally Scraped URL: " + url, Bun.color("yellow", "ansi"));
        });
        return true;
    } catch (error) {
        console.log("Already Scraped.");
        return false;
    }
}