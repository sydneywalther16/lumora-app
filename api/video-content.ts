import type { IncomingMessage, ServerResponse } from 'node:http';

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
  }

  const requestUrl = new URL(req.url || '', `https://${req.headers.host || 'localhost'}`);
  const provider = requestUrl.searchParams.get('provider');
  const id = requestUrl.searchParams.get('id');

  if (provider !== 'openai' || !id) {
    return sendJson(res, 400, { error: 'A valid OpenAI video id is required.' });
  }

  try {
    const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}/content`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      return sendJson(res, response.status >= 500 ? 502 : response.status, {
        error: message || 'Unable to download OpenAI video content.',
      });
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length');
    const content = Buffer.from(await response.arrayBuffer());

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    return res.end(content);
  } catch (error) {
    console.error('OPENAI VIDEO CONTENT FAILED', error);
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unable to download OpenAI video content.',
    });
  }
}
