import * as db from "./db/db";
import { renderToString } from "react-dom/server";

function Layout(props: { children: React.ReactNode }) {
	return (
		<body>
			<h1>IndieSeas :D</h1>
			{props.children}
		</body>
	);
}

function Status({ urlCount, buttonCount }: { urlCount: number, buttonCount: number }) {
	return (
		<Layout>
			<p>Found {buttonCount} Buttons across {urlCount} scraped and indexed pages.</p>
		</Layout>
	);
}


Bun.serve({
	routes: {
		"/": async () => {
			const urlCount = (await db.retrieveAllScrapedURLs()).length;
			const buttonCount = (await db.retrieveAllButtons()).length;
			return new Response(renderToString(<Status urlCount={urlCount} buttonCount={buttonCount} />), {
				headers: {
					"Content-Type": "text/html",
				},
			});
		},
		"/query": async (req) => {
			const query = new URL(req.url).searchParams.get("q");
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			const result = db.search(query);
			if (result.length === 0) {
				return new Response("No results found", { status: 404 });
			}
			const response = result.map((item: any) => {
				return `<div>
					<a href="${item.url}">${item.url}</a>
					<p>${item.text}</p>
				</div>`;
			}
	},
	port: 8080,
});
