const fs = require("fs");
import * as FileType from "file-type";

async function scrapeWebsites() {
	console.log("Starting to scrape website directories...");

	const sites = [];

	for (let i = 1; i <= 30; i++) {
		sites.push(`https://nekoweb.org/explore?page=${i}`);
	}

	for (const site of sites) {
		console.log(`Scraping ${site}...`);

		try {
			const response = await fetch(site);

			if (!response.ok) {
				console.error(
					`Failed to fetch ${site}: ${response.status} ${response.statusText}`
				);
				continue;
			}

			const rewriter = new HTMLRewriter().on("a", {
				async element(element: any) {
					let href = element.getAttribute("href") || "";
					if (
						href &&
						!href.startsWith("http") &&
						href.includes(".nekoweb.org")
					) {
						href = new URL(`https://${href.replace(/\//g, "")}`)
							.hostname;
						console.log(`Found link: ${href}`);
						processURL(href);
					}
				},
			});

			await rewriter.transform(response).text();

			await new Promise<void>((resolve) => setTimeout(resolve, 1000));
		} catch (error) {
			console.error(`Error while scraping ${site}:`, error);
		}
	}

	console.log("Finished scraping website directories");
}

let allURLs = [] as any[];

function processURL(hostname: string) {
	try {
		if (hostname) {
			allURLs.push(hostname);
		}
	} catch (error) {
		console.error(`Error processing URL ${hostname}:`, error);
	}
}

scrapeWebsites()
	.then(async () => {
		console.log(
			`Scraped ${allURLs.length} unique URLs. Writing to file...`
		);

		fs.writeFileSync(
			"nekoweb-urls.json",
			JSON.stringify(allURLs, null, 2),
			"utf8"
		);

		for (const url of allURLs) {
			var response = await fetch(
				`https://nekoweb.org//screenshots/${url}/index_large.jpg`
			);
			if (!response.ok) {
				console.error(
					`Failed to fetch screenshot for ${url}: ${response.status} ${response.statusText}`
				);
				continue;
			}
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const outputFileName = `./indie/${Buffer.from(
				new URL(`https://${url}`).href
			).toString("base64")}.jpg`;
			fs.createWriteStream(outputFileName).write(buffer);
			await new Promise<void>((resolve) => setTimeout(resolve, 1000));
		}

		console.log("URLs have been written to nekoweb-urls.json");
		process.exit(0);
	})
	.catch((err) => {
		console.error("Fatal error:", err);
		process.exit(1);
	});
