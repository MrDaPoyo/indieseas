import { sleep } from "bun";
import * as db from "./db/db";

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;
const MAX_CONCURRENT_SCRAPERS = 10; // Maximum number of concurrent scrapers

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = ["raw.githubusercontent.com", "imgur", "catbox.moe"];

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

if (process.argv[2] !== undefined) {
	console.log("Adding URL to scrape:", process.argv[2]);
	db.addURLToScrape(process.argv[2]);
	urlsToScrape = await db.retrieveURLsToScrape();
}

async function scrapeURL(url: string, url_id: number) {
	if (prohibitedURLs.some((prohibited) => url.includes(prohibited))) {
		console.log(`Skipping prohibited URL: ${url}`);
		await db.scrapedURL(url);
		return;
	}

	currentlyScraping.push(url);

	try {
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
						if (button.links_to) {
							const nextURL = new URL(button.links_to);
							await db.addURLToScrape(nextURL.hostname);
						} else if (button.src) {
							const nextURL = new URL(button.src);
							await db.addURLToScrape(nextURL.hostname);
						}
					}
					currentlyScraping = currentlyScraping.filter(
						(u: any) => u !== url
					);
					await db.scrapedURL(url);
					urlsToScrape = urlsToScrape.filter(item => item.url !== url);
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

while (true) {
	urlsToScrape = await db.retrieveURLsToScrape();
	
	const availableSlots = MAX_CONCURRENT_SCRAPERS - currentlyScraping.length;
	const urlsToProcess = urlsToScrape.slice(0, availableSlots);
	
	for (let url of urlsToProcess) {
		if (!currentlyScraping.includes(url.url)) {
			scrapeURL(url.url, url.url_id);
		}
	}
	
	console.log(`${currentlyScraping.length}/${MAX_CONCURRENT_SCRAPERS} active scrapers, ${urlsToScrape.length} URLs left to scrape.`);
	
	await sleep(1000);
	urlsToScrape = await db.retrieveURLsToScrape();
	if (urlsToScrape.length === 0) {
		console.log("No more URLs to scrape.");
		break;
	}
}
