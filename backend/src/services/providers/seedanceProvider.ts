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
  moderationDiagnostics?: SeedanceModerationDiagnostics;
  suggestedPrompt?: string;
  sanitizedPrompt?: string;
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

export type SeedanceModerationDiagnostics = {
  detected: boolean;
  provider: 'replicate';
  model: string;
  retryAttempted: boolean;
  retrySucceeded: boolean;
  retryMode: 'safe-cinematic-rewrite' | null;
  providerJobId: string | null;
  providerStatus: string | null;
  providerMessage: string;
  sanitizedPrompt: string;
  suggestedPrompt: string;
  referenceImageCount: number;
};

type GenerateSeedanceVideoOptions = {
  quality?: SeedanceQualityMode;
  timeoutMs?: number;
  pollIntervalMs?: number;
  referenceImages?: SeedanceReferenceImage[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RISKY_PROMPT_REWRITES: Array<[RegExp, string]> = [
  [/\bonlyfans\b/gi, 'creator portfolio'],
  [/\bsexy\b/gi, 'stylish'],
  [/\bsexiness\b/gi, 'confidence'],
  [/\bseductive\b/gi, 'confident'],
  [/\bseducing\b/gi, 'posing confidently'],
  [/\bsensual\b/gi, 'elegant'],
  [/\bsultry\b/gi, 'cinematic'],
  [/\bprovocative\b/gi, 'editorial'],
  [/\badult\b/gi, 'editorial'],
  [/\berotic\b/gi, 'fashion-inspired'],
  [/\bnude\b/gi, 'fully clothed'],
  [/\bnudity\b/gi, 'fully clothed styling'],
  [/\blingerie\b/gi, 'fashion outfit'],
  [/\bboudoir\b/gi, 'studio portrait'],
  [/\bfetish\b/gi, 'avant-garde fashion'],
  [/\bthirst\s*trap\b/gi, 'confident editorial portrait'],
  [/\brevealing\b/gi, 'tailored'],
  [/\bsheer\b/gi, 'layered'],
  [/\bsee[-\s]?through\b/gi, 'layered'],
  [/\bcleavage\b/gi, 'neckline'],
  [/\bskimpy\b/gi, 'minimalist'],
  [/\bbedroom\b/gi, 'cinematic studio'],
  [/\bglamour\b/gi, 'editorial fashion'],
];

const MODERATION_MATCHERS = [
  'flagged as sensitive',
  'input or output was flagged',
  'sensitive',
  'e005',
  'moderation',
  'safety filter',
  'safety-filter',
  'content policy',
  'policy violation',
  'blocked by provider safety',
  'nsfw',
];

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

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function stripRiskyPromptWording(prompt: string) {
  let sanitizedPrompt = prompt;
  const replacements: string[] = [];

  for (const [pattern, replacement] of RISKY_PROMPT_REWRITES) {
    if (pattern.test(sanitizedPrompt)) {
      replacements.push(replacement);
      sanitizedPrompt = sanitizedPrompt.replace(pattern, replacement);
    }
  }

  return {
    prompt: collapseWhitespace(sanitizedPrompt),
    changed: replacements.length > 0,
    replacements: Array.from(new Set(replacements)),
  };
}

export function safeCinematicRewrite(prompt: string) {
  const sanitized = stripRiskyPromptWording(prompt);
  return collapseWhitespace([
    'Create a family-safe, fully clothed, photorealistic cinematic video.',
    'Editorial fashion styling, confident neutral posing, natural movement, polished studio-safe composition.',
    sanitized.prompt,
  ].join(' '));
}

function stringifyProviderResponse(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function providerResponseText(value: unknown) {
  const parts: string[] = [];

  if (value instanceof Error) {
    parts.push(value.message);
    const errorRecord = value as Error & {
      response?: unknown;
      error?: unknown;
      logs?: unknown;
    };
    parts.push(stringifyProviderResponse(errorRecord.response));
    parts.push(stringifyProviderResponse(errorRecord.error));
    parts.push(stringifyProviderResponse(errorRecord.logs));
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    parts.push(stringifyProviderResponse(record.error));
    parts.push(stringifyProviderResponse(record.logs));
    parts.push(stringifyProviderResponse(record.status));
    parts.push(stringifyProviderResponse(value));
  } else {
    parts.push(stringifyProviderResponse(value));
  }

  return parts.filter(Boolean).join(' ');
}

export function isSeedanceModerationResponse(value: unknown) {
  const lowerText = providerResponseText(value).toLowerCase();
  return MODERATION_MATCHERS.some((matcher) => lowerText.includes(matcher));
}

export class SeedanceModerationError extends Error {
  readonly statusCode = 422;
  readonly suggestion = 'Try a safer cinematic editorial prompt with fully clothed styling and neutral posing.';
  readonly suggestedPrompt: string;
  readonly sanitizedPrompt: string;
  readonly diagnostics: SeedanceModerationDiagnostics;
  readonly referenceImages: SeedanceReferenceImage[];

  constructor(input: {
    message?: string;
    suggestedPrompt: string;
    sanitizedPrompt: string;
    diagnostics: SeedanceModerationDiagnostics;
    referenceImages: SeedanceReferenceImage[];
  }) {
    super(input.message ?? 'Provider moderation paused this render.');
    this.name = 'SeedanceModerationError';
    this.suggestedPrompt = input.suggestedPrompt;
    this.sanitizedPrompt = input.sanitizedPrompt;
    this.diagnostics = input.diagnostics;
    this.referenceImages = input.referenceImages;
  }
}

export function isSeedanceModerationError(error: unknown): error is SeedanceModerationError {
  return error instanceof SeedanceModerationError || (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'SeedanceModerationError'
  );
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

function buildSeedanceRequestInput(prompt: string, referenceImages: SeedanceReferenceImage[]) {
  return {
    prompt,
    ...(referenceImages.length
      ? { reference_images: referenceImages.map((reference) => reference.url) }
      : {}),
    ...DEFAULT_SEEDANCE_SETTINGS,
  };
}

function moderationDiagnostics(input: {
  model: string;
  prediction?: Prediction | null;
  providerResponse: unknown;
  retryAttempted: boolean;
  retrySucceeded: boolean;
  retryMode: SeedanceModerationDiagnostics['retryMode'];
  sanitizedPrompt: string;
  suggestedPrompt: string;
  referenceImageCount: number;
}): SeedanceModerationDiagnostics {
  return {
    detected: true,
    provider: 'replicate',
    model: input.model,
    retryAttempted: input.retryAttempted,
    retrySucceeded: input.retrySucceeded,
    retryMode: input.retryMode,
    providerJobId: input.prediction?.id ?? null,
    providerStatus: input.prediction?.status ?? null,
    providerMessage: providerResponseText(input.providerResponse),
    sanitizedPrompt: input.sanitizedPrompt,
    suggestedPrompt: input.suggestedPrompt,
    referenceImageCount: input.referenceImageCount,
  };
}

async function runSeedanceAttempt(input: {
  replicate: Replicate;
  model: typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL;
  quality: SeedanceQualityMode;
  prompt: string;
  referenceImages: SeedanceReferenceImage[];
  timeoutMs: number;
  pollIntervalMs: number;
  attemptLabel: 'primary' | 'moderation_retry';
}) {
  const requestInput = buildSeedanceRequestInput(input.prompt, input.referenceImages);

  console.info('SEEDANCE PROVIDER REQUEST:', {
    model: input.model,
    quality: input.quality,
    attempt: input.attemptLabel,
    inputKeys: Object.keys(requestInput),
    referenceImageCount: input.referenceImages.length,
    prompt: input.prompt,
  });

  const prediction = await withReplicateRetry(
    () => input.replicate.predictions.create({
      model: input.model,
      input: requestInput,
      wait: false,
    }),
    {
      model: input.model,
      action: 'predictions.create',
      quality: input.quality,
      attempt: input.attemptLabel,
    },
  );
  console.info('SEEDANCE PREDICTION CREATED:', {
    providerJobId: prediction.id,
    model: input.model,
    quality: input.quality,
    attempt: input.attemptLabel,
    status: prediction.status,
  });

  const completedPrediction = await pollPrediction({
    replicate: input.replicate,
    prediction,
    model: input.model,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  if (completedPrediction.status !== 'succeeded') {
    const providerResponse = {
      status: completedPrediction.status,
      error: completedPrediction.error,
      logs: completedPrediction.logs,
    };

    if (isSeedanceModerationResponse(providerResponse)) {
      console.warn('SEEDANCE PROVIDER MODERATION RESPONSE:', {
        providerJobId: completedPrediction.id,
        model: input.model,
        attempt: input.attemptLabel,
        providerResponse,
      });
      throw Object.assign(new Error('Seedance provider moderation response.'), {
        name: 'SeedanceProviderModerationResponse',
        prediction: completedPrediction,
        providerResponse,
      });
    }

    console.error('SEEDANCE PREDICTION FAILED:', {
      providerJobId: completedPrediction.id,
      model: input.model,
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
    completedPrediction,
    videoUrl,
  };
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
  const sanitized = stripRiskyPromptWording(safePrompt);
  const suggestedPrompt = safeCinematicRewrite(safePrompt);
  const finalPrompt = buildMultimodalSeedancePrompt(sanitized.prompt, referenceImages);

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
  });
  console.info('SEEDANCE FINAL PROMPT:', {
    model,
    prompt: finalPrompt,
    sanitizedChanged: sanitized.changed,
    replacements: sanitized.replacements,
  });

  try {
    const attempt = await runSeedanceAttempt({
      replicate,
      model,
      quality,
      prompt: finalPrompt,
      referenceImages,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      attemptLabel: 'primary',
    });

    return {
      id: randomUUID(),
      provider: 'replicate',
      model,
      status: 'completed',
      providerJobId: attempt.completedPrediction.id,
      videoUrl: attempt.videoUrl,
      finalPrompt,
      referenceImages,
      referenceImageCount: referenceImages.length,
      multimodalReferenceMode: referenceImages.length > 1,
      warnings: [
        ...(referenceImages.length === 1
          ? ['Only one reference image was sent to Seedance. Add side, full-body, expression, or outfit references for stronger multimodal identity consistency.']
          : []),
        ...(sanitized.changed
          ? ['Lumora automatically softened risky glamour/adult wording before sending this prompt to Seedance.']
          : []),
      ],
      suggestedPrompt,
      sanitizedPrompt: sanitized.prompt,
      rawOutput: attempt.completedPrediction.output,
      logs: attempt.completedPrediction.logs,
      metrics: attempt.completedPrediction.metrics,
      settings: DEFAULT_SEEDANCE_SETTINGS,
    };
  } catch (error) {
    if (!isSeedanceModerationResponse(error)) {
      throw error;
    }

    const moderationError = error as {
      prediction?: Prediction;
      providerResponse?: unknown;
    };
    const initialDiagnostics = moderationDiagnostics({
      model,
      prediction: moderationError.prediction ?? null,
      providerResponse: moderationError.providerResponse ?? error,
      retryAttempted: true,
      retrySucceeded: false,
      retryMode: 'safe-cinematic-rewrite',
      sanitizedPrompt: sanitized.prompt,
      suggestedPrompt,
      referenceImageCount: referenceImages.length,
    });
    console.warn('SEEDANCE MODERATION DIAGNOSTICS:', initialDiagnostics);
    console.info('SEEDANCE MODERATION RETRY MODE:', {
      model,
      quality,
      retryMode: 'safe-cinematic-rewrite',
      referenceImageCount: referenceImages.length,
      sanitizedPrompt: suggestedPrompt,
      referencesPreserved: referenceImages.map((reference) => ({
        token: reference.token,
        url: reference.url,
      })),
    });

    const retryFinalPrompt = buildMultimodalSeedancePrompt(suggestedPrompt, referenceImages);

    try {
      const retryAttempt = await runSeedanceAttempt({
        replicate,
        model,
        quality,
        prompt: retryFinalPrompt,
        referenceImages,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        attemptLabel: 'moderation_retry',
      });
      const retryDiagnostics: SeedanceModerationDiagnostics = {
        ...initialDiagnostics,
        retrySucceeded: true,
        providerJobId: retryAttempt.completedPrediction.id,
        providerStatus: retryAttempt.completedPrediction.status,
        providerMessage: providerResponseText({
          status: retryAttempt.completedPrediction.status,
          logs: retryAttempt.completedPrediction.logs,
        }),
        sanitizedPrompt: suggestedPrompt,
      };
      console.info('SEEDANCE MODERATION RETRY SUCCEEDED:', retryDiagnostics);

      return {
        id: randomUUID(),
        provider: 'replicate',
        model,
        status: 'completed',
        providerJobId: retryAttempt.completedPrediction.id,
        videoUrl: retryAttempt.videoUrl,
        finalPrompt: retryFinalPrompt,
        referenceImages,
        referenceImageCount: referenceImages.length,
        multimodalReferenceMode: referenceImages.length > 1,
        warnings: [
          'Provider moderation flagged the first Seedance attempt, so Lumora retried automatically with a safer cinematic rewrite.',
          ...(referenceImages.length === 1
            ? ['Only one reference image was sent to Seedance. Add side, full-body, expression, or outfit references for stronger multimodal identity consistency.']
            : []),
        ],
        moderationDiagnostics: retryDiagnostics,
        suggestedPrompt,
        sanitizedPrompt: suggestedPrompt,
        rawOutput: retryAttempt.completedPrediction.output,
        logs: retryAttempt.completedPrediction.logs,
        metrics: retryAttempt.completedPrediction.metrics,
        settings: DEFAULT_SEEDANCE_SETTINGS,
      };
    } catch (retryError) {
      if (!isSeedanceModerationResponse(retryError)) {
        throw retryError;
      }

      const retryModerationError = retryError as {
        prediction?: Prediction;
        providerResponse?: unknown;
      };
      const retryDiagnostics = moderationDiagnostics({
        model,
        prediction: retryModerationError.prediction ?? null,
        providerResponse: retryModerationError.providerResponse ?? retryError,
        retryAttempted: true,
        retrySucceeded: false,
        retryMode: 'safe-cinematic-rewrite',
        sanitizedPrompt: suggestedPrompt,
        suggestedPrompt,
        referenceImageCount: referenceImages.length,
      });

      console.warn('SEEDANCE PROVIDER MODERATION RESPONSE EXACT:', {
        diagnostics: retryDiagnostics,
        providerResponse: retryModerationError.providerResponse ?? providerResponseText(retryError),
      });

      throw new SeedanceModerationError({
        message: 'Seedance moderation paused this render after Lumora tried a safer cinematic rewrite.',
        suggestedPrompt,
        sanitizedPrompt: suggestedPrompt,
        diagnostics: retryDiagnostics,
        referenceImages,
      });
    }
  }
}
