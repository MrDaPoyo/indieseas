import { Jimp } from "jimp";
import fs from "fs";

var corpo_files = fs.readdirSync("./corpo");
var indie_files = fs.readdirSync("./indie");

for (const file of corpo_files) {
	if (file.endsWith(".png")) {
		Jimp.read(`./corpo/${file}`)
			.then((image: any) => {
				image.write(`./corpo/${file.split(".")[0]}.jpg`);
                fs.unlinkSync(`./corpo/${file}`);
                console.log(`Converted ${file} to JPG`);
			})
			.catch((err: any) => {
				console.log(err);
			});
	}
}

for (const file of indie_files) {
	if (file.endsWith(".png")) {
		Jimp.read(`./indie/${file}`)
			.then((image: any) => {
				image.write(`./indie/${file.split(".")[0]}.jpg`);
                fs.unlinkSync(`./indie/${file}`);
                console.log(`Converted ${file} to JPG`);
			})
			.catch((err: any) => {
				console.log(err);
			});
	}
}
