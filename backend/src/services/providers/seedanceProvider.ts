import { randomUUID } from 'node:crypto';
import Replicate, { type Prediction } from 'replicate';
import { env } from '../../lib/env';
import {
  createModerationOrchestrationPlan,
  detectModerationCategories,
  logModerationOrchestration,
  moderationProviderProfiles,
  moderationRetryStages,
  providerSensitivityProfile,
  recordModerationOrchestrationResult,
  rewritePromptForEscalationLevel,
  type ModerationCategory,
  type ModerationOrchestrationAttempt,
  type ModerationRenderingMode,
  type ModerationProviderSensitivityProfile,
} from '../moderationOrchestrator';
import {
  logProviderPromptFinalization,
  sanitizeProviderPrompt,
  type ProviderPromptSanitizerResult,
} from '../providerPromptSanitizer';
import {
  ProviderOutputError,
  type ProviderOutputParseFailure,
  extractProviderVideoUrl,
  parseProviderVideoOutput,
} from '../providerOutputParser';

export const SEEDANCE_FAST_MODEL = 'bytedance/seedance-2.0-fast';
export const SEEDANCE_QUALITY_MODEL = 'bytedance/seedance-2.0';

export type SeedanceQualityMode = 'fast' | 'quality';
export type SeedanceAspectRatio = '9:16' | '16:9' | '1:1';
export type SeedanceResolution = '480p' | '720p' | '1080p';

const DEFAULT_SEEDANCE_SETTINGS = {
  duration: 5,
  aspect_ratio: '16:9',
  resolution: '720p',
} as const;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 180_000;

export type SeedanceSettings = {
  duration: number;
  aspect_ratio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  generate_audio?: boolean;
};

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
  settings: SeedanceSettings;
};

export type SeedanceReferenceImage = {
  url: string;
  label?: string;
  role?: string;
  token?: string;
};

export type SeedancePredictionEvent = {
  prediction: Prediction;
  model: typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL;
  quality: SeedanceQualityMode;
  referenceImages: SeedanceReferenceImage[];
  referenceImageCount: number;
  prompt: string;
  attemptLabel: string;
  renderingMode: ModerationRenderingMode;
  providerFallbackStage?: string | null;
};

export type SeedanceModerationDiagnostics = {
  detected: boolean;
  provider: 'replicate';
  model: string;
  retryAttempted: boolean;
  retrySucceeded: boolean;
  retryMode: string | null;
  providerJobId: string | null;
  providerStatus: string | null;
  providerMessage: string;
  sanitizedPrompt: string;
  suggestedPrompt: string;
  referenceImageCount: number;
  category?: ModerationCategory | null;
  categories?: ModerationCategory[];
  escalationLevel?: number | null;
  rewriteStrategy?: string | null;
  renderingMode?: ModerationRenderingMode | null;
  realismModeSelected?: ModerationRenderingMode | null;
  providerProfile?: string | null;
  providerSensitivityProfile?: ModerationProviderSensitivityProfile | null;
  orchestrationPath?: Array<{
    escalationLevel: number;
    rewriteStrategy: string;
    renderingMode: ModerationRenderingMode;
    realismModeSelected: ModerationRenderingMode;
    stageMessage: string;
    categories: ModerationCategory[];
    providerProfile: string;
    providerFallbackReady?: boolean;
  }>;
  retryStages?: string[];
  finalSuccessfulOrchestrationPath?: string | null;
  successfulFallbackPath?: string | null;
  moderationMemoryApplied?: boolean;
  providerFallbackReady?: boolean;
};

type GenerateSeedanceVideoOptions = {
  quality?: SeedanceQualityMode;
  timeoutMs?: number;
  pollIntervalMs?: number;
  referenceImages?: SeedanceReferenceImage[];
  userId?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterDisplayName?: string | null;
  projectId?: string | null;
  providerFallbackStage?: string | null;
  durationSeconds?: number | null;
  aspectRatio?: SeedanceAspectRatio | string | null;
  resolution?: SeedanceResolution | string | null;
  generateAudio?: boolean | null;
  onPredictionCreated?: (event: SeedancePredictionEvent) => void | Promise<void>;
  onPredictionPolled?: (event: SeedancePredictionEvent) => void | Promise<void>;
};

export type SeedanceProviderPayload = {
  prompt: string;
  duration: number;
  aspect_ratio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  reference_images?: string[];
  generate_audio?: boolean;
};

export type SeedancePayloadValidationIssue = {
  field: string;
  valueSummary: string;
  expected: string;
};

export type SeedancePayloadValidationResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: SeedancePayloadValidationIssue[] };

export class SeedanceInputSchemaError extends Error {
  readonly category = 'input_schema_invalid';
  readonly issues: SeedancePayloadValidationIssue[];

  constructor(issues: SeedancePayloadValidationIssue[]) {
    super('Seedance provider payload is invalid.');
    this.name = 'SeedanceInputSchemaError';
    this.issues = issues;
  }
}

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

export function extractVideoUrl(output: unknown): string | null {
  return extractProviderVideoUrl(output);
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

function buildMultimodalSeedancePrompt(
  prompt: string,
  referenceImages: SeedanceReferenceImage[],
  renderingMode: ModerationRenderingMode = 'cinematic realism',
) {
  if (!referenceImages.length) return prompt;

  const tokens = referenceImages.map((reference, index) => reference.token ?? `[Image${index + 1}]`).join('');
  return [
    `The cinematic character from ${tokens}.`,
    'Use all provided images as visual continuity references for face, side angles, full body, expressions, and outfit details.',
    'Do not use any reference image as the first frame. Do not animate, copy, or recreate a single source photo.',
    `Generate a fresh ${renderingMode} scene with consistent visual continuity across shots.`,
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
  return rewritePromptForEscalationLevel({
    prompt,
    provider: 'seedance',
    level: 4,
  }).prompt;
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

export class ReplicateRateLimitError extends Error {
  readonly statusCode = 429;
  readonly retryAfterMs: number | null;
  readonly retryAfterSeconds: number | null;
  readonly retryAvailableAt: string | null;
  readonly providerMessage: string;

  constructor(input: {
    message?: string;
    retryAfterMs?: number | null;
    providerMessage?: string | null;
  }) {
    const retryAfterMs = input.retryAfterMs ?? null;
    const retryAfterSeconds = typeof retryAfterMs === 'number'
      ? Math.max(1, Math.ceil(retryAfterMs / 1000))
      : null;
    super(input.message ?? (
      retryAfterSeconds
        ? `Render queue is cooling down. Lumora will resume automatically in about ${retryAfterSeconds} seconds.`
        : 'Render queue is cooling down. Lumora will resume automatically.'
    ));
    this.name = 'ReplicateRateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryAvailableAt = typeof retryAfterMs === 'number'
      ? new Date(Date.now() + retryAfterMs).toISOString()
      : null;
    this.providerMessage = input.providerMessage ?? this.message;
  }
}

export function isReplicateRateLimitError(error: unknown): error is ReplicateRateLimitError {
  return error instanceof ReplicateRateLimitError || (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'ReplicateRateLimitError'
  );
}

function responseStatus(error: unknown): number | null {
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : null;
}

function errorMessageText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function retryAfterMsFromMessage(error: unknown): number | null {
  const message = errorMessageText(error);
  const secondsMatch = message.match(/(?:retry|reset)[^\d~]*(?:in\s*)?~?\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i) ??
    message.match(/~?\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  const minuteMatch = message.match(/~?\s*(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes)) return Math.max(0, minutes * 60_000);
  }
  return null;
}

function retryAfterMsForError(error: unknown) {
  return retryAfterMs(error) ?? retryAfterMsFromMessage(error);
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
    retryAfterMs: retryAfterMsForError(error),
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
    if (status === 429) {
      logReplicateError('rate_limited', error, context);
      const waitMs = retryAfterMsForError(error) ?? 10_000;
      throw new ReplicateRateLimitError({
        retryAfterMs: waitMs,
        providerMessage: errorMessageText(error),
      });
    }

    if (status !== 429 && status !== 503 && status !== 504) {
      logReplicateError('request_failed', error, context);
      throw error;
    }

    const waitMs = retryAfterMsForError(error) ?? 6_000;
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
  quality: SeedanceQualityMode;
  prompt: string;
  referenceImages: SeedanceReferenceImage[];
  attemptLabel: string;
  renderingMode: ModerationRenderingMode;
  providerFallbackStage?: string | null;
  timeoutMs: number;
  pollIntervalMs: number;
  onPredictionPolled?: (event: SeedancePredictionEvent) => void | Promise<void>;
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
    await input.onPredictionPolled?.({
      prediction,
      model: input.model as typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL,
      quality: input.quality,
      referenceImages: input.referenceImages,
      referenceImageCount: input.referenceImages.length,
      prompt: input.prompt,
      attemptLabel: input.attemptLabel,
      renderingMode: input.renderingMode,
      providerFallbackStage: input.providerFallbackStage,
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

  await input.onPredictionPolled?.({
    prediction,
    model: input.model as typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL,
    quality: input.quality,
    referenceImages: input.referenceImages,
    referenceImageCount: input.referenceImages.length,
    prompt: input.prompt,
    attemptLabel: input.attemptLabel,
    renderingMode: input.renderingMode,
    providerFallbackStage: input.providerFallbackStage,
  });

  return prediction;
}

function normalizedDurationSeconds(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SEEDANCE_SETTINGS.duration;
  const rounded = Math.round(value);
  return rounded <= 5 ? 5 : 10;
}

function normalizedAspectRatio(value?: string | null): SeedanceAspectRatio {
  return value === '9:16' || value === '1:1' || value === '16:9'
    ? value
    : DEFAULT_SEEDANCE_SETTINGS.aspect_ratio;
}

function normalizedResolution(value?: string | null): SeedanceResolution {
  return value === '480p' || value === '720p' || value === '1080p'
    ? value
    : DEFAULT_SEEDANCE_SETTINGS.resolution;
}

function settingsForOptions(options: GenerateSeedanceVideoOptions): SeedanceSettings {
  const settings: SeedanceSettings = {
    ...DEFAULT_SEEDANCE_SETTINGS,
    duration: normalizedDurationSeconds(options.durationSeconds),
    aspect_ratio: normalizedAspectRatio(options.aspectRatio),
    resolution: normalizedResolution(options.resolution),
  };
  if (typeof options.generateAudio === 'boolean') settings.generate_audio = options.generateAudio;
  return settings;
}

function buildSeedanceRequestInput(
  prompt: string,
  referenceImages: SeedanceReferenceImage[],
  settings: SeedanceSettings,
) {
  return {
    prompt,
    ...(referenceImages.length
      ? { reference_images: referenceImages.map((reference) => reference.url) }
      : {}),
    ...settings,
  };
}

function payloadValueSummary(value: unknown) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        return `[url host=${url.host}]`;
      } catch {
        return '[url]';
      }
    }
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (value == null) return String(value);
  return typeof value === 'object' ? `object(keys=${Object.keys(value as Record<string, unknown>).join(',')})` : String(value);
}

export function validateSeedanceProviderPayload(payload: unknown): SeedancePayloadValidationResult {
  const issues: SeedancePayloadValidationIssue[] = [];
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;

  if (!record) {
    return {
      ok: false,
      issues: [{
        field: '$',
        valueSummary: payloadValueSummary(payload),
        expected: 'object with prompt, duration, aspect_ratio, and resolution',
      }],
    };
  }

  const allowedKeys = new Set(['prompt', 'duration', 'aspect_ratio', 'resolution', 'reference_images', 'generate_audio']);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        field: key,
        valueSummary: payloadValueSummary(record[key]),
        expected: 'known Seedance input field',
      });
    }
  }

  if (typeof record.prompt !== 'string' || !record.prompt.trim()) {
    issues.push({
      field: 'prompt',
      valueSummary: payloadValueSummary(record.prompt),
      expected: 'non-empty string',
    });
  }

  if (record.duration !== 5 && record.duration !== 10) {
    issues.push({
      field: 'duration',
      valueSummary: payloadValueSummary(record.duration),
      expected: '5 or 10 seconds',
    });
  }

  if (record.aspect_ratio !== '9:16' && record.aspect_ratio !== '16:9' && record.aspect_ratio !== '1:1') {
    issues.push({
      field: 'aspect_ratio',
      valueSummary: payloadValueSummary(record.aspect_ratio),
      expected: '9:16, 16:9, or 1:1',
    });
  }

  if (record.resolution !== '480p' && record.resolution !== '720p' && record.resolution !== '1080p') {
    issues.push({
      field: 'resolution',
      valueSummary: payloadValueSummary(record.resolution),
      expected: '480p, 720p, or 1080p',
    });
  }

  if ('generate_audio' in record && typeof record.generate_audio !== 'boolean') {
    issues.push({
      field: 'generate_audio',
      valueSummary: payloadValueSummary(record.generate_audio),
      expected: 'boolean when provided',
    });
  }

  if ('reference_images' in record) {
    if (!Array.isArray(record.reference_images)) {
      issues.push({
        field: 'reference_images',
        valueSummary: payloadValueSummary(record.reference_images),
        expected: 'array of http(s) image URLs',
      });
    } else {
      record.reference_images.forEach((value, index) => {
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
          issues.push({
            field: `reference_images[${index}]`,
            valueSummary: payloadValueSummary(value),
            expected: 'http(s) image URL string',
          });
        }
      });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

export function seedancePayloadSummary(payload: SeedanceProviderPayload) {
  return {
    keys: Object.keys(payload),
    promptLength: payload.prompt.length,
    duration: payload.duration,
    aspect_ratio: payload.aspect_ratio,
    resolution: payload.resolution,
    generate_audio: typeof payload.generate_audio === 'boolean' ? payload.generate_audio : 'omitted',
    reference_images: payload.reference_images
      ? payload.reference_images.map((url) => payloadValueSummary(url))
      : [],
    referenceCount: payload.reference_images?.length ?? 0,
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
  categories?: ModerationCategory[];
  attempt?: ModerationOrchestrationAttempt | null;
  orchestrationPath?: ModerationOrchestrationAttempt[];
  moderationMemoryApplied?: boolean;
  finalSuccessfulOrchestrationPath?: string | null;
}): SeedanceModerationDiagnostics {
  const categories = input.categories ?? input.attempt?.categories ?? [];
  const orchestrationPath = input.orchestrationPath ?? [];
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
    category: categories[0] ?? null,
    categories,
    escalationLevel: input.attempt?.escalationLevel ?? null,
    rewriteStrategy: input.attempt?.rewriteStrategy ?? null,
    renderingMode: input.attempt?.renderingMode ?? null,
    realismModeSelected: input.attempt?.realismModeSelected ?? null,
    providerProfile: input.attempt?.providerProfile ?? moderationProviderProfiles.seedance.label,
    providerSensitivityProfile: providerSensitivityProfile(moderationProviderProfiles.seedance),
    orchestrationPath: orchestrationPath.map((attempt) => ({
      escalationLevel: attempt.escalationLevel,
      rewriteStrategy: attempt.rewriteStrategy,
      renderingMode: attempt.renderingMode,
      realismModeSelected: attempt.realismModeSelected,
      stageMessage: attempt.stageMessage,
      categories: attempt.categories,
      providerProfile: attempt.providerProfile,
      providerFallbackReady: attempt.providerFallbackReady,
    })),
    retryStages: moderationRetryStages(orchestrationPath),
    finalSuccessfulOrchestrationPath: input.finalSuccessfulOrchestrationPath ?? null,
    successfulFallbackPath: input.finalSuccessfulOrchestrationPath ?? null,
    moderationMemoryApplied: Boolean(input.moderationMemoryApplied),
    providerFallbackReady: Boolean(input.attempt?.providerFallbackReady),
  };
}

async function runSeedanceAttempt(input: {
  replicate: Replicate;
  model: typeof SEEDANCE_FAST_MODEL | typeof SEEDANCE_QUALITY_MODEL;
  quality: SeedanceQualityMode;
  prompt: string;
  referenceImages: SeedanceReferenceImage[];
  sanitizer: ProviderPromptSanitizerResult;
  settings: SeedanceSettings;
  timeoutMs: number;
  pollIntervalMs: number;
  attemptLabel: string;
  renderingMode: ModerationRenderingMode;
  providerFallbackStage?: string | null;
  onPredictionCreated?: (event: SeedancePredictionEvent) => void | Promise<void>;
  onPredictionPolled?: (event: SeedancePredictionEvent) => void | Promise<void>;
}) {
  const requestInput = buildSeedanceRequestInput(input.prompt, input.referenceImages, input.settings);
  const validation = validateSeedanceProviderPayload(requestInput);
  if (!validation.ok) {
    console.warn('SEEDANCE PAYLOAD VALIDATION FAILED:', {
      model: input.model,
      quality: input.quality,
      attempt: input.attemptLabel,
      issues: validation.issues,
    });
    throw new SeedanceInputSchemaError(validation.issues);
  }

  console.info('SEEDANCE PROVIDER REQUEST:', {
    model: input.model,
    quality: input.quality,
    attempt: input.attemptLabel,
    inputKeys: Object.keys(requestInput),
    referenceImageCount: input.referenceImages.length,
    promptLength: input.prompt.length,
    displayNameMasked: input.sanitizer.displayNameMasked,
    riskyTermsRemoved: input.sanitizer.riskyTermsRemoved,
    socialPhrasesRemoved: input.sanitizer.socialPhrasesRemoved,
    artifactsRemoved: input.sanitizer.artifactsRemoved,
    renderingMode: input.renderingMode,
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
  await input.onPredictionCreated?.({
    prediction,
    model: input.model,
    quality: input.quality,
    referenceImages: input.referenceImages,
    referenceImageCount: input.referenceImages.length,
    prompt: input.prompt,
    attemptLabel: input.attemptLabel,
    renderingMode: input.renderingMode,
    providerFallbackStage: input.providerFallbackStage,
  });

  const completedPrediction = await pollPrediction({
    replicate: input.replicate,
    prediction,
    model: input.model,
    quality: input.quality,
    prompt: input.prompt,
    referenceImages: input.referenceImages,
    attemptLabel: input.attemptLabel,
    renderingMode: input.renderingMode,
    providerFallbackStage: input.providerFallbackStage,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
    onPredictionPolled: input.onPredictionPolled,
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

  const outputParse = parseProviderVideoOutput(completedPrediction.output);

  if (!outputParse.ok) {
    throw new ProviderOutputError(outputParse as ProviderOutputParseFailure);
  }

  return {
    completedPrediction,
    videoUrl: outputParse.videoUrl,
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
  const settings = settingsForOptions(options);
  const orchestrationPlan = await createModerationOrchestrationPlan({
    prompt: safePrompt,
    provider: 'seedance',
    userId: options.userId,
    characterId: options.characterId,
    referenceImageCount: referenceImages.length,
  });
  const orchestrationPath: ModerationOrchestrationAttempt[] = [];
  let lastProviderResponse: unknown = null;
  let lastPrediction: Prediction | null = null;
  let lastDiagnostics: SeedanceModerationDiagnostics | null = null;

  console.info('SEEDANCE MULTIMODAL REFERENCES:', {
    model,
    quality,
    count: referenceImages.length,
    references: referenceImages.map((reference) => ({
      token: reference.token,
      label: reference.label ?? null,
      role: reference.role ?? null,
    })),
  });

  for (const orchestrationAttempt of orchestrationPlan.attempts) {
    const rawFinalPrompt = buildMultimodalSeedancePrompt(
      orchestrationAttempt.prompt,
      referenceImages,
      orchestrationAttempt.renderingMode,
    );
    const finalSanitizer = sanitizeProviderPrompt({
      prompt: rawFinalPrompt,
      characterName: options.characterName,
      characterDisplayName: options.characterDisplayName,
    });
    const finalPrompt = finalSanitizer.prompt;
    orchestrationPath.push(orchestrationAttempt);

    console.info('SEEDANCE FINAL PROMPT:', {
      model,
      promptLength: finalPrompt.length,
      sanitizedChanged: orchestrationAttempt.changed,
      replacements: orchestrationAttempt.replacements,
      finalSanitizerChanged: finalSanitizer.changed,
      displayNameMasked: finalSanitizer.displayNameMasked,
      riskyTermsRemoved: finalSanitizer.riskyTermsRemoved,
      socialPhrasesRemoved: finalSanitizer.socialPhrasesRemoved,
      artifactsRemoved: finalSanitizer.artifactsRemoved,
      escalationLevel: orchestrationAttempt.escalationLevel,
      rewriteStrategy: orchestrationAttempt.rewriteStrategy,
      renderingMode: orchestrationAttempt.renderingMode,
      realismModeSelected: orchestrationAttempt.realismModeSelected,
      providerProfile: orchestrationAttempt.providerProfile,
      moderationMemoryApplied: orchestrationPlan.moderationMemoryApplied,
    });
    logProviderPromptFinalization({
      providerId: model,
      originalPrompt: rawFinalPrompt,
      sanitizer: finalSanitizer,
      referenceCount: referenceImages.length,
      renderingMode: orchestrationAttempt.renderingMode,
      fallbackStage: options.providerFallbackStage ?? orchestrationAttempt.attemptLabel,
    });
    logModerationOrchestration({
      event: 'attempt',
      attempt: orchestrationAttempt,
      providerProfile: orchestrationPlan.providerProfile,
      orchestrationPath,
    });

    try {
      const attempt = await runSeedanceAttempt({
        replicate,
        model,
        quality,
        prompt: finalPrompt,
        referenceImages,
        sanitizer: finalSanitizer,
        settings,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        attemptLabel: orchestrationAttempt.attemptLabel,
        renderingMode: orchestrationAttempt.renderingMode,
        providerFallbackStage: options.providerFallbackStage ?? orchestrationAttempt.attemptLabel,
        onPredictionCreated: options.onPredictionCreated,
        onPredictionPolled: options.onPredictionPolled,
      });
      const finalSuccessfulOrchestrationPath = orchestrationPath
        .map((pathAttempt) => `${pathAttempt.attemptLabel}:${pathAttempt.realismModeSelected}`)
        .join(' -> ');
      const retryAttempted = orchestrationPath.length > 1;
      const successDiagnostics = (retryAttempted || orchestrationPlan.moderationMemoryApplied || orchestrationAttempt.escalationLevel > 1)
        ? moderationDiagnostics({
            model,
            prediction: attempt.completedPrediction,
            providerResponse: {
              status: attempt.completedPrediction.status,
              logs: attempt.completedPrediction.logs,
            },
            retryAttempted,
            retrySucceeded: retryAttempted,
            retryMode: orchestrationAttempt.rewriteStrategy,
            sanitizedPrompt: finalPrompt,
            suggestedPrompt: orchestrationAttempt.prompt,
            referenceImageCount: referenceImages.length,
            categories: orchestrationAttempt.categories,
            attempt: orchestrationAttempt,
            orchestrationPath,
            moderationMemoryApplied: orchestrationPlan.moderationMemoryApplied,
            finalSuccessfulOrchestrationPath,
          })
        : undefined;
      const moderationWarnings = [
        ...(retryAttempted
          ? ['Provider moderation blocked an earlier Seedance attempt, so Lumora escalated to safer cinematic orchestration automatically.']
          : []),
        ...(orchestrationPlan.moderationMemoryApplied
          ? ['Lumora applied saved moderation-safe rendering preferences for this character/provider.']
          : []),
        ...(orchestrationAttempt.changed
          ? ['Lumora softened provider-sensitive wording while preserving character continuity and storyboard intent.']
          : []),
      ];

      logModerationOrchestration({
        event: 'succeeded',
        attempt: orchestrationAttempt,
        providerProfile: orchestrationPlan.providerProfile,
        orchestrationPath,
      });
      await recordModerationOrchestrationResult({
        userId: options.userId,
        characterId: options.characterId,
        provider: 'seedance',
        originalPrompt: safePrompt,
        categories: orchestrationAttempt.categories,
        attempt: orchestrationAttempt,
        orchestrationPath,
        success: true,
        providerMessage: attempt.completedPrediction.logs ?? null,
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
            ? ['Only one reference image was sent to Seedance. Add side, full-body, expression, or outfit references for stronger multimodal visual continuity.']
            : []),
          ...moderationWarnings,
        ],
        moderationDiagnostics: successDiagnostics,
        suggestedPrompt: orchestrationAttempt.prompt,
        sanitizedPrompt: finalPrompt,
        rawOutput: attempt.completedPrediction.output,
        logs: attempt.completedPrediction.logs,
        metrics: attempt.completedPrediction.metrics,
        settings,
      };
    } catch (error) {
      if (!isSeedanceModerationResponse(error)) {
        throw error;
      }

      const moderationError = error as {
        prediction?: Prediction;
        providerResponse?: unknown;
      };
      const providerResponse = moderationError.providerResponse ?? error;
      const providerCategories = detectModerationCategories({
        prompt: finalPrompt,
        providerResponse,
        referenceImageCount: referenceImages.length,
        includeUnknownFallback: true,
      });
      const enrichedAttempt: ModerationOrchestrationAttempt = {
        ...orchestrationAttempt,
        categories: Array.from(new Set([
          ...orchestrationAttempt.categories,
          ...providerCategories,
        ])),
      };
      orchestrationPath[orchestrationPath.length - 1] = enrichedAttempt;
      lastProviderResponse = providerResponse;
      lastPrediction = moderationError.prediction ?? null;
      lastDiagnostics = moderationDiagnostics({
        model,
        prediction: lastPrediction,
        providerResponse,
        retryAttempted: true,
        retrySucceeded: false,
        retryMode: enrichedAttempt.rewriteStrategy,
        sanitizedPrompt: finalPrompt,
        suggestedPrompt: enrichedAttempt.prompt,
        referenceImageCount: referenceImages.length,
        categories: enrichedAttempt.categories,
        attempt: enrichedAttempt,
        orchestrationPath,
        moderationMemoryApplied: orchestrationPlan.moderationMemoryApplied,
      });
      console.warn('SEEDANCE MODERATION DIAGNOSTICS:', lastDiagnostics);
      logModerationOrchestration({
        event: 'blocked',
        attempt: enrichedAttempt,
        providerMessage: providerResponseText(providerResponse),
        providerProfile: orchestrationPlan.providerProfile,
        orchestrationPath,
      });
    }
  }

  const failedAttempt = orchestrationPath[orchestrationPath.length - 1] ?? null;
  const rawSuggestedPrompt = failedAttempt?.prompt ?? safeCinematicRewrite(safePrompt);
  const suggestedPrompt = sanitizeProviderPrompt({
    prompt: rawSuggestedPrompt,
    characterName: options.characterName,
    characterDisplayName: options.characterDisplayName,
  }).prompt;
  const failedCategories = failedAttempt?.categories.length
    ? failedAttempt.categories
    : detectModerationCategories({
        prompt: safePrompt,
        providerResponse: lastProviderResponse,
        referenceImageCount: referenceImages.length,
        includeUnknownFallback: true,
      });
  const diagnostics = lastDiagnostics ?? moderationDiagnostics({
    model,
    prediction: lastPrediction,
    providerResponse: lastProviderResponse,
    retryAttempted: orchestrationPath.length > 1,
    retrySucceeded: false,
    retryMode: failedAttempt?.rewriteStrategy ?? 'provider fallback orchestration',
    sanitizedPrompt: suggestedPrompt,
    suggestedPrompt,
    referenceImageCount: referenceImages.length,
    categories: failedCategories,
    attempt: failedAttempt,
    orchestrationPath,
    moderationMemoryApplied: orchestrationPlan.moderationMemoryApplied,
  });

  logModerationOrchestration({
    event: 'failed',
    attempt: failedAttempt,
    providerMessage: providerResponseText(lastProviderResponse),
    providerProfile: orchestrationPlan.providerProfile,
    orchestrationPath,
  });
  await recordModerationOrchestrationResult({
    userId: options.userId,
    characterId: options.characterId,
    provider: 'seedance',
    originalPrompt: safePrompt,
    categories: failedCategories,
    attempt: failedAttempt,
    orchestrationPath,
    success: false,
    providerMessage: providerResponseText(lastProviderResponse),
  });

  throw new SeedanceModerationError({
    message: 'Seedance moderation paused this render after Lumora tried moderation-safe cinematic orchestration.',
    suggestedPrompt,
    sanitizedPrompt: suggestedPrompt,
    diagnostics,
    referenceImages,
  });
}
