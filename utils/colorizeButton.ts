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

export function categorizeColor(hexColor: string): string {
	const r = parseInt(hexColor.substring(1, 3), 16);
	const g = parseInt(hexColor.substring(3, 5), 16);
	const b = parseInt(hexColor.substring(5, 7), 16);
	
	// Define color perception functions
	// Convert RGB to HSL for better color categorization
	function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		let h = 0, s = 0, l = (max + min) / 2;

		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			
			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h /= 6;
		}

		return [h * 360, s * 100, l * 100];
	}

	function deltaE(rgbA: number[], rgbB: number[]): number {
		let labA = rgb2lab(rgbA);
		let labB = rgb2lab(rgbB);
		let deltaL = labA[0] - labB[0];
		let deltaA = labA[1] - labB[1];
		let deltaB = labA[2] - labB[2];
		let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
		let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
		let deltaC = c1 - c2;
		let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
		deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
		let sc = 1.0 + 0.045 * c1;
		let sh = 1.0 + 0.015 * c1;
		let deltaLKlsl = deltaL / (1.0);
		let deltaCkcsc = deltaC / (sc);
		let deltaHkhsh = deltaH / (sh);
		let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
		return i < 0 ? 0 : Math.sqrt(i);
	}

	function rgb2lab(rgb: number[]): number[] {
		let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
		r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
		g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
		b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
		let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
		let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
		let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
		x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
		y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
		z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
		return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
	}

	const colorMap: {[key: string]: number[]} = {
		red: [255, 0, 0],
		blue: [0, 0, 255],
		green: [0, 128, 0],
		yellow: [255, 255, 0],
		purple: [128, 0, 128],
		orange: [255, 165, 0],
		black: [0, 0, 0],
		white: [255, 255, 255],
		pink: [255, 192, 203],
		brown: [165, 42, 42],
	};

	const [h, s, l] = rgbToHsl(r, g, b);
	let closestColor = "black";
	let minDistance = Number.MAX_VALUE;

	// Special cases for grayscale colors
	if (s < 10) {
		if (l < 15) return "black";
		if (l > 85) return "white";
		return "gray";
	}

	// Use deltaE for perceptual color difference
	for (const [color, colorRgb] of Object.entries(colorMap)) {
		const distance = deltaE([r, g, b], colorRgb);
		
		if (distance < minDistance) {
			minDistance = distance;
			closestColor = color;
		}
	}
	
	return closestColor;
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
				const colorTag = categorizeColor(averageColor);

				function categorizeColor(hexColor: string): string {
					const r = parseInt(hexColor.substring(1, 3), 16);
					const g = parseInt(hexColor.substring(3, 5), 16);
					const b = parseInt(hexColor.substring(5, 7), 16);
					
					// Define color perception functions
					// Convert RGB to HSL for better color categorization
					function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
						r /= 255; g /= 255; b /= 255;
						const max = Math.max(r, g, b), min = Math.min(r, g, b);
						let h = 0, s = 0, l = (max + min) / 2;

						if (max !== min) {
							const d = max - min;
							s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
							
							switch (max) {
								case r: h = (g - b) / d + (g < b ? 6 : 0); break;
								case g: h = (b - r) / d + 2; break;
								case b: h = (r - g) / d + 4; break;
							}
							h /= 6;
						}

						return [h * 360, s * 100, l * 100];
					}

					function deltaE(rgbA: number[], rgbB: number[]): number {
						let labA = rgb2lab(rgbA);
						let labB = rgb2lab(rgbB);
						let deltaL = labA[0] - labB[0];
						let deltaA = labA[1] - labB[1];
						let deltaB = labA[2] - labB[2];
						let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
						let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
						let deltaC = c1 - c2;
						let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
						deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
						let sc = 1.0 + 0.045 * c1;
						let sh = 1.0 + 0.015 * c1;
						let deltaLKlsl = deltaL / (1.0);
						let deltaCkcsc = deltaC / (sc);
						let deltaHkhsh = deltaH / (sh);
						let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
						return i < 0 ? 0 : Math.sqrt(i);
					}

					function rgb2lab(rgb: number[]): number[] {
						let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
						r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
						g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
						b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
						let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
						let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
						let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
						x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
						y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
						z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
						return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
					}

					const colorMap: {[key: string]: number[]} = {
						red: [255, 0, 0],
						blue: [0, 0, 255],
						green: [0, 128, 0],
						yellow: [255, 255, 0],
						purple: [128, 0, 128],
						orange: [255, 165, 0],
						black: [0, 0, 0],
						white: [255, 255, 255],
						pink: [255, 192, 203],
						brown: [165, 42, 42],
					};

					const [h, s, l] = rgbToHsl(r, g, b);
					let closestColor = "black";
					let minDistance = Number.MAX_VALUE;

					// Special cases for grayscale colors
					if (s < 10) {
						if (l < 15) return "black";
						if (l > 85) return "white";
						return "gray";
					}

					// Use deltaE for perceptual color difference
					for (const [color, colorRgb] of Object.entries(colorMap)) {
						const distance = deltaE([r, g, b], colorRgb);
						
						if (distance < minDistance) {
							minDistance = distance;
							closestColor = color;
						}
					}
					
					return closestColor;
				}
				await db.updateButtonColor(button.id, averageColor, colorTag);
				console.log(
					"Colorized button:",
					button.id,
					"with color:",
					averageColor,
					"and css color tag:",
					colorTag
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
}