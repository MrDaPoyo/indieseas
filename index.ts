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
	await db.addURLToScrape("https://thinliquid.dev/");
	urlsToScrape = await db.retrieveURLsToScrape();
}

while (true) {
	if (Array.isArray(urlsToScrape)) {
		console.log("Scraping", urlsToScrape.length, "URLs");

		const MAX_CONCURRENT_SCRAPERS = 1;

		for await (const url of urlsToScrape) {
			// Wait until we have a free slot for scraping
			while (currentlyScraping.length >= MAX_CONCURRENT_SCRAPERS) {
				console.log(
					`Max concurrent scrapers (${MAX_CONCURRENT_SCRAPERS}) reached. Waiting...`
				);
				await sleep(1000);
			}

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
							if (
								button.src.includes(
									"github",
									"githubusercontent",
									"facebook",
									"twitter",
									"instagram",
									"linkedin",
									"pinterest",
									"tiktok",
									"reddit",
									"tumblr",
									"discord"
								)
							) {
								continue;
							} else {
								const hostname = new URL(button.src).hostname;
								console.log("Next URL:", hostname);
								db.addURLToScrape(`https://${hostname}/`);
							}
							urlsToScrape = await db.retrieveURLsToScrape();
						}
					} else {
						scraperWorker.terminate();
						console.log(
							"Scraping failed for",
							url.url,
							event.data.error
						);
					}

					// Remove from currently scraping when done
					const index = currentlyScraping.indexOf(url);
					if (index > -1) {
						currentlyScraping.splice(index, 1);
					}
					const scrapedUrl = new URL(url.url);
					await db.scrapedURL(scrapedUrl.hostname);
					urlsToScrape = await db.retrieveURLsToScrape();
				});
			}
		}
	}

	// Add a small delay before the next iteration to prevent tight looping
	console.log("Waiting for new URLs to scrape...");
	await sleep(5000);
}
