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

async function getImageSize(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const metadata = await imageSize(buffer);
  return { width: metadata.width, height: metadata.height };
}

async function scrapeSinglePath(path: string): Promise<Button[]> {
  if (await db.isURLPathScraped(path)) {
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

<<<<<<< HEAD
      let links_to = null;
      const parentAnchor = $(element).parent();
      if (parentAnchor.prop("tagName") === "A" && parentAnchor.attr("href")) {
        if (!parentAnchor.attr("href")?.includes("http://") || !parentAnchor.attr("href")?.includes("https://")) {
          links_to = new URL(parentAnchor.attr("href") as any, path).href;
        };
        links_to = parentAnchor.attr("href") as string;
      }
=======
			let links_to = null;
			const parentAnchor = $(element).parent();
			console.log("Parent tag:", parentAnchor.prop("tagName"));
			if (
				parentAnchor.prop("tagName") === "A" &&
				parentAnchor.attr("href")
			) {
				console.log("Found link:", parentAnchor.attr("href"));
				if (
					!parentAnchor.attr("href")?.includes("http://") ||
					!parentAnchor.attr("href")?.includes("https://")
				) {
					links_to = new URL(parentAnchor.attr("href") as any, path)
						.href;
				}
				links_to = parentAnchor.attr("href") as string;
			}
>>>>>>> 3734bff (postgres)

      if (!src) continue;
      let button = await fetch(src);

      if (!button.ok) {
        console.log("Failed to fetch image:", src);
        continue;
      }

      let buttonBuffer = Buffer.from(await button.arrayBuffer());

      try {
        const { width, height } = await getImageSize(buttonBuffer);
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
      db.scrapedURLPath(path);
      totalButtonData.push(buttonData);
    }

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
  const allButtons: Button[] = [];
  let pageCount = 0;
  const maxPages = 50;

  // Use a priority queue (simulated with multiple arrays)
  const sitemapUrls: string[] = []; // Highest priority - sitemap links
  const priorityUrls: string[] = [];
  const normalUrls: string[] = [];

  // Add initial URL to appropriate queue
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

    // Get next URL from sitemap queue first, then priority queue, then normal queue
    let currentUrl;
    if (sitemapUrls.length > 0) {
      currentUrl = sitemapUrls.shift();
    } else if (priorityUrls.length > 0) {
      currentUrl = priorityUrls.shift();
    } else {
      currentUrl = normalUrls.shift();
    }

    if (!currentUrl || visited.has(currentUrl)) continue;

    visited.add(currentUrl);
    pageCount++;
    // console.log(`Scraping page ${pageCount}/${maxPages}: ${currentUrl}`);

    try {
      // Scrape the current page for buttons
      console.log(`Scraping ${currentUrl}`);
      if (!currentUrl) {
        console.warn("Skipping undefined URL");
        continue;
      } else {
        const buttons = await scrapeSinglePath(currentUrl);
        for (const button of buttons) {
          if (
            !allButtons.some(
              (existingButton) => existingButton.hash === button.hash
            )
          ) {
            allButtons.push(button);
          }
        }

<<<<<<< HEAD
        {
          const response = await fetch(currentUrl);
          if (response.ok) {
            const html = await response.text();
            const linkRegex =
              /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>/gi;
            let match;
=======
			{
				const response = await fetch(currentUrl);
				if (response.ok) {
					const html = await response.text();
					const $ = cheerio.load(html);
					const aTags = $("a").toArray();
>>>>>>> 3734bff (postgres)

            const isSitemap =
              currentUrl.toLowerCase().includes("sitemap") ||
              currentUrl.toLowerCase().includes("map");

<<<<<<< HEAD
            while ((match = linkRegex.exec(html)) !== null) {
              let link = match[1]?.trim();
              if (
                !link ||
                link.startsWith("#") ||
                link.startsWith("javascript:")
              )
                continue;

              // Convert relative URLs to absolute
              if (!link.startsWith("http")) {
                link = new URL(link, currentUrl).href;
              }

              const currentUrlObj = new URL(currentUrl);
              const linkUrlObj = new URL(link);
=======
					for (const element of aTags) {
						let link = element.attribs.href as string;
						if (
							!link ||
							link.startsWith("#") ||
							link.startsWith("javascript:")
						)
							continue;

						// Convert relative URLs to absolute
						if (!link.startsWith("http://") || !link.startsWith("https://")) {
							link = new URL(link, currentUrl).href;
						}

						if (!link.endsWith("/")) {
							link = link.concat("/");
						}

						const currentUrlObj = new URL(currentUrl);
						const linkUrlObj = new URL(link);
>>>>>>> 3734bff (postgres)

              if (
                currentUrlObj.hostname === linkUrlObj.hostname &&
                !visited.has(link)
              ) {
                db.addURLPathToScrape(link);

                if (isSitemap) {
                  sitemapUrls.push(link);
                  visited.delete(link);
                } else {
                  const lowerLink = link.toLowerCase();
                  if (
                    lowerLink.includes("sitemap") ||
                    lowerLink.includes("map")
                  ) {
                    sitemapUrls.push(link);
                  } else if (
                    lowerLink.includes("link") ||
                    lowerLink.includes("button") ||
                    lowerLink.includes("blink")
                  ) {
                    priorityUrls.push(link);
                  } else {
                    normalUrls.push(link);
                  }
                }
              }
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

console.log(await scrapeEntireWebsite("https://thinliquid.dev"));