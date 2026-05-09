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

type GenerateVideoBody = {
  prompt?: unknown;
  identityId?: unknown;
  identityPrompt?: unknown;
  consistencyPrompt?: unknown;
  generationConsistencyPrompt?: unknown;
  characterDescription?: unknown;
  keyframeUrl?: unknown;
  referenceImageUrl?: unknown;
  referenceImages?: unknown;
  additionalReferenceImageUrls?: unknown;
  canonicalReferenceSet?: unknown;
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
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('localhost') || lowerUrl.includes('undefined')) return '';
  const cleanUrl = url.split('?')[0];
  if (url.includes('expires=') || url.includes('token=')) {
    console.log('REFERENCE URL HAD TEMP QUERY, USING CLEAN URL:', cleanUrl);
  }
  return cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') ? cleanUrl : '';
}

function referenceUrlMap(value: unknown): Record<string, string> {
  const record = objectRecord(value);
  const nested = objectRecord(record.referenceImageUrls);
  const source = Object.keys(nested).length > 0 ? nested : record;
  const aliases: Record<string, string[]> = {
    manualReferenceImageUrl: ['manualReferenceImageUrl'],
    frontFace: ['frontFaceUrl', 'frontFace', 'frontImageUrl', 'frontImage', 'front', 'face', 'primary'],
    fullBody: ['fullBodyUrl', 'fullBody', 'body', 'full'],
    leftAngle: ['leftAngleUrl', 'leftAngle', 'left'],
    rightAngle: ['rightAngleUrl', 'rightAngle', 'right'],
    expressive: ['expressiveUrl', 'expressive', 'expression'],
  };

  return Object.fromEntries(
    Object.entries(aliases).flatMap(([slot, keys]) => {
      const url = keys.map((key) => publicImageUrl(source[key])).find(Boolean);
      return url ? [[slot, url]] : [];
    }),
  );
}

function firstReferenceImageUrl(body: GenerateVideoBody): string {
  const keyframe = publicImageUrl(body.keyframeUrl);
  if (keyframe) return keyframe;

  const explicit = publicImageUrl(body.referenceImageUrl);
  if (explicit) return explicit;

  const urls = referenceUrlMap(body.referenceImageUrls);
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl).find(Boolean)
    : '';

  return (
    urls.manualReferenceImageUrl ||
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

function additionalReferenceImageUrls(body: GenerateVideoBody, primaryReference: string): string[] {
  const urls = referenceUrlMap(body.referenceImageUrls);
  const explicitAdditional = Array.isArray(body.additionalReferenceImageUrls)
    ? body.additionalReferenceImageUrls.map(publicImageUrl)
    : [];
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl)
    : [];
  const canonicalReferences = Array.isArray(body.canonicalReferenceSet)
    ? body.canonicalReferenceSet.map(publicImageUrl)
    : [];
  const candidates = [
    ...canonicalReferences,
    ...explicitAdditional,
    urls.leftAngle,
    urls.rightAngle,
    urls.fullBody,
    ...referenceImages,
  ];
  const seen = new Set<string>();

  return candidates.flatMap((url) => {
    if (!url || url === primaryReference || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function normalizeAspectRatio(value: unknown): string {
  const aspectRatio = textValue(value);
  return ['9:16', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '9:16';
}

function buildFinalPrompt(input: {
  prompt: string;
  characterDescription: string;
  identityPrompt: string;
  consistencyPrompt: string;
  style: string;
  camera: string;
  mood: string;
  aspectRatio: string;
}) {
  return [
    input.consistencyPrompt || 'Create a new photorealistic character render based on the provided identity references. Do not simply animate or copy the source photo. Use the references only to preserve identity: face shape, hair color, hairstyle, skin tone, eye area, proportions, makeup style, and overall likeness. Place this same person into the requested new scene.',
    input.identityPrompt ? `Identity prompt: ${input.identityPrompt}` : '',
    `${input.characterDescription} ${input.prompt}`.trim(),
    input.style ? `Style: ${input.style}` : '',
    input.camera ? `Camera: ${input.camera}` : '',
    input.mood ? `Mood: ${input.mood}` : '',
    input.aspectRatio === '9:16' ? 'vertical video' : `${input.aspectRatio} video`,
    'Cinematic lighting, realistic motion, high detail.',
  ]
    .filter(Boolean)
    .join('\n\n');
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

function isValidHttpUrl(url: string) {
  return typeof url === 'string' &&
    url.startsWith('https://');
}

async function validateReferenceImageUrl(referenceImageUrl: string): Promise<{
  ok: boolean;
  status: number | null;
  contentType: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    console.log('VALIDATING REFERENCE URL', { referenceImageUrl, method: 'HEAD' });
    const response = await fetch(referenceImageUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const validation = {
      ok: response.status === 200 && contentType.toLowerCase().startsWith('image/'),
      status: response.status,
      contentType,
    };

    console.log('VALIDATION RESULT', {
      referenceImageUrl,
      status: validation.status,
      contentType: validation.contentType,
      ok: validation.ok,
    });

    return validation;
  } catch (error) {
    console.log('VALIDATION RESULT', {
      referenceImageUrl,
      ok: false,
      error: errorMessage(error),
    });

    return {
      ok: false,
      status: null,
      contentType: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runReplicate(input: {
  replicate: ReplicateClient;
  model: ReplicateModelIdentifier;
  requestInput: Record<string, unknown>;
  durationSent: number | null;
  generationModeUsed: 'identity-keyframe-to-video' | 'reference-photo-animation-fallback';
  referenceImageUrl: string;
}) {
  console.log('LUMORA PROVIDER', {
    provider: 'replicate',
    model: input.model,
    mode: input.generationModeUsed,
    inputKeys: Object.keys(input.requestInput),
  });

  if (input.generationModeUsed) {
    console.log('SENDING IMAGE TO KLING:', input.referenceImageUrl);
  }

  const attempts: unknown[] = [];
  const shouldTryStartImageOnly =
    Array.isArray(input.requestInput.reference_images) &&
    input.requestInput.reference_images.length > 0;
  const requestInputs = shouldTryStartImageOnly
    ? [
        input.requestInput,
        Object.fromEntries(
          Object.entries(input.requestInput).filter(([key]) => key !== 'reference_images'),
        ),
      ]
    : [input.requestInput];

  for (const [index, requestInput] of requestInputs.entries()) {
    try {
      const output = await input.replicate.run(input.model, { input: requestInput });
      const videoUrl = await outputUrl(output);
      if (!videoUrl) {
        throw new Error(`No video URL returned. Raw output: ${JSON.stringify(safeJsonValue(output))}`);
      }

      attempts.push({
        model: input.model,
        inputKeys: Object.keys(requestInput),
        success: true,
      });

      return {
        videoUrl,
        model: input.model,
        rawOutput: output,
        attempts,
        durationSent: input.durationSent,
      } satisfies ReplicateRunResult;
    } catch (error) {
      console.error('REPLICATE ERROR:', error);
      attempts.push({
        model: input.model,
        inputKeys: Object.keys(requestInput),
        success: false,
        details: safeJsonValue(error),
      });

      if (index < requestInputs.length - 1) {
        console.warn('Kling rejected reference_images; retrying with start_image only.');
        continue;
      }

      throw Object.assign(new Error(modelErrorMessage(error)), {
        provider: 'replicate',
        model: input.model,
        details: {
          error: safeJsonValue(error),
          attempts,
        },
      });
    }
  }

  throw new Error('Replicate generation failed without a completed attempt.');
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
    const keyframeUrl = publicImageUrl(body.keyframeUrl);
    const additionalReferences = additionalReferenceImageUrls(body, referenceImageUrl);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const finalPrompt = buildFinalPrompt({
      prompt,
      characterDescription: textValue(body.characterDescription),
      identityPrompt: textValue(body.identityPrompt),
      consistencyPrompt: textValue(body.consistencyPrompt) || textValue(body.generationConsistencyPrompt),
      style: textValue(body.style),
      camera: textValue(body.camera),
      mood: textValue(body.mood),
      aspectRatio,
    });
    const promptForModel = finalPrompt;

    console.log('FINAL INPUT:', {
      prompt: promptForModel,
      referenceImageUrl,
      keyframeUrl,
      additionalReferences,
    });

    if (!isValidHttpUrl(referenceImageUrl)) {
      return sendJson(res, 400, {
        error: 'Invalid reference image URL',
        received: referenceImageUrl,
      });
    }

    for (const additionalReference of additionalReferences) {
      if (!isValidHttpUrl(additionalReference)) {
        return sendJson(res, 400, {
          error: 'Invalid additional reference image URL',
          received: additionalReference,
        });
      }
    }

    const referenceValidation = await validateReferenceImageUrl(referenceImageUrl);
    if (!referenceValidation.ok) {
      return sendJson(res, 400, {
        error: 'Reference image not accessible',
        referenceImageUrl,
        status: referenceValidation.status,
        contentType: referenceValidation.contentType,
      });
    }

    for (const additionalReference of additionalReferences) {
      const additionalValidation = await validateReferenceImageUrl(additionalReference);
      if (!additionalValidation.ok) {
        return sendJson(res, 400, {
          error: 'Additional reference image not accessible',
          referenceImageUrl: additionalReference,
          status: additionalValidation.status,
          contentType: additionalValidation.contentType,
        });
      }
    }

    const model = (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || 'kwaivgi/kling-v2.1') as ReplicateModelIdentifier;
    const requestInput = {
      prompt: promptForModel,
      start_image: referenceImageUrl,
      ...(additionalReferences.length ? { reference_images: additionalReferences } : {}),
    };
    const generationModeUsed = keyframeUrl ? 'identity-keyframe-to-video' : 'reference-photo-animation-fallback';

    console.log('GENERATION DEBUG', {
      referenceImageUrl,
      additionalReferences,
      modelUsed: model,
      finalPrompt: promptForModel,
      generationModeUsed,
      identityId: textValue(body.identityId),
    });
    console.log('FINAL INPUT SENT TO KLING', requestInput);

    const { default: Replicate } = await import('replicate');
    const replicate = new Replicate({ auth: token }) as ReplicateClient;

    const result = await runReplicate({
      replicate,
      model,
      requestInput,
      durationSent: null,
      generationModeUsed,
      referenceImageUrl,
    });

    console.log('FINAL VIDEO URL:', result.videoUrl);

    return sendJson(res, 200, {
      success: true,
      videoUrl: result.videoUrl,
      provider: 'replicate',
      model: result.model,
      displayEngine: generationModeUsed,
      generationMode: generationModeUsed,
      generationModeUsed,
      hasReferenceImage: true,
      modelUsed: result.model,
      durationSent: result.durationSent,
      identityId: textValue(body.identityId) || null,
      keyframeUrl: keyframeUrl || null,
      referenceImageUrl,
      additionalReferenceImageUrls: additionalReferences,
      finalPrompt: promptForModel,
      warnings: [],
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
