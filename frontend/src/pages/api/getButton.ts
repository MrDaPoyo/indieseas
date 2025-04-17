import type { APIRoute } from "astro";

export const GET: APIRoute = async (request) => {
	try {
        const buttonId = request.url.searchParams.get("buttonId");
        if (!buttonId) {
            return new Response(
                JSON.stringify({ error: "buttonId is required" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const response = await fetch(
            `http://localhost:8000/retrieveButton?buttonId=${buttonId}`
        );

        if (!response.ok) {
            let errorDetails = "Failed to reach the IndieSeas API";
            try {
                const errorJson = await response.json();
                errorDetails = errorJson.error || errorDetails;
            } catch (e) {
            }
            return new Response(
                JSON.stringify({ error: errorDetails }),
                {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const imageBuffer = await response.arrayBuffer();
        const contentType = response.headers.get("Content-Type") || 'application/octet-stream';

        return new Response(imageBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
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
