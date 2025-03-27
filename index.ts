const puppeteer = require("puppeteer");
import * as db from "./db/db";
import * as bcrypt from "bcryptjs";
import { allocUnsafe } from "bun";
import { mkdir } from "node:fs/promises";

await mkdir("./static/buttons", { recursive: true });

function hashImage(image: Base64URLString): Base64URLString {
    return bcrypt.hashSync(image, 10);
}

Bun.color("reset", "ansi");

Bun.serve({
  routes: {
    "/search/all": async () => {
      const buttons = await db.retrieveAllButtons();
      return new Response(JSON.stringify(buttons));
    }
  }
});

const allURLs = [
    "https://thinliquid.dev/buttons-galore",
];

const visited = [] as any;

for (const url of allURLs) {
    const scraper = new Worker("./scrapeWebsite.ts", { type: "module" });
    scraper.postMessage(url);
    scraper.onmessage = event => {
        console.log(event.data.allURLs);
        allURLs.push(...event.data.allURLs);
        if (allURLs.length > 0) {
            const nextURL = allURLs.pop();
            if (!visited.includes(nextURL)) {
                visited.push(nextURL);
                const nextScraper = new Worker("./scrapeWebsite.ts", { type: "module" });
                nextScraper.postMessage(nextURL);
            }
        }
    };
}

console.log("IndieSearch scraper running.");