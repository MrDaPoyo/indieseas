import type { APIRoute } from "astro";

export const GET: APIRoute = async (request) => {
    try {
        const timer = performance.now();
        const query = request.url.searchParams.get("q") || null;
        const color = request.url.searchParams.get("color") || false;
        
        if (!query || query.trim() === "") {
            return new Response(
                JSON.stringify({ error: "Missing query parameter" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        if (color) {
            return await fetch(
                `http://localhost:8000/buttonSearchColor?q=${encodeURIComponent(query)}&color=true&page=${request.url.searchParams.get("page") || 1}&rainbow=${request.url.searchParams.get("rainbow") == "true" ? "true" : "false"}`,
            ).then(async (response) => {
                if (!response.ok) {
                    return new Response(
                        JSON.stringify({ error: "Failed to reach the IndieSeas API" }),
                        {
                            status: response.status,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }
                
                const result = await response.json();
                return new Response(JSON.stringify({results: result, time: performance.now() - timer}), {
                    status: 200,
                    headers: {
                        "Content-Type": "text/json",
                    },
                });
            });
        }

        const response = await fetch(
            `http://localhost:8000/buttonSearch?q=${encodeURIComponent(query)}&rainbow=${request.url.searchParams.get("rainbow") == "true" ? "true" : "false"}`,
        );
        if (!response.ok) {
            return new Response(
                JSON.stringify({ error: "Failed to reach the IndieSeas API" }),
                {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const result = await response.json();

        return new Response(JSON.stringify({results: result, time: performance.now() - timer}), {
            status: 200,
            headers: {
                "Content-Type": "text/json",
            },
        });
    } catch (err) {
        return new Response(
            JSON.stringify({
                error: "Failed to fetch the IndieSeas API",
                details: String(err),
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
};
