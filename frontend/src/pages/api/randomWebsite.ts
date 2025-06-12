import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
    const client = postgres(import.meta.env.DB_URL!);
    
    try {
        const db = drizzle(client);

        const result = await db.execute(
            sql`
            SELECT w.*, array_agg(
            json_build_object(
            'id', b.id,
            'url', b.url,
            'status_code', b.status_code,
            'color_tag', b.color_tag,
            'color_average', b.color_average,
            'alt', b.alt
            )
            ) FILTER (WHERE b.id IS NOT NULL) as buttons
            FROM websites w
            LEFT JOIN buttons_relations br ON w.id = br.website_id
            LEFT JOIN buttons b ON br.button_id = b.id
            WHERE w.status_code = 200 AND w.is_scraped = true AND w.amount_of_buttons > 0
            GROUP BY w.id
            ORDER BY RANDOM()
            LIMIT 1
            `
        );

        if (result.length === 0) {
            return new Response(
                JSON.stringify({ error: "No websites found" }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        return new Response(JSON.stringify(result[0]), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        console.error("Database query failed:", err);
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
