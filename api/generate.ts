import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  errorMessage as generationErrorMessage,
  generateVideoFromBody,
  ProviderError,
  safeJsonValue as generationSafeJsonValue,
} from './_lib/videoGeneration';

type GenerateRequest = IncomingMessage & {
  body?: unknown;
};

type GenerateVideoBody = {
  [key: string]: unknown;
};

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') return undefined;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof URL) return value.toString();

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      type: value.type,
      size: value.size,
    };
  }

  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item, seen) ?? null);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .flatMap(([key, entry]) => {
        const safeEntry = safeJsonValue(entry, seen);
        return typeof safeEntry === 'undefined' ? [] : [[key, safeEntry]];
      }),
  );
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const response = res as ServerResponse & {
    status?: (code: number) => ServerResponse & { json?: (value: unknown) => void };
    json?: (value: unknown) => void;
  };
  const safePayload = safeJsonValue(payload) ?? null;

  if (typeof response.status === 'function') {
    const statusResponse = response.status(statusCode);
    if (statusResponse && typeof statusResponse.json === 'function') {
      statusResponse.json(safePayload);
      return;
    }
  }

  if (typeof response.json === 'function') {
    response.statusCode = statusCode;
    response.json(safePayload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  try {
    res.end(JSON.stringify(safePayload));
  } catch {
    res.end(JSON.stringify({ error: 'Unable to serialize JSON response.' }));
  }
}

async function readBody(req: GenerateRequest): Promise<GenerateVideoBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as GenerateVideoBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as GenerateVideoBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as GenerateVideoBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GenerateVideoBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Video generation failed.';
}

export default async function handler(req: GenerateRequest, res: ServerResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    let body: GenerateVideoBody;

    try {
      body = await readBody(req);
    } catch (error) {
      console.warn('Invalid /api/generate JSON body', error);
      return sendJson(res, 400, { error: 'Invalid JSON body.', details: errorMessage(error) });
    }

    try {
      const result = await generateVideoFromBody(body);
      return sendJson(res, 200, result);
    } catch (error) {
      console.error('VIDEO GENERATE FAILED', error);

      if (error instanceof ProviderError) {
        const details = generationSafeJsonValue(error.payload);
        return sendJson(res, 500, {
          error: error.message,
          details,
          provider: error.provider,
          model: error.model,
          rawOutput: details,
        });
      }

      return sendJson(res, 500, {
        error: generationErrorMessage(error),
        details: safeJsonValue(error),
      });
    }
  } catch (error) {
    console.error('VIDEO GENERATE UNHANDLED ERROR:', error);
    return sendJson(res, 500, {
      error: errorMessage(error),
      details: safeJsonValue(error),
    });
  }
}
