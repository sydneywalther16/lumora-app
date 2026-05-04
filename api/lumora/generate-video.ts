import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenerateVideoRequestBody } from '../generate';

type GenerateVideoRequest = IncomingMessage & {
  body?: unknown;
};

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

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type ProviderErrorLike = Error & {
  statusCode?: number;
  provider?: unknown;
  model?: unknown;
  payload?: unknown;
};

function isProviderErrorLike(error: unknown): error is ProviderErrorLike {
  return error instanceof Error && (
    error.name === 'ProviderError' ||
    typeof (error as ProviderErrorLike).statusCode === 'number' ||
    typeof (error as ProviderErrorLike).provider === 'string'
  );
}

export default async function handler(req: GenerateVideoRequest, res: ServerResponse) {
  try {
    console.info('LUMORA GENERATE START', { method: req.method });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const body = await readBody(req);
    console.info('LUMORA PROVIDER', {
      provider: textValue(body.provider) || null,
      engine: textValue(body.engine) || null,
    });

    const { generateVideoFromBody } = await import('../generate');
    const result = await generateVideoFromBody(body);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('LUMORA GENERATE ERROR', error);

    if (error instanceof SyntaxError) {
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }

    if (isProviderErrorLike(error)) {
      const details = safeJsonValue(error.payload);
      return sendJson(res, error.statusCode ?? 500, {
        error: error.message,
        details,
        provider: typeof error.provider === 'string' ? error.provider : undefined,
        model: typeof error.model === 'string' ? error.model : undefined,
        rawOutput: details,
      });
    }

    return sendJson(res, 500, {
      error: errorMessage(error),
      details: safeJsonValue(error),
    });
  }
}
