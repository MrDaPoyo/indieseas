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
		},
		"/buttonSearchColor": async (req) => {
			const url = new URL(req.url);
			const query = decodeURIComponent(url.searchParams.get("q") || "");
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			const buttons = await db.retrieveAllButtons();
			if (!buttons) return new Response("No buttons found", { status: 404 });

			const queryColor = Bun.color(query, "[rgb]") || null;

			const buttonsWithColors = buttons.filter(button => button.avg_color);
			const sortedButtons = buttonsWithColors.map(button => {
				const colorComponents = Bun.color(button.avg_color, "[rgb]") || [0, 0, 0];
				if (colorComponents.length !== 3) return { ...button, distance: Infinity };
				const distance = deltaE(queryColor, colorComponents);
				return { ...button, distance };
			}).filter(button => button.distance < 20) // Filter buttons with distance under 10
				.sort((a, b) => a.distance - b.distance);

			function deltaE(rgbA, rgbB) {
				let labA = rgb2lab(rgbA);
				let labB = rgb2lab(rgbB);
				let deltaL = labA[0] - labB[0];
				let deltaA = labA[1] - labB[1];
				let deltaB = labA[2] - labB[2];
				let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
				let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
				let deltaC = c1 - c2;
				let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
				deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
				let sc = 1.0 + 0.045 * c1;
				let sh = 1.0 + 0.015 * c1;
				let deltaLKlsl = deltaL / (1.0);
				let deltaCkcsc = deltaC / (sc);
				let deltaHkhsh = deltaH / (sh);
				let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
				return i < 0 ? 0 : Math.sqrt(i);
			}

			function rgb2lab(rgb) {
				let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
				r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
				g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
				b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
				x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
				y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
				z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
				x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
				y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
				z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;
				return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)]
			}

			const page = parseInt(url.searchParams.get("page") || "1");
			const pageSize = 200;
			const start = (page - 1) * pageSize;
			const end = start + pageSize;
			const paginatedButtons = sortedButtons.slice(start, end);

			const totalButtons = sortedButtons.length;
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
		}
	},
	port: process.env.SEARCH_PORT || 8000,
});
