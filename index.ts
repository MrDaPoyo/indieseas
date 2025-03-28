import { sleep } from "bun";
import * as db from "./db/db";

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;
let maxConcurrentScrapers = 2;

let urlsToScrape = await db.retrieveURLsToScrape();

console.log("URLs to scrape:", urlsToScrape);

if (urlsToScrape.length === 0) {
  console.log("No URLs to scrape. Adding a test URL.");
	await db.addURLToScrape("https://thinliquid.dev/buttons-galore");
  urlsToScrape = await db.retrieveURLsToScrape();
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
			scraperWorker.addEventListener("message", async (event) => {
				if (event.data.success) {
					console.log("Scraping completed for", url.url);
					for (const button of event.data.buttonData) {
						db.insertButton(button);
					}
				} else {
					scraperWorker.terminate();
					console.log(
						"Scraping failed for",
						url.url,
						event.data.error
					);
				}
				await db.scrapedURL(url.url, db.hash(url.url));
        urlsToScrape = await db.retrieveURLsToScrape();
			});
		}
	}
}
