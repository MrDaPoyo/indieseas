import * as db from "./db/db";
import { renderToString } from "react-dom/server";
import React from "react";

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
		<>
			<p>Found {buttonCount} Buttons across {urlCount} scraped and indexed pages.</p>
			<Search query=""/>
		</>
	);
}

function Search({ query }: { query: string }) {
	return (
		<Layout>
			<form action="/query" method="GET">
				<input type="text" name="q" placeholder="Search..." defaultValue={query} />
				<button type="submit">Search</button>
			</form>
			<div id="results"></div>
			<script dangerouslySetInnerHTML={{
				__html: `
					document.querySelector('form').addEventListener('submit', async (e) => {
						e.preventDefault();
						const query = document.querySelector('input[name="q"]').value;
						const response = await fetch('/query?q=' + encodeURIComponent(query));
						
						if (response.ok) {
							const results = await response.json();
							const resultsHTML = results.map(item => \`
								<div class="result">
									<h3><a href="\${item.path}" target="_blank" rel="noopener noreferrer">\${item.title || new URL(item.path).href.replace("http://").replace("https://").replace("/")}</a></h3>
									\${item.description ? \`<p>Title: \${item.description}</p>\` : ''}
									<p>Scraped: \${new Date(item.visited_date).toLocaleDateString()}</p>
								</div>
								<hr>
							\`).join('');
							
							document.getElementById('results').innerHTML = "<p>Found " + results.length + " results for '" + query + "'</p><br>" + resultsHTML;
						} else {
							document.getElementById('results').innerHTML = '<p>No results found</p>';
						}
					});`
			}} />
		</Layout>
	);
}


Bun.serve({
	routes: {
		"/": async () => {
			const urlCount = (await db.retrieveAllScrapedURLs()).length;
			const buttons = await db.retrieveAllButtons();
			const buttonCount = Array.isArray(buttons) ? buttons.length : 0;
			return new Response(renderToString(<Status urlCount={urlCount} buttonCount={buttonCount} />), {
				headers: {
					"Content-Type": "text/html",
				},
			});
		},
		"/query": async (req) => {
			const url = new URL(req.url);
			const query = url.searchParams.get("q") || "";
			if (!query) {
				return new Response("No query provided", { status: 400 });
			}
			const results = await db.search(query);
			return new Response(JSON.stringify(results), {
				headers: {
					"Content-Type": "application/json",
				},
			});
		}
	},
	port: process.env.SEARCH_PORT || 8080,
});
