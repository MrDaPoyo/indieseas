<script>
	import { onMount } from "svelte";
	import * as d3 from "d3";

	export let relations = [];

	let container;
	let progressMessage = "Starting...";
	let loaded = false;

	onMount(() => {
		const buttonsToSites = new Map();
		const siteToButtons = new Map();
		for (const { button_id: b, website_id: s } of relations) {
			if (!buttonsToSites.has(b)) buttonsToSites.set(b, new Set());
			buttonsToSites.get(b).add(s);
			if (!siteToButtons.has(s)) siteToButtons.set(s, new Set());
			siteToButtons.get(s).add(b);
		}

		let destroy = () => {};

		(async () => {
			const allButtonIds = Array.from(buttonsToSites.keys());

			async function checkButtonExists(id) {
				try {
					let res = await fetch(
						`/api/getButton?id=${encodeURIComponent(id)}`,
						{ method: "HEAD" },
					);
					if (res.ok) return true;
					if (res.status === 405) {
						res = await fetch(
							`/api/getButton?id=${encodeURIComponent(id)}`,
							{ method: "GET", cache: "no-store" },
						);
						return res.ok;
					}
					return false;
				} catch {
					return false;
				}
			}

			const existingIds = new Set();
			const fetchCache = new Map();
			const uniqueIds = Array.from(new Set(allButtonIds));
			for (let i = 0; i < uniqueIds.length; i++) {
				const id = uniqueIds[i];
				progressMessage = `Retrieving button ${i + 1} / ${uniqueIds.length}`;
				if (existingIds.has(id)) continue;
				let promise = fetchCache.get(id);
				if (!promise) {
					promise = checkButtonExists(id);
					fetchCache.set(id, promise);
				}
				try {
					const exists = await promise;
					if (exists) existingIds.add(id);
				} catch {}
			}

			progressMessage = "Preparing graph...";

			const neighborsByButton = new Map();
			for (const bset of siteToButtons.values()) {
				const arr = Array.from(bset).filter((id) =>
					existingIds.has(id),
				);
				if (arr.length < 2) continue;
				for (let i = 0; i < arr.length; i++) {
					for (let j = i + 1; j < arr.length; j++) {
						const a = arr[i],
							b = arr[j];
						if (!neighborsByButton.has(a))
							neighborsByButton.set(a, new Set());
						if (!neighborsByButton.has(b))
							neighborsByButton.set(b, new Set());
						neighborsByButton.get(a).add(b);
						neighborsByButton.get(b).add(a);
					}
				}
			}

			const nodes = [];
			const nodesById = new Map();
			for (const bid of existingIds) {
				const degree = neighborsByButton.get(bid)?.size || 0;
				const n = {
					id: `b-${bid}`,
					buttonId: bid,
					type: "button",
					count: degree,
				};
				nodes.push(n);
				nodesById.set(n.id, n);
			}

			const linkMap = new Map();
			for (const bset of siteToButtons.values()) {
				const arr = Array.from(bset).filter((id) =>
					existingIds.has(id),
				);
				if (arr.length < 2) continue;
				for (let i = 0; i < arr.length; i++) {
					for (let j = i + 1; j < arr.length; j++) {
						const a = arr[i],
							b = arr[j];
						const [minId, maxId] = a < b ? [a, b] : [b, a];
						const key = `${minId}|${maxId}`;
						if (!linkMap.has(key))
							linkMap.set(key, { a: minId, b: maxId, weight: 0 });
						linkMap.get(key).weight++;
					}
				}
			}
			const links = Array.from(linkMap.values()).map(
				({ a, b, weight }) => ({
					source: `b-${a}`,
					target: `b-${b}`,
					weight,
				}),
			);

			loaded = true;

			const width = container.clientWidth || 800;
			const height = container.clientHeight || 600;

			const svg = d3
				.select(container)
				.append("svg")
				.attr("viewBox", [0, 0, width, height])
				.attr("width", "100%")
				.attr("height", "100%")
				.attr(
					"style",
					"max-height: 100%; display: block; background: #0b1020;",
				);

			const zoomLayer = svg.append("g");

			const link = zoomLayer
				.append("g")
				.attr("stroke", "#6b7280")
				.attr("stroke-opacity", 0.45)
				.selectAll("line")
				.data([])
				.join("line")
				.attr("stroke-width", 1.5);

			const BUTTON_W = 88;
			const BUTTON_H = 31;

			const node = zoomLayer
				.append("g")
				.selectAll("g")
				.data(nodes)
				.join("g");

			node.append("image")
				.attr(
					"href",
					(d) =>
						`/api/getButton?id=${encodeURIComponent(d.buttonId)}`,
				)
				.attr("width", BUTTON_W)
				.attr("height", BUTTON_H)
				.attr("x", -BUTTON_W / 2)
				.attr("y", -BUTTON_H / 2)
				.attr("preserveAspectRatio", "xMidYMid slice");

			const counts = nodes.map((d) => d.count);
			const nonZeroCounts = counts.filter((c) => c > 0);
			const STRAY_SCALE = 0.4;
			const baseScale = nonZeroCounts.length
				? d3
						.scalePow()
						.exponent(2)
						.domain([1, Math.max(...nonZeroCounts)])
						.range([0.6, 5.0])
				: () => 1;
 			const getScale = (d) =>
 				d.count === 0 ? STRAY_SCALE : baseScale(d.count);
 
 			const simulation = d3
 				.forceSimulation(nodes)
 				.force(
 					"link",
 					d3
 						.forceLink(links)
 						.id((d) => d.id)
 						.distance(340)
 						.strength(0.06),
 				)
 				.force("charge", d3.forceManyBody().strength(-220))
 				.force("center", d3.forceCenter(width / 2, height / 2))
 				.force(
 					"collision",
 					d3
 						.forceCollide()
 						.radius((d) => (BUTTON_W / 2) * getScale(d) + 12)
 						.strength(0.9),
 				)
 				.on("tick", ticked);

			function ticked() {
				link.attr("x1", (d) => d.source.x)
					.attr("y1", (d) => d.source.y)
					.attr("x2", (d) => d.target.x)
					.attr("y2", (d) => d.target.y);

				node.attr(
					"transform",
					(d) => `translate(${d.x},${d.y}) scale(${getScale(d)})`,
				);
			}

			svg.call(
				d3
					.zoom()
					.scaleExtent([0.2, 4])
					.on("zoom", (event) =>
						zoomLayer.attr("transform", event.transform),
					),
			);

			const ro = new ResizeObserver(() => {
				const w = container.clientWidth || width;
				const h = container.clientHeight || height;
				svg.attr("viewBox", [0, 0, w, h]);
				simulation
					.force("center", d3.forceCenter(w / 2, h / 2))
					.alpha(0.2)
					.restart();
			});
			ro.observe(container);

			destroy = () => {
				ro.disconnect();
				simulation.stop();
				svg.remove();
			};
		})();

		return () => destroy();
	});
</script>

<div bind:this={container} style="width:100%; height:100vh;">
	<div class="overlay top">
		<h1>IndieSeas.net</h1>
		{#if !loaded}
			<h2>{progressMessage}</h2>
		{:else}
			<a href="https://github.com/MrDaPoyo/indieseas" target="_blank"
				>GitHub</a
			>
		{/if}
	</div>
    
    <div class="overlay bottom" style="top: auto; bottom: 0;">
		<p >IndieSeas is a WIP. Currently you can only visualize all the buttons in this nicely presented graph. Sorry for the inconveniences!</p>
	</div>
	
    <style>
		h1,
		h2 {
			color: white;
			margin: 0;
		}

		div {
			height: 100vh;
			padding: auto;
			background-color: #10101a;
		}

		.overlay {
			position: absolute;
			left: 0;
			height: fit-content;
			width: 100vw;
			padding: auto;
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex-direction: row;
			padding: 0 16px;
			gap: 16px;
			z-index: 100000000;
			background: rgba(11, 16, 32, 0.8);
			color: white;
		}

		.overlay h1 {
			margin-inline: 0 auto;
		}

        .overlay .top {
            top: 0;
        }

        .overlay .bottom {
            bottom: 0;
        }
	</style>
</div>
