import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
};

type ReplicateModelIdentifier = `${string}/${string}` | `${string}/${string}:${string}`;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const vercelRes = res as Partial<VercelResponse>;

  if (typeof vercelRes.status === 'function' && typeof vercelRes.json === 'function') {
    vercelRes.status(statusCode).json(payload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.toString();
  return null;
}

function outputUrl(output: unknown): string | null {
  const directUrl = maybeUrl(output);
  if (directUrl) return directUrl;

  if (Array.isArray(output)) {
    return output.find((item): item is string => typeof item === 'string') ?? null;
  }

  if (!output || typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  const url = record.url;

  if (typeof url === 'string') return url;

  if (typeof url === 'function') {
    try {
      const value = url.call(output);
      const resolvedUrl = maybeUrl(value);
      if (resolvedUrl) return resolvedUrl;
    } catch (error) {
      console.warn('Unable to read Replicate output url:', error);
    }
  }

  const nestedOutput = record.output;
  if (Array.isArray(nestedOutput)) {
    return nestedOutput.find((item): item is string => typeof item === 'string') ?? null;
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('LUMORA GENERATE START');

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { prompt } = (body && typeof body === 'object' ? body : {}) as { prompt?: unknown };

    if (!prompt) {
      return sendJson(res, 400, { error: 'Missing prompt' });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return sendJson(res, 500, { error: 'Missing REPLICATE_API_TOKEN' });
    }

    const model = 'anotherjesse/zeroscope-v2-xl' as ReplicateModelIdentifier;

    console.log('Using model:', model);

    const { default: Replicate } = await import('replicate');
    const replicate = new Replicate({
      auth: token,
    });

    const input = {
      prompt: `${String(prompt)}, cinematic lighting, high detail, realistic motion`,
    };

    console.log('Calling Replicate...');

    const output = await replicate.run(model, { input });

    console.log('RAW OUTPUT:', JSON.stringify(output, null, 2));

    const videoUrl = outputUrl(output);

    console.log('FINAL VIDEO URL:', videoUrl);

    if (!videoUrl) {
      return sendJson(res, 500, {
        error: 'No video returned',
        raw: output,
      });
    }

    return sendJson(res, 200, {
      success: true,
      videoUrl,
      provider: 'replicate',
      model,
    });
  } catch (error) {
    console.error('LUMORA GENERATE ERROR:', error);

    return sendJson(res, 500, {
      error: 'Generation failed',
      message: errorMessage(error),
      stack: errorStack(error),
    });
  }
}
