import * as db from "./db/db";
import { imageSize } from "image-size";

declare var self: Worker;

console.log("Worker started");

interface Button {
	image?: any;
	filename?: string;
	scraped_date?: number | null;
	found_url?: string;
	hash?: string;
	src?: string;
}

async function getImageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
	const metadata = await imageSize(buffer);
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

				let button = await fetch(src);

				if (!button.ok) {
					console.log("Failed to fetch image:", src);
					return;
				}
                
                let buttonBuffer = Buffer.from(await button.arrayBuffer())
                
				const { width, height } = await getImageSize(buttonBuffer);

				if (!(width === 88 && height === 31)) {
					return;
				}

                const filename = element.getAttribute("src") as string;
				const scraped_date = Date.now();
				const found_url = url;
				const hash = db.hash(buttonBuffer) as string;

				const buttonData: Button = {
					image: buttonBuffer,
					filename,
					scraped_date,
					found_url,
					hash,
					src,
				};

				totalButtonData.push(buttonData);
			},
		} as any);

		await response
			.text()
			.then((html) => rewriter.transform(new Response(html)));

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
