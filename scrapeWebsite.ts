import * as db from "./db/db";
import { imageSize } from "image-size";
import { sleep } from "bun";
import * as cheerio from "cheerio";
import customFetch from "./utils/fetch";
import puppeteer from "puppeteer";

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

async function scrapeSinglePath(path: string, website_id: number): Promise<Button[]> {
	return new Promise(async (resolve, reject) => {
		try {
			let totalButtonData: Button[] = [];
			const response = await customFetch(path); // 10 second timeout
			if (!response.ok) {
				console.error("error: ", response.statusText);
				return [];
			}
			const $ = cheerio.load(await response.text());
			const baseUrl = new URL(path).origin;
			const images = $("img").toArray();
			for (const element of images) {

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
								links_to = new URL(href, `https://${baseUrl}`).href;
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
				let button = await fetchButton(src);

				if (!button.ok) {
					console.log("Failed to fetch image:", src);
					console.error("error: ", button.statusText);
					continue;
				}

				let buttonBuffer = Buffer.from(await button.arrayBuffer());

				if (buttonBuffer.length === 0) {
					console.log("Empty image buffer for:", src);
					continue;
				}

				try {
					const { width, height } = getImageSize(buttonBuffer);
					if (!(width === 88 && height === 31)) {
						continue;
					}
				} catch (error) {
					continue;
				}

				const filename = $(element).attr("src") as string;
				const scraped_date = new Date();
				const found_url = path;
				const hash = db.hash(buttonBuffer) as string;

				// Check if this button is already in totalButtonData
				if (totalButtonData.some((btn) => btn.hash === hash)) {
					continue;
				}

				const buttonData: Button = {
					image: buttonBuffer,
					filename: filename,
					scraped_date: scraped_date,
					found_url: found_url,
					hash: hash,
					src: src,
					links_to,
				};

				totalButtonData.push(buttonData);

				// Mark the URL as scraped only after successfully adding the button data
				await db.scrapedURLPath(new URL(path).pathname);
			}

			for (let button of totalButtonData) {
				if (button.src) await db.addURLToScrape(new URL(button.src).href);
				if (button.links_to) await db.addURLToScrape(new URL(button.links_to).href);
				db.insertButton(button, website_id);
			}

			return resolve(totalButtonData);


		} catch (error) {
			console.error(`Failed to scrape path: ${path}`, error);
			return reject([]);
		}
	});
}

export async function scrapeEntireWebsite(url: string, website_id: number, maxPages: number = 100): Promise<Button[]> {
	return new Promise(async (resolve, reject) => {
		try {
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				url = "https://" + url;
				url = new URL(url).href;
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
							const extractedButtons = Object.values(buttonData).map((btn: any) => {
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
							continue;
						} else {
							console.error("Unexpected button data format:", buttonData.toString());
							continue;
						}
					}

					await sleep(1000);
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

export async function scrapeEntireWebsiteUsingPuppeteer(url: string, website_id: number, maxPages: number = 50): Promise<Button[]> {
	return new Promise(async (resolve, reject) => {
		try {

			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				url = "https://" + url;
				url = new URL(url).href;
			} else if (url.startsWith("http://") || url.startsWith("https://")) {
				url = new URL(url).href;
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

			toVisit.add(website.pathname);

			// Process all links in the page to normalize them and add to queue

			for (const link of prioritizedLinks) {
				const href = $(link).attr('href');
				if (!href) continue;
				try {
					let normalizedHref: string;

					if (href.startsWith('/')) {
						normalizedHref = href;
					} else if (href.startsWith('#')) {
						continue;
					} else if (href.startsWith('http://') || href.startsWith('https://')) {
						const linkUrl = new URL(href);
						if (linkUrl.origin !== baseUrl) continue;
						normalizedHref = linkUrl.pathname + linkUrl.search + linkUrl.hash;
					} else if (!href.startsWith('mailto:') && !href.startsWith('tel:')) {
						normalizedHref = '/' + href;
					} else {
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
			const waitTimeMs = 2000;
			const maxTimeMs = 5 * 60 * 1000; // 5 minute timeout
			while (toVisit.size > 0) {
				await sleep(waitTimeMs);
				if (pagesScraped >= maxPages) {
					console.log(`Reached maximum page limit (${maxPages}). Stopping crawl.`);
					break;
				}

				if (Date.now() - startTime > maxTimeMs) {
					console.log(`Scraping timeout reached (${maxTimeMs}ms). Stopping crawl.`);
					break;
				}

				const path = Array.from(toVisit)[0];
				if (!path) break;
				toVisit.delete(path);

				if (visited.has(path)) continue;
				visited.add(path);

				// Check if URL was already scraped
				const isScraped = await db.isURLScraped(path);
				if (isScraped) continue;

				console.log(`Scraping (${++pagesScraped}/${maxPages}):`, baseUrl + path);
				const browser = await puppeteer.launch({
					headless: true,
					args: ['--no-sandbox', '--disable-setuid-sandbox'],
				});
				const page = await browser.newPage();
				page.setDefaultNavigationTimeout(0);
				try {
					await page.goto(baseUrl + path, { waitUntil: 'networkidle2' });
					const content = await page.content();
					const $ = cheerio.load(content);
					const images = $("img").toArray();
					for (const element of images) {
						if (!$(element).attr("src")) continue;
						var src = $(element).attr("src") as any;
						if (src && !src.startsWith("http")) {
							if (src.startsWith("/")) {
								src = new URL(src, baseUrl).href;
							} else {
								src = new URL(src, baseUrl).href;
							}
						}

						let links_to = null;
						const parentAnchor = $(element).closest("a");
						if (parentAnchor.length > 0 && parentAnchor.attr("href")) {
							const href = parentAnchor.attr("href")!;
							try {
								if (!href.startsWith("http://") && !href.startsWith("https://")) {
									if (href.startsWith("/")) {
										links_to = new URL(`https:${href}`, path).href;
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
						let button = await fetchButton(src);
						if (!button.ok) {
							console.log("Failed to fetch image:", src);
							console.error("error: ", button.statusText);
							continue;
						}
						let buttonBuffer = Buffer.from(await button.arrayBuffer());
						if (buttonBuffer.length === 0) {
							console.log("Empty image buffer for:", src);
							continue;
						}
						try {
							const { width, height } = getImageSize(buttonBuffer);
							if (!(width === 88 && height === 31)) {
								continue;
							}
						}
						catch (error) {
							continue;
						}
						const filename = $(element).attr("src") as string;
						const scraped_date = await new Date();
						const found_url = path;
						const hash = db.hash(buttonBuffer) as string;
						// Check if this button is already in totalButtonData
						if (totalButtonData.some((btn) => btn.hash === hash)) {
							continue;
						}
						const buttonData: Button = {
							image: buttonBuffer,
							filename: filename,
							scraped_date: scraped_date,
							found_url: found_url,
							hash: hash,
							src: src,
							links_to,
						};
						totalButtonData.push(buttonData);
						// Mark the URL as scraped only after successfully adding the button data
						await db.scrapedURLPath(path);
					}
					for (let button of totalButtonData) {
						if (button.src) await db.addURLToScrape(new URL(button.src).href);
						if (button.links_to) await db.addURLToScrape(new URL(button.links_to).href);
						db.insertButton(button, website_id);
					}
					await page.close();
					await browser.close();
					await sleep(waitTimeMs);
				} catch (error) {
					console.error("Error scraping path:", path, error);
				}
				resolve(totalButtonData);
			}
		} catch (error) {
			console.error("Error in scrapeEntireWebsite:", error);
			reject(error);
		}
	});
}