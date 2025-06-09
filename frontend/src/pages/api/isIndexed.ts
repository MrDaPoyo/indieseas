import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async ({ url }) => {
    const client = postgres(import.meta.env.DB_URL!);

    try {
        let websiteUrl = url.searchParams.get("url");
        if (!websiteUrl) {
            return new Response(
                JSON.stringify({ error: "url parameter is required" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        if (!websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
            websiteUrl = `https://${websiteUrl}`;
        }

        if (websiteUrl.endsWith("/")) {
            websiteUrl = websiteUrl.slice(0, -1);
        }

        const urlRegex = /^(https?:\/\/)?([\w.-]+)(:[0-9]+)?(\/.*)?$/;
        if (!urlRegex.test(websiteUrl)) {
            return new Response(
                JSON.stringify({ error: "Invalid URL format" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const db = drizzle(client);

        const websiteResults = await db.execute(
            sql`SELECT * FROM websites WHERE url = ${websiteUrl}`
        );

        if (websiteResults.length === 0) {
            return new Response(
                JSON.stringify({ indexed: false }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const website = websiteResults[0];

        const totalButtons = await db.execute(
            sql`SELECT SUM(amount_of_buttons) as total FROM websites WHERE url LIKE ${websiteUrl + '%'}`
        );

        const totalButtonsCount = totalButtons[0]?.total || 0;

        return new Response(
            JSON.stringify({
                indexed: true,
                website: {
                    id: website.id,
                    url: website.url,
                    is_scraped: website.is_scraped,
                    status_code: website.status_code,
                    title: website.title,
                    description: website.description,
                    raw_text: website.raw_text,
                    scraped_at: website.scraped_at,
                    amount_of_buttons: totalButtonsCount,
                }
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (err) {
        console.error("Error fetching website:", err);
        return new Response(
            JSON.stringify({
                error: "Failed to fetch website from database",
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
