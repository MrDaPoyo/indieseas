import * as db from "./db/db";

Bun.serve({
	routes: {
		"/": async () => {
			const buttons = await db.retrieveAllButtons();
			if (!buttons) {
				return new Response("No buttons found", { status: 404 });
			}
			return new Response(
				JSON.stringify({
					buttons: buttons.length,
				}),
				{}
			);
		},
	},
	port: 80,
});
