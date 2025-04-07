import { sleep } from "bun";

import * as db from "./db/db";

let currentlyScraping = [] as any;
const MAX_CONCURRENT_SCRAPERS =
	Number(process.env.MAX_CONCURRENT_SCRAPERS) || 10;

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = [
	"google.com",
	"raw.githubusercontent.com",
	"catbox.moe",
	"facebook.com",
	"github.com",
	"x.com",
	"instagram.com",
	"twitter.com",
	"tiktok.com",
	"reddit.com",
	"tumblr.com",
	"pinterest.com",
	"flickr.com",
	"youtube.com",
	"vimeo.com",
	"dailymotion.com",
	"liveleak.com",
	"newgrounds.com",
	"deviantart.com",
	"artstation.com",
	"ze.wtf",
];

if (process.argv[2] === "--nekoweb") {
	const nekoWebsites = await Bun.file("./nekoweb-urls.json").json();
	for (const url of nekoWebsites) {
		await db.addURLToScrape(url);
	}
} else if (process.argv[2] === "--status") {
	const allButtons = await db.retrieveAllButtons();

	if (allButtons)
		console.log((await allButtons.length) + " Buttons Found so far.");
	console.log(
		(await Array.from(await db.retrieveAllScrapedURLs()).length) +
			" URLS Scraped so far."
	);
	console.log(
		(await Array.from(await db.retrieveURLsToScrape()).length) +
			" URLs to scrape."
	);
	process.exit(0);
} else if (process.argv[2] === "--check-url") {
	const urlToCheck = process.argv[3];
	if (!urlToCheck) {
		console.error("Please provide a URL to check.");
		process.exit(1);
	}
	if (await db.isURLScraped(urlToCheck)) {
		console.log(`URL ${urlToCheck} has already been scraped.`);
	} else {
		console.log(`URL ${urlToCheck} has not been scraped yet.`);
	}
	process.exit(0);
}

if (urlsToScrape.length === 0) {
	if (process.argv[2] != undefined && process.argv[2] != "--nekoweb") {
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

let search = new Worker("./search.tsx", { type: "module" });

console.log(
	"URLs to scrape:",
	Array.from(urlsToScrape).map((item) => item.url)
);

async function scrapeURL(url: string, url_id: number) {
	const originalUrl = url;
	if (!url) {
		console.log("No URL provided.");
		return;
	}
	if (prohibitedURLs.some((prohibited) => url.includes(prohibited))) {
		console.log(`Skipping prohibited URL: ${url}`);
		await db.scrapedURL(url);
		return;
	}

	currentlyScraping.push(originalUrl);

	if (await db.isURLScraped(url)) {
		console.log(`Already scraped ${url}.`);
		currentlyScraping = currentlyScraping.filter((u: any) => u !== url);
		return;
	}

	if (url.startsWith("https://") || url.startsWith("http://")) {
		url = new URL(url).href;
	} else {
		url = "https://" + url;
		url = new URL(url).href;
	}

	try {
		const worker = new Worker("./scraperWorker.ts", {
			type: "module",
		});

		worker.addEventListener("open", () => {
			worker.postMessage({ url, website_id: url_id, maxPages: 50 });
		});

		await new Promise<void>((resolve) => {
			worker.onmessage = async (event) => {
				if (event.data.success) {
					console.log(`Successfully scraped ${url}`);
					await db.scrapedURL(originalUrl);
				} else if (!event.data.success) {
					console.error(`Error scraping ${url}:`, event.data.error);
					await db.scrapedURL(originalUrl);
				}
				resolve();
			};
		});
	} catch (error) {
		console.error(`Error scraping ${url}:`, error);
	} finally {
		currentlyScraping = currentlyScraping.filter(
			(u: any) => u !== originalUrl
		);
	}
}

while (true) {
	urlsToScrape = await db.retrieveURLsToScrape();

	const availableSlots = MAX_CONCURRENT_SCRAPERS - currentlyScraping.length;
	const urlsToProcess = urlsToScrape.slice(0, availableSlots);

	// Start multiple scrape operations concurrently
	const scrapePromises = urlsToProcess.map(url => {
		if (!currentlyScraping.includes(url.url)) {
			console.log(`Starting to scrape from scraper.ts: ${url.url}`);
			return scrapeURL(url.url, url.url_id);
		}
		return Promise.resolve();
	});

	// Wait for any scrape operations to complete before checking again
	if (scrapePromises.length > 0) {
		await Promise.all(scrapePromises);
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
