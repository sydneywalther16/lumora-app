import type { IncomingMessage, ServerResponse } from 'node:http';
import Replicate from 'replicate';

export type GenerateRequest = IncomingMessage & {
  body?: unknown;
};

export type GenerateVideoRequestBody = {
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
type OpenAIVideoModel = 'sora-2' | 'sora-2-pro';
type VideoProvider = 'replicate' | 'openai';

type ProviderResult = {
  videoUrl: string;
  provider: VideoProvider;
  model: string;
  rawOutput: unknown;
  referenceImageUrl?: string | null;
  referenceImageNote?: string | null;
};

type ReferenceImageSelection = {
  requested: string[];
  urls: string[];
  unresolved: string[];
};

export type GenerateVideoResponseBody = {
  videoUrl: string;
  video: string;
  provider: VideoProvider;
  model: string;
  finalPrompt: string;
  referenceImageUrl: string | null;
  referenceImageNote: string | null;
  rawOutput: unknown;
};

const REPLICATE_VIDEO_MODEL = (process.env.REPLICATE_VIDEO_MODEL || 'luma/ray-2-720p') as ReplicateModelIdentifier;
const OPENAI_VIDEO_MODEL = (process.env.OPENAI_VIDEO_MODEL || 'sora-2') as OpenAIVideoModel;
const OPENAI_VIDEO_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_VIDEO_POLL_INTERVAL_MS = 5000;
const OPENAI_VIDEO_POLL_TIMEOUT_MS = 240000;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
  useFileOutput: false,
});

export function sendJsonResponse(res: ServerResponse, statusCode: number, payload: unknown) {
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Video generation failed.';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
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

export class ProviderError extends Error {
  statusCode: number;
  provider: VideoProvider;
  model?: string;
  payload?: unknown;

  constructor(input: {
    message: string;
    statusCode?: number;
    provider: VideoProvider;
    model?: string;
    payload?: unknown;
  }) {
    super(input.message);
    this.name = 'ProviderError';
    this.statusCode = input.statusCode ?? 500;
    this.provider = input.provider;
    this.model = input.model;
    this.payload = input.payload;
  }
}

function isReplicateNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  const response = record.response;

  if (response && typeof response === 'object' && (response as Record<string, unknown>).status === 404) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(record.message ?? '');
  return message.includes('404') || message.includes('Not Found');
}

export async function readGenerateBody(req: GenerateRequest): Promise<GenerateVideoRequestBody> {
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

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

function buildFinalPrompt(input: {
  prompt: string;
  characterDescription: string;
  style: string;
  camera: string;
  audio: boolean;
}): string {
  return [
    input.characterDescription
      ? 'same person as the saved self character, preserve facial identity, consistent hair, makeup, skin tone, wardrobe style'
      : '',
    input.characterDescription,
    input.prompt,
    input.style ? `style: ${input.style}` : '',
    input.camera ? `camera: ${input.camera}` : '',
    input.audio ? 'include synced ambient audio when the selected provider supports audio' : '',
    'vertical video, cinematic lighting, realistic motion, high detail, TikTok style',
  ]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAspectRatio(aspectRatio: unknown): string {
  return textValue(aspectRatio) || '9:16';
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeReferenceImageAlias(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normalized === 'front' || normalized === 'frontface' || normalized === 'face') return 'front';
  if (normalized === 'left' || normalized === 'leftangle' || normalized === 'leftside') return 'left';
  if (normalized === 'right' || normalized === 'rightangle' || normalized === 'rightside') return 'right';
  if (normalized === 'expressive' || normalized === 'expression') return 'expressive';

  return normalized;
}

function referenceImageUrlMap(source: unknown): Record<string, string> {
  const record = objectRecord(source);
  const nestedRecord = objectRecord(record.referenceImageUrls);
  const referenceRecord = Object.keys(nestedRecord).length > 0 ? nestedRecord : record;
  const aliases: Record<string, string[]> = {
    front: ['front', 'frontFace', 'front_face', 'face'],
    left: ['left', 'leftAngle', 'left_angle', 'leftSide'],
    right: ['right', 'rightAngle', 'right_angle', 'rightSide'],
    expressive: ['expressive', 'expression'],
  };

  return Object.fromEntries(
    Object.entries(aliases).flatMap(([alias, keys]) => {
      const url = keys
        .map((key) => textValue(referenceRecord[key]))
        .find((value) => value && isHttpUrl(value));

      return url ? [[alias, url]] : [];
    }),
  );
}

function mergeReferenceImageUrlMaps(...sources: unknown[]): Record<string, string> {
  return Object.assign({}, ...sources.map(referenceImageUrlMap));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeReferenceImages(
  referenceImages: unknown,
  referenceUrlMap: Record<string, string>,
): ReferenceImageSelection {
  const candidates = Array.isArray(referenceImages) ? referenceImages : [referenceImages];
  const requested: string[] = [];
  const urls: string[] = [];
  const unresolved: string[] = [];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate instanceof URL) {
      urls.push(candidate.toString());
      continue;
    }

    if (typeof candidate === 'string') {
      const value = candidate.trim();
      if (!value) continue;

      requested.push(value);

      if (isHttpUrl(value)) {
        urls.push(value);
        continue;
      }

      const alias = normalizeReferenceImageAlias(value);
      const mappedUrl = referenceUrlMap[alias];
      if (mappedUrl) {
        urls.push(mappedUrl);
      } else {
        unresolved.push(value);
      }
      continue;
    }

    if (typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      const explicitUrl = [
        textValue(record.url),
        textValue(record.imageUrl),
        textValue(record.referenceImageUrl),
        textValue(record.src),
      ].find((value) => value && isHttpUrl(value));

      if (explicitUrl) {
        urls.push(explicitUrl);
        continue;
      }

      const label = [
        textValue(record.label),
        textValue(record.slot),
        textValue(record.angle),
        textValue(record.type),
      ].find(Boolean);

      if (label) {
        requested.push(label);
        const alias = normalizeReferenceImageAlias(label);
        const mappedUrl = referenceUrlMap[alias];
        if (mappedUrl) {
          urls.push(mappedUrl);
        } else {
          unresolved.push(label);
        }
      }
    }
  }

  return {
    requested: uniqueStrings(requested),
    urls: uniqueStrings(urls),
    unresolved: uniqueStrings(unresolved),
  };
}

function firstReferenceImageUrl(referenceImageUrl: string, referenceImages: string[]): string {
  if (referenceImageUrl) return referenceImageUrl;
  return referenceImages.find((image) => /^https?:\/\//i.test(image)) ?? '';
}

function resolveReferenceImageUrl(value: string, referenceUrlMap: Record<string, string>): string {
  if (!value) return '';
  if (isHttpUrl(value)) return value;
  return referenceUrlMap[normalizeReferenceImageAlias(value)] ?? '';
}

function normalizeDurationSeconds(duration: unknown): number {
  const parsed = Number(duration);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function normalizeSoraSeconds(duration: unknown): '4' | '8' | '12' {
  const seconds = normalizeDurationSeconds(duration);
  if (seconds >= 12) return '12';
  if (seconds >= 8) return '8';
  return '4';
}

function soraSizeForAspectRatio(aspectRatio: string): string {
  return aspectRatio === '16:9' ? '1280x720' : '720x1280';
}

function isSoraEngine(engine: string): engine is OpenAIVideoModel {
  return engine === 'sora-2' || engine === 'sora-2-pro';
}

function openAIVideoModelForEngine(engine: string): OpenAIVideoModel {
  return isSoraEngine(engine) ? engine : OPENAI_VIDEO_MODEL;
}

function resolveEngine(engine: string, provider: string): string {
  if (provider === 'auto') {
    return process.env.OPENAI_API_KEY ? OPENAI_VIDEO_MODEL : 'replicate';
  }

  if (provider === 'openai') return OPENAI_VIDEO_MODEL;
  if (provider === 'sora-2' || provider === 'sora-2-pro' || provider === 'replicate') {
    return provider;
  }

  return engine || 'replicate';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function errorPayloadMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const nestedError = record.error;

  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }

  return typeof record.message === 'string' ? record.message : '';
}

function isOpenAIReferenceImageError(message: string): boolean {
  const lower = message.toLowerCase();
  const mentionsReferenceImage = (
    lower.includes('reference') ||
    lower.includes('input_reference') ||
    lower.includes('image')
  );
  return mentionsReferenceImage && (
    lower.includes('face') ||
    lower.includes('human') ||
    lower.includes('person') ||
    lower.includes('people') ||
    lower.includes('rejected') ||
    lower.includes('restricted') ||
    lower.includes('disallowed') ||
    lower.includes('unsupported')
  );
}

function isOpenAIAccessOrBillingError(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    lower.includes('access') ||
    lower.includes('not enabled') ||
    lower.includes('not available') ||
    lower.includes('billing') ||
    lower.includes('quota') ||
    lower.includes('deprecated') ||
    lower.includes('deprecation')
  );
}

async function openAIJson(path: string, init: RequestInit, model = OPENAI_VIDEO_MODEL): Promise<unknown> {
  const response = await fetch(`${OPENAI_VIDEO_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...init.headers,
    },
  });
  const payload = await readResponseJson(response);

  if (!response.ok) {
    const message = errorPayloadMessage(payload) || `OpenAI Videos API request failed with status ${response.status}.`;

    if (isOpenAIReferenceImageError(message)) {
      throw new ProviderError({
        statusCode: 400,
        provider: 'openai',
        model,
        message: 'OpenAI rejected the reference image for this video request. Human-face reference images may be restricted; try Replicate or remove the reference image.',
        payload,
      });
    }

    if (isOpenAIAccessOrBillingError(response.status, message)) {
      throw new ProviderError({
        statusCode: response.status === 401 ? 401 : 502,
        provider: 'openai',
        model,
        message: 'Sora 2 video generation is unavailable for this OpenAI API account, model, billing state, or deprecation window. Try the Replicate engine fallback.',
        payload,
      });
    }

    throw new ProviderError({
      statusCode: response.status >= 500 ? 502 : response.status,
      provider: 'openai',
      model,
      message,
      payload,
    });
  }

  return payload;
}

function videoJobId(job: unknown, model = OPENAI_VIDEO_MODEL): string {
  if (job && typeof job === 'object') {
    const id = (job as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }

  throw new ProviderError({
    statusCode: 502,
    provider: 'openai',
    model,
    message: 'OpenAI did not return a video job id.',
    payload: job,
  });
}

function videoJobStatus(job: unknown): string {
  return job && typeof job === 'object' && typeof (job as Record<string, unknown>).status === 'string'
    ? (job as Record<string, string>).status
    : '';
}

function videoJobErrorMessage(job: unknown): string {
  if (!job || typeof job !== 'object') return '';
  const error = (job as Record<string, unknown>).error;
  return errorPayloadMessage({ error });
}

async function fetchReferenceImageBlob(referenceImageUrl: string): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const response = await fetch(referenceImageUrl);
    if (!response.ok) {
      console.warn('Unable to fetch OpenAI video reference image', {
        status: response.status,
        referenceImageUrl,
      });
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      blob: await response.blob(),
      contentType,
    };
  } catch (error) {
    console.warn('Unable to fetch OpenAI video reference image', error);
    return null;
  }
}

function referenceFileName(contentType: string): string {
  if (contentType.includes('png')) return 'reference.png';
  if (contentType.includes('webp')) return 'reference.webp';
  return 'reference.jpg';
}

async function createOpenAIVideo(input: {
  finalPrompt: string;
  aspectRatio: string;
  duration: number;
  engine: string;
  referenceImageUrl: string;
}): Promise<ProviderResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ProviderError({
      statusCode: 500,
      provider: 'openai',
      model: openAIVideoModelForEngine(input.engine),
      message: 'Missing OPENAI_API_KEY',
    });
  }

  const model = openAIVideoModelForEngine(input.engine);
  const seconds = normalizeSoraSeconds(input.duration);
  const size = soraSizeForAspectRatio(input.aspectRatio);
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', input.finalPrompt);
  form.set('seconds', seconds);
  form.set('size', size);
  let referenceImageUsed = false;

  if (input.referenceImageUrl) {
    const referenceImage = await fetchReferenceImageBlob(input.referenceImageUrl);

    if (referenceImage) {
      form.set(
        'input_reference',
        referenceImage.blob,
        referenceFileName(referenceImage.contentType),
      );
      referenceImageUsed = true;
    }
  }

  console.info('OPENAI VIDEO GENERATE REQUEST', {
    model,
    size,
    seconds,
    hasReferenceImageUrl: Boolean(input.referenceImageUrl),
    referenceImageUsed,
  });

  const created = await openAIJson('/videos', {
    method: 'POST',
    body: form,
  }, model);
  const id = videoJobId(created, model);
  const startedAt = Date.now();
  let current = created;

  while (Date.now() - startedAt < OPENAI_VIDEO_POLL_TIMEOUT_MS) {
    const status = videoJobStatus(current);

    if (status === 'completed' || status === 'succeeded') {
      const videoUrl = `/api/video-content?provider=openai&id=${encodeURIComponent(id)}`;
      return {
        videoUrl,
        provider: 'openai',
        model,
        referenceImageUrl: input.referenceImageUrl || null,
        referenceImageNote: referenceImageUsed
          ? null
          : input.referenceImageUrl
            ? 'Reference image URL was provided, but it could not be fetched for Sora.'
            : null,
        rawOutput: {
          created,
          completed: current,
          id,
          size,
          seconds,
          referenceImageUrl: input.referenceImageUrl || null,
          referenceImageUsed,
        },
      };
    }

    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      const message = videoJobErrorMessage(current) || 'OpenAI video generation failed.';

      if (isOpenAIReferenceImageError(message)) {
        throw new ProviderError({
          statusCode: 400,
          provider: 'openai',
          model,
          message: 'OpenAI rejected the reference image for this video request. Human-face reference images may be restricted; try Replicate or remove the reference image.',
          payload: current,
        });
      }

      if (isOpenAIAccessOrBillingError(502, message)) {
        throw new ProviderError({
          statusCode: 502,
          provider: 'openai',
          model,
          message: 'Sora 2 video generation is unavailable for this OpenAI API account, model, billing state, or deprecation window. Try the Replicate engine fallback.',
          payload: current,
        });
      }

      throw new ProviderError({
        statusCode: 502,
        provider: 'openai',
        model,
        message,
        payload: current,
      });
    }

    await delay(OPENAI_VIDEO_POLL_INTERVAL_MS);
    current = await openAIJson(`/videos/${encodeURIComponent(id)}`, {
      method: 'GET',
    }, model);
  }

  throw new ProviderError({
    statusCode: 504,
    provider: 'openai',
    model,
    message: 'OpenAI Sora video generation is still processing. Try again later or use Replicate fallback.',
    payload: current,
  });
}

async function createReplicateVideo(input: {
  finalPrompt: string;
  aspectRatio: string;
  duration: number;
  referenceImageUrl: string;
}): Promise<ProviderResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not configured.');
    throw new ProviderError({
      statusCode: 500,
      provider: 'replicate',
      model: REPLICATE_VIDEO_MODEL,
      message: 'Missing REPLICATE_API_TOKEN',
    });
  }

  const referenceImageNote = input.referenceImageUrl
    ? 'This model is text-to-video only and cannot preserve exact character likeness from reference images.'
    : null;

  console.info('REPLICATE GENERATE REQUEST', {
    model: REPLICATE_VIDEO_MODEL,
    hasReferenceImageUrl: Boolean(input.referenceImageUrl),
    aspectRatio: input.aspectRatio,
  });

  let output: unknown;

  try {
    output = await replicate.run(REPLICATE_VIDEO_MODEL, {
      input: {
        prompt: input.finalPrompt,
        duration: input.duration || 5,
        aspect_ratio: input.aspectRatio || '9:16',
        loop: false,
      },
    });
  } catch (error) {
    if (isReplicateNotFoundError(error)) {
      throw new ProviderError({
        statusCode: 502,
        provider: 'replicate',
        model: REPLICATE_VIDEO_MODEL,
        message: 'Selected Replicate model was not found. Check REPLICATE_VIDEO_MODEL.',
        payload: error,
      });
    }

    throw error;
  }
  const videoUrl = normalizeReplicateVideoUrl(output);
  const rawOutput = {
    output: serializeReplicateOutput(output),
    referenceImageUrl: input.referenceImageUrl || null,
    referenceImageNote,
  };

  console.info('REPLICATE GENERATE OUTPUT', {
    model: REPLICATE_VIDEO_MODEL,
    hasVideoUrl: Boolean(videoUrl),
    referenceImageUsed: false,
    outputType: Array.isArray(output) ? 'array' : typeof output,
  });

  if (!videoUrl) {
    throw new ProviderError({
      statusCode: 502,
      provider: 'replicate',
      model: REPLICATE_VIDEO_MODEL,
      message: 'Replicate completed, but no usable video URL was found in the output.',
      payload: rawOutput,
    });
  }

  return {
    videoUrl,
    provider: 'replicate',
    model: REPLICATE_VIDEO_MODEL,
    referenceImageUrl: input.referenceImageUrl || null,
    referenceImageNote,
    rawOutput,
  };
}

export async function generateVideoFromBody(body: GenerateVideoRequestBody): Promise<GenerateVideoResponseBody> {
  const prompt = textValue(body.prompt);
  const characterDescription =
    textValue(body.characterDescription) || formatCharacterDescription(body.character);
  const referenceUrlMap = mergeReferenceImageUrlMaps(body.referenceImageUrls, body.character);
  const referenceImages = normalizeReferenceImages(body.referenceImages, referenceUrlMap);
  const defaultMappedReferenceUrl = referenceUrlMap.front || referenceUrlMap.left || referenceUrlMap.right || '';
  const referenceImageUrl = firstReferenceImageUrl(
    resolveReferenceImageUrl(textValue(body.referenceImageUrl), referenceUrlMap) || defaultMappedReferenceUrl,
    referenceImages.urls,
  );
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);
  const duration = normalizeDurationSeconds(body.duration);
  const provider = textValue(body.provider);
  const engine = resolveEngine(textValue(body.engine), provider);
  const finalPrompt = buildFinalPrompt({
    prompt,
    characterDescription,
    style: textValue(body.style),
    camera: textValue(body.camera),
    audio: booleanValue(body.audio),
  });
  const unresolvedReferenceImageNote = referenceImages.unresolved.length > 0
    ? `referenceImages included label(s) without matching public URLs: ${referenceImages.unresolved.join(', ')}. Include referenceImageUrls to send image references to Sora.`
    : null;

  if (!prompt) {
    throw new ProviderError({
      statusCode: 400,
      provider: isSoraEngine(engine) ? 'openai' : 'replicate',
      model: isSoraEngine(engine) ? openAIVideoModelForEngine(engine) : REPLICATE_VIDEO_MODEL,
      message: 'A prompt is required.',
    });
  }

  let result: ProviderResult;

  if (isSoraEngine(engine)) {
    try {
      result = await createOpenAIVideo({
        finalPrompt,
        aspectRatio,
        duration,
        engine,
        referenceImageUrl,
      });
    } catch (error) {
      if (provider !== 'auto' || !(error instanceof ProviderError) || error.provider !== 'openai') {
        throw error;
      }

      console.warn('OPENAI AUTO PROVIDER FAILED; FALLING BACK TO REPLICATE', {
        model: error.model,
        message: error.message,
      });
      const fallback = await createReplicateVideo({
        finalPrompt,
        aspectRatio,
        duration,
        referenceImageUrl,
      });
      result = {
        ...fallback,
        referenceImageNote: fallback.referenceImageNote ?? unresolvedReferenceImageNote,
        rawOutput: {
          fallbackFrom: {
            provider: 'openai',
            model: error.model,
            error: error.message,
            rawOutput: error.payload,
          },
          referenceImages: {
            requested: referenceImages.requested,
            resolvedUrls: referenceImages.urls,
            unresolved: referenceImages.unresolved,
          },
          result: fallback.rawOutput,
        },
      };
    }
  } else {
    result = await createReplicateVideo({
      finalPrompt,
      aspectRatio,
      duration,
      referenceImageUrl,
    });
  }

  console.info('VIDEO GENERATE COMPLETE', {
    provider: result.provider,
    model: result.model,
    promptLength: prompt.length,
    characterId: textValue(body.characterId) || null,
    hasCharacterDescription: Boolean(characterDescription),
    hasReferenceImageUrl: Boolean(referenceImageUrl),
    referenceImageCount: referenceImages.urls.length,
    requestedReferenceImages: referenceImages.requested,
    unresolvedReferenceImages: referenceImages.unresolved,
    aspectRatio,
    duration,
    engine,
    requestedProvider: provider || null,
  });

  return {
    videoUrl: result.videoUrl,
    video: result.videoUrl,
    provider: result.provider,
    model: result.model,
    finalPrompt,
    referenceImageUrl: result.referenceImageUrl ?? null,
    referenceImageNote: result.referenceImageNote ?? unresolvedReferenceImageNote,
    rawOutput: {
      request: {
        characterId: textValue(body.characterId) || null,
        requestedReferenceImages: referenceImages.requested,
        resolvedReferenceImageUrls: referenceImages.urls,
        unresolvedReferenceImages: referenceImages.unresolved,
        style: textValue(body.style) || null,
        camera: textValue(body.camera) || null,
        audio: booleanValue(body.audio),
        requestedProvider: provider || null,
        engine,
      },
      provider: result.rawOutput,
    },
  };
}
