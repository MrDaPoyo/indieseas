import * as db from "./db/db";

console.log("Starting search server...");

Bun.serve({
	routes: {
		"/search": async (req) => {
			const url = new URL(req.url);
			const query = decodeURIComponent(url.searchParams.get("q") || "");
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			const results = await db.search(query);
			return new Response(JSON.stringify(results), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/stats": async (req) => {
			const stats = {
				totalButtons: (await db.retrieveAllButtons()).length,
				totalWebsites: (await db.retrieveAllScrapedURLs()).length,
			}
			return new Response(JSON.stringify(stats), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/randomWebsite": async (req) => {
			const randomWebsite = await db.retrieveRandomWebsite();
			if (!randomWebsite) {
				return new Response("No random website found", { status: 404 });
			}
			
			return new Response(JSON.stringify(randomWebsite), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/checkIfIndexed": async (req) => {
			const url = new URL(req.url);
			const hostname = url.searchParams.get("url");
			if (!hostname) {
				return new Response("No URL provided", { status: 400 });
			}
			const isIndexed = await db.isURLScraped(hostname);
			return new Response(JSON.stringify({ isIndexed }), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		}
	},
	port: process.env.SEARCH_PORT || 8000,
});
