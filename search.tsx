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
		},
		"/retrieveAllButtons": async (req) => {
			const url = new URL(req.url);
			const rainbowFilter = url.searchParams.get("rainbow") === "true";
			const page = parseInt(url.searchParams.get("page") || "1");
			const pageSize = parseInt(url.searchParams.get("pageSize") || "100");
			let buttons = await db.retrievePagedButtons(page, pageSize);
			
			let pagination = buttons.pagination;
			let sortedButtons = [...buttons.buttons];
			if (rainbowFilter) {
				console.log("Sorting buttons by rainbow filter");
				sortedButtons.sort((a, b) => {
					if (!a.avg_color && !b.avg_color) return 0;
					if (!a.avg_color) return 1;
					if (!b.avg_color) return -1;
					return a.avg_color.localeCompare(b.avg_color);
				});
			}

			return new Response(JSON.stringify({
				buttons: sortedButtons,
				pagination
			}), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/buttonSearch": async (req) => {
			const url = new URL(req.url);
			const rainbowFilter = url.searchParams.get("rainbow") === "true";
			const query = decodeURIComponent(url.searchParams.get("q") || "");
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			
			const buttons = await db.retrieveAllButtons();
			if (!buttons) return new Response("No buttons found", { status: 404 });
			
			const filteredButtons = buttons.filter((button: any) => {
				const query_lower = query.toLowerCase();
				return (
					(button.title?.toLowerCase().includes(query_lower)) ||
					(button.alt?.toLowerCase().includes(query_lower)) ||
					(button.links_to?.toLowerCase().includes(query_lower)) ||
					(button.found_url?.toLowerCase().includes(query_lower))
				);
			});

			const page = parseInt(url.searchParams.get("page") || "1");
			const pageSize = parseInt(url.searchParams.get("pageSize") || "200");
			
			let sortedButtons = [...filteredButtons];
			if (rainbowFilter) {
				sortedButtons.sort((a, b) => {
					if (!a.avg_color && !b.avg_color) return 0;
					if (!a.avg_color) return 1;
					if (!b.avg_color) return -1;
					return a.avg_color.localeCompare(b.avg_color);
				});
			}

			const totalButtons = sortedButtons.length;
			const totalPages = Math.ceil(totalButtons / pageSize);
			const validPage = Math.max(1, Math.min(page, totalPages || 1));
			const start = (validPage - 1) * pageSize;
			const end = start + pageSize;
			
			const paginatedButtons = sortedButtons.slice(start, end);
			const hasNextPage = validPage < totalPages;
			const hasPreviousPage = validPage > 1;

			return new Response(JSON.stringify({
				buttons: paginatedButtons,
				pagination: {
					currentPage: validPage,
					totalPages,
					totalButtons,
					hasNextPage,
					hasPreviousPage,
					nextPage: hasNextPage ? validPage + 1 : null,
					previousPage: hasPreviousPage ? validPage - 1 : null,
					pageSize
				}
			}), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/buttonSearchColor": async (req) => {
			const url = new URL(req.url);
			const query = decodeURIComponent(url.searchParams.get("q") || "");
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			const page = parseInt(url.searchParams.get("page") || "1");
			const pageSize = parseInt(url.searchParams.get("pageSize") || "200");
			const buttons = await db.retrievePagedButtons(page, pageSize, query);
			if (!buttons) return new Response("No buttons found", { status: 404 });

			return new Response(JSON.stringify({
				buttons: buttons.buttons,
				pagination: buttons.pagination
			}), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		}
	},
	port: process.env.SEARCH_PORT || 8000,
});
