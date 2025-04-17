declare var self: Worker;
import * as db from "./db/db";
import * as scrapeWebsite from "./scrapeWebsite";

console.log("Scraper worker started.");

self.onmessage = async (event: MessageEvent) => {
	let { url, website_id, maxPages } = event.data;
	try {
		if (!url) {
			console.log("No URL provided.");
			return;
		}

		if (await db.isURLScraped(url)) {
			console.log(`Already scraped ${url}.`);
			return;
		}

		if (url.startsWith("https://") || url.startsWith("http://")) {
			url = new URL(url).href;
		} else {
			url = "https://" + url;
			url = new URL(url).href;
		}

		try {
			await scrapeWebsite.scrapeEntireWebsite(url, website_id, maxPages);
			await db.scrapedURL(url);
			self.postMessage({
				success: true,
				message: `Scraped ${url} successfully.`,
			});
		} catch (error: any) {
			self.postMessage({ success: false, error: error.message });
			await db.scrapedURL(url);
			process.exit(1);
		}
	} catch (error: any) {
		self.postMessage({ success: false, error: error.message });
		process.exit(1);
	}
};

if (process.argv[2]) {
	await db.removeURLEntirely(process.argv[2]);
	db.addURLToScrape(process.argv[2]);
	const urlsToScrape = await db.retrieveURLsToScrape();

	const url = process.argv[2];
	const websiteId = urlsToScrape.find((item) => item.url === url)?.url_id;
	if (!websiteId) {
		console.error(`Website ID not found for URL: ${url}`);
		process.exit(1);
	}
	const maxPages = 50;

	console.log(
		`Direct execution: Scraping ${url}, website ID: ${websiteId}, max pages: ${maxPages}`
	);

	(async () => {
		try {
			await scrapeWebsite.scrapeEntireWebsite(url, websiteId, maxPages);
			await db.scrapedURL(url);
			console.log(`Scraped ${url} successfully.`);
		} catch (error: any) {
			console.error(`Error scraping ${url}: ${error}`);
			await db.scrapedURL(url);
			process.exit(1);
		}
	})();

	process.exit(0);
}
