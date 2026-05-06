import type { IncomingMessage, ServerResponse } from 'node:http';

type GenerateVideoRequest = IncomingMessage & {
  body?: unknown;
};

type GenerateVideoBody = {
  prompt?: unknown;
  characterDescription?: unknown;
  referenceImageUrl?: unknown;
  referenceImages?: unknown;
  referenceImageUrls?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  engine?: unknown;
  provider?: unknown;
  characterId?: unknown;
  character?: unknown;
  style?: unknown;
  camera?: unknown;
  audio?: unknown;
};

type ReplicateModelIdentifier = `${string}/${string}` | `${string}/${string}:${string}`;

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function durationValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (value instanceof URL) return value.toString();
  return null;
}

function normalizeReplicateVideoUrl(output: unknown, depth = 0): string | null {
  if (depth > 8 || output == null) return null;

  const directUrl = maybeUrl(output);
  if (directUrl) return directUrl;

  if (Array.isArray(output)) {
    for (const item of output) {
      const url = normalizeReplicateVideoUrl(item, depth + 1);
      if (url) return url;
    }
    return null;
  }

  if (typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  const urlMember = record.url;

  if (typeof urlMember === 'function') {
    try {
      const url = normalizeReplicateVideoUrl(urlMember.call(output), depth + 1);
      if (url) return url;
    } catch (error) {
      console.warn('Unable to read Replicate FileOutput URL', error);
    }
  }

  for (const key of ['videoUrl', 'video', 'output', 'url']) {
    const url = normalizeReplicateVideoUrl(record[key], depth + 1);
    if (url) return url;
  }

  const urls = record.urls;
  if (urls && typeof urls === 'object') {
    const url = normalizeReplicateVideoUrl((urls as Record<string, unknown>).get, depth + 1);
    if (url) return url;
  }

  const text = typeof output.toString === 'function' ? output.toString() : '';
  return text && text !== '[object Object]' ? maybeUrl(text) : null;
}

function buildFinalPrompt(body: GenerateVideoBody): string {
  const prompt = textValue(body.prompt);
  const characterDescription = textValue(body.characterDescription);
  const style = textValue(body.style);
  const camera = textValue(body.camera);
  const audio = booleanValue(body.audio);

  return [
    characterDescription
      ? 'same person as the saved self character, preserve facial identity, consistent hair, makeup, skin tone, wardrobe style'
      : '',
    characterDescription,
    prompt,
    style ? `style: ${style}` : '',
    camera ? `camera: ${camera}` : '',
    audio ? 'include synced ambient audio when supported' : '',
    'vertical video, cinematic lighting, realistic motion, high detail, TikTok style',
  ]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: GenerateVideoRequest, res: ServerResponse) {
  try {
    console.log('HANDLER REACHED');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    const model = (process.env.REPLICATE_VIDEO_MODEL || 'luma/ray-2-720p') as ReplicateModelIdentifier;
    console.log('VIDEO GEN START');
    console.log('ENV TOKEN EXISTS:', !!token);

    let body: GenerateVideoBody;

    try {
      body = await readBody(req);
    } catch (error) {
      console.warn('Invalid /api/lumora/generate-video JSON body', error);
      return sendJson(res, 400, {
        error: 'Invalid JSON body.',
        details: errorMessage(error),
        provider: 'replicate',
        model,
      });
    }

    const prompt = textValue(body.prompt);
    if (!prompt) {
      return sendJson(res, 400, {
        error: 'A prompt is required.',
        provider: 'replicate',
        model,
      });
    }

    if (!token) {
      throw new Error('Missing REPLICATE_API_TOKEN');
    }

    const finalPrompt = buildFinalPrompt(body);
    const aspectRatio = textValue(body.aspectRatio) || '9:16';
    const duration = durationValue(body.duration);

    try {
      const { default: Replicate } = await import('replicate');
      const replicate = new Replicate({
        auth: token,
        useFileOutput: false,
      });
      const output = await replicate.run(model, {
        input: {
          prompt: finalPrompt,
          duration,
          aspect_ratio: aspectRatio,
          loop: false,
        },
      });
      const videoUrl = normalizeReplicateVideoUrl(output);

      if (!videoUrl) {
        return sendJson(res, 502, {
          error: 'Replicate completed, but no usable video URL was found in the output.',
          details: safeJsonValue(output),
          provider: 'replicate',
          model,
          finalPrompt,
          rawOutput: safeJsonValue(output),
        });
      }

      return sendJson(res, 200, {
        videoUrl,
        video: videoUrl,
        provider: 'replicate',
        model,
        finalPrompt,
        referenceImageUrl: textValue(body.referenceImageUrl) || null,
        referenceImageNote: textValue(body.referenceImageUrl)
          ? 'This route currently uses Replicate text-to-video only and cannot preserve exact likeness from reference images.'
          : null,
        rawOutput: {
          request: {
            characterId: textValue(body.characterId) || null,
            requestedProvider: textValue(body.provider) || null,
            requestedEngine: textValue(body.engine) || null,
            aspectRatio,
            duration,
          },
          provider: safeJsonValue(output),
        },
      });
    } catch (error) {
      console.error('REPLICATE ERROR:', error);
      return sendJson(res, 500, {
        error: errorMessage(error),
        details: safeJsonValue(error),
        provider: 'replicate',
        model,
      });
    }
  } catch (error) {
    console.error('LUMORA GENERATE ERROR:', error);
    return sendJson(res, 500, {
      error: errorMessage(error),
      details: safeJsonValue(error),
      provider: 'replicate',
      model: process.env.REPLICATE_VIDEO_MODEL || 'luma/ray-2-720p',
    });
  }
}
