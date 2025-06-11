import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { stemmer } from 'stemmer';

function stemSentence(sentence: string): string[] {
	return sentence
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '') // remove punctuation
		.split(/\s+/)                // split into words
		.filter(word => word.length > 2)
		.map(word => stemmer(word));
}

export const GET: APIRoute = async (request) => {
	try {
		const client = postgres(import.meta.env.DB_URL!);
		const db = drizzle(client);

		const timer = performance.now();
		const query = request.url.searchParams.get("q") || null;

		if (!query || query.trim() === "") {
			return new Response(
			);
		}

		const keywords = stemSentence(query);
		console.log("Stemmed keywords:", keywords);

		if (keywords.length === 0) {
			console.log("No valid keywords found after stemming for query:", query);
			return new Response(JSON.stringify({
				results: [],
				metadata: {
					originalDbCount: 0,
					finalCount: 0,
					time: performance.now() - timer,
					message: "No searchable keywords found in your query."
				},
				time: performance.now() - timer
			}), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}

		const keywordSql = keywords.map((keyword) =>
			sql`LOWER(${keyword})`
		);
		const keywordRows = keywords.map((kw) =>
			sql`
				SELECT
					w.id,
					w.url,
					w.title,
					w.raw_text   AS content,
					ki.frequency
				FROM websites w
				JOIN keyword_index ki
					ON ki.url = w.url
				JOIN keywords k
					ON k.id = ki.keyword_id
				WHERE k.word = ${kw}
			`
		);

		const results = await db.execute(sql`
			SELECT
				w.id,
				w.url,
				w.title,
				w.description,
				ki.frequency
			FROM websites w
			JOIN keyword_index ki
				ON ki.url = w.url
			JOIN keywords k
				ON k.id = ki.keyword_id
			WHERE k.word IN (${sql.join(keywordSql, sql`, `)})
			ORDER BY ki.frequency DESC
			LIMIT 150
		`);

		console.log("Search results:", results);

		const rows = results as { id: string, url: string, title: string, content: string, frequency: number }[];

		return new Response(JSON.stringify({
			results,
			metadata: {
				originalDbCount: rows.length,
				finalCount: results.length,
				time: performance.now() - timer
			},
			time: performance.now() - timer
		}), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});

	} catch (err) {
		console.error("Search error:", err);
		return new Response(
			JSON.stringify({
				error: "Search failed",
				details: String(err),
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
};
