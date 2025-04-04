declare var self: Worker;
import * as db from "./db/db";
import * as scrapeWebsite from "./scrapeWebsite";
import { lemmatizationList } from "./utils/lemmatize";

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
			await scrapeWebsite.scrapeEntireWebsite(
				url,
				website_id,
				maxPages
			);
			await db.scrapedURL(url);
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
