import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database("indiesea.db");
// Enable WAL mode for better concurrency
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA busy_timeout = 5000;");
export let db = drizzle(sqlite, { schema: schema });

async function withRetry<T>(operation: () => Promise<T> | T): Promise<T> {
	const MAX_RETRIES = 10;
	const MIN_DELAY = 500;
	const MAX_DELAY = 2000; // sillyseconds
	
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await operation();
		} catch (error) {
			const isLocked = error instanceof Error && 
											 (error.message.includes('database is locked') || 
												error.message.includes('SQLITE_BUSY'));
			
			if (!isLocked || attempt === MAX_RETRIES - 1) {
				console.error("Operation failed:", error);
			}
			
			const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
			console.log(`Database locked, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	
	throw new Error('Max retries reached');
}

export function hash(image: any): any {
	return Bun.hash(image.toString());
}

export function retrieveAllButtons() {
	return withRetry(() => {
		try {
			return db.query.buttons.findMany();
		} catch (error) {
			return [];
		}
	});
}

export async function insertButton(button: schema.Button, website_id: number) {
	return withRetry(async () => {
		try {
			console.log(await db.insert(schema.buttons).values(button).returning());
			return true;
		} catch (error) {
			try {
				const existingButton = await db.query.buttons.findFirst({
					where: eq(schema.buttons.src, button.src),
				});

				if (existingButton) {
					if (
						await db.query.buttonWebsiteRelations.findFirst({
							where: eq(
								schema.buttonWebsiteRelations.button_id,
								existingButton.id
							),
						})
					) {
						return true;
					}
					await db.insert(schema.buttonWebsiteRelations).values({
						button_id: existingButton.id,
						website_id: website_id,
					});
					return true;
				}
				return false; // Return false if button doesn't exist
			} catch (innerError) {
				console.error("Failed to create relation:", innerError);
				return false;
			}
		}
	});
}

export function retrieveAllScrapedURLs() {
	return withRetry(() => {
		try {
			return db.query.scrapedURLs.findMany();
		} catch (error) {
			return {};
		}
	});
}

export async function retrieveURLsToScrape() {
	return withRetry(async () => {
		try {
			return await db.query.scrapedURLs.findMany({
				where: eq(schema.scrapedURLs.scraped, false),
			});
		} catch (error) {
			return [];
		}
	});
}

export async function retrieveURLId(url: string) {
	return withRetry(async () => {
		try {
			const existing = await db.query.scrapedURLs.findFirst({
				where: eq(schema.scrapedURLs.url, url),
			});
			if (existing) {
				return existing.url_id;
			} else {
				return null; // URL not found
			}
		} catch (error) {
			console.error("Error retrieving URL ID:", error);
			return null; // Error occurred
		}
	});
}

export async function scrapedURL(url: string) {
	return withRetry(async () => {
		try {
			await db
				.update(schema.scrapedURLs)
				.set({ scraped: true, scraped_date: new Date().getTime() })
				.where(eq(schema.scrapedURLs.url, url));
			console.log("Scraped URL:", url);
			return true;
		} catch (error) {
			console.log("Already Scraped.");
			return false;
		}
	});
}

export async function addURLPathToScrape(url: string) {
	return withRetry(async () => {
		try {
			const existing = await db.query.visitedURLs.findFirst({
				where: eq(schema.visitedURLs.path, url),
			});

			if (existing) {
				return true;
			}

			const returning = await db
				.insert(schema.visitedURLs)
				.values({ path: url, amount_of_buttons: 0 });
			return returning;
		}
		catch (error) {
			console.error(error);
			return false;
		}
	});
}

export async function scrapedURLPath(url: string) {
	return withRetry(async () => {
		try {
			await db
				.update(schema.visitedURLs)
				.set({ visited_date: new Date().getTime() })
				.where(eq(schema.visitedURLs.path, url));
			console.log("Scraped URL:", url);
			return true;
		} catch (error) {
			console.log("Already Scraped.");
			return false;
		}
	});
}

export async function isURLPathScraped(url: string) {
	return withRetry(async () => {
		try {
			const existing = await db.query.visitedURLs.findFirst({
				where: eq(schema.visitedURLs.path, url),
			});
			if (existing) {
				return true;
			} else {
				return false; // URL not found
			}
		}
		catch (error) {
			console.error("Error retrieving URL ID:", error);
			return false; // Error occurred
		}
	});
}

export async function addURLToScrape(url: string) {
	return withRetry(async () => {
		try {
			// Check if URL already exists in database
			const existing = await db.query.scrapedURLs.findFirst({
				where: eq(schema.scrapedURLs.url, url),
			});

			if (existing) {
				return true;
			}

			const returning = await db
				.insert(schema.scrapedURLs)
				.values({ url: url, hash: hash(url), scraped: false });
			return returning;
		} catch (error) {
			console.error(error);
			return false;
		}
	});
}

export async function removeURLEntirely(url: string) {
	return withRetry(async () => {
		try {
			const existing = await db.query.scrapedURLs.findFirst({
				where: eq(schema.scrapedURLs.url, url),
			});

			if (existing) {
				await db.delete(schema.scrapedURLs).where(
					eq(schema.scrapedURLs.url_id, existing.url_id)
				);
				await db.delete(schema.visitedURLs).where(
					eq(schema.visitedURLs.path, url)
				);
				await db.delete(schema.visitedURLsRelations).where(
					eq(schema.visitedURLsRelations.url_id, existing.url_id)
				);
				await db.delete(schema.buttonWebsiteRelations).where(
					eq(schema.buttonWebsiteRelations.website_id, existing.url_id)
				);
				await db.delete(schema.buttons).where(
					eq(schema.buttons.found_url, url)
				);
				console.log("Removed URL from scrape: " + url);
				return true;
			}
			return false;
		} catch (error) {
			console.error(error);
			return false;
		}
	});
}