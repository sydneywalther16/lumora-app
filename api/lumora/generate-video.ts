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
  userId?: unknown;
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

type GenerationModeUsed =
  | 'seedance-identity'
  | 'identity-keyframe-to-video'
  | 'reference-photo-animation-fallback';

const SEEDANCE_MODEL = 'bytedance/seedance-2.0' as ReplicateModelIdentifier;
const KLING_IMAGE_TO_VIDEO_MODEL = 'kwaivgi/kling-v2.1' as ReplicateModelIdentifier;
const KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL = 'kwaivgi/kling-v2.5-turbo-pro' as ReplicateModelIdentifier;
const SEEDANCE_IDENTITY_PROMPT =
  'Use the provided reference images only as identity references. Do not animate or copy any single source image. Generate a new photorealistic person matching the same identity in the requested scene.';
const SAFE_IDENTITY_PROMPT_PREFIX =
  'Create a safe, fully clothed, photorealistic cinematic video of the identity reference person. Preserve likeness. No nudity, no sexual content, no minors, no suggestive posing.';
const SAFE_PROMPT_REPLACEMENT = 'stylish, cinematic, confident, editorial, fashion-inspired';
const SENSITIVE_FILTER_ERROR = 'Generation blocked by provider safety filter';
const SENSITIVE_FILTER_SUGGESTION =
  'Try a safer prompt: fully clothed, cinematic, editorial, non-suggestive.';
const PROVIDER_QUEUE_BUSY_MESSAGE = 'Provider queue is busy. Retrying generation...';
const KLING_FALLBACK_DELAY_MS = 5_000;
const KLING_SECONDARY_FALLBACK_DELAY_MS = 8_000;
const DEFAULT_REPLICATE_RETRY_AFTER_MS = 6_000;
const sensitivePromptTerms = [
  'sexy',
  'nude',
  'nudity',
  'lingerie',
  'onlyfans',
  'seducing',
  'seductive',
  'provocative',
  'adult',
] as const;

type LumoraGenerationGlobals = typeof globalThis & {
  __lumoraActiveGenerationUsers?: Set<string>;
  __lumoraReplicatePredictionQueue?: Promise<unknown>;
};

const lumoraGenerationGlobals = globalThis as LumoraGenerationGlobals;
const activeGenerationUsers =
  lumoraGenerationGlobals.__lumoraActiveGenerationUsers ??= new Set<string>();

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizePromptText(value: string): string {
  let sanitized = value;

  for (const term of sensitivePromptTerms) {
    sanitized = sanitized.replace(
      new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'),
      SAFE_PROMPT_REPLACEMENT,
    );
  }

  return sanitized
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function activeGenerationUserKey(body: GenerateVideoBody): string {
  return (
    textValue(body.userId) ||
    textValue(body.identityId) ||
    'local'
  ).toLowerCase();
}

function acquireActiveGeneration(userKey: string): boolean {
  if (activeGenerationUsers.has(userKey)) return false;
  activeGenerationUsers.add(userKey);
  return true;
}

function releaseActiveGeneration(userKey: string) {
  activeGenerationUsers.delete(userKey);
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

function uniqueHttpUrls(values: string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((url) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function seedanceReferenceImages(body: GenerateVideoBody): string[] {
  const urls = referenceUrlMap(body.referenceImageUrls);
  const explicitReferences = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl)
    : [];
  const canonicalReferences = Array.isArray(body.canonicalReferenceSet)
    ? body.canonicalReferenceSet.map(publicImageUrl)
    : [];

  return uniqueHttpUrls([
    urls.frontFace,
    urls.leftAngle,
    urls.rightAngle,
    urls.fullBody,
    ...explicitReferences,
    ...canonicalReferences,
  ]);
}

function normalizeAspectRatio(value: unknown): string {
  const aspectRatio = textValue(value);
  return ['9:16', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '9:16';
}

function normalizeDuration(value: unknown): number {
  const duration = typeof value === 'number'
    ? value
    : Number.parseInt(textValue(value), 10);

  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 8;
}

function isSeedanceEngine(body: GenerateVideoBody): boolean {
  const engine = textValue(body.engine).toLowerCase();
  return engine === 'seedance-2.0' || engine === 'seedance';
}

function buildFinalPrompt(input: {
  prompt: string;
  characterDescription: string;
  identityPrompt: string;
  consistencyPrompt: string;
  engine: string;
  style: string;
  camera: string;
  mood: string;
  aspectRatio: string;
}) {
  const consistencyPrompt = input.consistencyPrompt || (input.engine === 'seedance-2.0'
      ? SEEDANCE_IDENTITY_PROMPT
      : 'Create a new photorealistic character render based on the provided identity references. Do not simply animate or copy the source photo. Use the references only to preserve identity: face shape, hair color, hairstyle, skin tone, eye area, proportions, makeup style, and overall likeness. Place this same person into the requested new scene.');

  return [
    SAFE_IDENTITY_PROMPT_PREFIX,
    sanitizePromptText(consistencyPrompt),
    input.identityPrompt ? `Identity prompt: ${sanitizePromptText(input.identityPrompt)}` : '',
    sanitizePromptText(`${input.characterDescription} ${input.prompt}`.trim()),
    input.style ? `Style: ${sanitizePromptText(input.style)}` : '',
    input.camera ? `Camera: ${sanitizePromptText(input.camera)}` : '',
    input.mood ? `Mood: ${sanitizePromptText(input.mood)}` : '',
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

function isSensitiveFilterError(error: unknown): boolean {
  const lower = [
    errorMessage(error),
    JSON.stringify(safeJsonValue(error) ?? ''),
  ].join(' ').toLowerCase();

  return (
    lower.includes('flagged as sensitive') ||
    lower.includes('e005') ||
    lower.includes('sensitive')
  );
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function retryAfterMillisecondsFromValue(value: unknown): number | null {
  const seconds = numericValue(value);
  if (seconds !== null && seconds >= 0) return Math.ceil(seconds * 1_000);

  if (typeof value === 'string' && value.trim()) {
    const retryDate = Date.parse(value);
    if (Number.isFinite(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }

  return null;
}

function headerRetryAfterMilliseconds(headers: unknown): number | null {
  if (!headers) return null;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const retryAfter = getter.call(headers, 'retry-after') ?? getter.call(headers, 'Retry-After');
    const parsed = retryAfterMillisecondsFromValue(retryAfter);
    if (parsed !== null) return parsed;
  }

  const headerRecord = objectRecord(headers);
  return retryAfterMillisecondsFromValue(
    headerRecord['retry-after'] ??
      headerRecord['Retry-After'] ??
      headerRecord.retry_after ??
      headerRecord.retryAfter,
  );
}

function retryAfterMilliseconds(error: unknown): number | null {
  const record = objectRecord(error);
  const response = objectRecord(record.response);
  const details = objectRecord(record.details);
  const detailError = objectRecord(details.error);
  const detailResponse = objectRecord(detailError.response);

  const directCandidates = [
    record.retry_after,
    record.retryAfter,
    record.retryAfterSeconds,
    record['retry-after'],
    response.retry_after,
    response.retryAfter,
    response.retryAfterSeconds,
    response['retry-after'],
    detailError.retry_after,
    detailError.retryAfter,
    detailError.retryAfterSeconds,
    detailError['retry-after'],
    detailResponse.retry_after,
    detailResponse.retryAfter,
    detailResponse.retryAfterSeconds,
    detailResponse['retry-after'],
  ];

  for (const candidate of directCandidates) {
    const parsed = retryAfterMillisecondsFromValue(candidate);
    if (parsed !== null) return parsed;
  }

  const serializedError = JSON.stringify(safeJsonValue(error) ?? '');
  const serializedRetryAfter = serializedError.match(/retry[_ -]?after["'\s:=]+(\d+(?:\.\d+)?)/i);
  if (serializedRetryAfter?.[1]) {
    const parsed = retryAfterMillisecondsFromValue(serializedRetryAfter[1]);
    if (parsed !== null) return parsed;
  }

  return (
    headerRetryAfterMilliseconds(record.headers) ??
    headerRetryAfterMilliseconds(response.headers) ??
    headerRetryAfterMilliseconds(detailError.headers) ??
    headerRetryAfterMilliseconds(detailResponse.headers)
  );
}

function errorStatusCode(error: unknown): number | null {
  const record = objectRecord(error);
  const response = objectRecord(record.response);
  const details = objectRecord(record.details);
  const detailError = objectRecord(details.error);
  const detailResponse = objectRecord(detailError.response);

  for (const candidate of [
    record.status,
    record.statusCode,
    record.code,
    response.status,
    response.statusCode,
    detailError.status,
    detailError.statusCode,
    detailError.code,
    detailResponse.status,
    detailResponse.statusCode,
  ]) {
    const numeric = numericValue(candidate);
    if (numeric !== null) return numeric;
  }

  return null;
}

function isRateLimitError(error: unknown): boolean {
  const lower = [
    errorMessage(error),
    JSON.stringify(safeJsonValue(error) ?? ''),
  ].join(' ').toLowerCase();

  return (
    errorStatusCode(error) === 429 ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('throttl')
  );
}

function uniqueModels(models: ReplicateModelIdentifier[]): ReplicateModelIdentifier[] {
  return Array.from(new Set(models));
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

async function enqueueReplicatePrediction<T>(operation: () => Promise<T>): Promise<T> {
  const queue = lumoraGenerationGlobals.__lumoraReplicatePredictionQueue ?? Promise.resolve();
  const queuedOperation = queue.then(operation, operation);
  lumoraGenerationGlobals.__lumoraReplicatePredictionQueue = queuedOperation.then(
    () => undefined,
    () => undefined,
  );
  return queuedOperation;
}

async function runReplicate(input: {
  replicate: ReplicateClient;
  model: ReplicateModelIdentifier;
  requestInput: Record<string, unknown>;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  referenceImageUrl: string;
  fallbackToStartImageOnly?: boolean;
}) {
  console.log('LUMORA PROVIDER', {
    provider: 'replicate',
    model: input.model,
    mode: input.generationModeUsed,
    inputKeys: Object.keys(input.requestInput),
  });

  if (input.generationModeUsed === 'seedance-identity') {
    console.log('SEEDANCE INPUT', input.requestInput);
  } else if (input.generationModeUsed) {
    console.log('SENDING IMAGE TO KLING:', input.referenceImageUrl);
  }

  const attempts: unknown[] = [];
  const shouldTryStartImageOnly =
    input.fallbackToStartImageOnly === true &&
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
      const output = await enqueueReplicatePrediction(() =>
        input.replicate.run(input.model, { input: requestInput }),
      );
      if (input.generationModeUsed === 'seedance-identity') {
        console.log('SEEDANCE RESPONSE', safeJsonValue(output));
      }
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
      const rateLimited = isRateLimitError(error);
      const retryAfterMs = retryAfterMilliseconds(error);
      console.error('REPLICATE ERROR:', error);
      if (rateLimited) {
        console.warn('THROTTLED:', {
          model: input.model,
          status: errorStatusCode(error) ?? 429,
          retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
        });
      }
      attempts.push({
        model: input.model,
        inputKeys: Object.keys(requestInput),
        success: false,
        rateLimited,
        retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
        details: safeJsonValue(error),
      });

      if (rateLimited) {
        throw Object.assign(new Error(modelErrorMessage(error)), {
          provider: 'replicate',
          model: input.model,
          rateLimited: true,
          retryAfterMs,
          retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
          details: {
            error: safeJsonValue(error),
            attempts,
          },
        });
      }

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

async function runReplicateWithRateLimitRetry(input: {
  replicate: ReplicateClient;
  model: ReplicateModelIdentifier;
  requestInput: Record<string, unknown>;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  referenceImageUrl: string;
  fallbackToStartImageOnly?: boolean;
}) {
  try {
    return await runReplicate(input);
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    const retryAfterMs = retryAfterMilliseconds(error) ?? DEFAULT_REPLICATE_RETRY_AFTER_MS;
    console.log('WAITING:', {
      reason: 'replicate-429',
      model: input.model,
      milliseconds: retryAfterMs,
      seconds: retryAfterMs / 1_000,
    });
    await sleep(retryAfterMs);
    console.warn('RETRYING MODEL:', {
      model: input.model,
      mode: input.generationModeUsed,
    });

    return await runReplicate(input);
  }
}

async function runKlingImageToVideo(input: {
  replicate: ReplicateClient;
  prompt: string;
  referenceImageUrl: string;
  additionalReferences: string[];
  primaryModel?: ReplicateModelIdentifier;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  fallbackFromModel?: ReplicateModelIdentifier;
  providerFallback?: boolean;
  safetyFallback?: boolean;
}) {
  const models = uniqueModels([
    input.primaryModel ?? KLING_IMAGE_TO_VIDEO_MODEL,
    KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
  ]);
  const failures: Array<{
    model: ReplicateModelIdentifier;
    safetyFiltered: boolean;
    details: unknown;
  }> = [];

  for (const [modelIndex, model] of models.entries()) {
    const isFirstProviderFallback = (input.providerFallback === true || input.safetyFallback === true) && modelIndex === 0;
    if (isFirstProviderFallback) {
      console.warn('SWITCHING PROVIDER:', {
        from: input.fallbackFromModel ?? SEEDANCE_MODEL,
        to: model,
      });
      console.log('WAITING:', {
        reason: 'kling-v2.1-fallback',
        milliseconds: KLING_FALLBACK_DELAY_MS,
        seconds: KLING_FALLBACK_DELAY_MS / 1_000,
      });
      await sleep(KLING_FALLBACK_DELAY_MS);
    } else if (modelIndex > 0) {
      console.warn('SWITCHING PROVIDER:', {
        from: models[modelIndex - 1],
        to: model,
      });
      console.log('WAITING:', {
        reason: 'kling-v2.5-fallback',
        milliseconds: KLING_SECONDARY_FALLBACK_DELAY_MS,
        seconds: KLING_SECONDARY_FALLBACK_DELAY_MS / 1_000,
      });
      await sleep(KLING_SECONDARY_FALLBACK_DELAY_MS);
    }

    const requestInput = {
      prompt: input.prompt,
      start_image: input.referenceImageUrl,
      ...(input.additionalReferences.length ? { reference_images: input.additionalReferences } : {}),
    };

    try {
      return await runReplicateWithRateLimitRetry({
        replicate: input.replicate,
        model,
        requestInput,
        durationSent: input.durationSent,
        generationModeUsed: input.generationModeUsed,
        referenceImageUrl: input.referenceImageUrl,
        fallbackToStartImageOnly: true,
      });
    } catch (error) {
      failures.push({
        model,
        safetyFiltered: isSensitiveFilterError(error),
        details: safeJsonValue(error),
      });
      console.warn('Kling image-to-video attempt failed', {
        model,
        safetyFiltered: isSensitiveFilterError(error),
        providerFallback: input.providerFallback ?? input.safetyFallback ?? false,
      });
    }
  }

  if (failures.length > 0 && failures.every((failure) => failure.safetyFiltered)) {
    throw Object.assign(new Error(SENSITIVE_FILTER_ERROR), {
      provider: 'replicate',
      model: failures[failures.length - 1]?.model ?? KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
      safetyFiltered: true,
      details: { attempts: failures },
    });
  }

  throw Object.assign(new Error('Kling image-to-video generation failed.'), {
    provider: 'replicate',
    model: failures[failures.length - 1]?.model ?? KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
    details: { attempts: failures },
  });
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

    const generationUserKey = activeGenerationUserKey(body);
    if (!acquireActiveGeneration(generationUserKey)) {
      return sendJson(res, 409, {
        error: PROVIDER_QUEUE_BUSY_MESSAGE,
      });
    }

    try {
    const engine = textValue(body.engine).toLowerCase() || 'replicate';
    const useSeedance = isSeedanceEngine(body);
    const seedanceReferences = seedanceReferenceImages(body);
    const referenceImageUrl = useSeedance
      ? seedanceReferences[0] ?? ''
      : firstReferenceImageUrl(body);
    const keyframeUrl = publicImageUrl(body.keyframeUrl);
    const additionalReferences = additionalReferenceImageUrls(body, referenceImageUrl);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const durationSent = normalizeDuration(body.duration);
    const finalPrompt = buildFinalPrompt({
      prompt,
      characterDescription: textValue(body.characterDescription),
      identityPrompt: textValue(body.identityPrompt),
      consistencyPrompt: textValue(body.consistencyPrompt) || textValue(body.generationConsistencyPrompt),
      engine,
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
      seedanceReferences,
      engine,
    });

    if (useSeedance) {
      if (seedanceReferences.length < 3) {
        return sendJson(res, 400, {
          error: 'Seedance 2.0 Identity requires front, left, and right reference images.',
          received: seedanceReferences,
          engine,
          model: SEEDANCE_MODEL,
        });
      }

      for (const seedanceReference of seedanceReferences) {
        if (!isValidHttpUrl(seedanceReference)) {
          return sendJson(res, 400, {
            error: 'Invalid Seedance reference image URL',
            received: seedanceReference,
            engine,
            model: SEEDANCE_MODEL,
          });
        }

        const validation = await validateReferenceImageUrl(seedanceReference);
        if (!validation.ok) {
          return sendJson(res, 400, {
            error: 'Seedance reference image not accessible',
            referenceImageUrl: seedanceReference,
            status: validation.status,
            contentType: validation.contentType,
            engine,
            model: SEEDANCE_MODEL,
          });
        }
      }

      const requestInput = {
        prompt: promptForModel,
        reference_images: seedanceReferences,
        duration: durationSent,
        aspect_ratio: aspectRatio,
      };

      console.log('GENERATION ENGINE USED', {
        engine: 'seedance-2.0',
        provider: 'replicate',
        model: SEEDANCE_MODEL,
      });
      console.log('SEEDANCE INPUT', requestInput);

      const { default: Replicate } = await import('replicate');
      const replicate = new Replicate({ auth: token }) as ReplicateClient;

      try {
        const result = await runReplicateWithRateLimitRetry({
          replicate,
          model: SEEDANCE_MODEL,
          requestInput,
          durationSent,
          generationModeUsed: 'seedance-identity',
          referenceImageUrl,
          fallbackToStartImageOnly: false,
        });

        console.log('FINAL VIDEO URL:', result.videoUrl);

        return sendJson(res, 200, {
          success: true,
          videoUrl: result.videoUrl,
          provider: 'replicate',
          model: result.model,
          displayEngine: 'seedance',
          generationMode: 'seedance-identity',
          generationModeUsed: 'seedance-identity',
          hasReferenceImage: true,
          modelUsed: result.model,
          durationSent: result.durationSent,
          identityId: textValue(body.identityId) || null,
          keyframeUrl: null,
          referenceImageUrl,
          referenceImages: seedanceReferences,
          additionalReferenceImageUrls: seedanceReferences.slice(1),
          finalPrompt: promptForModel,
          warnings: [],
          rawOutput: {
            provider: safeJsonValue(result.rawOutput),
            attempts: result.attempts,
          },
        });
      } catch (seedanceError) {
        const seedanceSafetyFiltered = isSensitiveFilterError(seedanceError);
        const seedanceRateLimited = isRateLimitError(seedanceError);
        if (!seedanceSafetyFiltered && !seedanceRateLimited) {
          throw seedanceError;
        }

        console.warn('Seedance generation switched to Kling image-to-video fallback.', {
          model: SEEDANCE_MODEL,
          referenceImageUrl,
          safetyFiltered: seedanceSafetyFiltered,
          rateLimited: seedanceRateLimited,
        });

        const fallbackResult = await runKlingImageToVideo({
          replicate,
          prompt: promptForModel,
          referenceImageUrl,
          additionalReferences: [],
          primaryModel: KLING_IMAGE_TO_VIDEO_MODEL,
          durationSent: null,
          generationModeUsed: 'reference-photo-animation-fallback',
          fallbackFromModel: SEEDANCE_MODEL,
          providerFallback: true,
        });

        console.log('FINAL VIDEO URL:', fallbackResult.videoUrl);

        return sendJson(res, 200, {
          success: true,
          videoUrl: fallbackResult.videoUrl,
          provider: 'replicate',
          model: fallbackResult.model,
          displayEngine: 'kling safety fallback',
          generationMode: 'reference-photo-animation-fallback',
          generationModeUsed: 'reference-photo-animation-fallback',
          hasReferenceImage: true,
          modelUsed: fallbackResult.model,
          durationSent: fallbackResult.durationSent,
          identityId: textValue(body.identityId) || null,
          keyframeUrl: null,
          referenceImageUrl,
          referenceImages: [referenceImageUrl],
          additionalReferenceImageUrls: [],
          finalPrompt: promptForModel,
          warnings: [
            seedanceRateLimited
              ? PROVIDER_QUEUE_BUSY_MESSAGE
              : 'Provider safety filter blocked Seedance, so Lumora used Kling image-to-video with the same saved reference.',
          ],
          rawOutput: {
            fallbackFrom: {
              provider: 'replicate',
              model: SEEDANCE_MODEL,
              error: safeJsonValue(seedanceError),
            },
            provider: safeJsonValue(fallbackResult.rawOutput),
            attempts: fallbackResult.attempts,
          },
        });
      }
    }

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

    const model = (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || KLING_IMAGE_TO_VIDEO_MODEL) as ReplicateModelIdentifier;
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
    console.log('GENERATION ENGINE USED', {
      engine: 'kling',
      provider: 'replicate',
      model,
    });
    console.log('FINAL INPUT SENT TO KLING', requestInput);

    const { default: Replicate } = await import('replicate');
    const replicate = new Replicate({ auth: token }) as ReplicateClient;

    const result = await runKlingImageToVideo({
      replicate,
      prompt: promptForModel,
      referenceImageUrl,
      additionalReferences,
      primaryModel: model,
      durationSent: null,
      generationModeUsed,
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
    } finally {
      releaseActiveGeneration(generationUserKey);
    }
  } catch (error) {
    console.error('LUMORA GENERATE ERROR:', error);
    const errorRecord = objectRecord(error);

    if (errorRecord.safetyFiltered === true || isSensitiveFilterError(error)) {
      return sendJson(res, 422, {
        error: SENSITIVE_FILTER_ERROR,
        suggestion: SENSITIVE_FILTER_SUGGESTION,
      });
    }

    if (errorRecord.rateLimited === true || isRateLimitError(error)) {
      return sendJson(res, 429, {
        error: PROVIDER_QUEUE_BUSY_MESSAGE,
        details: safeJsonValue(errorRecord.details ?? error),
        provider: textValue(errorRecord.provider) || 'replicate',
        model: textValue(errorRecord.model) || null,
      });
    }

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
