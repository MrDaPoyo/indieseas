import * as db from "./db/db";
import sharp from "sharp";
import { rm } from "node:fs";

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

async function getImageSize(path: string) {
	const metadata = await sharp(path).metadata();
	return { width: metadata.width, height: metadata.height };
}

async function scrapeEntireWebsite(url: string): Promise<Button[]> {
	let totalButtonData: Button[] = [];
	const response = await fetch(url);
	if (!response.ok) {
		postMessage({ success: false, error: "Failed to fetch the URL" });
		process.exit();
	}
	console.log("Response status:", response.status);
	try {
		const rewriter = new HTMLRewriter().on("img", {
			async element(element: any) {
				if (!element.hasAttribute("src")) return;

				var src = element.getAttribute("src") as any;
				if (src && !src.startsWith("http")) {
					src = new URL(src, url).href;
				}

				const button = await fetch(src);

				if (!button.ok) {
					console.log("Failed to fetch image:", src);
					return;
				}

				const temporaryFileName = `./scraped/${
					Math.random() * 10
				}-button.png`;
				await Bun.write(temporaryFileName, button);

				const { width, height } = await getImageSize(temporaryFileName);

				rm(temporaryFileName, { force: true }, (err) => {
					if (err) {
						console.error("Error deleting file:", err);
					}
				});

				if (!(width === 88 && height === 31)) {
					return;
				}

                const blob = await button.clone().blob();
				const arrayBuffer = await blob.arrayBuffer();
				const buffer = Buffer.from(arrayBuffer);
				const image = buffer.toString("base64");
				const filename = element.getAttribute("src") as string;
				const scraped_date = Date.now();
				const found_url = url;
				const hash = db.hash(image);

				const buttonData: Button = {
					image,
					filename,
					scraped_date,
					found_url,
					hash,
					src,
				};

				totalButtonData.push(buttonData);
			},
		} as any);

		await response.text().then((html) => rewriter.transform(new Response(html)));

		return totalButtonData;
	} catch (error) {
		console.error("Error during scraping:", error);
		postMessage({ success: false, error: "Scraping failed" });
		process.exit();
	}
}

self.onmessage = async (event: MessageEvent) => {
	console.log("Worker received message:", event.data.url);
	const totalButtonData = await scrapeEntireWebsite(event.data.url);
	postMessage({ buttonData: totalButtonData, success: true });
	console.log("Worker finished");
	process.exit();
};
