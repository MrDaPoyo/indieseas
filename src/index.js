let cachedUrlList = null;
let lastCacheTime = 0;
let DEFAULT_API_KEY = "CHANGE_ME6969colon-three";

export default {
  async fetch(req, env) {
    try {
      const { searchParams } = new URL(req.url);

      const authHeader = req.headers.get("Authorization") || "";
      const apiKey = env.API_KEY || DEFAULT_API_KEY;

      if (authHeader !== `Bearer ${apiKey}`) {
        return new Response("Unauthorized: invalid API key", { status: 401 });
      }

      const target = searchParams.get("url");
      if (!target) return new Response("Missing ?url=", { status: 400 });

      const base = new URL(target);

      const now = Date.now();
      if (!cachedUrlList || now - lastCacheTime > 15 * 60 * 1000) {
        const listRes = await fetch(`${env.SERVER_API}/api/url-list`, {
          headers: { "Authorization": `Bearer ${env.SECRET}` },
        });

        if (!listRes.ok)
          throw new Error(`Failed to fetch URL list: ${listRes.status}`);

        cachedUrlList = new Set(await listRes.json());
        lastCacheTime = now;
      }

      const htmlRes = await fetch(base.href, { redirect: "follow" });
      if (!htmlRes.ok)
        throw new Error(`Failed to fetch: ${htmlRes.status}`);
      const html = await htmlRes.text();

      const assetRegexes = {
        scripts: /<script[^>]+src=["']([^"']+)["']/gi,
        links: /<link[^>]+href=["']([^"']+)["']/gi,
        images: /<img[^>]+src=["']([^"']+)["']/gi,
        videos: /<video[^>]+src=["']([^"']+)["']/gi,
        sources: /<source[^>]+src=["']([^"']+)["']/gi,
        iframes: /<iframe[^>]+src=["']([^"']+)["']/gi,
      };

      const urls = new Set();
      for (const regex of Object.values(assetRegexes)) {
        let match;
        while ((match = regex.exec(html))) {
          try {
            const abs = new URL(match[1], base).href;
            urls.add(abs);
          } catch {}
        }
      }

      const newUrls = [...urls].filter(u => !cachedUrlList.has(u));

      let forwarded = 0;
      const failed = [];

      for (const assetUrl of newUrls) {
        try {
          const res = await fetch(assetUrl, { redirect: "follow" });

          await fetch(`${env.SERVER_API}/api/upload`, {
            method: "POST",
            headers: {
              "Content-Type": res.headers.get("content-type") || "application/octet-stream",
              "X-Source-Url": assetUrl,
              "X-Page-Url": base.href,
              "X-Status-Code": res.status.toString(),
              "Authorization": `Bearer ${env.SECRET}`,
            },
            body: res.body,
          });

          if (!res.ok) {
            failed.push({ url: assetUrl, status: res.status });
          } else {
            forwarded++;
          }
        } catch (err) {
          failed.push({ url: assetUrl, error: err.message });
        }
      }

      return Response.json({
        forwarded,
        skipped: urls.size - newUrls.length,
        totalAssets: urls.size,
        failed,
      });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
