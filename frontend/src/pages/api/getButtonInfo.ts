import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async ({ url }) => {
    const client = postgres(import.meta.env.DB_URL!);
    
    try {
        const buttonId = url.searchParams.get("buttonId");
        if (!buttonId) {
            return new Response(
                JSON.stringify({ error: "buttonId is required" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const db = drizzle(client);

        let buttonResults = await db.execute(
            sql`
            SELECT 
                b.*,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'website_id', w.id,
                            'url', w.url,
                            'title', w.title,
                            'description', w.description,
                            'links_to_url', br.links_to_url
                        )
                    ) FILTER (WHERE w.id IS NOT NULL), 
                    '[]'::json
                ) as websites
            FROM buttons b
            LEFT JOIN buttons_relations br ON b.id = br.button_id
            LEFT JOIN websites w ON br.website_id = w.id
            WHERE b.id = ${buttonId}
            GROUP BY b.id
            `
        );

        if (buttonResults.length === 0) {
            return new Response(
                JSON.stringify({ error: "Button not found" }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const button = buttonResults[0];

        return new Response(
            JSON.stringify(button),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
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
    } finally {
        await client.end();
    }
};