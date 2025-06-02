import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
	try {
		const client = postgres(import.meta.env.DB_URL!);
		const db = drizzle(client);

		const timer = performance.now();
		const query = request.url.searchParams.get("q") || null;

		if (!query || query.trim() === "") {
			return new Response(
				JSON.stringify({ error: "Missing query parameter" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		const aiUrl = import.meta.env.AI_URL || "http://localhost:8888";
		if (!aiUrl) {
			throw new Error("AI_URL environment variable not set");
		}

		const aiResponse = await fetch(`${aiUrl}/vectorize`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: query })
		});

		if (!aiResponse.ok) {
			throw new Error("Failed to get vector from AI service");
		}

		const vectorData = await aiResponse.json();
		const vectors = vectorData.vectors?.[0];

		if (!Array.isArray(vectors)) {
			throw new Error("Invalid vector response from AI service");
		}

		const vectorString = `[${vectors.join(",")}]`;

		const rows = await db.execute(sql`
			WITH nearest_matches AS (
				SELECT id, website, type, embedding <=> ${vectorString}::vector AS distance
				FROM websites_index
				ORDER BY distance ASC
				LIMIT 1000
			),
			similarity_scores AS (
				SELECT website, type, 1 - distance AS similarity,
					CASE type
						WHEN 'title' THEN (1 - distance) * 2.0
						WHEN 'description' THEN (1 - distance) * 1.5
						WHEN 'corpus' THEN (1 - distance) * 1.0
						ELSE (1 - distance)
					END AS weighted_similarity
				FROM nearest_matches
			),
			aggregated_scores AS (
				SELECT website, SUM(weighted_similarity) as total_similarity,
					COUNT(DISTINCT type) as matched_types_count,
					ARRAY_AGG(DISTINCT type) as matched_types_list
				FROM similarity_scores
				GROUP BY website
			)
			SELECT ag.website, ag.total_similarity, ag.matched_types_count, 
				   ag.matched_types_list, w.title, w.description, 
				   w.amount_of_buttons, w.id, w.status_code, w.is_scraped, w.scraped_at
			FROM aggregated_scores ag
			JOIN websites w ON ag.website = w.url
			WHERE ag.total_similarity >= 0.3 AND w.is_scraped = true
			ORDER BY ag.total_similarity DESC
			LIMIT 50
		`);

		const results = rows.map(row => ({
			website: row.website,
			title: row.title,
			description: row.description,
			amount_of_buttons: row.amount_of_buttons,
			score: row.total_similarity,
			matched_types_count: row.matched_types_count,
			website_id: row.id,
			status_code: row.status_code,
			is_scraped: row.is_scraped,
			scraped_at: row.scraped_at
		}));

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
