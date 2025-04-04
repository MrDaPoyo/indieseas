import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import { lemmatizeWord } from "../utils/lemmatize";


export let db = drizzle(process.env.DB_URL! as string, { schema: schema });

export function hash(image: any): any {
	return Bun.hash(image.toString());
}

export function retrieveAllButtons() {
	try {
		return db.query.buttons.findMany();
	} catch (error) {
		return {};
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
		url = new URL(url).hostname;
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
		if (url.startsWith("http://") || url.startsWith("https://")) {
			url = new URL(url).hostname;
		} else {
			url = new URL("https://" + url).hostname;
		}
		await db.update(schema.scrapedURLs)
			.set({ scraped: true, scraped_date: new Date() })
			.where(eq(schema.scrapedURLs.url, url));
		return true;
	} catch (error) {
		console.log(error);
		return false;
	}
}

export async function isURLScraped(url: string) {
	try {
		const existing = await db.query.scrapedURLs.findMany({
			where: eq(schema.scrapedURLs.url, url),
			columns: {
				scraped: true,
			},
		});
		if (existing[0] && existing.length > 0 && existing[0].scraped) {
			return true;
		} else {
			return false; // URL not found or not scraped
		}
	} catch (error) {
		console.error("Error retrieving URL ID at isURLScraped:", error);
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
			.values({ path: url });
		return returning;
	} catch (error) {
		console.error(error);
		return false;
	}
}

export async function scrapedURLPath(url: string, amount_of_buttons: number = 0, title: string = "", description: string = "", text: string[]) {
	try {
		await db
			.update(schema.visitedURLs)
			.set({ visited_date: new Date(), amount_of_buttons: amount_of_buttons, title: title, description: description })
			.where(eq(schema.visitedURLs.path, url));

		const urlId = await retrieveURLId(url);
		if (urlId) {
			for (const keyword of text) {
				const existingKeyword = await db.query.websitesIndex.findFirst({
					where: eq(schema.websitesIndex.keyword, keyword)
				});
				
				if (existingKeyword) {
					if (!existingKeyword.websites.includes(urlId)) {
						await db.update(schema.websitesIndex)
							.set({ websites: [...existingKeyword.websites, urlId] })
							.where(eq(schema.websitesIndex.keyword, keyword));
					}
				} else {
					// create new keyword
					await db.insert(schema.websitesIndex)
						.values({ keyword: keyword, websites: [urlId] });
				}
			}
		}
		return true;
	} catch (error) {
		console.log("Error at addURLPathToScrape: " + error);
		return false;
	}
}

export async function isURLPathScraped(url: string) {
	try {
		const existing = await db.select()
			.from(schema.visitedURLs)
			.where(eq(schema.visitedURLs.path, url))
			.execute();

		if (existing) {
			return true;
		} else {
			return false; // URL not found
		}
	} catch (error) {
		console.error("Error at isURLPathScraped:", error);
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

export async function search(query: string) {
	let keywords = [] as string[];
	for (let char of query.split(" ")) {
		if (char.includes("http://") || char.includes("https://") || char.includes(".")) {
			if (char.startsWith("http://") || char.startsWith("https://")) {
				char = new URL(char).hostname;
			} else {
				char = new URL("https://" + char).hostname;
			}
			keywords.push(char.toLowerCase().trim());
		}
		if (!keywords.includes(char))
			keywords.push(lemmatizeWord(char.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, "")));
	}
	if (keywords.length === 0) {
		return [];
	}
	console.log("Keywords: ", keywords);
	try {
		const websiteKeywords = keywords.filter(k => k.includes('.'));
		if (websiteKeywords.length > 0) {
			const websiteResults = await db
				.select()
				.from(schema.scrapedURLs)
				.where(inArray(schema.scrapedURLs.url, websiteKeywords))
				.execute();
			
			if (websiteResults.length > 0) {
				return websiteResults;
			}
		}
		const results = await db
			.select()
			.from(schema.websitesIndex)
			.where(eq(schema.websitesIndex.keyword, query))
			.execute();

		if (results.length > 0) {
			let websiteIds = [] as number[];
			results.forEach((result) => {
				websiteIds = result.websites;
			});

			if (websiteIds.length == 0) {
				return [];
			}
			let actualResults = [] as any[];
			for (let websiteId of websiteIds) {
				const results = await db
					.select()
					.from(schema.scrapedURLs)
					.where(eq(schema.scrapedURLs.url_id, websiteId))
					.execute();
				actualResults = actualResults.concat(results);
			}
			return actualResults;
		} else {
			return [];
		}
	} catch (error) {
		console.error("Error at search:", error);
		return [];
	}
}