import * as db from "./db/db";

Bun.serve({
	routes: {
		"/": async () => {
			const buttons = await db.retrieveAllButtons();
			return new Response(
				JSON.stringify({
					buttons: buttons.length,
				}),
				{}
			);
		},
	},
	port: 8080,
});
