import * as db from "./db/db";
import { imageSize } from "image-size";
import { sleep } from "bun";
import * as cheerio from "cheerio";

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

function getImageSize(buffer: Buffer): { width: number; height: number } {
	const metadata = imageSize(buffer);
	return { width: metadata.width || 0, height: metadata.height || 0 };
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
		const $ = cheerio.load(await response.text());
		const images = $("img").toArray();
		for (const element of images) {
			await sleep(500);
			if (!$(element).attr("src")) continue;

			var src = $(element).attr("src") as any;
			if (src && !src.startsWith("http")) {
				src = new URL(src, path).href;
			}

			let links_to = null;
			const parentAnchor = $(element).closest("a");
			if (parentAnchor.length > 0 && parentAnchor.attr("href")) {
				const href = parentAnchor.attr("href")!;
				try {
					if (!href.startsWith("http://") && !href.startsWith("https://")) {
						if (href.startsWith("/")) {
							links_to = new URL(href, path).href;
						} else {
							links_to = `https://${href}`;
						}
					} else {
						links_to = href;
					}
				} catch (error) {
					console.log("Invalid URL:", href, error);
					links_to = href; // Keep the original href as a fallback
				}
			}

			if (!src) continue;
			let button = await fetch(src);

			if (!button.ok) {
				console.log("Failed to fetch image:", src);
				continue;
			}

			let buttonBuffer = Buffer.from(await button.arrayBuffer());

			try {
				const { width, height } = getImageSize(buttonBuffer);
				if (!(width === 88 && height === 31)) {
					continue;
				}
			} catch (error) {
				continue;
			}

			const filename = $(element).attr("src") as string;
			const scraped_date = Date.now();
			const found_url = path;
			const hash = db.hash(buttonBuffer) as string;

			// Check if this button is already in totalButtonData
			if (totalButtonData.some((btn) => btn.hash === hash)) {
				console.log("Already have this button:", filename);
				continue;
			}

			const buttonData: Button = {
				image: buttonBuffer,
				filename,
				scraped_date,
				found_url,
				hash,
				src,
				links_to,
			};
			db.scrapedURLPath(new URL(path).pathname);
			totalButtonData.push(buttonData);
		}

		return totalButtonData;
	} catch (error) {
		console.error("Error scraping:", error);
		postMessage({ success: false, error: "Scraping failed" });
		process.exit();
	}
}

async function scrapeEntireWebsite(url: string): Promise<Button[]> {
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		if (url.startsWith("/")) {
			url = `https://example.com${url}`;
		} else {
			url = `https://${url}`;
		}
	}

	const visited = new Set<string>();
	const allButtons: Button[] = [];
	let pageCount = 0;
	const maxPages = 50;

	const sitemapUrls: string[] = []; // Highest priority - sitemap links
	const priorityUrls: string[] = [];
	const normalUrls: string[] = [];

	if (
		url.toLowerCase().includes("sitemap") ||
		url.toLowerCase().includes("map")
	) {
		sitemapUrls.push(url);
	} else if (
		url.toLowerCase().includes("link") ||
		url.toLowerCase().includes("button") ||
		url.toLowerCase().includes("blink")
	) {
		priorityUrls.push(url);
	} else {
		normalUrls.push(url);
	}

	while (
		(sitemapUrls.length > 0 ||
			priorityUrls.length > 0 ||
			normalUrls.length > 0) &&
		pageCount < maxPages
	) {
		await sleep(250);

		let currentUrl: string | undefined;
		if (sitemapUrls.length > 0) {
			currentUrl = sitemapUrls.shift();
		} else if (priorityUrls.length > 0) {
			currentUrl = priorityUrls.shift();
		} else {
			currentUrl = normalUrls.shift();
		}
		if (!currentUrl) {
			break;
		}
		if (visited.has(currentUrl) || await db.isURLPathScraped(currentUrl)) {
			console.log("Already visited:", currentUrl);
			continue;
		}
		visited.add(currentUrl);
		pageCount++;
		console.log("Scraping:", currentUrl);
		const buttons = await scrapeSinglePath(currentUrl);
		if (buttons.length > 0) {
			console.log("Found buttons:", buttons.length);
			allButtons.push(...buttons);
		}
		const $ = cheerio.load(
			await fetch(currentUrl).then((res) => res.text())
		);
		const links = $("a").toArray();
		for (const element of links) {
			await sleep(500);
			if (!$(element).attr("href")) continue;
			let href = $(element).attr("href") as string;
			if (href && !href.startsWith("http")) {
				href = new URL(href, currentUrl).href;
				console.log("Link href:", href);
			}
			if (visited.has(href)) {
				console.log("Already visited link:", href);
				continue;
			}
			if (sitemapUrls.length < 10) {
				sitemapUrls.push(href);
			} else if (priorityUrls.length < 10) {
				priorityUrls.push(href);
			} else {
				normalUrls.push(href);
			}
		}
	}
	db.scrapedURL(new URL(url).hostname);
	console.log("Scraping complete for:", new URL(url).hostname);
	return allButtons;
}

self.onmessage = async (event: MessageEvent) => {
	const totalButtonData = await scrapeEntireWebsite(event.data.url);
	postMessage({ buttonData: totalButtonData, success: true });
	process.exit();
};

console.log(await scrapeEntireWebsite("https://thinliquid.dev/"));
