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
		return null;
	}
}


export async function retrievePagedButtons(
	page: number = 1,
	pageSize: number = 200,
	color?: string,
) {
	const offset = (page - 1) * pageSize;
	const limit = pageSize;

	// get total count for pagination info that ill later return in "pagination"
	const totalCountResult = await db.select({ count: sql<number>`count(*)` }).from(schema.buttons);
	const totalCount = totalCountResult[0].count;
	const totalPages = Math.ceil(totalCount / pageSize);

	if (color) {
		const totalCountResult = await db.select({ count: sql<number>`count(*)` }).from(schema.buttons).where(
			eq(schema.buttons.color_tag, color));
		const totalCount = totalCountResult[0].count;
		const totalPages = Math.ceil(totalCount / pageSize);
		
		const buttons = await db.query.buttons.findMany({
			where: eq(schema.buttons.color_tag, color),
			limit: limit,
			offset: offset,
		});
		const hasNextPage = page < totalPages;
		const hasPreviousPage = page > 1;
		const validPage = page;

		return {
			buttons,
			pagination: {
				currentPage: validPage,
				totalPages,
				totalButtons: totalCount,
				hasNextPage,
				hasPreviousPage,
				nextPage: hasNextPage ? validPage + 1 : null,
				previousPage: hasPreviousPage ? validPage - 1 : null,
				pageSize
			}
		};
	}

	const buttons = await db.query.buttons.findMany({
		limit: limit,
		offset: offset,
	});

	const hasNextPage = page < totalPages;
	const hasPreviousPage = page > 1;
	const validPage = page;

	return {
		buttons,
		pagination: {
			currentPage: validPage,
			totalPages,
			totalButtons: totalCount,
			hasNextPage,
			hasPreviousPage,
			nextPage: hasNextPage ? validPage + 1 : null,
			previousPage: hasPreviousPage ? validPage - 1 : null,
			pageSize
		}
	};
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

export function updateButtonColor(id: number, color: any, color_tag: string) {
	try {
		return db
			.update(schema.buttons)
			.set({ avg_color: color, color_tag: color_tag })
			.where(eq(schema.buttons.id, id));
	} catch (error) {
		return false;
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

export async function castVote(website_id: number, ip: string) {
	try {

		const existing = await db.query.buttons.findFirst({
			where: eq(schema.scrapedURLs.url_id, website_id),
		});

		if (existing) {
			await db
				.insert(schema.votes)
				.values({ ip: ip, website_id: existing.id })
			return true;
		}
		return false;
	} catch (error) {
		return false;
	}
}

export async function cowardyVote(id: number) {
	try {
		const existing = await db.query.votes.findFirst({
			where: eq(schema.votes.id, id),
		});

		if (existing) {
			await db.delete(schema.votes).where(eq(schema.votes.id, id));
			return true;
		}
		return false;
	} catch (error) {
		return false;
	}
}

export async function retrieveVotes(website_id: number) {
	try {
		const existing = await db.query.votes.findMany({
			where: eq(schema.votes.website_id, website_id),
		});

		if (existing) {
			return existing;
		}
		return false;
	} catch (error) {
		return false;
	}
}

const KNN_CANDIDATE_LIMIT = 150; // How many nearest neighbors to fetch initially (e.g., 3x final limit)
const FINAL_RESULT_LIMIT = 150;
const MIN_RELEVANCE_THRESHOLD = 0.75; // Minimum acceptable aggregated similarity score (adjust 0.0 to 1.0)
const TITLE_WEIGHT = 1.5;
const DESCRIPTION_WEIGHT = 1.25;
const CORPUS_WEIGHT = 1.0;


export async function search(query: string) {
    const apiUrlBase = process.env.AI_API_URL;
    const apiPort = process.env.AI_API_PORT;
    if (!apiUrlBase || !apiPort) {
        console.error("Error: AI_API_URL or AI_API_PORT environment variables are not set.");
        return { results: [], metadata: { time: 0, originalCount: 0, filteredCount: 0, error: "API configuration missing" } };
    }
    const apiUrl = `${apiUrlBase.replace(/\/$/, "")}:${apiPort}/vectorize`;

    const timer = performance.now();

    try {
        // 1. Get Embedding via the super duper cool vectorize.ts api
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: [query] }),
        });

        if (!response.ok) {
            // Log or capture more response body info if possible
            const errorBody = await response.text().catch(() => "Could not read error body");
            console.error(`API request failed with status ${response.status}: ${errorBody}`);
            throw new Error(`API request failed with status ${response.status}`);
        }

        const embeddingResponse = await response.json();

        if (
            !embeddingResponse.vectors ||
            !Array.isArray(embeddingResponse.vectors) ||
            embeddingResponse.vectors.length === 0 ||
            !Array.isArray(embeddingResponse.vectors[0]) // Ensure inner element is an array
        ) {
            console.error("API returned invalid embedding format:", embeddingResponse);
            throw new Error("API returned invalid embedding format");
        }

        const queryVector: number[] = embeddingResponse.vectors[0];
        const vectorString = `[${queryVector.join(",")}]`;

		// 2. Perform Optimized Vector Search & Aggregation in SQL
		// This query first finds the nearest neighbors using the index,
		// then calculates weighted similarity, aggregates per website,
		// and finally joins with visitedURLs.
		const results = await db.execute(sql`
			WITH nearest_matches AS (
				-- Step 1: Find K nearest *individual* embeddings using the HNSW index
				SELECT
					id,
					website,
					type,
					embedding <=> ${vectorString}::vector AS distance -- $1 (vector)
				FROM ${schema.websitesIndex}
				ORDER BY
					distance ASC
				LIMIT ${KNN_CANDIDATE_LIMIT}::integer -- $2 (Explicitly integer)
			),
			similarity_scores AS (
				-- Step 2: Calculate similarity and apply weights to the candidates
				SELECT
					website,
					type,
					1 - distance AS similarity,
					CASE type
						WHEN 'title' THEN (1 - distance) * ${TITLE_WEIGHT}::float -- $3 (Explicitly float)
						WHEN 'description' THEN (1 - distance) * ${DESCRIPTION_WEIGHT}::float -- $4 (Explicitly float)
						WHEN 'corpus' THEN (1 - distance) * ${CORPUS_WEIGHT}::float -- $5 (Explicitly float)
						ELSE (1 - distance)
					END AS weighted_similarity
				FROM nearest_matches
				WHERE website IS NOT NULL
			),
			aggregated_scores AS (
				-- Step 3: Aggregate scores per website
				SELECT
					website,
					SUM(weighted_similarity) as total_similarity,
					COUNT(DISTINCT type) as matched_types_count,
					ARRAY_AGG(DISTINCT type) as matched_types_list
				FROM similarity_scores
				GROUP BY website
			)
			-- Step 4: Join with visitedURLs to get metadata and apply final ordering/limit
			SELECT
				ag.website,
				ag.total_similarity,
				ag.matched_types_count,
				ag.matched_types_list,
				vu.title,
				vu.description,
				vu.amount_of_buttons,
				vu.url_id
			FROM aggregated_scores ag
			JOIN ${schema.visitedURLs} vu ON ag.website = vu.path
			ORDER BY
				ag.total_similarity DESC
			LIMIT ${FINAL_RESULT_LIMIT}::integer; -- $6 (Explicitly integer)
		`);

		const queryTime = performance.now() - timer;

		const filteredResults = results.rows.filter(row =>
			row.total_similarity != null && // Check for null/undefined
			row.total_similarity as number >= MIN_RELEVANCE_THRESHOLD &&
			row.title != null && // Ensure we have a title to display
			typeof row.title === 'string' && // Type guard
			row.title.trim() !== '' // Ensure title isn't empty
		);

		// 4. Format Output
		const finalOutput = filteredResults.map(row => ({
			website: row.website,
			title: row.title,
			description: row.description,
			amount_of_buttons: row.amount_of_buttons,
			score: row.total_similarity, // The final relevance score
			matched_types_count: row.matched_types_count,
			matched_types_list: row.matched_types_list,
			website_id: row.url_id
		}));

		const finalResults = {
			results: finalOutput,
            metadata: {
                time: queryTime,
                originalDbCount: results.rows.length,
                finalCount: finalOutput.length,
                queryVector: queryVector
            }
		}

        return finalResults;

    } catch (error) {
        const queryTime = performance.now() - timer;
        console.error("Error during search operation:", error);

        return {
            results: [],
            metadata: {
                time: queryTime,
                originalDbCount: 0,
                finalCount: 0,
                error: error instanceof Error ? error.message : "An unknown error occurred"
            }
        };
    }
}
