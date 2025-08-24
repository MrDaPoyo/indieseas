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

export const GET: APIRoute = async () => {
    try {
        const client = postgres(process.env.DB_URL!);
        const db = drizzle(client);

        const relations = await db.execute(sql`SELECT * FROM buttons_relations`);
        const buttonResults = await db.execute(sql`SELECT id, value, link FROM buttons`);
        const websiteResults = await db.execute(sql`SELECT id, hostname FROM websites`);

        await client.end();

        if (!buttonResults || buttonResults.count == 0 || buttonResults[0].value == null) {
            return new Response(JSON.stringify({ error: "Button not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        const cleanResults = {
            "buttons": buttonResults.map((button) => ({
                id: button.id,
                link: button.link,
            })),
            "relations": relations.map((relation) => ({
                id: relation.id,
                button_id: relation.button_id,
                website_id: relation.website_id,
            })),
            "websites": websiteResults.map((website) => ({
                id: website.id,
                hostname: website.hostname,
            })),
        };
        
        return new Response(JSON.stringify(cleanResults), {
            status: 200,
            headers: { "Content-Type": "application/json" },
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
