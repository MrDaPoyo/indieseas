import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

export let db = drizzle(process.env.DB_URL! as string, { schema: schema });

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
}

export function retrieveAllScrapedURLs() {
	try {
		return db.query.scrapedURLs.findMany();
	} catch (error) {
		return [];
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
			.set({ scraped: true, scraped_date: new Date() })
			.where(eq(schema.scrapedURLs.url, url));
		console.log("Scraped URL:", url);
		return true;
	} catch (error) {
		console.log("Already Scraped.");
		console.log(error);
		return false;
	}
}

export async function isURLScraped(url: string) {
	try {
		const existing = await db.query.scrapedURLs.findFirst({
			where: eq(schema.scrapedURLs.url, url),
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
			.values({ path: url, amount_of_buttons: 0 });
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
			.set({ visited_date: new Date() })
			.where(eq(schema.visitedURLs.path, url));
		console.log("Scraped URL:", url);
		return true;
	} catch (error) {
		console.log(error);
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
		console.log(error);
		console.error("Error retrieving URL ID:", error);
		return false;
	}
}

export async function addURLToScrape(url: string) {
	try {
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
}

export async function removeURLEntirely(url: string) {
	try {
		const existing = await db.query.scrapedURLs.findFirst({
			where: eq(schema.scrapedURLs.url, url),
		});

		if (existing) {
			await db
				.delete(schema.scrapedURLs)
				.where(eq(schema.scrapedURLs.url_id, existing.url_id));
			await db
				.delete(schema.visitedURLs)
				.where(eq(schema.visitedURLs.path, url));
			await db
				.delete(schema.visitedURLsRelations)
				.where(eq(schema.visitedURLsRelations.url_id, existing.url_id));
			await db
				.delete(schema.buttonWebsiteRelations)
				.where(
					eq(
						schema.buttonWebsiteRelations.website_id,
						existing.url_id
					)
				);
			await db
				.delete(schema.buttons)
				.where(eq(schema.buttons.found_url, url));
			console.log("Removed URL from scrape: " + url);
			return true;
		}
		return false;
	} catch (error) {
		return false;
	}
}
