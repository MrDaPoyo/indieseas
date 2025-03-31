import { sleep } from "bun";
import * as db from "./db/db";

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;
const MAX_CONCURRENT_SCRAPERS = Number(process.env.MAX_CONCURRENT_SCRAPERS) || 10;

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = ["google.com", "raw.githubusercontent.com", "imgur", "catbox.moe", "facebook.com", "github.com", "x.com", "instagram.com", "twitter.com", "tiktok.com", "reddit.com", "tumblr.com", "pinterest.com", "flickr.com", "youtube.com", "vimeo.com", "dailymotion.com", "liveleak.com", "newgrounds.com", "deviantart.com", "artstation.com"];

let status = new Worker("./status.ts", { type: "module" });

if (process.argv[2] === "--nekoweb") {
	const nekoWebsites = await Bun.file("./nekoweb-urls.json").json();
	for (const url of nekoWebsites) {
		await db.addURLToScrape(url);
	}
} else if (process.argv[2] === "--status") {
	console.log(await Array.from(await db.retrieveAllButtons()).length + " Buttons Found so far.");
	console.log(await Array.from(await db.retrieveAllScrapedURLs()).length + " URLS Scraped so far.");
	console.log(await Array.from(await db.retrieveURLsToScrape()).length + " URLs to scrape.");
	process.exit(0);
}

if (urlsToScrape.length === 0) {
	if (process.argv[2] !== undefined && process.argv[2] !== "--nekoweb") {
		await db.removeURLEntirely(process.argv[2]);
		await db.addURLToScrape(process.argv[2]);
	}
	urlsToScrape = await db.retrieveURLsToScrape();
}

if (process.argv[2] !== undefined) {
	console.log("Adding URL to scrape:", process.argv[2]);
	await db.removeURLEntirely(process.argv[2]);
	db.addURLToScrape(process.argv[2]);
	urlsToScrape = await db.retrieveURLsToScrape();
}

console.log(
	"URLs to scrape:",
	Array.from(urlsToScrape).map((item) => item.url)
);

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
							if (
								button.links_to.startsWith("http") ||
								button.links_to.startsWith("https")
							) {
								const nextURL = new URL(button.links_to);
								await db.addURLToScrape(nextURL.hostname);
							} else {
								const nextURL = new URL(button.links_to, `https://${url}`);
								await db.addURLToScrape(nextURL.hostname);
							}
						} else if (button.src) {
							const nextURL = new URL(button.src);
							await db.addURLToScrape(nextURL.hostname);
						}
					}
				} else if (event.data.success) {
					console.log(`No buttons found on ${url}`);
				}
			} else {
				console.error(`Error scraping ${url}:`, event.data.error);
			}

			// Free up scraper slot regardless of success or failure
			currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
			await db.scrapedURL(url);
			urlsToScrape = urlsToScrape.filter((item) => item.url !== url);
			scraperWorker.terminate();
		};

		// Add error handler for the worker
		scraperWorker.onerror = (err) => {
			console.error(`Worker error for ${url}`);
			console.error(err.message);
			currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
			db.scrapedURL(url);
			scraperWorker.terminate();
		};
	} catch (error) {
		console.error(`Failed to scrape ${url}:`, error);
		currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
		await db.scrapedURL(url);
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

	console.log(
		`${currentlyScraping.length}/${MAX_CONCURRENT_SCRAPERS} active scrapers, ${urlsToScrape.length} URLs left to scrape.`
	);

	await sleep(1000);
	if (urlsToScrape.length === 0 && currentlyScraping.length === 0) {
		console.log("No more URLs to scrape.");
		break;
	}
}
