import type { ArrayBindingElement } from "typescript";
import * as db from "./db/db";

Bun.serve({
  port: 3000,
  routes: {
    "/search": async () => {
      const buttons = await db.retrieveAllButtons();
      return new Response(JSON.stringify(buttons));
    }
  },
});

const startURL = [
    "https://thinliquid.dev/buttons-galore",
];

for (const url of await db.retrieveURLsToScrape()) {
    const scraperWorker = new Worker("scrapeWebsite.ts");
    scraperWorker.postMessage(url);
}

console.log("IndieSearch scraper running.");