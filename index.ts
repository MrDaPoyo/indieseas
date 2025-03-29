import { sleep } from "bun";
import * as db from "./db/db";
import { mkdirSync } from "node:fs";

mkdirSync("./scraped", { recursive: true });

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = ["githubusercontent.com", "postimg.cc", "imgur.com"];

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

async function scrapeURL(url: string) {
	if (currentlyScraping.includes(url)) {
		setTimeout(() => {
			console.log("Already scraping:", url);
		}, 1000);
		return;
	}
	currentlyScraping.push(url);
	console.log("Currently scraping:", currentlyScraping);
	const scraperWorker = new Worker("./scrapeWebsite.ts");

	scraperWorker.postMessage({ url: url });
	scraperWorker.onmessage = async (event) => {
		if (event.data.success) {
			const buttonData = event.data.buttonData;
			for (const button of buttonData) {
				await db.insertButton(button);
				if (
					!prohibitedURLs.some((prohibitedURL) =>
						button.src.includes(prohibitedURL)
					)
				) {
					const nextURL = new URL(button.src).hostname;
					await db.addURLToScrape(nextURL);
					if (
						!Array.from(await db.retrieveURLsToScrape()).some(
							(item) => item.url === nextURL
						)
					) {
						scrapeURL(nextURL);
						console.log("Adding URL to scrape:", button.src);
					}
					await db.scrapedURL(url);
					currentlyScraping = currentlyScraping.filter(
						(item: any) => item !== url
					);
					console.log("Currently scraping:", currentlyScraping);
				} else {
					console.error("Error in worker:", event.data.error);
				}
			}
			urlsToScrape = await db.retrieveURLsToScrape();
			await sleep(1000);
		}
	};
}

scrapeURL(urlsToScrape[0].url);
