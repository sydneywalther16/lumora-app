import type { IncomingMessage, ServerResponse } from 'node:http';

type GenerateVideoRequest = IncomingMessage & {
  body?: unknown;
};

type GenerateVideoBody = {
  provider?: unknown;
  engine?: unknown;
  [key: string]: unknown;
};

type VideoGenerationModule = {
  generateVideoFromBody: (body: GenerateVideoBody) => Promise<unknown>;
  ProviderError: new (...args: never[]) => Error & {
    statusCode?: number;
    provider?: unknown;
    model?: unknown;
    payload?: unknown;
  };
  errorMessage: (error: unknown) => string;
  safeJsonValue: (value: unknown) => unknown;
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

async function readBody(req: GenerateVideoRequest): Promise<GenerateVideoBody> {
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

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function isReplicateFailure(error: unknown, provider?: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    provider === 'replicate' ||
    message.includes('replicate') ||
    message.includes('replicate_api_token')
  );
}

export default async function handler(req: GenerateVideoRequest, res: ServerResponse) {
  try {
    console.log('HANDLER REACHED');
    console.info('LUMORA GENERATE START', { method: req.method });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    let body: GenerateVideoBody;

    try {
      body = await readBody(req);
    } catch (error) {
      console.warn('Invalid /api/lumora/generate-video JSON body', error);
      return sendJson(res, 400, { error: 'Invalid JSON body.', details: errorMessage(error) });
    }

    console.info('LUMORA PROVIDER', {
      provider: textValue(body.provider) || null,
      engine: textValue(body.engine) || null,
    });

    let videoGeneration: VideoGenerationModule;

    try {
      videoGeneration = await import('../../src/server/videoGeneration') as VideoGenerationModule;
    } catch (error) {
      console.error('LUMORA VIDEO MODULE IMPORT ERROR:', error);
      return sendJson(res, 500, {
        error: 'Failed to load video generation module',
        details: errorMessage(error),
        stack: errorStack(error),
      });
    }

    try {
      const result = await videoGeneration.generateVideoFromBody(body);
      return sendJson(res, 200, result);
    } catch (error) {
      console.error('LUMORA GENERATE ERROR:', error);

      if (error instanceof videoGeneration.ProviderError) {
        const provider = error.provider;
        const details = videoGeneration.safeJsonValue(error.payload);

        if (isReplicateFailure(error, provider)) {
          return sendJson(res, 500, {
            error: 'Replicate failed',
            suggestion: 'Check billing or API token',
            details,
            provider,
            model: error.model,
            stack: error.stack ?? null,
          });
        }

        return sendJson(res, 500, {
          error: error.message || 'Unknown error',
          details,
          provider,
          model: error.model,
          stack: error.stack ?? null,
          rawOutput: details,
        });
      }

      if (errorMessage(error) === 'Missing REPLICATE_API_TOKEN') {
        return sendJson(res, 500, {
          error: 'Missing REPLICATE_API_TOKEN',
          suggestion: 'Check billing or API token',
          stack: errorStack(error),
        });
      }

      if (isReplicateFailure(error)) {
        return sendJson(res, 500, {
          error: 'Replicate failed',
          suggestion: 'Check billing or API token',
          details: errorMessage(error),
          stack: errorStack(error),
        });
      }

      return sendJson(res, 500, {
        error: errorMessage(error),
        stack: errorStack(error),
        details: safeJsonValue(error),
      });
    }
  } catch (error) {
    console.error('LUMORA GENERATE UNHANDLED ERROR:', error);
    return sendJson(res, 500, {
      error: errorMessage(error),
      stack: errorStack(error),
      details: safeJsonValue(error),
    });
  }
}
