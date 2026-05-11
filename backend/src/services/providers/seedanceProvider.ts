import { randomUUID } from 'node:crypto';
import Replicate, { type Prediction } from 'replicate';
import { env } from '../../lib/env';

export const SEEDANCE_FAST_MODEL = 'bytedance/seedance-2.0-fast';
export const SEEDANCE_QUALITY_MODEL = 'bytedance/seedance-2.0';

export type SeedanceQualityMode = 'fast' | 'quality';

const DEFAULT_SEEDANCE_SETTINGS = {
  duration: 5,
  aspect_ratio: '16:9',
  resolution: '720p',
} as const;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 180_000;

export type SeedanceVideoResult = {
  id: string;
  provider: 'replicate';
  model: typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL;
  status: 'completed';
  providerJobId: string;
  videoUrl: string;
  finalPrompt: string;
  referenceImages: SeedanceReferenceImage[];
  referenceImageCount: number;
  multimodalReferenceMode: boolean;
  warnings: string[];
  rawOutput: unknown;
  logs?: string;
  metrics?: Prediction['metrics'];
  settings: typeof DEFAULT_SEEDANCE_SETTINGS;
};

export type SeedanceReferenceImage = {
  url: string;
  label?: string;
  role?: string;
  token?: string;
};

type GenerateSeedanceVideoOptions = {
  quality?: SeedanceQualityMode;
  timeoutMs?: number;
  pollIntervalMs?: number;
  referenceImages?: SeedanceReferenceImage[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function modelForQuality(quality: SeedanceQualityMode) {
  return quality === 'quality' ? SEEDANCE_QUALITY_MODEL : SEEDANCE_FAST_MODEL;
}

function stringifyUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof URL) return value.toString();

  if (value && typeof value === 'object') {
    const maybeFileOutput = value as { url?: () => URL; toString?: () => string };
    if (typeof maybeFileOutput.url === 'function') {
      return maybeFileOutput.url().toString();
    }

    if (typeof maybeFileOutput.toString === 'function') {
      const stringValue = maybeFileOutput.toString();
      if (stringValue && stringValue !== '[object Object]') return stringValue;
    }
  }

  return null;
}

function extractVideoUrl(output: unknown): string | null {
  const directUrl = stringifyUrl(output);
  if (directUrl) return directUrl;

  if (Array.isArray(output)) {
    for (const item of output) {
      const url = extractVideoUrl(item);
      if (url) return url;
    }
    return null;
  }

  if (!output || typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  const preferredKeys = [
    'video',
    'video_url',
    'videoUrl',
    'output',
    'url',
    'uri',
    'file',
    'files',
  ];

  for (const key of preferredKeys) {
    const url = extractVideoUrl(record[key]);
    if (url) return url;
  }

  return null;
}

function normalizeReferenceImages(
  referenceImages: SeedanceReferenceImage[] | undefined,
): SeedanceReferenceImage[] {
  const seen = new Set<string>();

  return (referenceImages ?? []).flatMap((reference, index) => {
    const url = typeof reference.url === 'string' ? reference.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);

    return [{
      url,
      label: reference.label,
      role: reference.role,
      token: reference.token || `[Image${index + 1}]`,
    }];
  }).map((reference, index) => ({
    ...reference,
    token: `[Image${index + 1}]`,
  }));
}

function buildMultimodalSeedancePrompt(prompt: string, referenceImages: SeedanceReferenceImage[]) {
  if (!referenceImages.length) return prompt;

  const tokens = referenceImages.map((reference, index) => reference.token ?? `[Image${index + 1}]`).join('');
  return [
    `The woman from ${tokens}.`,
    'Use all provided images as multimodal identity references for face, side angles, full body, expressions, and outfit details.',
    'Do not use any reference image as the first frame. Do not animate, copy, or recreate a single source photo.',
    'Generate a fresh photorealistic cinematic scene with consistent identity across shots.',
    prompt,
  ].join(' ');
}

function responseStatus(error: unknown): number | null {
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : null;
}

function retryAfterMs(error: unknown): number | null {
  const headers = (error as { response?: { headers?: { get?: (name: string) => string | null } } } | null)
    ?.response
    ?.headers;
  const retryAfter = headers?.get?.('retry-after') ?? headers?.get?.('Retry-After') ?? null;
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function replicateErrorDetails(error: unknown) {
  const response = (error as {
    response?: {
      status?: number;
      statusText?: string;
      headers?: { get?: (name: string) => string | null };
    };
    request?: unknown;
  } | null)?.response;

  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    status: response?.status ?? null,
    statusText: response?.statusText ?? null,
    retryAfterMs: retryAfterMs(error),
    requestId: response?.headers?.get?.('x-request-id') ?? response?.headers?.get?.('x-replicate-request-id') ?? null,
  };
}

function logReplicateError(stage: string, error: unknown, context: Record<string, unknown>) {
  console.error('REPLICATE ERROR:', {
    stage,
    ...context,
    error: replicateErrorDetails(error),
  });
}

async function withReplicateRetry<T>(
  action: () => Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const status = responseStatus(error);
    if (status !== 429 && status !== 503 && status !== 504) {
      logReplicateError('request_failed', error, context);
      throw error;
    }

    const waitMs = retryAfterMs(error) ?? 6_000;
    logReplicateError('retryable_request_failed', error, { ...context, waitMs });
    await sleep(waitMs);

    try {
      return await action();
    } catch (retryError) {
      logReplicateError('request_retry_failed', retryError, context);
      throw retryError;
    }
  }
}

async function pollPrediction(input: {
  replicate: Replicate;
  prediction: Prediction;
  model: string;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<Prediction> {
  const startedAt = Date.now();
  let prediction = input.prediction;

  while (prediction.status === 'starting' || prediction.status === 'processing') {
    const elapsedMs = Date.now() - startedAt;
    const phase = prediction.status === 'starting' ? 'queued' : 'processing';
    console.info('SEEDANCE PREDICTION STATUS:', {
      providerJobId: prediction.id,
      model: input.model,
      phase,
      elapsedMs,
    });

    if (elapsedMs >= input.timeoutMs) {
      await input.replicate.predictions.cancel(prediction.id).catch((error) => {
        logReplicateError('prediction_cancel_failed', error, {
          providerJobId: prediction.id,
          model: input.model,
        });
      });
      throw new Error(`Seedance generation timed out after ${Math.round(input.timeoutMs / 1000)} seconds.`);
    }

    await sleep(input.pollIntervalMs);
    prediction = await withReplicateRetry(
      () => input.replicate.predictions.get(prediction.id),
      {
        providerJobId: prediction.id,
        model: input.model,
        action: 'predictions.get',
      },
    );
  }

  return prediction;
}

export async function generateSeedanceVideo(
  prompt: string,
  options: GenerateSeedanceVideoOptions = {},
): Promise<SeedanceVideoResult> {
  const safePrompt = prompt.trim();
  if (!safePrompt) {
    throw new Error('Seedance generation requires a prompt.');
  }

  if (!env.REPLICATE_API_TOKEN) {
    throw new Error('Seedance generation is not configured. Set REPLICATE_API_TOKEN on the API server.');
  }

  const replicate = new Replicate({
    auth: env.REPLICATE_API_TOKEN,
    useFileOutput: false,
  });
  const quality = options.quality ?? 'fast';
  const model = modelForQuality(quality);
  const referenceImages = normalizeReferenceImages(options.referenceImages);
  const finalPrompt = buildMultimodalSeedancePrompt(safePrompt, referenceImages);
  const requestInput = {
    prompt: finalPrompt,
    ...(referenceImages.length
      ? { reference_images: referenceImages.map((reference) => reference.url) }
      : {}),
    ...DEFAULT_SEEDANCE_SETTINGS,
  };

  console.info('SEEDANCE MULTIMODAL REFERENCES:', {
    model,
    quality,
    count: referenceImages.length,
    references: referenceImages.map((reference) => ({
      token: reference.token,
      label: reference.label ?? null,
      role: reference.role ?? null,
      url: reference.url,
    })),
    inputKeys: Object.keys(requestInput),
  });
  console.info('SEEDANCE FINAL PROMPT:', {
    model,
    prompt: finalPrompt,
  });

  const prediction = await withReplicateRetry(
    () => replicate.predictions.create({
      model,
      input: requestInput,
      wait: false,
    }),
    {
      model,
      action: 'predictions.create',
      quality,
    },
  );
  console.info('SEEDANCE PREDICTION CREATED:', {
    providerJobId: prediction.id,
    model,
    quality,
    status: prediction.status,
  });

  const completedPrediction = await pollPrediction({
    replicate,
    prediction,
    model,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  });

  if (completedPrediction.status !== 'succeeded') {
    console.error('SEEDANCE PREDICTION FAILED:', {
      providerJobId: completedPrediction.id,
      model,
      status: completedPrediction.status,
      error: completedPrediction.error,
      logs: completedPrediction.logs,
    });
    throw new Error(
      typeof completedPrediction.error === 'string'
        ? completedPrediction.error
        : `Seedance prediction ${completedPrediction.status}.`,
    );
  }

  const videoUrl = extractVideoUrl(completedPrediction.output);

  if (!videoUrl) {
    throw new Error('Seedance generation completed without a usable video URL.');
  }

  return {
    id: randomUUID(),
    provider: 'replicate',
    model,
    status: 'completed',
    providerJobId: completedPrediction.id,
    videoUrl,
    finalPrompt,
    referenceImages,
    referenceImageCount: referenceImages.length,
    multimodalReferenceMode: referenceImages.length > 1,
    warnings: referenceImages.length === 1
      ? ['Only one reference image was sent to Seedance. Add side, full-body, expression, or outfit references for stronger multimodal identity consistency.']
      : [],
    rawOutput: completedPrediction.output,
    logs: completedPrediction.logs,
    metrics: completedPrediction.metrics,
    settings: DEFAULT_SEEDANCE_SETTINGS,
  };
}
