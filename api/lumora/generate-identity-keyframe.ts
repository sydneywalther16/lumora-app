import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
};

type KeyframeBody = {
  prompt?: unknown;
  identityId?: unknown;
  identityPrompt?: unknown;
  consistencyPrompt?: unknown;
  generationConsistencyPrompt?: unknown;
  canonicalReferenceSet?: unknown;
  frontFaceUrl?: unknown;
  leftAngleUrl?: unknown;
  rightAngleUrl?: unknown;
  videoReferenceUrls?: unknown;
  appearanceSummary?: unknown;
  preferences?: unknown;
  dislikes?: unknown;
  likenessNotes?: unknown;
  style?: unknown;
};

type ReplicateClient = {
  run: (model: `${string}/${string}` | `${string}/${string}:${string}`, options: { input: Record<string, unknown> }) => Promise<unknown>;
};

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeJsonValue(item, seen) ?? null);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const safeEntry = safeJsonValue(entry, seen);
      return typeof safeEntry === 'undefined' ? [] : [[key, safeEntry]];
    }),
  );
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const vercelRes = res as Partial<VercelResponse>;
  const safePayload = safeJsonValue(payload) ?? null;

  if (typeof vercelRes.status === 'function' && typeof vercelRes.json === 'function') {
    vercelRes.status(statusCode).json(safePayload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(safePayload));
}

async function readBody(req: VercelRequest): Promise<KeyframeBody> {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8')) as KeyframeBody;
  if (typeof req.body === 'string') return JSON.parse(req.body) as KeyframeBody;
  if (req.body && typeof req.body === 'object') return req.body as KeyframeBody;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as KeyframeBody;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function cleanHttpUrl(value: unknown): string {
  const url = textValue(value);
  if (!url || !/^https?:\/\//i.test(url)) return '';
  if (/^(?:blob|data|file):/i.test(url) || url.includes('localhost') || url.includes('undefined')) return '';
  return url.split('?')[0];
}

function buildFinalPrompt(body: KeyframeBody) {
  const preferences = body.preferences && typeof body.preferences === 'object'
    ? JSON.stringify(body.preferences)
    : '';
  const dislikes = stringList(body.dislikes).join(', ');
  const notes = stringList(body.likenessNotes).join(', ');

  return [
    'Create a new photorealistic character render based on the provided identity references.',
    'Do not simply animate or copy the source photo. Use the references only to preserve identity: face shape, hair color, hairstyle, skin tone, eye area, proportions, makeup style, and overall likeness.',
    'Place this same person into the requested new scene.',
    textValue(body.consistencyPrompt) || textValue(body.generationConsistencyPrompt),
    textValue(body.identityPrompt) ? `Identity prompt: ${textValue(body.identityPrompt)}` : '',
    textValue(body.appearanceSummary),
    textValue(body.prompt),
    textValue(body.style) ? `Style: ${textValue(body.style)}` : '',
    preferences ? `User preferences: ${preferences}` : '',
    dislikes ? `Avoid these traits: ${dislikes}` : '',
    notes ? `Likeness feedback notes: ${notes}` : '',
    'Hyperrealistic portrait keyframe, cinematic lighting, natural skin texture, high detail.',
  ].filter(Boolean).join('\n\n');
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (value instanceof URL) return value.toString();
  return null;
}

async function outputUrl(output: unknown): Promise<string | null> {
  const direct = maybeUrl(output);
  if (direct) return direct;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = await outputUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  for (const key of ['data', 'image', 'images', 'output', 'url', 'keyframeUrl']) {
    const url = await outputUrl(record[key]);
    if (url) return url;
  }
  return null;
}

async function generateWithOpenAI(input: {
  prompt: string;
  frontFaceUrl: string;
  leftAngleUrl: string;
  rightAngleUrl: string;
  videoReferenceUrls: string[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_IMAGE_MODEL;
  if (!apiKey || !model) return null;

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size: '1024x1792',
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error('OpenAI identity keyframe generation failed.'), {
      provider: 'openai',
      model,
      details: payload,
    });
  }

  const keyframeUrl = await outputUrl(payload);
  if (!keyframeUrl) {
    throw Object.assign(new Error('OpenAI image provider did not return a hosted keyframe URL.'), {
      provider: 'openai',
      model,
      details: payload,
    });
  }

  return {
    keyframeUrl,
    provider: 'openai',
    model,
    rawOutput: payload,
  };
}

async function generateWithReplicate(input: {
  prompt: string;
  frontFaceUrl: string;
  leftAngleUrl: string;
  rightAngleUrl: string;
  videoReferenceUrls: string[];
}) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_IDENTITY_KEYFRAME_MODEL || process.env.REPLICATE_IMAGE_MODEL;
  if (!token || !model) return null;

  const { default: Replicate } = await import('replicate');
  const replicate = new Replicate({ auth: token }) as ReplicateClient;
  const output = await replicate.run(model as `${string}/${string}`, {
    input: {
      prompt: input.prompt,
      image: input.frontFaceUrl,
      reference_images: [
        input.leftAngleUrl,
        input.rightAngleUrl,
        ...input.videoReferenceUrls,
      ].filter(Boolean),
    },
  });
  const keyframeUrl = await outputUrl(output);

  if (!keyframeUrl) {
    throw Object.assign(new Error('Replicate image provider did not return a keyframe URL.'), {
      provider: 'replicate',
      model,
      details: output,
    });
  }

  return {
    keyframeUrl,
    provider: 'replicate',
    model,
    rawOutput: output,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('LUMORA IDENTITY KEYFRAME START');

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = await readBody(req);
    const prompt = textValue(body.prompt);
    const frontFaceUrl = cleanHttpUrl(body.frontFaceUrl);
    const leftAngleUrl = cleanHttpUrl(body.leftAngleUrl);
    const rightAngleUrl = cleanHttpUrl(body.rightAngleUrl);
    const videoReferenceUrls = stringList(body.videoReferenceUrls).map(cleanHttpUrl).filter(Boolean);

    if (!prompt) return sendJson(res, 400, { error: 'Missing prompt' });
    if (!frontFaceUrl) {
      return sendJson(res, 400, {
        error: 'Identity keyframe requires a public frontFaceUrl.',
      });
    }

    const finalPrompt = buildFinalPrompt(body);
    console.log('IDENTITY KEYFRAME INPUT', {
      identityId: textValue(body.identityId),
      frontFaceUrl,
      hasLeft: Boolean(leftAngleUrl),
      hasRight: Boolean(rightAngleUrl),
      videoReferenceCount: videoReferenceUrls.length,
    });

    const openAiResult = await generateWithOpenAI({
      prompt: finalPrompt,
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      videoReferenceUrls,
    });
    const result = openAiResult ?? await generateWithReplicate({
      prompt: finalPrompt,
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      videoReferenceUrls,
    });

    if (!result) {
      return sendJson(res, 501, {
        error: 'Identity keyframe provider not configured yet.',
        warnings: ['Set OPENAI_IMAGE_MODEL with OPENAI_API_KEY, or REPLICATE_IDENTITY_KEYFRAME_MODEL with REPLICATE_API_TOKEN.'],
        finalPrompt,
      });
    }

    return sendJson(res, 200, {
      keyframeUrl: result.keyframeUrl,
      finalPrompt,
      provider: result.provider,
      model: result.model,
      warnings: [],
      rawOutput: result.rawOutput,
    });
  } catch (error) {
    console.error('LUMORA IDENTITY KEYFRAME ERROR:', error);
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Identity keyframe generation failed.',
      details: safeJsonValue(record.details ?? error),
      provider: typeof record.provider === 'string' ? record.provider : null,
      model: typeof record.model === 'string' ? record.model : null,
    });
  }
}
