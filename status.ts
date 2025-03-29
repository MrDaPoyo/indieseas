import * as db from "./db/db";

Bun.serve({
    "routes": {
        "/": async (req: Request) => {
            const buttons = await db.retrieveAllButtons();
            return new Response(JSON.stringify(buttons === false ? [] : buttons.length));
        },
    },
    "port": 80,
})