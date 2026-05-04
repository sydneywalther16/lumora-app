import type { IncomingMessage, ServerResponse } from 'node:http';
import Replicate from 'replicate';

type GenerateRequest = IncomingMessage & {
  body?: unknown;
};

type RequestBody = {
  prompt?: unknown;
  characterDescription?: unknown;
  aspectRatio?: unknown;
  engine?: unknown;
  character?: unknown;
};

const REPLICATE_VIDEO_MODEL = 'anotherjesse/zeroscope-v2-xl';
const DEFAULT_NEGATIVE_PROMPT = 'blurred, noisy, washed out, distorted, broken';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
  useFileOutput: false,
});

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Video generation failed.';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readBody(req: GenerateRequest): Promise<RequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as RequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as RequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as RequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RequestBody;
}

function formatCharacterDescription(character: unknown): string {
  if (!character) return '';
  if (typeof character === 'string') return character.trim();
  if (typeof character === 'number' || typeof character === 'boolean') {
    return String(character);
  }

  try {
    return JSON.stringify(character);
  } catch {
    return '';
  }
}

function buildFinalPrompt(prompt: string, characterDescription: string): string {
  return `${characterDescription || ''}, ${prompt || ''}, vertical video, cinematic lighting, realistic motion, high detail, TikTok style`
    .replace(/\s+/g, ' ')
    .trim();
}

function getDimensions(aspectRatio: unknown): { width: number; height: number } {
  if (aspectRatio === '16:9') return { width: 1024, height: 576 };
  if (aspectRatio === '1:1') return { width: 768, height: 768 };
  return { width: 576, height: 1024 };
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

function serializeReplicateOutput(output: unknown, seen = new WeakSet<object>()): unknown {
  if (output == null || typeof output !== 'object') return output;
  if (output instanceof URL) return output.toString();

  if (seen.has(output)) return '[Circular]';
  seen.add(output);

  const normalizedUrl = normalizeReplicateVideoUrl(output);

  if (Array.isArray(output)) {
    return output.map((item) => serializeReplicateOutput(item, seen));
  }

  const record = output as Record<string, unknown>;
  const serialized = Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => typeof value !== 'function')
      .map(([key, value]) => [key, serializeReplicateOutput(value, seen)]),
  );

  if (normalizedUrl && !serialized.url) {
    serialized.url = normalizedUrl;
  }

  return serialized;
}

export default async function handler(req: GenerateRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not configured.');
    return sendJson(res, 500, { error: 'REPLICATE_API_TOKEN is not configured.' });
  }

  try {
    let body: RequestBody;

    try {
      body = await readBody(req);
    } catch (error) {
      console.warn('Invalid /api/generate JSON body', error);
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }

    const prompt = textValue(body.prompt);
    const characterDescription =
      textValue(body.characterDescription) || formatCharacterDescription(body.character);
    const aspectRatio = textValue(body.aspectRatio) || '9:16';
    const engine = textValue(body.engine) || 'replicate';
    const finalPrompt = buildFinalPrompt(prompt, characterDescription);
    const { width, height } = getDimensions(aspectRatio);

    if (!prompt) {
      return sendJson(res, 400, { error: 'A prompt is required.' });
    }

    console.info('REPLICATE GENERATE REQUEST', {
      model: REPLICATE_VIDEO_MODEL,
      promptLength: prompt.length,
      hasCharacterDescription: Boolean(characterDescription),
      aspectRatio,
      engine,
    });

    const output = await replicate.run(REPLICATE_VIDEO_MODEL, {
      input: {
        prompt: finalPrompt,
        negative_prompt: DEFAULT_NEGATIVE_PROMPT,
        num_frames: 24,
        num_inference_steps: 50,
        guidance_scale: 12.5,
        fps: 24,
        width,
        height,
      },
    });
    const videoUrl = normalizeReplicateVideoUrl(output);
    const rawOutput = serializeReplicateOutput(output);

    console.info('REPLICATE GENERATE OUTPUT', {
      model: REPLICATE_VIDEO_MODEL,
      hasVideoUrl: Boolean(videoUrl),
      outputType: Array.isArray(output) ? 'array' : typeof output,
    });

    if (!videoUrl) {
      return sendJson(res, 502, {
        error: 'Replicate completed, but no usable video URL was found in the output.',
        provider: 'replicate',
        finalPrompt,
        rawOutput,
      });
    }

    return sendJson(res, 200, {
      videoUrl,
      video: videoUrl,
      provider: 'replicate',
      finalPrompt,
      rawOutput,
    });
  } catch (error) {
    console.error('REPLICATE GENERATE FAILED', error);
    return sendJson(res, 500, { error: errorMessage(error) });
  }
}
