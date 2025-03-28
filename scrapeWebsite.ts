declare var self: Worker;

console.log("Worker started");

interface Button {
  image?: string;
  filename?: string;
  scraped_date?: number | null;
  found_url?: string;
  hash?: string;
  src?: string;
};

async function scrapeEntireWebsite(url: string): Promise<Button> {
  let metadata: Button = {};
  const response = await fetch(url);

  const rewriter = new HTMLRewriter()
    .on("img", {
      async element(element) {
        const src = element.getAttribute("src") as any;
        const imageUrl = new URL(src, url);
        console.log(JSON.stringify(imageUrl));
        try {
          const imageResponse = await fetch(imageUrl);
          const imageBlob = await imageResponse.blob();
          const reader = new FileReader();
          reader.onload = () => {
            const base64String = reader.result as string;
            metadata = {
              image: base64String,
              filename: src.split("/").pop(), // Get the last part of the URL
              scraped_date: Date.now(),
              found_url: url,
              hash: require("./db/db").hash(),
              src: src,
            };
          };
          reader.onerror = (error) => {
            console.error("Error reading image:", error);
          };
          reader.readAsDataURL(imageBlob);
        } catch (error) {
          console.error("Error fetching image:", error);
        }
      }
    });

  // Process the response
  await rewriter.transform(response).blob();

  // Convert relative image URLs to absolute
  if (metadata.image && !metadata.image.startsWith("http")) {
    try {
      metadata.image = new URL(metadata.image, url).href;
    } catch {
      // Keep the original URL if parsing fails
    }
  }

  return metadata;
}

self.onmessage = async (event: MessageEvent) => {
  const buttons = await scrapeEntireWebsite(event.data);
  console.log("Scraped", buttons);
  postMessage(buttons);
  console.log("Worker finished");
  process.exit();
};