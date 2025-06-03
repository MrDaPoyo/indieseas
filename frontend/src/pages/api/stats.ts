import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async (request) => {
    try {
        const client = postgres(import.meta.env.DB_URL!);
        const db = drizzle(client);

        const timer = performance.now();

        const statsQuery = await db.execute(sql`
            WITH button_stats AS (
                SELECT COUNT(*) as total_buttons FROM buttons
            )
            SELECT 
                COUNT(*) as total_websites,
                COUNT(CASE WHEN is_scraped = true THEN 1 END) as scraped_websites,
                COUNT(CASE WHEN status_code = 200 THEN 1 END) as successful_websites,
                AVG(amount_of_buttons) as avg_buttons,
                (SELECT COUNT(*) FROM buttons) as buttons
            FROM websites
        `);

        const stats = statsQuery[0];

        return new Response(JSON.stringify({
            total_websites: Number(stats.total_websites),
            scraped_websites: Number(stats.scraped_websites),
            successful_websites: Number(stats.successful_websites),
            other_websites: Number(stats.total_websites) - Number(stats.scraped_websites),
            buttons: Number(stats.buttons),
            time: performance.now() - timer
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        console.error("Stats error:", err);
        return new Response(
            JSON.stringify({
                error: "Failed to fetch stats",
                details: String(err),
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
};
