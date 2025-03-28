import { sleep } from "bun";
import * as db from "./db/db";

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;
let maxConcurrentScrapers = 2;

const urlsToScrape = await db.retrieveURLsToScrape();

if (urlsToScrape) {
  await db.addURLToScrape("https://thinliquid.dev/buttons-galore");
}

if (Array.isArray(urlsToScrape)) {
  for (const item of urlsToScrape) {
    console.log("Gonna scrape", item.url);
  }
}

if (Array.isArray(urlsToScrape)) {
  console.log("Scraping", urlsToScrape.length, "URLs");
  for await (const url of urlsToScrape) {
    if (currentlyScraping.includes(url)) {
      await sleep(1000);
    } else {
      currentlyScraping.push(url);
      const scraperWorker = new Worker("./scrapeWebsite.ts");
      scraperWorker.addEventListener("open", () => {
        scraperWorker.postMessage(url);
      });
      scraperWorker.addEventListener("message", (event) => {
        db.insertButton(event.data);
        db.scrapedURL(url.url, db.hash(url.url));
      });
    }
  }
}