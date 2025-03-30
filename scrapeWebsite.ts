import * as db from "./db/db";
import { imageSize } from "image-size";
import { sleep } from "bun"; 

declare var self: Worker;

console.log("Worker started");

interface Button {
	image?: any;
	filename?: string;
	scraped_date?: number | null;
	found_url?: string;
	hash?: string;
	src?: string;
	links_to?: string | null;
}

async function getImageSize(
	buffer: Buffer
): Promise<{ width: number; height: number }> {
	const metadata = await imageSize(buffer);
	return { width: metadata.width, height: metadata.height };
}

async function scrapeSinglePath(path: string): Promise<Button[]> {
	if (await db.isURLPathScraped(path)) {
		console.log("Already scraped:", path);
		return [];
	}
	try {
		let totalButtonData: Button[] = [];
		const response = await fetch(path);
		if (!response.ok) {
			postMessage({ success: false, error: "Failed to fetch the URL" });
			process.exit();
		}
		const rewriter = new HTMLRewriter().on("img", {
			async element(element: any) {
				await sleep(500);
				if (!element.hasAttribute("src")) return;

				// Extract image source
				var src = element.getAttribute("src") as any;
				if (src && !src.startsWith("http")) {
					src = new URL(src, path).href;
				}

				// Check if the image is inside an <a> tag and get the href
				let links_to = null;
				const parentElement = element.parentElement;
				if (
					parentElement &&
					parentElement.tagName.toLowerCase() === "a" &&
					parentElement.hasAttribute("href")
				) {
					links_to = parentElement.getAttribute("href");
					if (links_to && !links_to.startsWith("http")) {
						links_to = new URL(links_to, path).href;
					}
				}
				if (!src) return;
				let button = await fetch(src);
				if (!button.ok) {
					console.log("Failed to fetch image:", src);
					return;
				}

				let buttonBuffer = Buffer.from(await button.arrayBuffer());

				try {
					const { width, height } = await getImageSize(buttonBuffer);
					if (!(width === 88 && height === 31)) {
						return;
					}
				} catch (error) {
					return;
				}

				const filename = element.getAttribute("src") as string;
				const scraped_date = Date.now();
				const found_url = path;
				const hash = db.hash(buttonBuffer) as string;

				const buttonData: Button = {
					image: buttonBuffer,
					filename,
					scraped_date,
					found_url,
					hash,
					src,
					links_to, // Add the links_to attribute
				};
				db.scrapedURLPath(path);
				totalButtonData.push(buttonData);
			},
		});

		await response
			.text()
			.then((html) => rewriter.transform(new Response(html)));

		return totalButtonData;
	} catch (error) {
		postMessage({ success: false, error: "Scraping failed" });
		process.exit();
	}
}

async function scrapeEntireWebsite(url: string): Promise<Button[]> {
	// Ensure URL is complete with scheme and host
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		// If it's a relative path starting with /, assume it's from the root of the domain
		if (url.startsWith("/")) {
			// Use a placeholder domain that will be replaced with the actual domain
			url = `https://example.com${url}`;
		} else {
			// If it doesn't start with /, assume it's a domain without scheme
			url = `https://${url}`;
		}
	}

	const visited = new Set<string>();
	const toVisit = [url];
	const allButtons: Button[] = [];
	let pageCount = 0;
	const maxPages = 20;

	while (toVisit.length > 0 && pageCount < maxPages) {
		await sleep(500);
		const currentUrl = toVisit.shift();
		if (!currentUrl || visited.has(currentUrl)) continue;

		visited.add(currentUrl);
		pageCount++;
		console.log(`Scraping page ${pageCount}/${maxPages}: ${currentUrl}`);

		try {
			// Scrape the current page for buttons
			console.log(`Scraping ${currentUrl}`);
			const buttons = await scrapeSinglePath(currentUrl);
			for (const button of buttons) {
				if (!allButtons.some(existingButton => existingButton.hash === button.hash)) {
					allButtons.push(button);
				}
			}

			{
				const response = await fetch(currentUrl);
				if (response.ok) {
					const html = await response.text();
					const linkRegex =
						/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>/gi;
					let match;

					while ((match = linkRegex.exec(html)) !== null) {
						let link = match[1]?.trim();
						if (
							!link ||
							link.startsWith("#") ||
							link.startsWith("javascript:")
						)
							continue;

						// Convert relative URLs to absolute because otherwise this wont work
						if (!link.startsWith("http")) {
							link = new URL(link, currentUrl).href;
						}

						const currentUrlObj = new URL(currentUrl);
						const linkUrlObj = new URL(link);

						if (
							currentUrlObj.hostname === linkUrlObj.hostname &&
							!visited.has(link)
						) {
							db.addURLPathToScrape(link);
							toVisit.push(link); // Push the complete URL instead of building it incorrectly
						}
					}
				}
			}
		} catch (error) {
			console.warn(`Error scraping ${currentUrl}:`, error);
		}
	}

	console.log(
		`Finished scraping ${pageCount} pages. Found ${allButtons.length} buttons.`
	);
	return allButtons;
}

self.onmessage = async (event: MessageEvent) => {
	const totalButtonData = await scrapeEntireWebsite(event.data.url);
	
	postMessage({ buttonData: totalButtonData, success: true });
	process.exit();
};
