import { sleep } from "bun";
import * as db from "./db/db";

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
	init.headers = {
		...init.headers,
		"User-Agent": "indieseas/0.1 (+https://indieseas.net)",
	};

	return originalFetch(input, init);
};

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

	if (await db.isURLScraped(url)) {
		console.log(`Already scraped ${url}.`);
		currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
		return;
	}

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

		scraperWorker.onerror = async (err) => {
			console.error(`Worker error for ${url}`);
			console.error(err.message);
			currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
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
			console.log(`Starting to scrape from scraper.ts: ${url.url}`);
			await scrapeURL(url.url, url.url_id);
		}
	}

	console.log(
		`${currentlyScraping.length}/${MAX_CONCURRENT_SCRAPERS} active scrapers, ${urlsToScrape.length} URLs left to scrape.`
	);
	
	const allButtons = await db.retrieveAllButtons();
	if (allButtons.length > 0) {
		console.log(`Found ${allButtons.length} buttons so far.`);
	}

	await sleep(1000);
	urlsToScrape = await db.retrieveURLsToScrape();
	if (urlsToScrape.length === 0 && currentlyScraping.length === 0) {
		console.log("No more URLs to scrape.");
		break;
	}
}