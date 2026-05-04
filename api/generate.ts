import type { IncomingMessage, ServerResponse } from 'node:http';
import Replicate from 'replicate';

type GenerateRequest = IncomingMessage & {
  body?: unknown;
};

type RequestBody = {
  prompt?: unknown;
  characterDescription?: unknown;
  referenceImageUrl?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  engine?: unknown;
  character?: unknown;
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

const REPLICATE_VIDEO_MODEL = (process.env.REPLICATE_VIDEO_MODEL || 'luma/ray-2-720p') as ReplicateModelIdentifier;
const OPENAI_VIDEO_MODEL = (process.env.OPENAI_VIDEO_MODEL || 'sora-2') as OpenAIVideoModel;
const OPENAI_VIDEO_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_VIDEO_POLL_INTERVAL_MS = 5000;
const OPENAI_VIDEO_POLL_TIMEOUT_MS = 240000;

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

class ProviderError extends Error {
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
  return [
    characterDescription
      ? 'same person as the saved self character, preserve facial identity, consistent hair, makeup, skin tone, wardrobe style'
      : '',
    characterDescription,
    prompt,
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
      message: 'OPENAI_API_KEY is not configured.',
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
  referenceImageUrl: string;
}): Promise<ProviderResult> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not configured.');
    throw new ProviderError({
      statusCode: 500,
      provider: 'replicate',
      model: REPLICATE_VIDEO_MODEL,
      message: 'REPLICATE_API_TOKEN is not configured.',
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

  const output = await replicate.run(REPLICATE_VIDEO_MODEL, {
    input: {
      prompt: input.finalPrompt,
      duration: 5,
      aspect_ratio: input.aspectRatio || '9:16',
      loop: false,
    },
  });
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

export default async function handler(req: GenerateRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
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
    const referenceImageUrl = textValue(body.referenceImageUrl);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const duration = normalizeDurationSeconds(body.duration);
    const engine = textValue(body.engine) || 'replicate';
    const finalPrompt = buildFinalPrompt(prompt, characterDescription);

    if (!prompt) {
      return sendJson(res, 400, { error: 'A prompt is required.' });
    }

    const result = isSoraEngine(engine)
      ? await createOpenAIVideo({
          finalPrompt,
          aspectRatio,
          duration,
          engine,
          referenceImageUrl,
        })
      : await createReplicateVideo({
          finalPrompt,
          aspectRatio,
          referenceImageUrl,
        });

    console.info('VIDEO GENERATE COMPLETE', {
      provider: result.provider,
      model: result.model,
      promptLength: prompt.length,
      hasCharacterDescription: Boolean(characterDescription),
      hasReferenceImageUrl: Boolean(referenceImageUrl),
      aspectRatio,
      duration,
      engine,
    });

    return sendJson(res, 200, {
      videoUrl: result.videoUrl,
      video: result.videoUrl,
      provider: result.provider,
      model: result.model,
      finalPrompt,
      referenceImageUrl: result.referenceImageUrl ?? null,
      referenceImageNote: result.referenceImageNote ?? null,
      rawOutput: result.rawOutput,
    });
  } catch (error) {
    console.error('VIDEO GENERATE FAILED', error);
    if (error instanceof ProviderError) {
      return sendJson(res, error.statusCode, {
        error: error.message,
        provider: error.provider,
        model: error.model,
        rawOutput: error.payload,
      });
    }

    if (isReplicateNotFoundError(error)) {
      return sendJson(res, 502, {
        error: 'Selected Replicate model was not found. Check REPLICATE_VIDEO_MODEL.',
        provider: 'replicate',
        model: REPLICATE_VIDEO_MODEL,
      });
    }

    return sendJson(res, 500, { error: errorMessage(error) });
  }
}
