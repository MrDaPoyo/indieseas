import puppeteer, { Browser } from "puppeteer";
import { Jimp } from "jimp";

async function takeScreenshot(
	url: string,
	image_dir: string,
	browser: Browser
) {
	let page: Awaited<ReturnType<Browser["newPage"]>> | undefined;
	let normalizedUrl: string;
	try {
		normalizedUrl = new URL(url).href;
	} catch {
		console.warn(`Invalid URL: ${url}`);
		return;
	}

	try {
		page = await browser.newPage();
		await page.setViewport({ width: 1080, height: 1920 });
		await page.setDefaultTimeout(60000);

		await page.goto(normalizedUrl, {
			waitUntil: "domcontentloaded",
			timeout: 45000,
		});

		const fs = await import("fs");
		var outputFileName = `${image_dir}/${Buffer.from(normalizedUrl).toString("base64")}`;
		await fs.promises.mkdir(image_dir, { recursive: true });
		await fs.promises.writeFile(
			`${outputFileName}.png`,
			await page.screenshot({ fullPage: true })
		);

		await fs.promises.mkdir("./corpo", { recursive: true });
		const image = await Jimp.read(`${outputFileName}.png`);
		await image.write(`${outputFileName}.jpg`);
	} catch (error) {
		console.error(`Error taking screenshot of ${url}:`, error);
	} finally {
		if (page) await page.close();
	}
}

async function loadTop1000Websites() {
	const csvContent = await Bun.file("1000_top_corporate_websites.csv").text();
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	try {
		const fs = await import("fs");
		await fs.promises.mkdir("./corpo", { recursive: true });

		const websites = csvContent
			.split("\n")
			.map((line) => {
				const match = line.match(/,"([^"]+)"/);
				return match ? match[1] : null;
			})
			.filter(Boolean) as string[];

		for (const [index, url] of websites.entries()) {
			if (!url) continue;

			if (
				await Bun.file(
					`./corpo/${Buffer.from(
						new URL(`https://${url}`).href
					).toString("base64")}.png`
				).exists()
			) {
				console.log(`${index + 1}: Screenshot already exists - ${url}`);
				continue;
			}

			const startTime = performance.now();
			await takeScreenshot(`https://${url}`, "corpo", browser);
			const endTime = performance.now();

			console.log(
				`${index + 1}: Screenshot taken - ${url} (took ${(
					endTime - startTime
				).toFixed(2)} ms)`
			);
		}
	} finally {
		await browser.close();
	}
}

loadTop1000Websites().catch(console.error);
