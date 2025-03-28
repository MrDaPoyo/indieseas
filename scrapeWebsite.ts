import * as db from "./db/db";

declare var self: Worker;

console.log("Worker started");

interface Button {
	image?: string;
	filename?: string;
	scraped_date?: number | null;
	found_url?: string;
	hash?: string;
	src?: string;
}

async function scrapeEntireWebsite(url: string): Promise<Button[]> {
	let totalButtonData: Button[] = [];
	let buttonData: Button = {};
	const response = await fetch(url);
	if (!response.ok) {
		postMessage({ success: false, error: "Failed to fetch the URL" });
		process.exit();
	}
	console.log("Response status:", response.status);
	try {
		const rewriter = new HTMLRewriter()
			.on("a > img", {
				async element(element) {
					var src = element.getAttribute("src") as any;
                    if (src && !src.startsWith("http")) {
                        src = new URL(src, url).href;
                    }
					const button = await fetch(
						src
					);

					const blob = await button.blob();
					const arrayBuffer = await blob.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);
					const filename = element.getAttribute("src") as string;
					const scraped_date = Date.now();
					const found_url = url;
					const image = buffer.toString("base64");
					const hash = db.hash(image);
					buttonData = {
						image,
						filename,
						scraped_date,
						found_url,
						hash,
						src,
					};
                    totalButtonData.push(buttonData);
				},
			})
			.on("a", {
				async element(element) {
					const href = element.getAttribute("href") as string;
					if (href && !href.startsWith("http")) {
						buttonData.image = new URL(href, url).href;
					}
				},
			});

		// Process the response
		await rewriter.transform(response).blob();

		// Convert relative image URLs to absolute
		if (buttonData.image && !buttonData.image.startsWith("http")) {
			try {
				buttonData.image = new URL(buttonData.image, url).href;
			} catch {
				// Keep the original URL if parsing fails
			}
		}
		return totalButtonData;
	} catch (error) {
		console.error("Error during scraping:", error);
		postMessage({ success: false, error: "Scraping failed" });
		process.exit();
	}
}

self.onmessage = async (event: MessageEvent) => {
	console.log("Worker received message:", event.data.url);
	const buttons = await scrapeEntireWebsite(event.data.url);
	postMessage({ buttonData: buttons, success: true });
	console.log("Worker finished");
	process.exit();
};
