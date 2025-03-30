import { eq } from "drizzle-orm";
import * as schema from "./schema";

import { drizzle } from "drizzle-orm/node-postgres";
const db = drizzle(process.env.DB_URL!, { schema });

export function hash(image: any): any {
	return Bun.hash(image.toString());
}

export function retrieveAllButtons() {
	try {
		return db.query.buttons.findMany();
	} catch (error) {
		return [];
	}
}

export async function insertButton(button: schema.Button, website_id: number) {
	try {
		const result = await db
			.insert(schema.buttons)
			.values(button as any)
			.returning();
		const insertedButton = result[0];
		if (!insertedButton) {
			console.error("Failed to insert button:", button);
			return false;
		}
		await db.insert(schema.buttonWebsiteRelations).values({
			button_id: insertedButton.button_id,
			website_id: website_id,
		});
		console.log("Inserted button: " + button.src);
		return true;
	} catch (error) {
		// If error is due to unique constraint (button already exists)
		console.log(
			"Button already exists, adding website relation: " + button.src
		);
		try {
			const existingButton = await db.query.buttons.findFirst({
				where: eq(schema.buttons.src, button.src),
			});

			if (existingButton) {
				if (
					await db.query.buttonWebsiteRelations.findFirst({
						where: eq(
							schema.buttonWebsiteRelations.button_id,
							existingButton.button_id
						),
					})
				) {
					console.log("Relation already exists, skipping.");
					return true;
				}
				await db.insert(schema.buttonWebsiteRelations).values({
					button_id: existingButton.button_id,
					website_id: website_id,
				});
				console.log("Added relation for existing button");
				return true;
			}
			return false; // Return false if button doesn't exist
		} catch (innerError) {
			console.error("Failed to create relation:", innerError);
			return false;
		}
	}
}

export async function retrieveAllScrapedURLs() {
	try {
		return await db.query.scrapedURLs.findMany();
	} catch (error) {
		return {};
	}
}

export async function retrieveURLsToScrape() {
	try {
		return await db.query.scrapedURLs.findMany({
			where: eq(schema.scrapedURLs.scraped, false),
		});
	} catch (error) {
		return [];
	}
}

export async function retrieveURLId(url: string) {
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
}

export async function scrapedURL(url: string) {
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
}

export async function addURLPathToScrape(url: string) {
	try {
		const existing = await db.query.visitedURLs.findFirst({
			where: eq(schema.visitedURLs.path, url),
		});

		if (existing) {
			return true;
		}

		const returning = await db
			.insert(schema.visitedURLs)
			.values({
				path: url,
				amount_of_buttons: 0,
			});
		console.log("Added URL to scrape: " + url);
		return returning;
	} catch (error) {
		console.error(error);
		return false;
	}
}

export async function scrapedURLPath(url: string) {
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
}

export async function isURLPathScraped(url: string) {
	try {
		const existing = await db.query.visitedURLs.findFirst({
			where: eq(schema.visitedURLs.path, url),
		});
		if (existing) {
			return true;
		} else {
			return false; // URL not found
		}
	} catch (error) {
		console.error("Error retrieving URL ID:", error);
		return false; // Error occurred
	}
}

export async function addURLToScrape(url: string) {
	console.log("Adding URL to scrape:", url);
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
			.values({
				url: url,
				hash: hash(url),
				scraped: false,
			})
			.returning();
		console.log("Added URL to scrape: " + url);
		return returning;
	} catch (error) {
		return false;
	}
}

export async function removeURLEntirely(url: string) {
	try {
		const existing = await db.query.scrapedURLs.findFirst({
			where: eq(schema.scrapedURLs.url, url),
		});

		if (!existing) {
			return true; // URL not found, nothing to remove
		}

		await db
			.delete(schema.scrapedURLs)
			.where(eq(schema.scrapedURLs.url, url));
		await db
			.delete(schema.visitedURLs)
			.where(eq(schema.visitedURLs.path, url));
		await db
			.delete(schema.buttonWebsiteRelations)
			.where(
				eq(schema.buttonWebsiteRelations.website_id, existing.url_id)
			);
		console.log("Removed URL from scrape: " + url);
		return true;
	} catch (error) {
		console.error("Error removing URL:", error);
		return false;
	}
}
