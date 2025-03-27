import * as db from "./db/db";

console.log("IndieSearch scraper running.");

db.scrapedURL("https://thinliquid.dev/buttons-galore", db.hash("https://thinliquid.dev/buttons-galore"));

let currentlyScraping = [] as any;

const urlsToScrape = await db.retrieveURLsToScrape();
if (Array.isArray(urlsToScrape)) {
    for (const url of urlsToScrape) {
      if (!currentlyScraping.includes(url)) {
        continue;
      } else { 
        currentlyScraping.push(url);
        const scraperWorker = new Worker("scrapeWebsite.ts");
        scraperWorker.postMessage(url);
      }
    }
}
console.log("Finished!");
