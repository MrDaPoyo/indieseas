import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
	const client = postgres(import.meta.env.DB_URL!);
	
	try {
		const url = new URL(request.url);
		const query = url.searchParams.get("q") || "";
		const color = url.searchParams.get("color") === "true";
		const page = parseInt(url.searchParams.get("page") || "1");
		const pageSize = parseInt(url.searchParams.get("pageSize") || "200");
		const offset = (page - 1) * pageSize;

		const db = drizzle(client);

		console.log("Search Params:", url.searchParams.toString());

		let countResult;
		let buttonsQuery;

		if (color && query) {
			const searchQuery = `%${query}%`;
			
			countResult = await db.execute(
				sql`SELECT COUNT(*) as count FROM buttons WHERE color_tag ILIKE ${searchQuery}`
			);

			buttonsQuery = sql`
				SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content 
				FROM buttons 
				WHERE color_tag ILIKE ${searchQuery} 
				ORDER BY id 
				LIMIT ${pageSize} 
				OFFSET ${offset}`;
		} else if (query) {
			// Text search
			const searchQuery = `%${query}%`;
			
			countResult = await db.execute(
				sql`SELECT COUNT(*) as count FROM buttons WHERE url ILIKE ${searchQuery}`
			);

			buttonsQuery = sql`
				SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content 
				FROM buttons 
				WHERE url ILIKE ${searchQuery} 
				ORDER BY id 
				LIMIT ${pageSize} 
				OFFSET ${offset}`;
		} else {
			// No search, return all
			countResult = await db.execute(
				sql`SELECT COUNT(*) as count FROM buttons`
			);

			buttonsQuery = sql`
				SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content 
				FROM buttons 
				ORDER BY id 
				LIMIT ${pageSize} 
				OFFSET ${offset}`;
		}

		const totalCount = Number(countResult[0].count);
		const buttons = await db.execute(buttonsQuery);
		const totalPages = Math.ceil(totalCount / pageSize);

		const response = {
			buttons: buttons,
			pagination: {
				currentPage: page,
				totalPages: totalPages,
				totalButtons: totalCount,
				hasPreviousPage: page > 1,
				hasNextPage: page < totalPages,
				previousPage: page > 1 ? page - 1 : null,
				nextPage: page < totalPages ? page + 1 : null
			}
		};

		return new Response(
			JSON.stringify(response),
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
