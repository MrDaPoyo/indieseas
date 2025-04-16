import type { APIRoute } from "astro";

const API_BASE_URL = "http://localhost:8000";

async function handleApiRequest(url: string, method: string = "GET") {
    try {
        const response = await fetch(url, { method });
        if (!response.ok) {
            let errorDetails = "Failed to reach the IndieSeas API";
            try {
                const errorResult = await response.json();
                errorDetails = errorResult.error || errorDetails;
            } catch (parseError) {
                // Ignore if response is not JSON
            }
            return new Response(
                JSON.stringify({ error: errorDetails }),
                {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        const result = await response.json();
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" }, // Corrected Content-Type
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
}

// GET /api/vote?website_id=... (retrieveVotes)
export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const websiteId = url.searchParams.get("website_id");

    if (!websiteId) {
        return new Response(
            JSON.stringify({ error: "Missing website_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Validate if websiteId is a number, although the backend does parseInt
    if (isNaN(parseInt(websiteId))) {
         return new Response(
            JSON.stringify({ error: "Invalid website_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const apiUrl = `${API_BASE_URL}/retrieveVotes?website_id=${websiteId}`;
    return handleApiRequest(apiUrl, "GET");
};

// POST /api/vote?website_id=... (castVote)
export const POST: APIRoute = async ({ request, clientAddress }) => {
    const url = new URL(request.url);
    const websiteId = url.searchParams.get("website_id");
    let ip = clientAddress;
    try {
        const body = await request.json();
        if (body && body.ip) {
            ip = body.ip;
        }
    } catch (error) {
        console.log("Could not parse request body, using clientAddress instead");
    }

    if (!websiteId) {
        return new Response(
            JSON.stringify({ error: "Missing website_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    if (isNaN(parseInt(websiteId))) {
         return new Response(
            JSON.stringify({ error: "Invalid website_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    if (!ip) {
         console.error("Could not determine client IP address.");
         return new Response(
            JSON.stringify({ error: "Could not determine client IP address" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    const apiUrl = `${API_BASE_URL}/castVote?website_id=${websiteId}&ip=${encodeURIComponent(ip)}`;
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
        let errorDetails = "Failed to reach the IndieSeas API";
        try {
            const errorResult = await response.json();
            errorDetails = errorResult.error || errorDetails;
        } catch (parseError) {
            // Ignore if response is not JSON
        }
        return new Response(
            JSON.stringify({ error: errorDetails }),
            {
                status: response.status,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
    const result = await response.json();
    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
};

// DELETE /api/vote?vote_id=... (removeVote)
export const DELETE: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const voteId = url.searchParams.get("vote_id");

    if (!voteId) {
        return new Response(
            JSON.stringify({ error: "Missing vote_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

     // Validate if voteId is a number
    if (isNaN(parseInt(voteId))) {
         return new Response(
            JSON.stringify({ error: "Invalid vote_id parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const apiUrl = `${API_BASE_URL}/removeVote?vote_id=${voteId}`;
    return handleApiRequest(apiUrl, "DELETE");
};
