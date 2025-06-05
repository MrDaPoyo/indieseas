import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
    const client = postgres(import.meta.env.DB_URL!);
    
    try {
        const db = drizzle(client);

        const result = await db.execute(
            sql`SELECT * FROM websites WHERE status_code = 200 ORDER BY RANDOM() LIMIT 1`
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
