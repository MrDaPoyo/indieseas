import * as db from "./db/db";

Bun.serve({
    routes: {
        "/search/all": new Response(await JSON.stringify(await db.retrieveAllButtons()))
    }
})