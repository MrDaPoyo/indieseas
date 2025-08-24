import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const GET: APIRoute = async ({ url }) => {
	try {
		const buttonId = url.searchParams.get("id");
		if (!buttonId) {
			return new Response(JSON.stringify({ error: "id is required" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const id = Number(buttonId);
		if (!Number.isInteger(id)) {
			return new Response(
				JSON.stringify({ error: "id must be an integer" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		const client = postgres(process.env.DB_URL!);
		const db = drizzle(client);

		const buttonResults = await db.execute(
			sql`SELECT value FROM buttons WHERE id = ${id}`
		);

		await client.end();

		if (!buttonResults || buttonResults.count == 0 || buttonResults[0].value == null) {
			return new Response(JSON.stringify({ error: "Button not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		}

		const button = buttonResults[0];
		const imageBytes = button.value;
		const imageName = `button-${id}.png`;

		return new Response(imageBytes, {
			status: 200,
			headers: {
				"Content-Type": "image/png",
				"Content-Disposition": `inline; filename="${imageName}"`,
			},
		});
	} catch (err) {
		console.error("Error fetching button:", err);
		return new Response(
			JSON.stringify({
				error: "Failed to fetch button from database",
				details: String(err),
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			}
		);
	}
};
