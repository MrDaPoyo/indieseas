import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, sql, and } from "drizzle-orm";
import * as schema from "./schema";
import { createEmbedder } from "../utils/vectorize"

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
		if (url.startsWith("http://") || url.startsWith("https://")) {
			url = new URL(url).hostname;
		} else {
			url = new URL("https://" + url).hostname;
		}

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

		const apiUrl = `${process.env.AI_API_URL!.replace(/\/$/, '')}:${process.env.AI_API_PORT}/vectorize`;
		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: text })
		});

		if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
		const embeddings = await response.json();

		if (!embeddings.vectors || !Array.isArray(embeddings.vectors)) {
			throw new Error("API returned invalid embedding format");
		}

		console.log(`Received ${embeddings.vectors.length} embeddings, each with ${
			embeddings.vectors[0]?.length || 0} dimensions`);

		for (let embedding of embeddings.vectors) {
			// convert the embedding array to a PostgreSQL vector string format such as [x1,x2,x3,...] cuz silly postgres wont make the cut
			const vectorString = `[${embedding.join(',')}]`;
			
			// Check if the website already exists
			const existingRecord = await db.execute(sql`
				SELECT * FROM websites_index WHERE website = ${url}
			`);
			
			if (existingRecord.rowCount as any > 0) {
				// Update existing record
				await db.execute(sql`
					UPDATE websites_index 
					SET embedding = ${vectorString}::vector
					WHERE website = ${url}
				`);
			} else {
				// Insert new record
				await db.execute(sql`
					INSERT INTO websites_index (website, embedding) 
					VALUES (${url}, ${vectorString}::vector)
				`);
			}
		}
		
		return true;
	} catch (error) {
		console.log("Error at scrapedURLPath: " + error);
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
		// Handle direct website searches first
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
		
		// Search by tf-idf for all keywords
		const keywordsForSearch = keywords.filter(k => k.trim() !== '');
		if (keywordsForSearch.length === 0) return [];
		
		// Get websites with matching keywords and their tf-idf scores
		const indexResults = await db
			.select({
				website: schema.websitesIndex.website,
				tf_idf: schema.websitesIndex.tf_idf
			})
			.from(schema.websitesIndex)
			.where(inArray(schema.websitesIndex.keyword, keywordsForSearch))
			.execute();
		
		if (indexResults.length === 0) return [];
		
		// Aggregate tf-idf scores by website
		const websiteScores = new Map<string, number>();
		for (const result of indexResults) {
			const currentScore = websiteScores.get(result.website) || 0;
			websiteScores.set(result.website, currentScore + result.tf_idf);
		}
		
		// Convert to array for sorting
		const rankedWebsites = Array.from(websiteScores.entries())
			.map(([website, score]) => ({ website, score }))
			.sort((a, b) => b.score - a.score); // Sort by score descending
		
		// Get full website data for top results
		const websiteUrls = rankedWebsites.map(item => item.website);
		const websiteResults = await db
			.select()
			.from(schema.visitedURLs)
			.where(inArray(schema.visitedURLs.path, websiteUrls))
			.execute();
		
		// Add scores to results and return in ranked order
		const rankedResults = websiteUrls.map(url => {
			const website = websiteResults.find(site => {
				// Normalize URLs for comparison
				const sitePath = site.path ? new URL(site.path.startsWith('http') ? site.path : `https://${site.path}`).href : '';
				const normalizedUrl = url ? new URL(url.startsWith('http') ? url : `https://${url}`).href : '';
				return sitePath === normalizedUrl;
			});
			const score = websiteScores.get(url) || 0;
			return { ...website, tf_idf_score: score };
		}).filter(result => result.path !== undefined);
		
		return rankedResults;
	} catch (error) {
		console.error("Error at search:", error);
		return [];
	}
}