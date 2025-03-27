const puppeteer = require("puppeteer");
import * as db from "./db/db";
import * as bcrypt from "bcryptjs";
import { mkdir } from "node:fs/promises";

await mkdir("./static/buttons", { recursive: true });

function hashImage(image: Base64URLString): Base64URLString {
    return bcrypt.hashSync(image, 10);
}

Bun.serve({
    routes: {
        "/search/all": new Response(JSON.stringify(await db.retrieveAllButtons())),
        "/scrape/:url": async (req) => {
            var url = req.params.url;
            if (url.includes("http://") || url.includes("https://")) {
                url = url;
            } else {
                url = "https://" + url;
            }
            const browser = await puppeteer.launch();
            const page = await browser.newPage();
            try {
                await page.goto(url);

                // Extract data
                const data = await page.evaluate(() => {
                    // return Array.from(document.querySelectorAll("img")).map(img => img.src);
                    return Promise.all(
                        Array.from(document.querySelectorAll("img"))
                            .filter(img => img.width === 88 && img.height === 31)
                            .map(async img => {
                                const originalSrc = img.src;
                                // For remote images, fetch and convert to base64
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0);
                                try {
                                    return {
                                        imageData: canvas.toDataURL('image/png'),
                                        src: originalSrc
                                    };
                                } catch (e) {
                                    // If CORS prevents access, fall back to src
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
                        console.log(button);
                        await db.insertButton(button);
                    };
                }

                await browser.close();

                return new Response(JSON.stringify({ data }), {
                    headers: { "Content-Type": "application/json" },
                });
            } catch (error) {
                await browser.close();
                console.warn(error);
                return new Response("Error: " + error);
            }
        }
    }
})

console.log("IndieSearch scraper running.");