import type { APIRoute } from "astro";

export const GET: APIRoute = async (request) => {
	try {
		const timer = performance.now();
		const url = new URL(request.url);
		const query = url.searchParams.get("q") || null;
		const color = url.searchParams.get("color") || false;

		if (!query || query.trim() === "") {
			return new Response(
				JSON.stringify({ error: "Missing query parameter" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

        const rainbowFilter = url.searchParams.get("rainbow") === "true";
        const colorQuery = url.searchParams.get("color") || "";
        const maxDistance = url.searchParams.get("maxDistance") || "20";
        const pageParam = url.searchParams.get("page") || "1";
        const pageSize = url.searchParams.get("pageSize") || "200";

        const apiUrl = new URL("http://localhost:8000/buttonSearch");
        if (query) apiUrl.searchParams.set("q", query);
        if (colorQuery) apiUrl.searchParams.set("color", colorQuery);
        if (rainbowFilter) apiUrl.searchParams.set("rainbow", "true");
        apiUrl.searchParams.set("maxDistance", maxDistance);
        apiUrl.searchParams.set("page", pageParam);
        apiUrl.searchParams.set("pageSize", pageSize);

        const response = await fetch(apiUrl.toString());
        
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

        return new Response(
            JSON.stringify({
                results: result,
                time: performance.now() - timer,
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
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
