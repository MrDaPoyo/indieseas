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
            sql`SELECT content FROM buttons WHERE id = ${buttonId}`
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
        const imageBuffer = button.content as Buffer;
        const imageName = `button-${buttonId}.png`;

        return new Response(imageBuffer, {
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
    } finally {
        await client.end();
    }
};
