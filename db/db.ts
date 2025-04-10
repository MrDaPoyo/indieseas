import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, sql, and } from "drizzle-orm";
import * as schema from "./schema";
import { createEmbedder } from "../utils/vectorize";

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
		await db
			.update(schema.scrapedURLs)
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

export async function scrapedURLPath(
	url: string,
	amount_of_buttons: number = 0,
	title: string = "",
	description: string = "",
	text: string[]
) {
	try {
		await db
			.update(schema.visitedURLs)
			.set({
				visited_date: new Date(),
				amount_of_buttons: amount_of_buttons,
				title: title,
				description: description,
			})
			.where(eq(schema.visitedURLs.path, url));

		const apiUrl = `${process.env.AI_API_URL!.replace(/\/$/, "")}:${process.env.AI_API_PORT
			}/vectorize`;

		if (title) {
			const vectorizedTitle = await fetch(apiUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: [title] })
			})
			if (vectorizedTitle.ok) {
				const titleEmbeddings = await vectorizedTitle.json();
				const titleVectorString = `[${titleEmbeddings.vectors[0].join(",")}]`;
				await db.execute(sql`
					INSERT INTO websites_index (website, embedding, type) 
					VALUES (${url}, ${titleVectorString}::vector, 'title')
				`);
			}
		}
		if (description) {
			const vectorizedDescription = await fetch(apiUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: [description] })
			})
			const descriptionEmbeddings = await vectorizedDescription.json();
			const descVectorString = `[${descriptionEmbeddings.vectors[0].join(",")}]`;
			await db.execute(sql`
					INSERT INTO websites_index (website, embedding, type) 
					VALUES (${url}, ${descVectorString}::vector, 'description')
				`);
		}


		const response = await fetch(apiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: [text] }),
		});

		if (!response.ok)
			throw new Error(
				`API request failed with status ${response.status}`
			);
		const embeddings = await response.json();

		if (!embeddings.vectors || !Array.isArray(embeddings.vectors)) {
			throw new Error("API returned invalid embedding format");
		}

		console.log(
			`Received ${embeddings.vectors.length} embeddings, each with ${embeddings.vectors[0]?.length || 0
			} dimensions`
		);

		for (let embedding of embeddings.vectors) {
			// convert the embedding array to a PostgreSQL vector string format such as [x1,x2,x3,...] cuz silly postgres wont make the cut
			const vectorString = `[${embedding.join(",")}]`;

			await db.execute(sql`
					INSERT INTO websites_index (website, embedding, type) 
					VALUES (${url}, ${vectorString}::vector, 'corpus')
				`);
		}

		return true;
	} catch (error) {
		console.log("Error at scrapedURLPath: " + error);
		return false;
	}
}

export async function isURLPathScraped(url: string) {
	try {
		const existing = await db
			.select()
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

export async function retrieveRandomWebsite() {
	try {
		const randomWebsite = await db.query.scrapedURLs.findFirst({
			where: eq(schema.scrapedURLs.scraped, true),
			orderBy: sql`random()`,
		});

		if (!randomWebsite) {
			return false; // not enough websites
		}

		const url = randomWebsite.url;
		const websiteButtons = await db.query.buttons.findMany({
			limit: 25,
			where: (buttons) => 
				sql`${buttons.found_url} LIKE ${'%' + url + '%'} OR ${buttons.links_to} LIKE ${'%' + url + '%'}`
		});

		if (websiteButtons && websiteButtons.length > 0) {
			randomWebsite.buttons = websiteButtons;
		}
		return { website: randomWebsite };
	} catch (error) {
		return false;
	}
}

export async function search(query: string) {
	try {
		// Convert the query to an embedding vector
		const apiUrl = `${process.env.AI_API_URL!.replace(/\/$/, "")}:${process.env.AI_API_PORT
			}/vectorize`;
		const response = await fetch(apiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: [query] }),
		});

		if (!response.ok)
			throw new Error(
				`API request failed with status ${response.status}`
			);

		const timer = performance.now();

		const embedding = await response.json();

		if (
			!embedding.vectors ||
			!Array.isArray(embedding.vectors) ||
			embedding.vectors.length === 0
		) {
			throw new Error("API returned invalid embedding format");
		}

		// Convert the embedding array to a PostgreSQL vector string format
		const vectorString = `[${embedding.vectors[0].join(",")}]`;

		// Perform vector similarity search with different weights for each type
		const results = await db.execute(sql`
			WITH similarity_scores AS (
				SELECT 
					website, 
					type,
					1 - (embedding <=> ${vectorString}::vector) as similarity
				FROM websites_index 
				WHERE website IS NOT NULL
			),
			aggregated_scores AS (
				SELECT 
					website,
					SUM(CASE WHEN type = 'title' THEN similarity * 1.5 
							WHEN type = 'description' THEN similarity * 1.25
							WHEN type = 'corpus' THEN similarity * 1.0
							ELSE similarity END) as total_similarity,
					COUNT(DISTINCT type) as matched_types
				FROM similarity_scores
				GROUP BY website
			)
			SELECT * FROM aggregated_scores
			ORDER BY total_similarity DESC 
			LIMIT 50;
		`);

		if (!results.rows[0] || results.rows.length === 0) {
			return [];
		}

		for (let i = 0; i < results.rows.length; i++) {
			const websitePath = results.rows[i].website as string;
			if (websitePath) {
				const websiteInfo = await db.query.visitedURLs.findFirst({
					where: eq(schema.visitedURLs.path, websitePath),
				});

				if (websiteInfo) {
					results.rows[i] = {
						...results.rows[i],
						title: websiteInfo.title,
						description: websiteInfo.description,
						amount_of_buttons: websiteInfo.amount_of_buttons,
						similarity: results.rows[i].total_similarity,
					};
				}
			}
		}

		const filteredResults = results.rows.filter(row => 
			row.total_similarity !== null && 
			row.total_similarity !== undefined ||
			row.title !== null &&
			row.title !== undefined
		);

		return { 
			results: filteredResults, 
			metadata: { 
				time: performance.now() - timer,
				originalCount: results.rows.length,
				filteredCount: filteredResults.length
			} 
		};
	} catch (error) {
		console.error("Error in vector search:", error);
		return [];
	}
}
