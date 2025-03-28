import { sleep } from "bun";
import * as db from "./db/db";
import { mkdirSync } from "node:fs";

mkdirSync("./scraped", { recursive: true });

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;

let urlsToScrape = await db.retrieveURLsToScrape();

console.log(
	"URLs to scrape:",
	Array.from(urlsToScrape).map((item) => item.url)
);

if (urlsToScrape.length === 0) {
	console.log("No URLs to scrape. Adding a test URL.");
	await db.addURLToScrape("https://thinliquid.dev/buttons-galore");
	urlsToScrape = await db.retrieveURLsToScrape();
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
					for (const button of event.data.buttonData) {
						await db.insertButton(button);
					}
				} else {
					scraperWorker.terminate();
					console.log(
						"Scraping failed for",
						url.url,
						event.data.error
					);
				}
				await db.scrapedURL(url.url);
				urlsToScrape = await db.retrieveURLsToScrape();
			});
		}
	}
}
