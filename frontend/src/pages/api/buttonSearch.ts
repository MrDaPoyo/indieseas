import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
	const client = postgres(import.meta.env.DB_URL!);
	
	try {
		const timer = performance.now();
		const url = new URL(request.url);
		const query = url.searchParams.get("q") || null;
		const color = url.searchParams.get("color") || false;

		if (!query || query.trim() === "") {
			return new Response(
				JSON.stringify({ error: "Missing query parameter" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		const db = drizzle(client);

		const randomWebsiteResult = await db.execute(
			sql`SELECT * FROM websites ORDER BY RANDOM() LIMIT 1`
		);

		if (randomWebsiteResult.length === 0) {
			return new Response(
				JSON.stringify({ error: "No websites found in database" }),
				{
					status: 404,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		const randomWebsite = randomWebsiteResult[0];

		const buttonsQuery = color 
			? sql`
				SELECT b.*, br.links_to_url 
				FROM buttons b 
				JOIN buttons_relations br ON b.id = br.button_id 
				WHERE br.website_id = ${randomWebsite.id} 
				AND b.color_tag IS NOT NULL
				LIMIT ${url.searchParams.get("pageSize") || 200}
				OFFSET ${((parseInt(url.searchParams.get("page") || "1") - 1) * parseInt(url.searchParams.get("pageSize") || "200"))}`
			: sql`
				SELECT b.*, br.links_to_url 
				FROM buttons b 
				JOIN buttons_relations br ON b.id = br.button_id 
				WHERE br.website_id = ${randomWebsite.id}
				LIMIT ${url.searchParams.get("pageSize") || 200}
				OFFSET ${((parseInt(url.searchParams.get("page") || "1") - 1) * parseInt(url.searchParams.get("pageSize") || "200"))}`;

		const buttons = await db.execute(buttonsQuery);

		const result = {
			website: randomWebsite,
			buttons: buttons,
			pagination: {
				totalButtons: randomWebsite.amount_of_buttons,
				page: parseInt(url.searchParams.get("page") || "1"),
				pageSize: parseInt(url.searchParams.get("pageSize") || "200")
			}
		};

		return new Response(
			JSON.stringify({
				results: result,
				time: performance.now() - timer,
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json",
				},
			}
		);
	} catch (err) {
		return new Response(
			JSON.stringify({
				error: "Failed to fetch from database",
				details: String(err),
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	} finally {
		await client.end();
	}
};
