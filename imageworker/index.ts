import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "url" query parameter.' });
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL encoding.' });
  }

  try {
    new URL(decodedUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }

  try {
    const response = await fetch(decodedUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'VercelImageFetcher/1.0' }
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'Failed to fetch image.' });
    }

    const contentType = response.headers.get('content-type') || '';

    // Only allow images (including gifs)
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL does not point to a valid image or gif.' });
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(imageBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
}
