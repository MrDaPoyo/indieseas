import { sleep } from "bun";
import * as db from "./db/db";

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = ["raw.githubusercontent.com"];

let status = new Worker("./status.ts");

console.log(
	"URLs to scrape:",
	Array.from(urlsToScrape).map((item) => item.url)
);

if (urlsToScrape.length === 0) {
	if (process.argv[2] === undefined) {
		console.error(
			"No URLs to scrape. Please provide a URL as an argument."
		);
		process.exit(1);
	}
	db.addURLToScrape(process.argv[2]);
	urlsToScrape = await db.retrieveURLsToScrape();
}

async function scrapeURL(url: string, url_id: number) {
	if (prohibitedURLs.some((prohibited) => url.includes(prohibited))) {
		console.log(`Skipping prohibited URL: ${url}`);
		await db.scrapedURL(url);
		return;
	}

	console.log(`Scraping ${url}...`);
	currentlyScraping.push(url);

	try {
		// Create a promise to handle worker completion
		const scraperWorker = new Worker("./scrapeWebsite.ts");
    scraperWorker.postMessage({ url: url });
		scraperWorker.onmessage = async (event) => {
			if (event.data.success) {
				// Process button data
				if (event.data.buttonData && event.data.buttonData.length > 0) {
					console.log(
						`Found ${event.data.buttonData.length} buttons on ${url}`
					);

					// Store the buttons in database
					for (const button of event.data.buttonData) {
						db.insertButton(button, url_id);
					}
					currentlyScraping = currentlyScraping.filter(
						(u) => u !== url
					);
					await db.scrapedURL(url);
					await sleep(1000);
				} else {
					console.log(`No buttons found on ${url}`);
				}
			} else {
				console.error(`Error scraping ${url}:`, event.data.error);
			}
		};
	} catch (error) {
		console.error(`Failed to scrape ${url}:`, error);
	}
}

for (let url of urlsToScrape) {
	scrapeURL(url.url, url.url_id);
	let urlsToScrape = await db.retrieveURLsToScrape();
	console.log(urlsToScrape.length, "URLs left to scrape.");
}
