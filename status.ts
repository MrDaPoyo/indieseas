import * as db from "./db/db";

Bun.serve({
	routes: {
		"/": async (req: Request) => {
			const buttons = await db.retrieveAllButtons();
			return new Response(
				JSON.stringify({
					buttons: buttons === false ? [] : buttons.length,
					scraped_urls: await db.retrieveAllScrapedURLs(),
				}),
				{}
			);
		},
	},
	port: 8080,
});
