import { sleep } from "bun";
import * as db from "./db/db";
import { mkdirSync } from "node:fs";
import { Console } from "node:console";

mkdirSync("./scraped", { recursive: true });

console.log("IndieSearch scraper running.");

let currentlyScraping = [] as any;

let urlsToScrape = await db.retrieveURLsToScrape();

let prohibitedURLs = ["https://raw.githubusercontent.com/"];

let status = new Worker("status.ts");

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
	if (currentlyScraping.length >= 30) {
		setTimeout(() => {
			scrapeURL(url);
		}, 5000);
		return;
	}

	const normalizedUrl = url.toLowerCase().trim();

	if (currentlyScraping.includes(normalizedUrl)) {
		console.log("Already scraping:", normalizedUrl);
		return;
	}

	currentlyScraping.push(normalizedUrl);
	console.log("Currently scraping:", currentlyScraping);

	const scraperWorker = new Worker("./scrapeWebsite.ts");

	scraperWorker.postMessage({ url: normalizedUrl });
	scraperWorker.onmessage = async (event) => {
		if (event.data.success) {
			const buttonData = event.data.buttonData;
			for (const button of buttonData) {
				await db.insertButton(button);
				if (
					!prohibitedURLs.some((prohibitedURL) =>
						button.src.startsWith(prohibitedURL)
					)
				) {
					if (button.links_to) {
						const nextURL = new URL(button.links_to).hostname;
						await db.addURLToScrape(nextURL);
					}
					const nextURL = new URL(button.src).hostname;
					await db.addURLToScrape(nextURL);
					if (
						!currentlyScraping.includes(nextURL) &&
						!Array.from(await db.retrieveURLsToScrape()).some(
							(item) => item.url === nextURL
						)
					) {
						console.log("Adding URL to scrape:", button.src);
					}
					await db.scrapedURL(normalizedUrl);
					currentlyScraping = currentlyScraping.filter(
						(item: any) => item !== normalizedUrl
					);
					console.log("Currently scraping:", currentlyScraping);
				} else {
          db.scrapedURL(normalizedUrl);
					console.error("Error in worker:", event.data.error);
				}
			}
			urlsToScrape = await db.retrieveURLsToScrape();
			console.log(urlsToScrape.length, "URLs left to scrape.");
			await sleep(1000);
		}
	};
}

for (let url of urlsToScrape) {
	scrapeURL(url.url);
	console.log(urlsToScrape.length, "URLs left to scrape.");
}
