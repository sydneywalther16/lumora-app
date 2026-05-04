import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  generateVideoFromBody,
  ProviderError,
  type GenerateVideoRequestBody,
} from '../generate';

type GenerateVideoRequest = IncomingMessage & {
  body?: unknown;
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req: GenerateVideoRequest): Promise<GenerateVideoRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as GenerateVideoRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as GenerateVideoRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as GenerateVideoRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GenerateVideoRequestBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Video generation failed.';
}

export default async function handler(req: GenerateVideoRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }

  try {
    const body = await readBody(req);
    const result = await generateVideoFromBody(body);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('LUMORA GENERATE VIDEO FAILED', error);

    if (error instanceof SyntaxError) {
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }

    if (error instanceof ProviderError) {
      return sendJson(res, error.statusCode, {
        error: error.message,
        provider: error.provider,
        model: error.model,
        rawOutput: error.payload,
      });
    }

    return sendJson(res, 500, { error: errorMessage(error) });
  }
}
