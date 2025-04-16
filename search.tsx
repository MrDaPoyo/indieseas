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
			const buttons = await db.retrieveAllButtons();
			const url = new URL(req.url);
			const rainbowFilter = true;
			const page = parseInt(url.searchParams.get("page") || "1");
			const pageSize = 100;
			const start = (page - 1) * pageSize;
			const end = start + pageSize;
			
			let sortedButtons = [...buttons];
			if (rainbowFilter) {
				console.log("Sorting buttons by rainbow filter");
				sortedButtons.sort((a, b) => {
					if (!a.avg_color && !b.avg_color) return 0;
					if (!a.avg_color) return 1;
					if (!b.avg_color) return -1;
					return a.avg_color.localeCompare(b.avg_color);
				});
			}
			
			let paginatedButtons = sortedButtons.slice(start, end);
			
			const totalButtons = buttons.length;
			const totalPages = Math.ceil(totalButtons / pageSize);
			const hasNextPage = page < totalPages;
			const hasPreviousPage = page > 1;
			
			return new Response(JSON.stringify({
				buttons: paginatedButtons,
				pagination: {
					currentPage: page,
					totalPages,
					totalButtons,
					hasNextPage,
					hasPreviousPage,
					nextPage: hasNextPage ? page + 1 : null,
					previousPage: hasPreviousPage ? page - 1 : null
				}
			}), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		},
		"/buttonSearch": async (req) => {
			const url = new URL(req.url);
			const rainbowFilter = url.searchParams.get("rainbow") == "true";
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
			const pageSize = 200;
			const start = (page - 1) * pageSize;
			const end = start + pageSize;
			let paginatedButtons = filteredButtons.slice(start, end);
			
			const totalButtons = filteredButtons.length;
			const totalPages = Math.ceil(totalButtons / pageSize);
			const hasNextPage = page < totalPages;
			const hasPreviousPage = page > 1;


			let sortedButtons = [...filteredButtons];
			if (rainbowFilter) {
				sortedButtons.sort((a, b) => {
					if (!a.avg_color && !b.avg_color) return 0;
					if (!a.avg_color) return 1;
					if (!b.avg_color) return -1;
					return a.avg_color.localeCompare(b.avg_color);
				});
				paginatedButtons = sortedButtons.slice(start, end);
			} else {
				paginatedButtons = filteredButtons.slice(start, end);
			}

		
			return new Response(JSON.stringify({
				buttons: paginatedButtons,
				pagination: {
					currentPage: page,
					totalPages,
					totalButtons,
					hasNextPage,
					hasPreviousPage,
					nextPage: hasNextPage ? page + 1 : null,
					previousPage: hasPreviousPage ? page - 1 : null
				}
			}), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		}
	},
	port: process.env.SEARCH_PORT || 8000,
});
