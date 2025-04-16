import sharp from "sharp";
import { Buffer } from "buffer";

export async function getAverageColor(buffer: Buffer): Promise<string> {
	try {
		const { data, info } = await sharp(buffer)
			.raw()
			.toBuffer({ resolveWithObject: true });

		let totalR = 0;
		let totalG = 0;
		let totalB = 0;
		const pixelCount = data.length / info.channels;

		for (let i = 0; i < data.length; i += info.channels) {
			totalR += data[i];
			totalG += data[i + 1];
			totalB += data[i + 2];
		}

		const avgR = Math.round(totalR / pixelCount);
		const avgG = Math.round(totalG / pixelCount);
		const avgB = Math.round(totalB / pixelCount);

		const hexColor = `#${avgR.toString(16).padStart(2, "0")}${avgG
			.toString(16)
			.padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`;

		return hexColor;
	} catch (error) {
		console.error("Error processing image:", error);
		return "#000000"; // Default to black on error
	}
}

import * as db from "../db/db";

export async function colorizeAllButtons() {
	try {
		const allButtons = await db.retrieveAllButtons();
        if (!allButtons) {
            console.error("No buttons found in the database.");
            return;
        } else {
            console.log("Buttons retrieved:", allButtons.length);
        }
		Array.from(allButtons).forEach(async (button: any) => {
			if (button.image) {
				const imageBuffer = Buffer.from(button.image);
				const averageColor = await getAverageColor(imageBuffer);
				await db.updateButtonColor(button.id, averageColor);
				console.log(
					"Colorized button:",
					button.id,
					"with color:",
					averageColor
				);
			} else {
				console.log(
					`Skipping button ${button.id}: No image data found`
				);
			}
		});
		console.log("Finished colorizing all buttons.");
	} catch (error) {
		console.error("Error colorizing buttons:", error);
	}
}

if (process.argv[2] === "--colorize") {
    await colorizeAllButtons();
    process.exit(0);
}