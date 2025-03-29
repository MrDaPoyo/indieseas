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

async function scrapeURL(url: string, websiteId?: number) {
  if (!url) {
    console.error("No URL provided for scraping.");
    return;
  }
  return new Promise((resolve, reject) => {
    if (currentlyScraping.length >= 30) {
      setTimeout(() => {
        scrapeURL(url, websiteId).then(resolve).catch(reject);
      }, 5000);
      return;
    }

    let normalizedUrl = url.toLowerCase().trim();
    // Remove protocol if present
    normalizedUrl = normalizedUrl.replace(/^https?:\/\//, '');
    normalizedUrl = new URL(`https://` + normalizedUrl).hostname;
    console.log("Normalized URL:", normalizedUrl);

    if (currentlyScraping.includes(normalizedUrl)) {
      console.log("Already scraping:", normalizedUrl);
      resolve({ success: false, reason: "already-scraping" });
      return;
    }

    currentlyScraping.push(normalizedUrl);
    console.log("Currently scraping:", currentlyScraping);

    const scraperWorker = new Worker("./scrapeWebsite.ts");

    scraperWorker.postMessage({ url: normalizedUrl, websiteId });
    scraperWorker.onmessage = async (event) => {
      if (event.data.success) {
        const buttonData = event.data.buttonData;
        for (const button of buttonData) {
          await db.insertButton(button, await db.retrieveURLId(normalizedUrl) as number);
          if (
            !prohibitedURLs.some((prohibitedURL) =>
              button.src.startsWith(prohibitedURL)
            )
          ) {
            if (button.links_to) {
              const nextURL = button.links_to.replace(/^https?:\/\//, '');
              await db.addURLToScrape(nextURL);
            }

            const nextURL = button.src.replace(/^https?:\/\//, '');
            await db.addURLToScrape(nextURL);

            if (
              !currentlyScraping.includes(nextURL) &&
              !Array.from(await db.retrieveURLsToScrape()).some(
                (item) => item.url === nextURL
              )
            ) {
              console.log("Adding URL to scrape:", nextURL);
            }
            await db.scrapedURL(normalizedUrl);
            currentlyScraping = currentlyScraping.filter(
              (item: any) => item !== normalizedUrl
            );
            console.log("Currently scraping:", currentlyScraping);
          }
        }
        resolve({ success: true, data: event.data });
        urlsToScrape = await db.retrieveURLsToScrape();
        console.log(urlsToScrape.length, "URLs left to scrape.");
      } else {
        await db.scrapedURL(normalizedUrl);
        console.error("Error in worker:", event.data.error);
        resolve({ success: false, error: event.data.error });
      }

      currentlyScraping = currentlyScraping.filter(
        (item: any) => item !== normalizedUrl
      );

      const timeout = setTimeout(() => {
        async function processQueue() {
          while (true) {
            urlsToScrape = await db.retrieveURLsToScrape();
            if (urlsToScrape.length === 0) {
              console.log("No more URLs to scrape, waiting...");
              await sleep(10000); // Wait 10 seconds before checking again
              continue;
            }

            const urlToScrape = urlsToScrape[0];
            if (!urlToScrape) {
              console.log("No URL found in the queue, continuing...");
              continue;
            }
            try {
              await scrapeURL(urlToScrape.url, urlToScrape.url_id);
            } catch (error) {
              console.error(`Error scraping ${urlToScrape.url}:`, error);
              await db.scrapedURL(urlToScrape.url);
            }
            console.log(
              urlsToScrape.length - 1,
              "URLs left to scrape."
            );
            await sleep(1000);
          }
        }

        processQueue().catch((err) => {
          console.error("Fatal error in processing queue:", err);
          process.exit(1);
        });
        scraperWorker.terminate();
      }, 10000);

      scraperWorker.onmessageerror = (error) => {
        clearTimeout(timeout);
        reject(error);
        currentlyScraping = currentlyScraping.filter(
          (item: any) => item !== normalizedUrl
        );
      };

      const messageHandler = async (event: any) => {
        if (event.data.success) {
          clearTimeout(timeout);
          resolve(event.data);
        }
      };

      scraperWorker.addEventListener("message", messageHandler);
    };
  });
}

for (let url of urlsToScrape) {
	scrapeURL(url.url, url.url_id);
	console.log(urlsToScrape.length, "URLs left to scrape.");
}
