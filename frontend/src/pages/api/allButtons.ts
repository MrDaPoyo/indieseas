import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async ({ url }) => {
    try {
        const client = postgres(import.meta.env.DB_URL!);
        const db = drizzle(client);

        const page = parseInt(url.searchParams.get("page") || "1");
        const pageSize = parseInt(url.searchParams.get("pageSize") || "200");
        const colorFilter = url.searchParams.get("color") === "true";
        const searchQuery = url.searchParams.get("q") || "";
        
        const offset = (page - 1) * pageSize;

        let totalCountResult;
        let buttonResults;

        if (colorFilter && searchQuery) {
            const searchPattern = `%${searchQuery}%`;
            
            totalCountResult = await db.execute(
                sql`SELECT COUNT(*) as count FROM buttons WHERE color_tag ILIKE ${searchPattern}`
            );

            buttonResults = await db.execute(
                sql`SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title 
                    FROM buttons 
                    WHERE color_tag ILIKE ${searchPattern} 
                    ORDER BY id DESC 
                    LIMIT ${pageSize} OFFSET ${offset}`
            );
        } else if (searchQuery) {
            const searchPattern = `%${searchQuery}%`;
            
            totalCountResult = await db.execute(
                sql`SELECT COUNT(*) as count FROM buttons WHERE url ILIKE ${searchPattern}`
            );

            buttonResults = await db.execute(
                sql`SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title 
                    FROM buttons 
                    WHERE url ILIKE ${searchPattern} 
                    ORDER BY id DESC 
                    LIMIT ${pageSize} OFFSET ${offset}`
            );
        } else {
            totalCountResult = await db.execute(
                sql`SELECT COUNT(*) as count FROM buttons`
            );

            buttonResults = await db.execute(
                sql`SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title 
                    FROM buttons 
                    ORDER BY id DESC 
                    LIMIT ${pageSize} OFFSET ${offset}`
            );
        }

        const totalCount = totalCountResult[0].count as number;
        const totalPages = Math.ceil(totalCount / pageSize);

        const response = {
            buttons: buttonResults,
            pagination: {
                currentPage: page,
                totalPages,
                totalButtons: totalCount,
                hasPreviousPage: page > 1,
                hasNextPage: page < totalPages,
                previousPage: page > 1 ? page - 1 : null,
                nextPage: page < totalPages ? page + 1 : null
            }
        };

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        return new Response(
            JSON.stringify({
                error: "Failed to fetch buttons from database",
                details: String(err),
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
};
