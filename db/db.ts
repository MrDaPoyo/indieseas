import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, sql, and } from "drizzle-orm";
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

		const processedText = text.map(word => lemmatizeWord(word.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, "")));
		const wordFrequency = new Map<string, number>();

		// count the word frequency
		for (const word of processedText) {
			if (word) {
				wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
			}
		}
		let urlObj: string;
		if (url.startsWith("http://") || url.startsWith("https://")) {
			urlObj = new URL(url).href;
		} else {
			urlObj = new URL("https://" + url).href;
		}
		const website = urlObj;

		// Get updated total websites count
		const totalWebsites = await db.select({ count: sql`count(*)` })
			.from(schema.scrapedURLs)
			.where(eq(schema.scrapedURLs.scraped, true))
			.execute()
			.then(result => Number(result[0]?.count || 1));

		// Update IDF for all existing keywords first
		await updateAllIdfValues(totalWebsites);

		// Now process the current document's keywords
		for (const [word, count] of wordFrequency.entries()) {
			// calculate TF. count/total words in document
			const tf = count / Math.max(1, processedText.length);

			// get document frequency (number of documents containing this word)
			const docFrequency = await db.select({ count: sql`count(*)` })
				.from(schema.websitesIndex)
				.where(eq(schema.websitesIndex.keyword, word))
				.execute()
				.then(result => Number(result[0]?.count || 0) + 1); // Add 1 to avoid division by zero

			// calculate IDF (inverse document frequency): log(total docs/docs with term)
			const idf = Math.max(0, Math.log10(totalWebsites / docFrequency));

			// calculate TF-IDF
			const tfidf = tf * idf;

			// Ensure values are valid integers by clamping to safe range
			const tfScaled = Math.round(Math.max(0, Math.min(tf, 1)) * 1000);
			const idfScaled = Math.round(Math.max(0, Math.min(idf, 1000)) * 1000);
			const tfidfScaled = Math.round(Math.max(0, Math.min(tfidf, 1000)) * 1000);

			await db.insert(schema.websitesIndex)
				.values({
					keyword: word,
					website: website,
					tf: tfScaled,
					idf: idfScaled,
					tf_idf: tfidfScaled
				})
				.onConflictDoUpdate({
					target: [schema.websitesIndex.keyword, schema.websitesIndex.website],
					set: { tf: tfScaled, idf: idfScaled, tf_idf: tfidfScaled }
				});
		}

		const urlId = await retrieveURLId(url);
		if (urlId) {
			for (const keyword of text) {
				// Process keywords the same way as above to ensure consistency
				const processedKeyword = lemmatizeWord(keyword.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, ""));
				if (!processedKeyword) continue; // Skip empty keywords

				try {
					// Use upsert to handle potential duplicates
					await db.insert(schema.websitesIndex)
						.values({
							keyword: processedKeyword,
							website: urlObj,
							idf: 0,
							tf: 0,
							tf_idf: 0
						})
						.onConflictDoUpdate({
							target: [schema.websitesIndex.keyword, schema.websitesIndex.website],
							set: { website: urlObj }
						});
				} catch (err) {
					console.error(`Error processing keyword ${processedKeyword}:`, err);
				}
			}
		}
		return true;
	} catch (error) {
		console.log("Error at scrapedURLPath: " + error);
		return false;
	}
}

async function updateAllIdfValues(totalWebsites: number) {
	// get all unique keywords
	const keywords = await db.select({ keyword: schema.websitesIndex.keyword })
		.from(schema.websitesIndex)
		.groupBy(schema.websitesIndex.keyword)
		.execute();

	for (const { keyword } of keywords) {
		// get document frequency for this keyword
		const docFrequency = await db.select({ count: sql`count(DISTINCT website)` })
			.from(schema.websitesIndex)
			.where(eq(schema.websitesIndex.keyword, keyword))
			.execute()
			.then(result => Number(result[0]?.count || 1));

		// Calculate new IDF value
		const idf = Math.max(0, Math.log10(totalWebsites / docFrequency));
		const idfScaled = Math.round(Math.max(0, Math.min(idf, 1000)) * 1000);

		// update all entries for this keyword with new IDF and TF-IDF
		const entries = await db.select()
			.from(schema.websitesIndex)
			.where(eq(schema.websitesIndex.keyword, keyword))
			.execute();

		for (const entry of entries) {
			const tfidfScaled = Math.round(Math.max(0, Math.min((entry.tf / 1000) * idf, 1000)) * 1000);

			await db.update(schema.websitesIndex)
				.set({
					idf: idfScaled,
					tf_idf: tfidfScaled
				})
				.where(
					and(
						eq(schema.websitesIndex.keyword, keyword),
						eq(schema.websitesIndex.website, entry.website)
					),
				).$dynamic();
		}
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