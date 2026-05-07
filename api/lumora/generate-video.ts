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
type GenerationMode = 'self-reference-video' | 'image-to-video' | 'text-to-video-fallback';

type GenerateVideoBody = {
  prompt?: unknown;
  characterDescription?: unknown;
  referenceImageUrl?: unknown;
  referenceImages?: unknown;
  referenceImageUrls?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  style?: unknown;
  camera?: unknown;
  mood?: unknown;
  audio?: unknown;
  provider?: unknown;
  engine?: unknown;
  generationMode?: unknown;
};

type ReplicateClient = {
  run: (model: ReplicateModelIdentifier, options: { input: Record<string, unknown> }) => Promise<unknown>;
};

type ReplicateRunResult = {
  videoUrl: string;
  model: ReplicateModelIdentifier;
  rawOutput: unknown;
  attempts: unknown[];
  durationSent: number | null;
};

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') return undefined;

  if (value instanceof URL) return value.toString();

  if (value instanceof Error) {
    const errorRecord: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };

    for (const key of Object.getOwnPropertyNames(value)) {
      if (!(key in errorRecord)) {
        errorRecord[key] = safeJsonValue((value as unknown as Record<string, unknown>)[key], seen);
      }
    }

    return errorRecord;
  }

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
  try {
    res.end(JSON.stringify(safePayload));
  } catch {
    res.end(JSON.stringify({ error: 'Unable to serialize JSON response.' }));
  }
}

async function readBody(req: VercelRequest): Promise<GenerateVideoBody> {
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

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GenerateVideoBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function publicImageUrl(value: unknown): string {
  const url = textValue(value);
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('file:')) return '';
  return url;
}

function referenceUrlMap(value: unknown): Record<string, string> {
  const record = objectRecord(value);
  const nested = objectRecord(record.referenceImageUrls);
  const source = Object.keys(nested).length > 0 ? nested : record;
  const aliases: Record<string, string[]> = {
    frontFace: ['frontFace', 'front', 'face', 'primary'],
    fullBody: ['fullBody', 'body', 'full'],
    leftAngle: ['leftAngle', 'left'],
    rightAngle: ['rightAngle', 'right'],
    expressive: ['expressive', 'expression'],
  };

  return Object.fromEntries(
    Object.entries(aliases).flatMap(([slot, keys]) => {
      const url = keys.map((key) => publicImageUrl(source[key])).find(Boolean);
      return url ? [[slot, url]] : [];
    }),
  );
}

function firstReferenceImageUrl(body: GenerateVideoBody): string {
  const explicit = publicImageUrl(body.referenceImageUrl);
  if (explicit) return explicit;

  const urls = referenceUrlMap(body.referenceImageUrls);
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl).find(Boolean)
    : '';

  return (
    urls.frontFace ||
    urls.fullBody ||
    urls.leftAngle ||
    urls.rightAngle ||
    urls.expressive ||
    Object.values(urls).find(Boolean) ||
    referenceImages ||
    ''
  );
}

function normalizeAspectRatio(value: unknown): string {
  const aspectRatio = textValue(value);
  return ['9:16', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '9:16';
}

function normalizeDuration(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(textValue(value));
  if (!Number.isFinite(numericValue)) return 8;
  return Math.min(20, Math.max(1, Math.round(numericValue)));
}

function generationModeFor(bodyMode: unknown, referenceImageUrl: string): GenerationMode {
  const requestedMode = textValue(bodyMode);
  if (!referenceImageUrl) return 'text-to-video-fallback';
  if (requestedMode === 'image-to-video') return 'image-to-video';
  return 'self-reference-video';
}

function buildFinalPrompt(input: {
  prompt: string;
  characterDescription: string;
  referenceImageUrl: string;
  style: string;
  camera: string;
  mood: string;
  aspectRatio: string;
}) {
  const identityInstruction = input.referenceImageUrl
    ? 'Use the reference image as the identity source. Preserve the same person, face shape, hairstyle, hair color, skin tone, makeup style, and overall appearance. Do not change identity. Keep the person consistent across frames.'
    : 'Text-only fallback, likeness not guaranteed. Follow the saved self-character traits as closely as possible.';

  return [
    identityInstruction,
    input.characterDescription,
    input.prompt,
    input.style ? `Style: ${input.style}` : '',
    input.camera ? `Camera: ${input.camera}` : '',
    input.mood ? `Mood: ${input.mood}` : '',
    input.aspectRatio === '9:16' ? 'vertical video' : `${input.aspectRatio} video`,
    'cinematic lighting, realistic motion, high detail, TikTok style',
  ]
    .filter(Boolean)
    .join(', ');
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.toString();
  return null;
}

async function outputUrl(output: unknown): Promise<string | null> {
  const directUrl = maybeUrl(output);
  if (directUrl) return directUrl;

  if (Array.isArray(output)) {
    for (const item of output) {
      const itemUrl = await outputUrl(item);
      if (itemUrl) return itemUrl;
    }
    return null;
  }

  if (!output || typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  for (const key of ['videoUrl', 'video', 'output', 'url']) {
    const value = record[key];
    const url = maybeUrl(value);
    if (url) return url;

    if (typeof value === 'function') {
      try {
        const resolvedValue = await value.call(output);
        const resolvedUrl = maybeUrl(resolvedValue) ?? await outputUrl(resolvedValue);
        if (resolvedUrl) return resolvedUrl;
      } catch (error) {
        console.warn('Unable to read Replicate output URL:', error);
      }
    }

    if (value && typeof value === 'object') {
      const nestedUrl = await outputUrl(value);
      if (nestedUrl) return nestedUrl;
    }
  }

  return null;
}

function imageToVideoModel(): ReplicateModelIdentifier {
  return (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || 'kwaivgi/kling-v2.1') as ReplicateModelIdentifier;
}

function imageToVideoFallbackModel(): ReplicateModelIdentifier {
  return (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL_FALLBACK || 'kwaivgi/kling-v2.5-turbo-pro') as ReplicateModelIdentifier;
}

function textToVideoModel(): ReplicateModelIdentifier {
  return (process.env.REPLICATE_VIDEO_MODEL || 'luma/ray-2-720p') as ReplicateModelIdentifier;
}

function imageInputs(input: {
  finalPrompt: string;
  referenceImageUrl: string;
}): Array<{ label: string; input: Record<string, unknown> }> {
  return [
    {
      label: 'start_image-minimal',
      input: {
        prompt: input.finalPrompt,
        start_image: input.referenceImageUrl,
      },
    },
  ];
}

function textFallbackInput(input: {
  finalPrompt: string;
  aspectRatio: string;
  duration: number;
  model: ReplicateModelIdentifier;
}) {
  if (input.model.includes('zeroscope')) {
    return { prompt: input.finalPrompt };
  }

  return {
    prompt: input.finalPrompt,
    duration: replicateTextModelDuration(input.model, input.duration),
    aspect_ratio: input.aspectRatio,
    loop: false,
  };
}

function normalizeLumaDuration(duration: number): 5 | 9 {
  return duration <= 5 ? 5 : 9;
}

function replicateTextModelDuration(model: ReplicateModelIdentifier, duration: number): number {
  const modelSlug = model.toLowerCase();

  if (modelSlug.includes('luma/ray-2')) {
    return normalizeLumaDuration(duration);
  }

  return duration;
}

function modelErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes('credit') || lower.includes('billing') || lower.includes('payment')) {
    return 'Replicate generation failed because billing, credits, or payment setup needs attention.';
  }
  return message;
}

function isBillingOrCreditError(error: unknown): boolean {
  const lower = JSON.stringify(safeJsonValue(error) ?? '').toLowerCase();
  return lower.includes('credit') || lower.includes('billing') || lower.includes('payment');
}

function isInputValidationError(error: unknown): boolean {
  const lower = JSON.stringify(safeJsonValue(error) ?? '').toLowerCase();
  return (
    lower.includes('validation') ||
    lower.includes('start_image') ||
    lower.includes('invalid input') ||
    lower.includes('input schema') ||
    lower.includes('schema')
  );
}

async function runImageConditionedReplicate(input: {
  replicate: ReplicateClient;
  finalPrompt: string;
  referenceImageUrl: string;
}) {
  const primaryModel = imageToVideoModel();
  const fallbackModel = imageToVideoFallbackModel();
  const models = Array.from(new Set([primaryModel, fallbackModel]));
  const attempts: unknown[] = [];

  for (const model of models) {
    for (const adapter of imageInputs(input)) {
      try {
        console.log('LUMORA PROVIDER', {
          provider: 'replicate',
          model,
          adapter: adapter.label,
          mode: 'image-to-video',
        });

        const output = await input.replicate.run(model, { input: adapter.input });
        const videoUrl = await outputUrl(output);

        attempts.push({
          model,
          adapter: adapter.label,
          inputKeys: Object.keys(adapter.input),
          success: Boolean(videoUrl),
        });

        if (videoUrl) {
          return {
            videoUrl,
            model,
            rawOutput: output,
            attempts,
            durationSent: null,
          } satisfies ReplicateRunResult;
        }

        attempts.push({
          model,
          adapter: adapter.label,
          error: 'No video URL returned',
          rawOutput: safeJsonValue(output),
        });
      } catch (error) {
        console.error('REPLICATE IMAGE MODEL ERROR:', error);
        attempts.push({
          model,
          adapter: adapter.label,
          error: modelErrorMessage(error),
          details: safeJsonValue(error),
        });

        if (isBillingOrCreditError(error)) {
          throw Object.assign(new Error(modelErrorMessage(error)), {
            provider: 'replicate',
            model,
            details: safeJsonValue(error),
            attempts,
          });
        }

        if (isInputValidationError(error)) {
          throw Object.assign(new Error('Kling image-to-video rejected start_image input.'), {
            provider: 'replicate',
            model,
            details: safeJsonValue(error),
            attempts,
          });
        }
      }
    }
  }

  throw Object.assign(new Error('Replicate image-to-video generation failed.'), {
    provider: 'replicate',
    model: primaryModel,
    details: attempts,
  });
}

async function runTextFallbackReplicate(input: {
  replicate: ReplicateClient;
  finalPrompt: string;
  aspectRatio: string;
  duration: number;
}) {
  const model = textToVideoModel();
  const requestInput = textFallbackInput({
    finalPrompt: input.finalPrompt,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    model,
  });

  console.log('LUMORA PROVIDER', {
    provider: 'replicate',
    model,
    mode: 'text-to-video-fallback',
    requestedDuration: input.duration,
    modelDuration: requestInput.duration ?? null,
  });

  try {
    const output = await input.replicate.run(model, { input: requestInput });
    const videoUrl = await outputUrl(output);
    if (!videoUrl) {
      throw new Error(`No video URL returned. Raw output: ${JSON.stringify(safeJsonValue(output))}`);
    }

    return {
      videoUrl,
      model,
      rawOutput: output,
      attempts: [
        {
          model,
          inputKeys: Object.keys(requestInput),
          success: true,
        },
      ],
      durationSent: requestInput.duration ?? null,
    } satisfies ReplicateRunResult;
  } catch (error) {
    console.error('REPLICATE TEXT FALLBACK ERROR:', error);
    throw Object.assign(new Error(modelErrorMessage(error)), {
      provider: 'replicate',
      model,
      details: safeJsonValue(error),
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('LUMORA GENERATE START');

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    let body: GenerateVideoBody;
    try {
      body = await readBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: 'Invalid JSON body',
        details: safeJsonValue(error),
      });
    }

    const prompt = textValue(body.prompt);
    if (!prompt) {
      return sendJson(res, 400, { error: 'Missing prompt' });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return sendJson(res, 500, { error: 'Missing REPLICATE_API_TOKEN' });
    }

    const referenceImageUrl = firstReferenceImageUrl(body);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const duration = normalizeDuration(body.duration);
    const generationMode = generationModeFor(body.generationMode, referenceImageUrl);
    console.log('LUMORA REFERENCE ROUTING', {
      hasReferenceImage: Boolean(referenceImageUrl),
      generationMode,
      referenceImageUrlPreview: referenceImageUrl ? `${referenceImageUrl.slice(0, 64)}${referenceImageUrl.length > 64 ? '...' : ''}` : null,
    });
    const warnings = [
      referenceImageUrl
        ? ''
        : 'Add a self-character reference photo for accurate likeness. Text-only fallback, likeness not guaranteed.',
      body.provider && textValue(body.provider) !== 'replicate'
        ? 'Self-character likeness generation currently routes through Replicate image-to-video models.'
        : '',
    ].filter(Boolean);
    const finalPrompt = buildFinalPrompt({
      prompt,
      characterDescription: textValue(body.characterDescription),
      referenceImageUrl,
      style: textValue(body.style),
      camera: textValue(body.camera),
      mood: textValue(body.mood),
      aspectRatio,
    });

    const { default: Replicate } = await import('replicate');
    const replicate = new Replicate({ auth: token }) as ReplicateClient;

    const result = referenceImageUrl
      ? await runImageConditionedReplicate({
          replicate,
          finalPrompt,
          referenceImageUrl,
        })
      : await runTextFallbackReplicate({
          replicate,
          finalPrompt,
          aspectRatio,
          duration,
        });

    console.log('FINAL VIDEO URL:', result.videoUrl);

    return sendJson(res, 200, {
      success: true,
      videoUrl: result.videoUrl,
      provider: 'replicate',
      model: result.model,
      displayEngine: referenceImageUrl ? 'kling' : 'text-to-video-fallback',
      generationMode,
      generationModeUsed: generationMode,
      hasReferenceImage: Boolean(referenceImageUrl),
      modelUsed: result.model,
      durationSent: result.durationSent,
      referenceImageUrl: referenceImageUrl || null,
      finalPrompt,
      warnings,
      rawOutput: {
        provider: safeJsonValue(result.rawOutput),
        attempts: result.attempts,
      },
    });
  } catch (error) {
    console.error('LUMORA GENERATE ERROR:', error);
    const errorRecord = objectRecord(error);

    return sendJson(res, 500, {
      error: errorMessage(error),
      details: safeJsonValue(errorRecord.details ?? error),
      stack: errorStack(error),
      provider: textValue(errorRecord.provider) || 'replicate',
      model: textValue(errorRecord.model) || null,
      suggestion: isBillingOrCreditError(error)
        ? 'Check Replicate billing, credits, or API token access.'
        : 'If the image-to-video model rejected the reference image input, try the fallback model or inspect details for the exact Replicate error.',
    });
  }
}
