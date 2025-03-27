const puppeteer = require("puppeteer");
import * as db from "./db/db";
import * as bcrypt from "bcryptjs";

function hashImage(image: Base64URLString): Base64URLString {
    return bcrypt.hashSync(image, 10);
}

async function scrapeWebsite(url: string) {
    console.log("Scraping", url);
    if (!url.includes("http://") && !url.includes("https://")) {
        url = "https://" + url;
    }
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    try {
        await page.goto(url);

        // Extract data
        const data = await page.evaluate(() => {
            return Promise.all(
                Array.from(document.querySelectorAll("img"))
                    .filter(img => img.width === 88 && img.height === 31)
                    .map(async img => {
                        console.log("Found button", img.src);
                        const originalSrc = img.src;
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx?.drawImage(img, 0, 0);
                        try {
                            return {
                                imageData: canvas.toDataURL('image/png'),
                                src: originalSrc
                            };
                        } catch (e) {
                            return {
                                imageData: originalSrc,
                                src: originalSrc
                            };
                        }
                    })
            );
        });

        if (data.length > 0) {
            for (let i = 0; i < data.length; i++) {
                const imageObj = data[i];
                const image = imageObj.imageData;
                const hash = hashImage(image);
                const button = {
                    hash: hash,
                    image: image,
                    src: imageObj.src,
                    found_url: url,
                    scraped_date: Date.now(),
                    filename: hash + ".png",
                };
                await db.insertButton(button);
            }
        }

        const allURLs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("a"))
                .filter(a => {
                    const img = a.querySelector("img");
                    return img && img.width === 88 && img.height === 31;
                })
                .map(a => a.href);
        });

        postMessage({ success: true, data, allURLs });

        await browser.close();
        return { success: true, data, allURLs };
    } catch (error) {
        await browser.close();
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// Handle messages from the main thread
self.onmessage = async (message: any) => {
    try {
        const result = await scrapeWebsite(message.data);
        self.postMessage({ url: message.data, ...result });
    } catch (error) {
        self.postMessage({ 
            success: false, 
            url: message.data, 
            error: error instanceof Error ? error.message : String(error) 
        });
    }
};