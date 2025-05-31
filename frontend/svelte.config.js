import { vitePreprocess } from "@astrojs/svelte";

export default {
	preprocess: vitePreprocess(),
	server: {
		port: 80,
		allowedHosts: ["indieseas.net"],
	},
};
