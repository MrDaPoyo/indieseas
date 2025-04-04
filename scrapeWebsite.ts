import * as db from "./db/db";
import { imageSize } from "image-size";
import { sleep } from "bun";
import * as cheerio from "cheerio";
import customFetch from "./utils/fetch";
import puppeteer from "puppeteer";
import { checkRobotsTxt } from "./utils/checkRobotsTxt"
import { lemmatizeText } from "./utils/lemmatize";

declare var self: Worker;

console.log("Worker started");

export type Button = {
	id?: number;
	image: any;
	filename: string;
	scraped_date: Date | null;
	found_url: string;
	hash: string;
	src: string;
	links_to?: string | null;
	website_id?: number | null;
	height?: number;
	width?: number;
	alt?: string | null;
};

function getImageSize(buffer: Buffer): { width: number; height: number } {
	const metadata = imageSize(buffer);
	return { width: metadata.width || 0, height: metadata.height || 0 };
}

function fetchButton(url: string): Promise<Response> {
	return customFetch(url);
}

export async function scrapeEntireWebsite(url: string, website_id: number, maxPages: number = 50, lemmatizationMap: Map<string, string>): Promise<Button[]> {
	return new Promise(async (resolve, reject) => {
		try {
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				url = "https://" + url;
				url = new URL(url).href;
			}

			const robotsResult = await checkRobotsTxt(url);
			if (!robotsResult) {
				console.log("No robots.txt found or empty.");
			} else {
				const allowedUrls = robotsResult.allowed;
				const disallowedUrls = robotsResult.disallowed;

				if (!allowedUrls || !disallowedUrls) {
					console.log("No allowed or disallowed URLs found in robots.txt.");
					return reject("No allowed or disallowed URLs found in robots.txt.");
				}

				const isDisallowed = (checkUrl: string) =>
					disallowedUrls.some((disallowedUrl: string) => checkUrl.startsWith(disallowedUrl));

				const isAllowed = (checkUrl: string) =>
					allowedUrls.some((allowedUrl: string) => checkUrl.startsWith(allowedUrl));

				if (isDisallowed(url)) {
					console.log("URL is disallowed by robots.txt:", url);
					return reject("URL is disallowed by robots.txt");
				}

				if (!isAllowed(url)) {
					console.log("URL is not explicitly allowed by robots.txt:", url);
					return reject("URL is not explicitly allowed by robots.txt");
				}
			}

			const response = await customFetch(url);

			if (!response.ok) {
				return reject("Failed to fetch the URL: " + response.statusText);
			}

			const $ = cheerio.load(await response.text());
			const links = $("a").toArray();
			console.log("Found " + links.length + " links on the page");


			// Helper function to prioritize links
			function getPriorityScore(link: any, $: any): number {
				const href = $(link).attr('href') || '';
				const text = $(link).text().toLowerCase();
				const classes = $(link).attr('class') || '';
				const id = $(link).attr('id') || '';

				// Check if link contains priority keywords
				if (href.includes('button') || href.includes('link') || href.includes('out')) {
					return 10;
				}
				if (text.includes('button') || text.includes('link') || text.includes('out')) {
					return 8;
				}
				if (classes.includes('button') || classes.includes('link') || classes.includes('out')) {
					return 6;
				}
				if (id.includes('button') || id.includes('link') || id.includes('out')) {
					return 4;
				}
				return 0;
			}

			// Sort links by priority score
			const prioritizedLinks = [...links].sort((a, b) =>
				getPriorityScore(b, $) - getPriorityScore(a, $)
			);

			const website = new URL(url);
			const baseUrl = website.origin;
			const visited = new Set<string>();
			const toVisit = new Set<string>();
			let totalButtonData: Button[] = [];

			// Add initial page to the queue
			toVisit.add(website.pathname);

			// Process all links in the page to normalize them and add to queue
			for (const link of prioritizedLinks) {
				const href = $(link).attr('href');
				if (!href) continue;
				let urlToScrape = href;
				// Track URLs for future scraping
				if (href.startsWith('http://') || href.startsWith('https://')) {
					await db.addURLPathToScrape(new URL(href).href);
				}

				if (href.startsWith('/')) {
					urlToScrape = new URL(baseUrl + href).href;
					await db.addURLPathToScrape(urlToScrape);
				}
				try {
					let normalizedHref: string;

					// Handle different link formats
					if (href.startsWith('/')) {
						// Already a relative path starting with /
						normalizedHref = href;
					} else if (href.startsWith('#')) {
						// Skip anchors on the same page
						continue;
					} else if (href.startsWith('http://') || href.startsWith('https://')) {
						// Check if it's from the same origin
						const linkUrl = new URL(href);
						if (linkUrl.origin !== baseUrl) continue;
						normalizedHref = linkUrl.pathname + linkUrl.search + linkUrl.hash;
					} else if (!href.startsWith('mailto:') && !href.startsWith('tel:')) {
						// Assume it's a relative path not starting with /
						normalizedHref = '/' + href;
					} else {
						// Skip non-http links
						continue;
					}

					toVisit.add(normalizedHref);
				} catch (error) {
					console.log("Invalid URL:", href);
					continue;
				}
			}
			// Process pages in queue with a maximum limit
			let pagesScraped = 0;
			const startTime = Date.now();
			const maxTimeMs = 5 * 60 * 1000; // 5 minute timeout

			while (toVisit.size > 0) {
				// Check if we've hit our limits
				if (pagesScraped >= maxPages) {
					console.log(`Reached maximum page limit (${maxPages}). Stopping crawl.`);
					break;
				}

				if (Date.now() - startTime > maxTimeMs) {
					console.log(`Scraping timeout reached (${maxTimeMs}ms). Stopping crawl.`);
					break;
				}

				let path = Array.from(toVisit)[0];
				if (!path) break;
				toVisit.delete(path);

				if (visited.has(path)) continue;
				visited.add(path);

				// Check if URL was already scraped
				const isScraped = await db.isURLScraped(path);
				if (isScraped) continue;

				if (path.startsWith("/")) {
					path = baseUrl + path;
				} else if (path.startsWith("http://") || path.startsWith("https://")) {
					path = new URL(path).href;
				}

				console.log(`Scraping (${++pagesScraped}/${maxPages}):`, path);
				try {
					const buttons = await fetch(`${process.env.WORKER_URL}?path=${path}&key=${process.env.WORKER_KEY}`, {
						method: "GET",
					});

					if (!buttons.ok || !buttons) {
						console.error("Failed to fetch button data:", buttons.statusText);
						continue;
					}

					let buttonData = await buttons.json();
					if (buttonData && buttonData.error) {
						console.error("Error in button data:", buttonData.error);
						continue;
					}
					if (!Array.isArray(buttonData)) {
						if (buttonData) {
							const extractedButtons = Object.values(buttonData.buttons).map((btn: any) => {
								return {
									image: btn.buffer ? Buffer.from(Object.values(btn.buffer)) : Buffer.alloc(0),
									filename: btn.src.split('/').pop() || '',
									scraped_date: new Date(),
									found_url: path,
									hash: btn.buffer ? db.hash(Buffer.from(Object.values(btn.buffer))) : '',
									src: btn.src,
									links_to: btn.links_to,
									height: btn.size.height,
									width: btn.size.width,
									alt: btn.alt,
								};
							});

							extractedButtons.forEach((button: Button) => {
								if (button.width !== 88 || button.height !== 31) {
									console.log("Invalid button dimensions:", button.width, button.height);
									return;
								}
								if (button.src && !button.src.startsWith("/")) db.addURLToScrape(new URL(button.src).hostname);
								if (button.links_to) db.addURLToScrape(new URL(button.links_to).hostname);
								db.insertButton(button, website_id);
							});

							if (extractedButtons.length > 0) {
								totalButtonData = [...totalButtonData, ...extractedButtons];
							}
							const lemmatizedText = await lemmatizeText(buttonData.rawText, lemmatizationMap);
							db.scrapedURLPath(path, totalButtonData.length, buttonData.title, buttonData.description, await lemmatizedText);
							await sleep(1000);
							continue;
						} else {
							console.error("Unexpected button data format:", buttonData.toString());
							continue;
						}
					}
				} catch (error) {
					console.error("Error scraping path:", path, error);
				}
			}

			resolve(totalButtonData);
		} catch (error) {
			console.error("Error in scrapeEntireWebsite:", error);
			reject(error);
		}
	});
}