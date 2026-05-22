import { createHash, randomUUID } from 'node:crypto';
import Replicate, { type Prediction } from 'replicate';
import { env } from '../lib/env';
import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { createVideoGeneration } from '../video';
import {
  SEEDANCE_FAST_MODEL,
  SEEDANCE_QUALITY_MODEL,
  generateSeedanceVideo,
  isReplicateRateLimitError,
  isSeedanceModerationError,
  type SeedancePredictionEvent,
  type SeedanceAspectRatio,
  type SeedanceQualityMode,
  type SeedanceResolution,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';
import { isProviderOutputError, parseProviderVideoOutput } from './providerOutputParser';
import { scoreReferenceConfidence } from './sceneOptimization';
import { buildReferenceImagePrompt, getReferenceCanaryReadiness } from './seedanceCanary';

export const DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT =
  'the cast character gently moves through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, calm mood, gentle camera motion';

export const ULTRA_SAFE_SCENE_PROVIDER_PROMPT =
  'the cast character walks through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion';

export const FIRST_VIDEO_RESCUE_PROVIDER_PROMPT =
  'the cast character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion';

const RENDER_SUCCESS_ACTIVE_STATUSES = ['queued', 'rendering', 'processing', 'rate_limited'] as const;
const RENDER_SUCCESS_TOTAL_ATTEMPTS = 5;
const RENDER_SUCCESS_DURATION_SECONDS = 5;
const RENDER_SUCCESS_ASPECT_RATIO: SeedanceAspectRatio = '16:9';
const FIRST_VIDEO_RESCUE_ASPECT_RATIO: SeedanceAspectRatio = '9:16';
const RENDER_SUCCESS_RESOLUTION: SeedanceResolution = '480p';
const RENDER_SUCCESS_GENERATE_AUDIO = false;
const RENDER_SUCCESS_TIMEOUT_MS = 12 * 60 * 1000;
const RENDER_SUCCESS_POLL_INTERVAL_MS = 4_000;
const MAX_RATE_LIMIT_DELAY_MS = 10 * 60 * 1000;
const RATE_LIMIT_SAFETY_BUFFER_MS = 2_000;

export type RenderSuccessProvider = 'seedance-fast' | 'seedance-quality' | 'demo-mode';
export type RenderSuccessAttemptStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'rate_limited' | 'skipped';
export type RenderSuccessPromptStyle = 'safe_garden' | 'storybook_cinematic' | 'identity_light' | 'first_video_rescue' | 'demo';
export type RenderSuccessStyleMode = 'storybook_cinematic' | 'ultra_safe' | 'first_video_rescue' | 'demo';

export type RenderSuccessAttempt = {
  tier: 1 | 2 | 3 | 4 | 5;
  provider: RenderSuccessProvider;
  providerModel: string;
  quality: SeedanceQualityMode | 'demo';
  durationSeconds: number;
  aspectRatio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  generateAudio: boolean;
  referenceImages: SeedanceReferenceImage[];
  referenceCount: number;
  prompt: string;
  promptStyle: RenderSuccessPromptStyle;
  styleMode: RenderSuccessStyleMode;
  paid: boolean;
  label: string;
  progressLabel: string;
  lighterCastGuidance: boolean;
};

type RenderSuccessRecipe = {
  provider: string | null;
  providerModel: string | null;
  attemptTier: number | null;
  referenceCount: number | null;
  promptStyle: string | null;
};

type RenderSuccessEngineMetadata = {
  role: 'master' | 'attempt';
  groupId: string;
  masterJobId?: string | null;
  prompt: string;
  title?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  referenceImages?: SeedanceReferenceImage[];
  attempt?: RenderSuccessAttempt;
  allowDemoFallback?: boolean;
  maxPaidAttempts?: number;
  maxTotalAttempts?: number;
  firstVideoRescue?: boolean;
  progressLabel?: string;
  createdAt?: string;
};

type RenderSuccessJobRow = {
  id: string;
  userId: string;
  projectId: string | null;
  provider: string;
  providerJobId: string | null;
  providerPredictionId: string | null;
  providerPredictionUrl: string | null;
  providerStatus: string | null;
  providerName: string | null;
  providerModel: string | null;
  outputType: string;
  prompt: string;
  status: string;
  characterId: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  privacy: string;
  resultAssetUrl: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  errorCategory: string | null;
  renderMode: string | null;
  providerFallbackStage: string | null;
  referenceCount: number | null;
  sceneMetadata: Record<string, unknown> | null;
  retryCount: number;
  retryAfterSeconds: number | null;
  retryAvailableAt: string | null;
  createdAt: string;
  updatedAt: string;
  renderSuccessGroupId: string | null;
  renderSuccessRole: string | null;
  renderSuccessAttemptTier: number | null;
  renderSuccessPromptStyle: string | null;
  renderSuccessReferenceCount: number | null;
  renderSuccessPaid: boolean | null;
  renderSuccessParentJobId: string | null;
};

export type StartRenderSuccessJobInput = {
  prompt: string;
  title?: string | null;
  userId: string;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  referenceImages?: SeedanceReferenceImage[];
  allowDemoFallback?: boolean;
  maxPaidAttempts?: number;
  maxTotalAttempts?: number;
  forceProbe?: boolean;
  firstVideoRescue?: boolean;
};

const activeRenderSuccessProcessors = new Set<string>();
const resumeTimers = new Map<string, NodeJS.Timeout>();
let paidAttemptsPrevented = 0;
let duplicateRenderPrevented = 0;
let providerOutputMissingCount = 0;

const renderSuccessRuntimeStats = {
  enabled: true,
  totalAttempts: 0,
  completedAttempts: 0,
  failedAttempts: 0,
  moderationBlocksByTier: new Map<number, number>(),
  rateLimitsByProvider: new Map<string, number>(),
  lastSuccessfulRecipe: null as Record<string, unknown> | null,
};

const renderSuccessJobSelect = `
  id,
  user_id as "userId",
  project_id as "projectId",
  provider,
  provider_job_id as "providerJobId",
  provider_prediction_id as "providerPredictionId",
  provider_prediction_url as "providerPredictionUrl",
  provider_status as "providerStatus",
  provider_name as "providerName",
  provider_model as "providerModel",
  output_type as "outputType",
  prompt,
  status,
  character_id as "characterId",
  duration_seconds as "durationSeconds",
  aspect_ratio as "aspectRatio",
  privacy,
  result_asset_url as "resultAssetUrl",
  output_url as "outputUrl",
  thumbnail_url as "thumbnailUrl",
  error_message as "errorMessage",
  error_category as "errorCategory",
  render_mode as "renderMode",
  provider_fallback_stage as "providerFallbackStage",
  reference_count as "referenceCount",
  scene_metadata as "sceneMetadata",
  retry_count as "retryCount",
  retry_after_seconds as "retryAfterSeconds",
  retry_available_at as "retryAvailableAt",
  created_at as "createdAt",
  updated_at as "updatedAt",
  render_success_group_id as "renderSuccessGroupId",
  render_success_role as "renderSuccessRole",
  render_success_attempt_tier as "renderSuccessAttemptTier",
  render_success_prompt_style as "renderSuccessPromptStyle",
  render_success_reference_count as "renderSuccessReferenceCount",
  render_success_paid as "renderSuccessPaid",
  render_success_parent_job_id as "renderSuccessParentJobId"
`;

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recordMapValue<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function safeErrorMessage(error: unknown) {
  if (isReplicateRateLimitError(error)) {
    return 'Render queue is cooling down. Lumora will resume automatically.';
  }
  if (isSeedanceModerationError(error)) {
    return 'This scene needs a simpler direction before rendering.';
  }
  if (isProviderOutputError(error)) {
    return 'Provider completed without a usable video output.';
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('moderation') || lower.includes('sensitive') || lower.includes('policy')) {
    return 'This scene needs a simpler direction before rendering.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'This scene is still processing. Lumora will keep checking.';
  }
  if (lower.includes('configured') || lower.includes('token')) {
    return 'The renderer is not configured for this environment.';
  }
  return 'Lumora could not complete this render path.';
}

function displayNameCandidates(displayName?: string | null) {
  if (!displayName) return [];
  const cleaned = displayName.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return Array.from(new Set([
    cleaned,
    ...cleaned.split(/\s+/).filter((part) => part.length >= 3),
  ])).sort((left, right) => right.length - left.length);
}

export function sanitizeSuccessProviderPrompt(input: {
  prompt?: string | null;
  characterName?: string | null;
}) {
  let prompt = collapseWhitespace(input.prompt || DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT);
  for (const candidate of displayNameCandidates(input.characterName)) {
    prompt = prompt.replace(new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'gi'), 'the cast character');
  }

  const rewrites: Array<[RegExp, string]> = [
    [/\bphoto\s*shoot\b/gi, 'cinematic scene'],
    [/\bphotoshoot\b/gi, 'cinematic scene'],
    [/\binfluencer\b/gi, 'creator'],
    [/\bsuperstar\b/gi, 'confident protagonist'],
    [/\bmodel\b/gi, 'character'],
    [/\bglamou?r\b/gi, 'soft cinematic'],
    [/\bcelebrity\b/gi, ''],
    [/\bpublic\s+figure\b/gi, ''],
    [/\bfashion\s+editorial\b/gi, 'storybook cinematic'],
    [/\beditorial\b/gi, 'cinematic'],
  ];

  for (const [pattern, replacement] of rewrites) {
    prompt = prompt.replace(pattern, replacement);
  }

  prompt = collapseWhitespace(prompt)
    .replace(/\bthe cast character\s+the cast character\b/gi, 'the cast character')
    .replace(/^[:,.\s]+|[:,.\s]+$/g, '');

  if (!prompt.toLowerCase().includes('fully clothed')) {
    prompt = `${prompt}, fully clothed`;
  }
  if (!prompt.toLowerCase().includes('natural movement')) {
    prompt = `${prompt}, natural movement`;
  }

  return collapseWhitespace(prompt);
}

function referenceText(reference: SeedanceReferenceImage) {
  return `${reference.label ?? ''} ${reference.role ?? ''} ${reference.token ?? ''}`.toLowerCase();
}

function isManualReference(reference: SeedanceReferenceImage) {
  const text = referenceText(reference);
  return text.includes('manual_reference_override') ||
    text.includes('manual reference') ||
    text.includes('manual override');
}

function strongestSavedReferences(references: SeedanceReferenceImage[]) {
  const seen = new Set<string>();
  return references
    .filter((reference) => {
      if (!reference.url || seen.has(reference.url) || isManualReference(reference)) return false;
      seen.add(reference.url);
      const confidence = scoreReferenceConfidence(reference);
      return confidence.savedToLumora && !confidence.reasons.includes('Protected or temporary source');
    })
    .sort((left, right) => scoreReferenceConfidence(right).score - scoreReferenceConfidence(left).score)
    .map((reference, index) => ({
      ...reference,
      token: `[Image${index + 1}]`,
    }));
}

function promptWithReferenceTokens(prompt: string, references: SeedanceReferenceImage[]) {
  if (!references.length) return prompt;
  const tokens = references.map((reference, index) => reference.token ?? `[Image${index + 1}]`);
  if (tokens.every((token) => prompt.includes(token))) return prompt;
  return collapseWhitespace(`The character from ${tokens.join(', ')}. ${prompt}`);
}

function providerModelForQuality(quality: SeedanceQualityMode | 'demo') {
  if (quality === 'quality') return SEEDANCE_QUALITY_MODEL;
  if (quality === 'fast') return SEEDANCE_FAST_MODEL;
  return 'demo-mode';
}

function providerForQuality(quality: SeedanceQualityMode | 'demo'): RenderSuccessProvider {
  if (quality === 'quality') return 'seedance-quality';
  if (quality === 'fast') return 'seedance-fast';
  return 'demo-mode';
}

function makeAttempt(input: {
  tier: RenderSuccessAttempt['tier'];
  quality: SeedanceQualityMode | 'demo';
  referenceImages: SeedanceReferenceImage[];
  prompt: string;
  promptStyle: RenderSuccessPromptStyle;
  styleMode: RenderSuccessStyleMode;
  label: string;
  progressLabel: string;
  lighterCastGuidance?: boolean;
  paid?: boolean;
  durationSeconds?: number;
  aspectRatio?: SeedanceAspectRatio;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
}): RenderSuccessAttempt {
  return {
    tier: input.tier,
    provider: providerForQuality(input.quality),
    providerModel: providerModelForQuality(input.quality),
    quality: input.quality,
    durationSeconds: input.durationSeconds ?? RENDER_SUCCESS_DURATION_SECONDS,
    aspectRatio: input.aspectRatio ?? RENDER_SUCCESS_ASPECT_RATIO,
    resolution: input.resolution ?? RENDER_SUCCESS_RESOLUTION,
    generateAudio: input.generateAudio ?? RENDER_SUCCESS_GENERATE_AUDIO,
    referenceImages: input.referenceImages,
    referenceCount: input.referenceImages.length,
    prompt: input.prompt,
    promptStyle: input.promptStyle,
    styleMode: input.styleMode,
    paid: input.paid ?? input.quality !== 'demo',
    label: input.label,
    progressLabel: input.progressLabel,
    lighterCastGuidance: Boolean(input.lighterCastGuidance || input.referenceImages.length === 0),
  };
}

export function buildRenderSuccessAttemptPlan(input: {
  referenceImages?: SeedanceReferenceImage[];
  characterName?: string | null;
  allowDemoFallback?: boolean;
  firstVideoRescue?: boolean;
  referenceCanaryState?: 'succeeded' | 'failed' | 'unknown';
}) {
  const strongestReferences = strongestSavedReferences(input.referenceImages ?? []);
  const primaryReference = strongestReferences.slice(0, 1);
  const twoStrongestReferences = strongestReferences.slice(0, 2);
  const rescuePrompt = sanitizeSuccessProviderPrompt({
    prompt: FIRST_VIDEO_RESCUE_PROVIDER_PROMPT,
    characterName: input.characterName,
  });
  const safePrompt = sanitizeSuccessProviderPrompt({
    prompt: DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT,
    characterName: input.characterName,
  });
  const storybookPrompt = sanitizeSuccessProviderPrompt({
    prompt: `${DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT}, storybook cinematic style`,
    characterName: input.characterName,
  });
  const identityLightPrompt = sanitizeSuccessProviderPrompt({
    prompt: 'the cast character walks through a peaceful sunlit garden, fully clothed, natural movement, soft storybook cinematic style, calm mood',
    characterName: input.characterName,
  });

  const firstVideoReferences = input.referenceCanaryState === 'succeeded' ? primaryReference : [];
  const rescueReferencePrompt = sanitizeSuccessProviderPrompt({
    prompt: firstVideoReferences.length ? buildReferenceImagePrompt(firstVideoReferences) : FIRST_VIDEO_RESCUE_PROVIDER_PROMPT,
    characterName: input.characterName,
  });
  const attempts: RenderSuccessAttempt[] = input.firstVideoRescue ? [
    makeAttempt({
      tier: 1,
      quality: 'fast',
      referenceImages: firstVideoReferences,
      prompt: firstVideoReferences.length ? rescueReferencePrompt : rescuePrompt,
      promptStyle: 'first_video_rescue',
      styleMode: 'first_video_rescue',
      aspectRatio: FIRST_VIDEO_RESCUE_ASPECT_RATIO,
      label: firstVideoReferences.length
        ? 'First video rescue Seedance Fast primary reference'
        : 'First video rescue Seedance Fast text only',
      progressLabel: firstVideoReferences.length ? 'Trying primary reference...' : 'Trying the cleanest storybook render...',
      lighterCastGuidance: firstVideoReferences.length === 0,
    }),
    ...(firstVideoReferences.length ? [makeAttempt({
      tier: 2,
      quality: 'fast',
      referenceImages: [],
      prompt: rescuePrompt,
      promptStyle: 'first_video_rescue',
      styleMode: 'first_video_rescue',
      aspectRatio: FIRST_VIDEO_RESCUE_ASPECT_RATIO,
      label: 'First video rescue Seedance Fast text only',
      progressLabel: 'Trying lighter cast guidance...',
      lighterCastGuidance: true,
    })] : []),
  ] : [
    makeAttempt({
      tier: 1,
      quality: 'fast',
      referenceImages: primaryReference,
      prompt: promptWithReferenceTokens(safePrompt, primaryReference),
      promptStyle: 'safe_garden',
      styleMode: 'storybook_cinematic',
      label: 'Seedance Fast primary reference',
      progressLabel: primaryReference.length ? 'Trying primary reference...' : 'Trying the cleanest storybook render...',
    }),
    makeAttempt({
      tier: 2,
      quality: 'fast',
      referenceImages: twoStrongestReferences,
      prompt: promptWithReferenceTokens(storybookPrompt, twoStrongestReferences),
      promptStyle: 'storybook_cinematic',
      styleMode: 'storybook_cinematic',
      label: 'Seedance Fast two strongest references',
      progressLabel: twoStrongestReferences.length > 1 ? 'Trying a lighter cast reference...' : 'Trying a storybook cinematic take...',
    }),
    makeAttempt({
      tier: 3,
      quality: 'quality',
      referenceImages: primaryReference,
      prompt: promptWithReferenceTokens(storybookPrompt, primaryReference),
      promptStyle: 'storybook_cinematic',
      styleMode: 'storybook_cinematic',
      label: 'Seedance Quality primary reference',
      progressLabel: 'Trying a storybook cinematic take...',
    }),
    makeAttempt({
      tier: 4,
      quality: 'fast',
      referenceImages: [],
      prompt: identityLightPrompt,
      promptStyle: 'identity_light',
      styleMode: 'ultra_safe',
      label: 'Seedance Fast lighter cast guidance',
      progressLabel: 'Trying lighter cast guidance...',
      lighterCastGuidance: true,
    }),
  ];

  if (input.allowDemoFallback) {
    attempts.push(makeAttempt({
      tier: 5,
      quality: 'demo',
      referenceImages: [],
      prompt: ULTRA_SAFE_SCENE_PROVIDER_PROMPT,
      promptStyle: 'demo',
      styleMode: 'demo',
      label: 'Demo Mode explicit fallback',
      progressLabel: 'Preparing demo preview...',
      lighterCastGuidance: true,
      paid: false,
    }));
  }

  return attempts;
}

export function selectAttemptsWithinBudget(input: {
  attempts: RenderSuccessAttempt[];
  maxPaidAttempts?: number | null;
  maxTotalAttempts?: number | null;
}) {
  const maxPaidAttempts = Math.max(1, Math.min(5, Math.round(input.maxPaidAttempts ?? env.RENDER_SUCCESS_MAX_PAID_ATTEMPTS)));
  const maxTotalAttempts = Math.max(1, Math.min(5, Math.round(input.maxTotalAttempts ?? RENDER_SUCCESS_TOTAL_ATTEMPTS)));
  const selected: RenderSuccessAttempt[] = [];
  const skipped: RenderSuccessAttempt[] = [];
  let paidAttempts = 0;

  for (const attempt of input.attempts) {
    if (selected.length >= maxTotalAttempts) {
      skipped.push(attempt);
      continue;
    }
    if (attempt.paid && paidAttempts >= maxPaidAttempts) {
      skipped.push(attempt);
      paidAttemptsPrevented += 1;
      continue;
    }
    selected.push(attempt);
    if (attempt.paid) paidAttempts += 1;
  }

  return {
    selected,
    skipped,
    maxPaidAttempts,
    maxTotalAttempts,
    paidAttempts,
  };
}

export function prioritizeAttemptsWithMemory(
  attempts: RenderSuccessAttempt[],
  recipe: RenderSuccessRecipe | null,
) {
  if (!recipe) return attempts;
  const preferredIndex = attempts.findIndex((attempt) => (
    (recipe.attemptTier ? attempt.tier === recipe.attemptTier : true) &&
    (!recipe.provider || attempt.provider === recipe.provider || attempt.providerModel === recipe.providerModel) &&
    (recipe.referenceCount == null || attempt.referenceCount === recipe.referenceCount) &&
    (!recipe.promptStyle || attempt.promptStyle === recipe.promptStyle)
  ));
  if (preferredIndex <= 0) return attempts;
  return [
    attempts[preferredIndex],
    ...attempts.slice(0, preferredIndex),
    ...attempts.slice(preferredIndex + 1),
  ];
}

export function rateLimitRetryDelayMs(input: {
  retryAfterMs?: number | null;
  retryCount?: number;
  jitterRatio?: number;
}) {
  const retryCount = Math.max(0, Math.round(input.retryCount ?? 0));
  const explicitDelay = typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs)
    ? input.retryAfterMs
    : null;
  const fallbackDelay = Math.min(MAX_RATE_LIMIT_DELAY_MS, 10_000 * (2 ** retryCount));
  const baseDelay = explicitDelay ?? fallbackDelay;
  const jitterRatio = Math.max(0, Math.min(0.4, input.jitterRatio ?? 0.12));
  const jitter = Math.round(baseDelay * jitterRatio * Math.random());
  return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(1_000, baseDelay + RATE_LIMIT_SAFETY_BUFFER_MS + jitter));
}

export function isUsableVideoOutput(input: {
  providerStatus?: string | null;
  outputUrl?: string | null;
  storagePath?: string | null;
}) {
  const parsed = parseProviderVideoOutput(input.outputUrl);
  return (
    (input.providerStatus === 'succeeded' || input.providerStatus === 'completed' || !input.providerStatus) &&
    parsed.ok &&
    (Boolean(input.storagePath) || /^https?:\/\//i.test(input.outputUrl ?? '') || /^\/[^/]/.test(input.outputUrl ?? ''))
  );
}

export function shouldPreventDuplicateRender(input: {
  activeStatus?: string | null;
  activeCreatedAt?: string | null;
  nowMs?: number;
}) {
  if (!input.activeStatus || !RENDER_SUCCESS_ACTIVE_STATUSES.includes(input.activeStatus as typeof RENDER_SUCCESS_ACTIVE_STATUSES[number])) {
    return false;
  }
  if (!input.activeCreatedAt) return true;
  const ageMs = (input.nowMs ?? Date.now()) - Date.parse(input.activeCreatedAt);
  return Number.isFinite(ageMs) && ageMs < RENDER_SUCCESS_TIMEOUT_MS;
}

export function isRateLimitCooldownActive(input: {
  retryAvailableAt?: string | null;
  nowMs?: number;
}) {
  return Boolean(
    input.retryAvailableAt &&
    Date.parse(input.retryAvailableAt) > (input.nowMs ?? Date.now()),
  );
}

export function shouldResumeRateLimitedAttempt(input: {
  status?: string | null;
  retryAvailableAt?: string | null;
  nowMs?: number;
}) {
  return input.status === 'rate_limited' && !isRateLimitCooldownActive(input);
}

export function rateLimitCountsAsFailedAttempt() {
  return false;
}

export function paidAttemptConsumesBudget(input: {
  renderSuccessPaid?: boolean | null;
  providerPredictionId?: string | null;
}) {
  return Boolean(input.renderSuccessPaid && input.providerPredictionId);
}

export function recipeMemoryPayload(input: {
  userId: string;
  characterId?: string | null;
  attempt: RenderSuccessAttempt;
  success: boolean;
  failureCategory?: string | null;
}) {
  const memoryKey = [
    'render-success',
    input.userId,
    input.characterId ?? 'no-character',
    input.attempt.provider,
    input.attempt.providerModel,
    input.attempt.tier,
    input.attempt.referenceCount,
    input.attempt.promptStyle,
  ].join(':');

  return {
    memoryKey,
    userId: input.userId,
    characterId: input.characterId ?? null,
    provider: input.attempt.provider,
    providerModel: input.attempt.providerModel,
    renderFeel: 'success_first',
    attemptTier: input.attempt.tier,
    referenceCount: input.attempt.referenceCount,
    duration: input.attempt.durationSeconds,
    aspectRatio: input.attempt.aspectRatio,
    styleMode: input.attempt.styleMode,
    promptStyle: input.attempt.promptStyle,
    promptFingerprint: hashText(input.attempt.prompt),
    successCount: input.success ? 1 : 0,
    failureCount: input.success ? 0 : 1,
    lastSuccessAt: input.success ? new Date().toISOString() : null,
    lastFailureAt: input.success ? null : new Date().toISOString(),
    notes: {
      lighterCastGuidance: input.attempt.lighterCastGuidance,
      failureCategory: input.failureCategory ?? null,
    },
  };
}

function mapRow(row: Record<string, unknown>): RenderSuccessJobRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    projectId: typeof row.projectId === 'string' ? row.projectId : null,
    provider: String(row.provider ?? ''),
    providerJobId: typeof row.providerJobId === 'string' ? row.providerJobId : null,
    providerPredictionId: typeof row.providerPredictionId === 'string' ? row.providerPredictionId : null,
    providerPredictionUrl: typeof row.providerPredictionUrl === 'string' ? row.providerPredictionUrl : null,
    providerStatus: typeof row.providerStatus === 'string' ? row.providerStatus : null,
    providerName: typeof row.providerName === 'string' ? row.providerName : null,
    providerModel: typeof row.providerModel === 'string' ? row.providerModel : null,
    outputType: String(row.outputType ?? 'video'),
    prompt: String(row.prompt ?? ''),
    status: String(row.status ?? 'queued'),
    characterId: typeof row.characterId === 'string' ? row.characterId : null,
    durationSeconds: typeof row.durationSeconds === 'number' ? row.durationSeconds : null,
    aspectRatio: typeof row.aspectRatio === 'string' ? row.aspectRatio : null,
    privacy: String(row.privacy ?? 'private'),
    resultAssetUrl: typeof row.resultAssetUrl === 'string' ? row.resultAssetUrl : null,
    outputUrl: typeof row.outputUrl === 'string' ? row.outputUrl : null,
    thumbnailUrl: typeof row.thumbnailUrl === 'string' ? row.thumbnailUrl : null,
    errorMessage: typeof row.errorMessage === 'string' ? row.errorMessage : null,
    errorCategory: typeof row.errorCategory === 'string' ? row.errorCategory : null,
    renderMode: typeof row.renderMode === 'string' ? row.renderMode : null,
    providerFallbackStage: typeof row.providerFallbackStage === 'string' ? row.providerFallbackStage : null,
    referenceCount: typeof row.referenceCount === 'number' ? row.referenceCount : null,
    sceneMetadata: row.sceneMetadata && typeof row.sceneMetadata === 'object'
      ? row.sceneMetadata as Record<string, unknown>
      : null,
    retryCount: typeof row.retryCount === 'number' ? row.retryCount : 0,
    retryAfterSeconds: typeof row.retryAfterSeconds === 'number' ? row.retryAfterSeconds : null,
    retryAvailableAt: typeof row.retryAvailableAt === 'string' ? row.retryAvailableAt : null,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    renderSuccessGroupId: typeof row.renderSuccessGroupId === 'string' ? row.renderSuccessGroupId : null,
    renderSuccessRole: typeof row.renderSuccessRole === 'string' ? row.renderSuccessRole : null,
    renderSuccessAttemptTier: typeof row.renderSuccessAttemptTier === 'number' ? row.renderSuccessAttemptTier : null,
    renderSuccessPromptStyle: typeof row.renderSuccessPromptStyle === 'string' ? row.renderSuccessPromptStyle : null,
    renderSuccessReferenceCount: typeof row.renderSuccessReferenceCount === 'number' ? row.renderSuccessReferenceCount : null,
    renderSuccessPaid: typeof row.renderSuccessPaid === 'boolean' ? row.renderSuccessPaid : null,
    renderSuccessParentJobId: typeof row.renderSuccessParentJobId === 'string' ? row.renderSuccessParentJobId : null,
  };
}

function renderSuccessMetadata(row: RenderSuccessJobRow): RenderSuccessEngineMetadata | null {
  const metadata = row.sceneMetadata?.renderSuccessEngine;
  if (!metadata || typeof metadata !== 'object') return null;
  return metadata as RenderSuccessEngineMetadata;
}

function effectiveAspectRatioForInput(input: Pick<StartRenderSuccessJobInput, 'firstVideoRescue'>) {
  return input.firstVideoRescue ? FIRST_VIDEO_RESCUE_ASPECT_RATIO : RENDER_SUCCESS_ASPECT_RATIO;
}

function effectiveInitialPromptForInput(input: Pick<StartRenderSuccessJobInput, 'firstVideoRescue'>) {
  return input.firstVideoRescue ? FIRST_VIDEO_RESCUE_PROVIDER_PROMPT : DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT;
}

async function hasVerifiedVideoForUserCharacter(input: {
  userId: string;
  characterId?: string | null;
}) {
  try {
    const result = await query<{
      videoUrl: string | null;
      coverAssetUrl: string | null;
    }>(
      `select
         video_url as "videoUrl",
         cover_asset_url as "coverAssetUrl"
       from projects
       where user_id = $1
         and status = 'completed'
         and output_type = 'video'
         and ($2::text is null or character_id = $2)
       order by updated_at desc nulls last, created_at desc
       limit 20`,
      [input.userId, input.characterId ?? null],
    );

    return result.rows.some((row) => parseProviderVideoOutput(row.videoUrl ?? row.coverAssetUrl).ok);
  } catch {
    return false;
  }
}

function firstReferenceThumbnail(references: SeedanceReferenceImage[], fallback?: string | null) {
  return references.map((reference) => reference.url).find(Boolean) ?? fallback ?? null;
}

function predictionUrl(prediction: Prediction) {
  const urls = prediction.urls as Record<string, unknown> | undefined;
  const getUrl = typeof urls?.get === 'string' ? urls.get : null;
  return getUrl ?? (prediction.id ? `https://replicate.com/p/${prediction.id}` : null);
}

async function createRenderSuccessProject(input: StartRenderSuccessJobInput, groupId: string) {
  const thumbnailUrl = firstReferenceThumbnail(input.referenceImages ?? [], input.characterAvatar);
  const initialPrompt = effectiveInitialPromptForInput(input);
  const aspectRatio = effectiveAspectRatioForInput(input);
  const result = await query<{ id: string }>(
    `insert into projects (
       user_id,
       title,
       caption,
       prompt,
       final_prompt,
       style_preset,
       status,
       provider,
       engine,
       display_engine,
       model,
       generation_mode,
       output_type,
       thumbnail_url,
       poster_url,
       character_id,
       character_name,
       character_avatar,
       is_default_self_character,
       privacy,
       visibility,
       duration_seconds,
       aspect_ratio,
       created_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, 'success_first', 'rendering', 'replicate', 'seedance-2.0', 'Success First', $6, 'render-success-first', 'video', $7, $7, $8, $9, $10, $11, 'private', 'private', $12, $13, now(), now())
     returning id`,
    [
      input.userId,
      input.title || 'Lumora cinematic draft',
      input.prompt,
      input.prompt,
      initialPrompt,
      SEEDANCE_FAST_MODEL,
      thumbnailUrl,
      input.characterId ?? null,
      input.characterName ?? null,
      input.characterAvatar ?? null,
      Boolean(input.isDefaultSelfCharacter),
      RENDER_SUCCESS_DURATION_SECONDS,
      aspectRatio,
    ],
  );

  console.info('RENDER SUCCESS PROJECT CREATED:', {
    groupId,
    projectId: result.rows[0]?.id ?? null,
    referenceCount: input.referenceImages?.length ?? 0,
  });
  return result.rows[0]?.id ?? null;
}

async function insertMasterJob(input: StartRenderSuccessJobInput, groupId: string, projectId: string | null) {
  const metadata: RenderSuccessEngineMetadata = {
    role: 'master',
    groupId,
    prompt: input.prompt,
    title: input.title ?? null,
    characterId: input.characterId ?? null,
    characterName: input.characterName ?? null,
    characterAvatar: input.characterAvatar ?? null,
    isDefaultSelfCharacter: Boolean(input.isDefaultSelfCharacter),
    referenceImages: input.referenceImages ?? [],
    allowDemoFallback: Boolean(input.allowDemoFallback),
    maxPaidAttempts: input.maxPaidAttempts ?? env.RENDER_SUCCESS_MAX_PAID_ATTEMPTS,
    maxTotalAttempts: input.maxTotalAttempts ?? RENDER_SUCCESS_TOTAL_ATTEMPTS,
    firstVideoRescue: Boolean(input.firstVideoRescue),
    progressLabel: 'Lumora is finding the cleanest render path.',
    createdAt: new Date().toISOString(),
  };
  const aspectRatio = effectiveAspectRatioForInput(input);
  const result = await query<Record<string, unknown>>(
    `insert into generation_jobs (
       user_id,
       project_id,
       provider,
       provider_name,
       output_type,
       prompt,
       status,
       character_id,
       duration_seconds,
       aspect_ratio,
       privacy,
       thumbnail_url,
       provider_status,
       scene_metadata,
       timeout_at,
       reference_count,
       render_mode,
       provider_fallback_stage,
       render_success_group_id,
       render_success_role,
       render_success_attempt_tier,
       render_success_prompt_style,
       render_success_reference_count,
       render_success_paid,
       created_at,
       updated_at
     )
     values ($1, $2, 'render-success-engine', 'lumora', 'video', $3, 'queued', $4, $5, $6, 'private', $7, 'queued', $8::jsonb, $9, $10, 'success_first', 'success_ladder', $11, 'master', 0, 'success_ladder', $10, false, now(), now())
     returning ${renderSuccessJobSelect}`,
    [
      input.userId,
      projectId,
      input.prompt,
      input.characterId ?? null,
      RENDER_SUCCESS_DURATION_SECONDS,
      aspectRatio,
      firstReferenceThumbnail(input.referenceImages ?? [], input.characterAvatar),
      JSON.stringify({ renderSuccessEngine: metadata }),
      new Date(Date.now() + RENDER_SUCCESS_TIMEOUT_MS).toISOString(),
      input.referenceImages?.length ?? 0,
      groupId,
    ],
  );

  return mapRow(result.rows[0]);
}

async function insertAttemptJob(input: {
  master: RenderSuccessJobRow;
  attempt: RenderSuccessAttempt;
  metadata: RenderSuccessEngineMetadata;
}) {
  const attemptMetadata: RenderSuccessEngineMetadata = {
    ...input.metadata,
    role: 'attempt',
    masterJobId: input.master.id,
    attempt: input.attempt,
    progressLabel: input.attempt.progressLabel,
    createdAt: new Date().toISOString(),
  };
  const result = await query<Record<string, unknown>>(
    `insert into generation_jobs (
       user_id,
       project_id,
       provider,
       provider_name,
       provider_model,
       output_type,
       prompt,
       status,
       character_id,
       duration_seconds,
       aspect_ratio,
       privacy,
       thumbnail_url,
       provider_status,
       scene_metadata,
       timeout_at,
       reference_count,
       render_mode,
       provider_fallback_stage,
       render_success_group_id,
       render_success_parent_job_id,
       render_success_role,
       render_success_attempt_tier,
       render_success_prompt_style,
       render_success_reference_count,
       render_success_paid,
       created_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, 'video', $6, 'queued', $7, $8, $9, 'private', $10, 'queued', $11::jsonb, $12, $13, 'success_first', $14, $15, $16, 'attempt', $17, $18, $13, $19, now(), now())
     returning ${renderSuccessJobSelect}`,
    [
      input.master.userId,
      input.master.projectId,
      input.attempt.quality === 'quality' ? 'seedance-quality' : input.attempt.quality === 'fast' ? 'seedance-2.0' : 'demo-mode',
      input.attempt.quality === 'demo' ? 'demo' : 'replicate',
      input.attempt.providerModel,
      input.attempt.prompt,
      input.metadata.characterId ?? null,
      input.attempt.durationSeconds,
      input.attempt.aspectRatio,
      firstReferenceThumbnail(input.attempt.referenceImages, input.metadata.characterAvatar),
      JSON.stringify({ renderSuccessEngine: attemptMetadata }),
      new Date(Date.now() + RENDER_SUCCESS_TIMEOUT_MS).toISOString(),
      input.attempt.referenceCount,
      `attempt_${input.attempt.tier}`,
      input.metadata.groupId,
      input.master.id,
      input.attempt.tier,
      input.attempt.promptStyle,
      input.attempt.paid,
    ],
  );

  return mapRow(result.rows[0]);
}

async function findActiveMasterJob(userId: string) {
  const result = await query<Record<string, unknown>>(
    `select ${renderSuccessJobSelect}
     from generation_jobs
     where user_id = $1
       and render_success_role = 'master'
       and status = any($2::text[])
       and created_at > now() - interval '45 minutes'
     order by created_at desc
     limit 1`,
    [userId, RENDER_SUCCESS_ACTIVE_STATUSES],
  );

  const row = result.rows[0] ? mapRow(result.rows[0]) : null;
  return row && shouldPreventDuplicateRender({ activeStatus: row.status, activeCreatedAt: row.createdAt })
    ? row
    : null;
}

async function getRenderSuccessJob(jobId: string) {
  const result = await query<Record<string, unknown>>(
    `select ${renderSuccessJobSelect}
     from generation_jobs
     where id = $1
       and render_success_role = 'master'
     limit 1`,
    [jobId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function listAttemptJobs(groupId: string) {
  const result = await query<Record<string, unknown>>(
    `select ${renderSuccessJobSelect}
     from generation_jobs
     where render_success_group_id = $1
       and render_success_role = 'attempt'
     order by render_success_attempt_tier asc, created_at asc`,
    [groupId],
  );
  return result.rows.map(mapRow);
}

async function updateProjectStatus(projectId: string | null, status: string, errorMessage?: string | null) {
  if (!projectId) return;
  await query(
    `update projects
     set status = $2,
         error_message = $3,
         updated_at = now()
     where id = $1`,
    [projectId, status, errorMessage ?? null],
  ).catch(() => undefined);
}

async function markMasterStatus(input: {
  masterId: string;
  status: string;
  providerStatus?: string | null;
  progressLabel?: string | null;
  outputUrl?: string | null;
  projectId?: string | null;
  errorMessage?: string | null;
  errorCategory?: string | null;
  retryAfterSeconds?: number | null;
  retryAvailableAt?: string | null;
  providerModel?: string | null;
  referenceCount?: number | null;
  attemptTier?: number | null;
}) {
  const result = await query<Record<string, unknown>>(
    `update generation_jobs
     set
       status = $2,
       provider_status = coalesce($3, provider_status),
       result_asset_url = coalesce($4, result_asset_url),
       output_url = coalesce($4, output_url),
       project_id = coalesce($5, project_id),
       error_message = $6,
       error_category = $7,
       retry_after_seconds = $8,
       retry_available_at = $9,
       provider_model = coalesce($10, provider_model),
       reference_count = coalesce($11, reference_count),
       render_success_attempt_tier = coalesce($12, render_success_attempt_tier),
       scene_metadata = case
         when $13::text is null then scene_metadata
         else jsonb_set(coalesce(scene_metadata, '{}'::jsonb), '{renderSuccessEngine,progressLabel}', to_jsonb($13::text), true)
       end,
       updated_at = now()
     where id = $1
     returning ${renderSuccessJobSelect}`,
    [
      input.masterId,
      input.status,
      input.providerStatus ?? null,
      input.outputUrl ?? null,
      input.projectId ?? null,
      input.errorMessage ?? null,
      input.errorCategory ?? null,
      input.retryAfterSeconds ?? null,
      input.retryAvailableAt ?? null,
      input.providerModel ?? null,
      input.referenceCount ?? null,
      input.attemptTier ?? null,
      input.progressLabel ?? null,
    ],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function updateAttemptProviderState(input: {
  attemptJobId: string;
  prediction: Prediction;
  attempt: RenderSuccessAttempt;
}) {
  await query(
    `update generation_jobs
     set
       status = case when status = 'completed' then status else 'rendering' end,
       provider_job_id = $2,
       provider_prediction_id = $2,
       provider_prediction_url = $3,
       provider_status = $4,
       provider_name = $5,
       provider_model = $6,
       last_polled_at = now(),
       updated_at = now()
     where id = $1`,
    [
      input.attemptJobId,
      input.prediction.id,
      predictionUrl(input.prediction),
      input.prediction.status,
      input.attempt.quality === 'demo' ? 'demo' : 'replicate',
      input.attempt.providerModel,
    ],
  );
}

async function markAttemptCompleted(input: {
  attemptJobId: string;
  attempt: RenderSuccessAttempt;
  providerJobId: string | null;
  outputUrl: string;
  projectId: string | null;
}) {
  await query(
    `update generation_jobs
     set
       status = 'completed',
       provider_status = 'succeeded',
       provider_job_id = coalesce($2, provider_job_id),
       provider_prediction_id = coalesce($2, provider_prediction_id),
       result_asset_url = $3,
       output_url = $3,
       project_id = coalesce($4, project_id),
       error_message = null,
       error_category = null,
       render_success_reference_count = $5,
       updated_at = now()
     where id = $1`,
    [input.attemptJobId, input.providerJobId, input.outputUrl, input.projectId, input.attempt.referenceCount],
  );
  renderSuccessRuntimeStats.completedAttempts += 1;
}

async function markAttemptFailed(input: {
  attemptJobId: string;
  attempt: RenderSuccessAttempt;
  message: string;
  category: string;
  status?: 'failed' | 'rate_limited' | 'skipped';
  retryAfterSeconds?: number | null;
  retryAvailableAt?: string | null;
}) {
  await query(
    `update generation_jobs
     set
       status = $2,
       provider_status = coalesce($7, provider_status),
       error_message = $3,
       error_category = $4,
       retry_count = retry_count + case when $2 = 'rate_limited' then 1 else 0 end,
       retry_after_seconds = $5,
       retry_available_at = $6,
       updated_at = now()
     where id = $1`,
    [
      input.attemptJobId,
      input.status ?? 'failed',
      input.message,
      input.category,
      input.retryAfterSeconds ?? null,
      input.retryAvailableAt ?? null,
      input.status === 'rate_limited' ? 'rate_limited' : input.status === 'skipped' ? 'skipped' : null,
    ],
  );
  if ((input.status ?? 'failed') === 'failed') {
    renderSuccessRuntimeStats.failedAttempts += 1;
  }
}

function retryInfo(error: unknown, retryCount: number) {
  const retryAfterMs = isReplicateRateLimitError(error)
    ? error.retryAfterMs
    : rawRetryAfterMs(error)
      ? rawRetryAfterMs(error)
    : null;
  const delayMs = rateLimitRetryDelayMs({ retryAfterMs, retryCount });
  return {
    delayMs,
    retryAfterSeconds: Math.max(1, Math.ceil(delayMs / 1000)),
    retryAvailableAt: new Date(Date.now() + delayMs).toISOString(),
  };
}

function rawResponseStatus(error: unknown) {
  return (error as { response?: { status?: unknown } } | null)?.response?.status;
}

function rawRetryAfterMs(error: unknown) {
  const headers = (error as { response?: { headers?: { get?: (name: string) => string | null } } } | null)
    ?.response
    ?.headers;
  const retryAfter = headers?.get?.('retry-after') ?? headers?.get?.('Retry-After') ?? null;
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const parsedDate = Date.parse(retryAfter);
  return Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : null;
}

function isRateLimitLike(error: unknown) {
  if (isReplicateRateLimitError(error)) return true;
  if (rawResponseStatus(error) === 429) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('429') || message.includes('rate limit') || message.includes('too many requests');
}

function scheduleResume(masterId: string, delayMs: number) {
  if (!env.RENDER_SUCCESS_AUTO_RETRY) return;
  const existing = resumeTimers.get(masterId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    resumeTimers.delete(masterId);
    processRenderSuccessJob(masterId);
  }, delayMs);
  resumeTimers.set(masterId, timer);
}

async function replicateClient() {
  if (!env.REPLICATE_API_TOKEN) return null;
  return new Replicate({
    auth: env.REPLICATE_API_TOKEN,
    useFileOutput: false,
  });
}

async function verifyOutputReachable(input: {
  outputUrl: string;
  storagePath?: string | null;
}) {
  if (input.storagePath) return true;
  if (/^\/[^/]/.test(input.outputUrl)) return true;
  if (!/^https?:\/\//i.test(input.outputUrl)) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(input.outputUrl, { method: 'HEAD', signal: controller.signal });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 403) return false;
  } catch {
    // Try a tiny GET below. Some signed video URLs reject HEAD.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), 8_000);
  try {
    const response = await fetch(input.outputUrl, {
      method: 'GET',
      headers: { range: 'bytes=0-1' },
      signal: getController.signal,
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(getTimeout);
  }
}

async function persistRecipe(input: {
  userId: string;
  characterId?: string | null;
  attempt: RenderSuccessAttempt;
  success: boolean;
  failureCategory?: string | null;
}) {
  const payload = recipeMemoryPayload(input);
  try {
    await query(
      `insert into render_success_memory (
         memory_key,
         user_id,
         character_id,
         provider,
         provider_model,
         render_mode,
         render_feel,
         safe_style,
         attempt_tier,
         reference_strategy,
         reference_count,
         duration,
         aspect_ratio,
         style_mode,
         prompt_style,
         prompt_fingerprint,
         complexity_score,
         reference_quality_score,
         success_count,
         failure_count,
         last_success_at,
         last_failure_at,
         notes,
         metadata,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, 0, $16, $17, $18, $19, $20::jsonb, $20::jsonb, now(), now())
       on conflict (memory_key)
       do update set
         provider_model = excluded.provider_model,
         render_feel = excluded.render_feel,
         attempt_tier = excluded.attempt_tier,
         reference_count = excluded.reference_count,
         duration = excluded.duration,
         aspect_ratio = excluded.aspect_ratio,
         style_mode = excluded.style_mode,
         prompt_style = excluded.prompt_style,
         success_count = render_success_memory.success_count + excluded.success_count,
         failure_count = render_success_memory.failure_count + excluded.failure_count,
         last_success_at = coalesce(excluded.last_success_at, render_success_memory.last_success_at),
         last_failure_at = coalesce(excluded.last_failure_at, render_success_memory.last_failure_at),
         notes = coalesce(render_success_memory.notes, '{}'::jsonb) || excluded.notes,
         metadata = coalesce(render_success_memory.metadata, '{}'::jsonb) || excluded.metadata,
         updated_at = now()`,
      [
        payload.memoryKey,
        payload.userId,
        payload.characterId,
        payload.provider,
        payload.providerModel,
        payload.renderFeel,
        payload.styleMode,
        payload.attemptTier,
        payload.referenceCount === 0 ? 'no_reference_storybook' : payload.referenceCount === 1 ? 'primary_reference' : 'reduced_cast_references',
        payload.referenceCount,
        payload.duration,
        payload.aspectRatio,
        payload.styleMode,
        payload.promptStyle,
        payload.promptFingerprint,
        payload.successCount,
        payload.failureCount,
        payload.lastSuccessAt,
        payload.lastFailureAt,
        JSON.stringify(payload.notes),
      ],
    );
  } catch (error) {
    console.warn('RENDER SUCCESS MEMORY PERSISTENCE SKIPPED:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadPreferredRecipe(input: {
  userId: string;
  characterId?: string | null;
}): Promise<RenderSuccessRecipe | null> {
  try {
    const result = await query<{
      provider: string | null;
      providerModel: string | null;
      attemptTier: number | null;
      referenceCount: number | null;
      promptStyle: string | null;
    }>(
      `select
         provider,
         provider_model as "providerModel",
         attempt_tier as "attemptTier",
         reference_count as "referenceCount",
         prompt_style as "promptStyle"
       from render_success_memory
       where user_id = $1
         and ($2::text is null or character_id = $2)
         and coalesce(success_count, 0) > coalesce(failure_count, 0)
       order by success_count desc, last_success_at desc nulls last, updated_at desc
       limit 1`,
      [input.userId, input.characterId ?? null],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function finalizeSuccessfulAttempt(input: {
  master: RenderSuccessJobRow;
  metadata: RenderSuccessEngineMetadata;
  attemptJob: RenderSuccessJobRow;
  attempt: RenderSuccessAttempt;
  providerJobId: string | null;
  providerStatus?: string | null;
  providerOutputUrl: string;
  finalPrompt: string;
  model: string;
  warnings?: string[];
}) {
  const providerOutputParse = parseProviderVideoOutput(input.providerOutputUrl);
  if (!providerOutputParse.ok) {
    providerOutputMissingCount += 1;
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: 'Provider completed without a usable video output.',
      category: providerOutputParse.category,
    });
    await persistRecipe({
      userId: input.master.userId,
      characterId: input.metadata.characterId,
      attempt: input.attempt,
      success: false,
      failureCategory: providerOutputParse.category,
    });
    return false;
  }

  const persistence = await persistCompletedGeneration({
    userId: input.master.userId,
    id: input.providerJobId ?? input.attemptJob.id,
    projectId: input.master.projectId,
    title: input.metadata.title ?? 'Lumora cinematic draft',
    prompt: input.metadata.prompt,
    finalPrompt: input.finalPrompt,
    provider: input.attempt.quality === 'demo' ? 'demo' : 'replicate',
    engine: input.attempt.quality === 'quality' ? 'seedance-quality' : input.attempt.quality === 'fast' ? 'seedance-2.0' : 'mock',
    model: input.model,
    displayEngine: input.attempt.quality === 'quality'
      ? 'Seedance Quality'
      : input.attempt.quality === 'fast'
        ? 'Seedance Fast'
        : 'Demo Mode',
    videoUrl: providerOutputParse.videoUrl,
    thumbnailUrl: firstReferenceThumbnail(input.attempt.referenceImages, input.metadata.characterAvatar),
    characterId: input.metadata.characterId ?? null,
    characterName: input.metadata.characterName ?? null,
    characterAvatar: input.metadata.characterAvatar ?? null,
    isDefaultSelfCharacter: input.metadata.isDefaultSelfCharacter ?? null,
    durationSeconds: input.attempt.durationSeconds,
    aspectRatio: input.attempt.aspectRatio,
    privacy: 'private',
  });

  const usable = isUsableVideoOutput({
    providerStatus: input.providerStatus ?? 'succeeded',
    outputUrl: persistence.videoUrl,
    storagePath: persistence.storagePath,
  }) && await verifyOutputReachable({
    outputUrl: persistence.videoUrl,
    storagePath: persistence.storagePath,
  });

  if (!usable) {
    providerOutputMissingCount += 1;
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: 'Provider completed without a usable video output.',
      category: 'provider_output_missing',
    });
    await persistRecipe({
      userId: input.master.userId,
      characterId: input.metadata.characterId,
      attempt: input.attempt,
      success: false,
      failureCategory: 'provider_output_missing',
    });
    return false;
  }

  await markAttemptCompleted({
    attemptJobId: input.attemptJob.id,
    attempt: input.attempt,
    providerJobId: input.providerJobId,
    outputUrl: persistence.videoUrl,
    projectId: persistence.projectId ?? input.master.projectId,
  });
  await markMasterStatus({
    masterId: input.master.id,
    status: 'completed',
    providerStatus: 'succeeded',
    progressLabel: 'Cinematic draft ready.',
    outputUrl: persistence.videoUrl,
    projectId: persistence.projectId ?? input.master.projectId,
    providerModel: input.model,
    referenceCount: input.attempt.referenceCount,
    attemptTier: input.attempt.tier,
    errorMessage: null,
    errorCategory: null,
  });
  await updateProjectStatus(persistence.projectId ?? input.master.projectId, 'completed', null);
  await persistRecipe({
    userId: input.master.userId,
    characterId: input.metadata.characterId,
    attempt: input.attempt,
    success: true,
  });
  renderSuccessRuntimeStats.lastSuccessfulRecipe = {
    provider: input.attempt.provider,
    providerModel: input.model,
    attemptTier: input.attempt.tier,
    referenceCount: input.attempt.referenceCount,
    promptStyle: input.attempt.promptStyle,
    lighterCastGuidance: input.attempt.lighterCastGuidance,
  };
  return true;
}

async function pollExistingPrediction(input: {
  master: RenderSuccessJobRow;
  metadata: RenderSuccessEngineMetadata;
  attemptJob: RenderSuccessJobRow;
  attempt: RenderSuccessAttempt;
}) {
  if (!input.attemptJob.providerPredictionId) return 'failed' as const;
  const replicate = await replicateClient();
  if (!replicate) return 'failed' as const;

  let prediction: Prediction;
  try {
    prediction = await replicate.predictions.get(input.attemptJob.providerPredictionId);
  } catch (error) {
    if (!isRateLimitLike(error)) throw error;
    recordMapValue(renderSuccessRuntimeStats.rateLimitsByProvider, input.attempt.provider);
    const retry = retryInfo(error, input.attemptJob.retryCount);
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: 'Render queue is cooling down. Lumora will resume automatically.',
      category: 'rate_limited',
      status: 'rate_limited',
      retryAfterSeconds: retry.retryAfterSeconds,
      retryAvailableAt: retry.retryAvailableAt,
    });
    await markMasterStatus({
      masterId: input.master.id,
      status: 'rate_limited',
      providerStatus: 'rate_limited',
      progressLabel: 'Render queue is cooling down. Lumora will resume automatically.',
      errorMessage: 'Render queue is cooling down. Lumora will resume automatically.',
      errorCategory: 'rate_limited',
      retryAfterSeconds: retry.retryAfterSeconds,
      retryAvailableAt: retry.retryAvailableAt,
      providerModel: input.attempt.providerModel,
      referenceCount: input.attempt.referenceCount,
      attemptTier: input.attempt.tier,
    });
    scheduleResume(input.master.id, retry.delayMs);
    return 'pending' as const;
  }
  await updateAttemptProviderState({
    attemptJobId: input.attemptJob.id,
    prediction,
    attempt: input.attempt,
  });

  if (prediction.status === 'succeeded') {
    const outputParse = parseProviderVideoOutput(prediction.output);
    if (!outputParse.ok) {
      providerOutputMissingCount += 1;
      await markAttemptFailed({
        attemptJobId: input.attemptJob.id,
        attempt: input.attempt,
        message: 'Provider completed without a usable video output.',
        category: outputParse.category,
      });
      await persistRecipe({
        userId: input.master.userId,
        characterId: input.metadata.characterId,
        attempt: input.attempt,
        success: false,
        failureCategory: outputParse.category,
      });
      return 'failed' as const;
    }
    const completed = await finalizeSuccessfulAttempt({
      master: input.master,
      metadata: input.metadata,
      attemptJob: input.attemptJob,
      attempt: input.attempt,
      providerJobId: prediction.id,
      providerStatus: prediction.status,
      providerOutputUrl: outputParse.videoUrl,
      finalPrompt: input.attempt.prompt,
      model: input.attempt.providerModel,
    });
    return completed ? 'completed' as const : 'failed' as const;
  }

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: 'This render path did not complete.',
      category: 'provider',
    });
    return 'failed' as const;
  }

  await markMasterStatus({
    masterId: input.master.id,
    status: 'rendering',
    providerStatus: prediction.status,
    progressLabel: input.attempt.progressLabel,
    providerModel: input.attempt.providerModel,
    referenceCount: input.attempt.referenceCount,
    attemptTier: input.attempt.tier,
  });
  scheduleResume(input.master.id, RENDER_SUCCESS_POLL_INTERVAL_MS);
  return 'pending' as const;
}

async function runDemoAttempt(input: {
  master: RenderSuccessJobRow;
  metadata: RenderSuccessEngineMetadata;
  attemptJob: RenderSuccessJobRow;
  attempt: RenderSuccessAttempt;
}) {
  const result = await createVideoGeneration('mock', {
    userId: input.master.userId,
    prompt: input.attempt.prompt,
    durationSeconds: input.attempt.durationSeconds,
    aspectRatio: input.attempt.aspectRatio,
    privacy: 'private',
    characterId: input.metadata.characterId ?? null,
    characterName: input.metadata.characterName ?? null,
  });
  if (result.status !== 'completed' || !result.resultAssetUrl) {
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: 'Demo Mode did not create provider video output.',
      category: 'demo_output_missing',
    });
    return false;
  }
  return finalizeSuccessfulAttempt({
    master: input.master,
    metadata: input.metadata,
    attemptJob: input.attemptJob,
    attempt: input.attempt,
    providerJobId: result.providerJobId,
    providerStatus: 'completed',
    providerOutputUrl: result.resultAssetUrl,
    finalPrompt: result.prompt,
    model: 'demo-mode',
  });
}

async function runProviderAttempt(input: {
  master: RenderSuccessJobRow;
  metadata: RenderSuccessEngineMetadata;
  attemptJob: RenderSuccessJobRow;
  attempt: RenderSuccessAttempt;
}) {
  renderSuccessRuntimeStats.totalAttempts += 1;
  await markMasterStatus({
    masterId: input.master.id,
    status: 'rendering',
    providerStatus: 'rendering',
    progressLabel: input.attempt.progressLabel,
    providerModel: input.attempt.providerModel,
    referenceCount: input.attempt.referenceCount,
    attemptTier: input.attempt.tier,
  });
  await query(
    `update generation_jobs
     set status = 'rendering',
         provider_status = 'starting',
         error_message = null,
         error_category = null,
         retry_after_seconds = null,
         retry_available_at = null,
         updated_at = now()
     where id = $1`,
    [input.attemptJob.id],
  );

  try {
    if (input.attempt.quality === 'demo') {
      const demoCompleted = await runDemoAttempt(input);
      return demoCompleted ? 'completed' as const : 'failed' as const;
    }

    const onPredictionEvent = (event: SeedancePredictionEvent) => updateAttemptProviderState({
      attemptJobId: input.attemptJob.id,
      prediction: event.prediction,
      attempt: input.attempt,
    });

    const result = await generateSeedanceVideo(input.attempt.prompt, {
      quality: input.attempt.quality,
      referenceImages: input.attempt.referenceImages,
      userId: input.master.userId,
      characterId: input.metadata.characterId,
      characterName: null,
      characterDisplayName: null,
      projectId: input.master.projectId,
      providerFallbackStage: `render_success_attempt_${input.attempt.tier}`,
      durationSeconds: input.attempt.durationSeconds,
      aspectRatio: input.attempt.aspectRatio,
      resolution: input.attempt.resolution,
      generateAudio: input.attempt.generateAudio,
      timeoutMs: RENDER_SUCCESS_TIMEOUT_MS,
      pollIntervalMs: RENDER_SUCCESS_POLL_INTERVAL_MS,
      onPredictionCreated: onPredictionEvent,
      onPredictionPolled: onPredictionEvent,
    });

    const completed = await finalizeSuccessfulAttempt({
      master: input.master,
      metadata: input.metadata,
      attemptJob: input.attemptJob,
      attempt: input.attempt,
      providerJobId: result.providerJobId,
      providerStatus: 'succeeded',
      providerOutputUrl: result.videoUrl,
      finalPrompt: result.finalPrompt,
      model: result.model,
      warnings: result.warnings,
    });
    return completed ? 'completed' as const : 'failed' as const;
  } catch (error) {
    if (isRateLimitLike(error)) {
      recordMapValue(renderSuccessRuntimeStats.rateLimitsByProvider, input.attempt.provider);
      const retry = retryInfo(error, input.attemptJob.retryCount);
      await markAttemptFailed({
        attemptJobId: input.attemptJob.id,
        attempt: input.attempt,
        message: 'Render queue is cooling down. Lumora will resume automatically.',
        category: 'rate_limited',
        status: 'rate_limited',
        retryAfterSeconds: retry.retryAfterSeconds,
        retryAvailableAt: retry.retryAvailableAt,
      });
      await markMasterStatus({
        masterId: input.master.id,
        status: 'rate_limited',
        providerStatus: 'rate_limited',
        progressLabel: 'Render queue is cooling down. Lumora will resume automatically.',
        errorMessage: 'Render queue is cooling down. Lumora will resume automatically.',
        errorCategory: 'rate_limited',
        retryAfterSeconds: retry.retryAfterSeconds,
        retryAvailableAt: retry.retryAvailableAt,
        providerModel: input.attempt.providerModel,
        referenceCount: input.attempt.referenceCount,
        attemptTier: input.attempt.tier,
      });
      await updateProjectStatus(input.master.projectId, 'rendering', 'Render queue is cooling down. Lumora will resume automatically.');
      scheduleResume(input.master.id, retry.delayMs);
      return 'pending' as const;
    }

    const category = isProviderOutputError(error)
      ? error.category
      : isSeedanceModerationError(error)
        ? 'moderation'
        : 'provider';
    if (category === 'moderation') recordMapValue(renderSuccessRuntimeStats.moderationBlocksByTier, input.attempt.tier);
    await markAttemptFailed({
      attemptJobId: input.attemptJob.id,
      attempt: input.attempt,
      message: safeErrorMessage(error),
      category,
      status: category === 'moderation' && !input.attemptJob.providerPredictionId ? 'skipped' : 'failed',
    });
    await persistRecipe({
      userId: input.master.userId,
      characterId: input.metadata.characterId,
      attempt: input.attempt,
      success: false,
      failureCategory: category,
    });
    return 'failed' as const;
  }
}

async function exhaustRenderSuccessJob(master: RenderSuccessJobRow) {
  await markMasterStatus({
    masterId: master.id,
    status: 'paused',
    providerStatus: 'exhausted',
    progressLabel: 'This scene needs a simpler direction before rendering.',
    errorMessage: 'This scene needs a simpler direction before rendering.',
    errorCategory: 'safe_routes_exhausted',
  });
  await updateProjectStatus(master.projectId, 'draft', 'This scene needs a simpler direction before rendering.');
}

export async function startRenderSuccessJob(input: StartRenderSuccessJobInput) {
  if (!isUuidLike(input.userId)) {
    throw new Error('Sign in before rendering so Lumora can save your scene to Drafts.');
  }

  const activeJob = input.forceProbe ? null : await findActiveMasterJob(input.userId);
  if (activeJob) {
    duplicateRenderPrevented += 1;
    if (
      activeJob.status === 'queued' ||
      activeJob.status === 'rendering' ||
      shouldResumeRateLimitedAttempt({
        status: activeJob.status,
        retryAvailableAt: activeJob.retryAvailableAt,
      })
    ) {
      processRenderSuccessJob(activeJob.id);
    }
    return {
      job: activeJob,
      duplicateOf: activeJob.id,
      message: 'Lumora is already finding the cleanest render path.',
    };
  }

  const firstVideoRescue = input.firstVideoRescue ?? !(await hasVerifiedVideoForUserCharacter({
    userId: input.userId,
    characterId: input.characterId ?? null,
  }));
  const renderInput: StartRenderSuccessJobInput = {
    ...input,
    firstVideoRescue,
  };
  const groupId = randomUUID();
  const projectId = await createRenderSuccessProject(renderInput, groupId);
  const master = await insertMasterJob(renderInput, groupId, projectId);
  processRenderSuccessJob(master.id);

  return {
    job: master,
    duplicateOf: null,
    message: 'Lumora is finding the cleanest render path.',
  };
}

export function processRenderSuccessJob(masterJobId: string) {
  if (activeRenderSuccessProcessors.has(masterJobId)) return;
  activeRenderSuccessProcessors.add(masterJobId);

  void (async () => {
    try {
      const master = await getRenderSuccessJob(masterJobId);
      if (!master || master.status === 'completed' || master.status === 'failed' || master.status === 'paused') return;
      const metadata = renderSuccessMetadata(master);
      if (!metadata?.groupId) {
        await markMasterStatus({
          masterId: masterJobId,
          status: 'failed',
          progressLabel: 'Lumora could not resume this render path.',
          errorMessage: 'Lumora could not resume this render path.',
          errorCategory: 'metadata',
        });
        return;
      }

      if (master.status === 'rate_limited' && isRateLimitCooldownActive({ retryAvailableAt: master.retryAvailableAt })) {
        scheduleResume(master.id, Math.max(1_000, Date.parse(master.retryAvailableAt ?? '') - Date.now()));
        return;
      }

      const referenceCanary = metadata.firstVideoRescue
        ? await getReferenceCanaryReadiness({
            userId: master.userId,
            characterId: metadata.characterId,
          })
        : { state: 'unknown' as const };
      const baseAttempts = buildRenderSuccessAttemptPlan({
        referenceImages: metadata.referenceImages ?? [],
        characterName: metadata.characterName,
        allowDemoFallback: Boolean(metadata.allowDemoFallback || env.DEMO_MODE),
        firstVideoRescue: Boolean(metadata.firstVideoRescue),
        referenceCanaryState: referenceCanary.state,
      });
      const preferredRecipe = await loadPreferredRecipe({
        userId: master.userId,
        characterId: metadata.characterId,
      });
      const prioritizedAttempts = prioritizeAttemptsWithMemory(baseAttempts, preferredRecipe);
      const budgetedAttempts = selectAttemptsWithinBudget({
        attempts: prioritizedAttempts,
        maxPaidAttempts: metadata.maxPaidAttempts,
        maxTotalAttempts: metadata.maxTotalAttempts,
      }).selected;
      const attemptJobs = await listAttemptJobs(metadata.groupId);
      const attemptJobsByTier = new Map<number, RenderSuccessJobRow>();
      for (const attemptJob of attemptJobs) {
        if (typeof attemptJob.renderSuccessAttemptTier === 'number' && !attemptJobsByTier.has(attemptJob.renderSuccessAttemptTier)) {
          attemptJobsByTier.set(attemptJob.renderSuccessAttemptTier, attemptJob);
        }
      }

      for (const attempt of budgetedAttempts) {
        let attemptJob = attemptJobsByTier.get(attempt.tier) ?? null;
        const attemptOutputUrl = attemptJob?.outputUrl ?? attemptJob?.resultAssetUrl ?? null;
        const attemptOutputParse = parseProviderVideoOutput(attemptOutputUrl);
        if (attemptJob?.status === 'completed' && isUsableVideoOutput({
          providerStatus: attemptJob.providerStatus ?? 'succeeded',
          outputUrl: attemptOutputUrl,
        })) {
          await markMasterStatus({
            masterId: master.id,
            status: 'completed',
            providerStatus: 'succeeded',
            progressLabel: 'Cinematic draft ready.',
            outputUrl: attemptOutputUrl,
            providerModel: attempt.providerModel,
            referenceCount: attempt.referenceCount,
            attemptTier: attempt.tier,
          });
          return;
        }
        if (attemptJob?.status === 'completed' && !attemptOutputParse.ok) {
          await markAttemptFailed({
            attemptJobId: attemptJob.id,
            attempt,
            message: 'Provider completed without a usable video output.',
            category: attemptOutputParse.category,
          });
          continue;
        }
        if (attemptJob?.status === 'rate_limited' && isRateLimitCooldownActive({ retryAvailableAt: attemptJob.retryAvailableAt })) {
          scheduleResume(master.id, Math.max(1_000, Date.parse(attemptJob.retryAvailableAt ?? '') - Date.now()));
          return;
        }
        if (attemptJob?.providerPredictionId && (attemptJob.status === 'rendering' || attemptJob.status === 'rate_limited')) {
          const pollResult = await pollExistingPrediction({ master, metadata, attemptJob, attempt });
          if (pollResult === 'completed' || pollResult === 'pending') return;
          continue;
        }
        if (attemptJob?.status === 'failed' || attemptJob?.status === 'skipped') continue;
        if (!attemptJob) {
          attemptJob = await insertAttemptJob({ master, attempt, metadata });
          attemptJobsByTier.set(attempt.tier, attemptJob);
        }

        const result = await runProviderAttempt({ master, metadata, attemptJob, attempt });
        if (result === 'completed' || result === 'pending') return;
      }

      await exhaustRenderSuccessJob(master);
    } catch (error) {
      await markMasterStatus({
        masterId: masterJobId,
        status: 'paused',
        progressLabel: 'This scene needs a simpler direction before rendering.',
        errorMessage: safeErrorMessage(error),
        errorCategory: 'render_success_engine',
      }).catch(() => undefined);
      console.error('RENDER SUCCESS ENGINE FAILED:', serializeDiagnosticError(error));
    } finally {
      activeRenderSuccessProcessors.delete(masterJobId);
    }
  })();
}

export function formatRenderSuccessJobStatus(job: RenderSuccessJobRow) {
  const metadata = renderSuccessMetadata(job);
  const outputParse = parseProviderVideoOutput(job.outputUrl ?? job.resultAssetUrl ?? null);
  const outputUrl = outputParse.ok ? outputParse.videoUrl : '';
  const completedWithOutput = job.status === 'completed' && Boolean(outputUrl);
  const status = job.status === 'completed' && !outputUrl
    ? 'failed'
    : job.status === 'processing'
      ? 'rendering'
      : job.status;
  const renderedWithLighterCastGuidance = completedWithOutput && (
    job.renderSuccessAttemptTier === 4 ||
    job.referenceCount === 0 ||
    job.renderSuccessReferenceCount === 0
  );
  const retrySeconds = job.retryAvailableAt
    ? Math.max(0, Math.ceil((Date.parse(job.retryAvailableAt) - Date.now()) / 1000))
    : job.retryAfterSeconds;
  const progressLabel = completedWithOutput
    ? 'Cinematic draft ready.'
    : status === 'rate_limited'
      ? 'Render queue is cooling down. Lumora will resume automatically.'
      : status === 'paused' || status === 'failed'
        ? 'This scene needs a simpler direction before rendering.'
        : metadata?.progressLabel || 'Lumora is finding the cleanest render path.';

  return {
    id: job.id,
    jobId: job.id,
    projectId: job.projectId,
    status,
    providerStatus: job.providerStatus,
    progressLabel,
    engine: 'seedance-2.0',
    provider: job.providerName ?? 'replicate',
    model: job.providerModel,
    providerJobId: job.providerJobId,
    providerPredictionId: job.providerPredictionId,
    providerPredictionUrl: job.providerPredictionUrl,
    prompt: metadata?.prompt ?? job.prompt,
    outputUrl,
    videoUrl: outputUrl,
    thumbnailUrl: job.thumbnailUrl,
    error: job.errorMessage,
    errorMessage: job.errorMessage,
    errorCategory: job.errorCategory,
    renderMode: 'success_first',
    providerFallbackStage: job.providerFallbackStage,
    referenceCount: job.referenceCount ?? job.renderSuccessReferenceCount,
    retryAfterSeconds: retrySeconds ?? null,
    retryAvailableAt: job.retryAvailableAt,
    durationSeconds: job.durationSeconds ?? RENDER_SUCCESS_DURATION_SECONDS,
    aspectRatio: job.aspectRatio ?? (metadata?.firstVideoRescue ? FIRST_VIDEO_RESCUE_ASPECT_RATIO : RENDER_SUCCESS_ASPECT_RATIO),
    displayEngine: 'Seedance Fast',
    generationMode: (job.referenceCount ?? 0) > 0 ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
    message: completedWithOutput
      ? renderedWithLighterCastGuidance
        ? 'Rendered with lighter cast guidance.'
        : 'Cinematic draft ready.'
      : status === 'rate_limited'
        ? 'Render queue is cooling down. Lumora will resume automatically.'
      : status === 'paused' || status === 'failed'
        ? 'This scene needs a simpler direction before rendering.'
        : 'Lumora is finding the cleanest render path.',
    warnings: renderedWithLighterCastGuidance ? ['Rendered with lighter cast guidance.'] : [],
    renderSuccess: {
      enabled: true,
      attemptTier: job.renderSuccessAttemptTier,
      promptStyle: job.renderSuccessPromptStyle,
      progressSteps: [
        'Preparing cast',
        'Trying primary reference',
        'Trying storybook cinematic take',
        'Saving to Drafts',
      ],
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function getRenderSuccessJobStatus(jobId: string) {
  const job = await getRenderSuccessJob(jobId);
  if (!job) return null;

  if (job.status === 'queued' || job.status === 'rendering' || shouldResumeRateLimitedAttempt({
    status: job.status,
    retryAvailableAt: job.retryAvailableAt,
  })) {
    processRenderSuccessJob(job.id);
  }

  return formatRenderSuccessJobStatus(await getRenderSuccessJob(job.id) ?? job);
}

export async function resumeRenderSuccessJob(jobId: string) {
  const job = await getRenderSuccessJob(jobId);
  if (!job) return null;

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'paused') {
    return formatRenderSuccessJobStatus(job);
  }

  if (job.status === 'rate_limited' && isRateLimitCooldownActive({ retryAvailableAt: job.retryAvailableAt })) {
    return formatRenderSuccessJobStatus(job);
  }

  processRenderSuccessJob(job.id);
  return formatRenderSuccessJobStatus(await getRenderSuccessJob(job.id) ?? job);
}

export async function resumeExpiredRenderSuccessCooldowns(limit = 5) {
  const result = await query<{ id: string }>(
    `select id
     from generation_jobs
     where render_success_role = 'master'
       and status = 'rate_limited'
       and (retry_available_at is null or retry_available_at <= now())
     order by updated_at asc
     limit $1`,
    [Math.max(1, Math.min(20, Math.round(limit)))],
  );
  for (const row of result.rows) {
    processRenderSuccessJob(row.id);
  }
  return result.rows.length;
}

export async function buildRenderSuccessDiagnostics() {
  try {
    await resumeExpiredRenderSuccessCooldowns().catch(() => 0);
    const result = await query<{
      totalAttempts: number;
      successfulAttempts: number;
      failedAttempts: number;
      activeMasters: number;
      currentStuckJobs: number;
      outputMissingCount: number;
      mostSuccessfulProvider: string | null;
      mostSuccessfulReferenceCount: number | null;
    }>(
      `select
         count(*) filter (where render_success_role = 'attempt')::int as "totalAttempts",
         count(*) filter (where render_success_role = 'attempt' and status = 'completed')::int as "successfulAttempts",
         count(*) filter (where render_success_role = 'attempt' and status = 'failed')::int as "failedAttempts",
         count(*) filter (where render_success_role = 'master' and status in ('queued', 'rendering', 'processing', 'rate_limited'))::int as "activeMasters",
         count(*) filter (
           where render_success_role in ('master', 'attempt')
             and status in ('queued', 'rendering', 'processing')
             and updated_at < now() - interval '30 minutes'
         )::int as "currentStuckJobs",
         count(*) filter (where error_category in ('provider_output_missing', 'provider_output_unreachable', 'output_missing', 'unsupported_output_shape', 'image_output', 'non_video_output', 'error_output', 'demo_output_missing'))::int as "outputMissingCount",
         (
           select provider
           from render_success_memory
           where coalesce(success_count, 0) > 0
           order by success_count desc, last_success_at desc nulls last
           limit 1
         ) as "mostSuccessfulProvider",
         (
           select reference_count
           from render_success_memory
           where coalesce(success_count, 0) > 0
           order by success_count desc, last_success_at desc nulls last
           limit 1
         )::int as "mostSuccessfulReferenceCount"
       from generation_jobs`,
    );
    const row = result.rows[0];

    return {
      ok: (row?.currentStuckJobs ?? 0) === 0,
      enabled: true,
      totalAttempts: (row?.totalAttempts ?? 0) + renderSuccessRuntimeStats.totalAttempts,
      successRate: row && row.totalAttempts > 0
        ? Math.round((row.successfulAttempts / row.totalAttempts) * 100)
        : null,
      mostSuccessfulProvider: row?.mostSuccessfulProvider ?? null,
      mostSuccessfulReferenceCount: row?.mostSuccessfulReferenceCount ?? null,
      lastSuccessfulRecipe: renderSuccessRuntimeStats.lastSuccessfulRecipe,
      currentStuckJobs: row?.currentStuckJobs ?? 0,
      activeMasters: row?.activeMasters ?? activeRenderSuccessProcessors.size,
      paidAttemptsPrevented,
      duplicateRenderPrevented,
      moderationBlocksByTier: Object.fromEntries(renderSuccessRuntimeStats.moderationBlocksByTier.entries()),
      rateLimitsByProvider: Object.fromEntries(renderSuccessRuntimeStats.rateLimitsByProvider.entries()),
      providerOutputMissingCount: (row?.outputMissingCount ?? 0) + providerOutputMissingCount,
      maxPaidAttempts: env.RENDER_SUCCESS_MAX_PAID_ATTEMPTS,
      autoRetry: env.RENDER_SUCCESS_AUTO_RETRY,
      probeEnabled: env.ENABLE_RENDER_PROBE,
    };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      totalAttempts: renderSuccessRuntimeStats.totalAttempts,
      successRate: null,
      mostSuccessfulProvider: null,
      mostSuccessfulReferenceCount: null,
      lastSuccessfulRecipe: renderSuccessRuntimeStats.lastSuccessfulRecipe,
      currentStuckJobs: 0,
      activeMasters: activeRenderSuccessProcessors.size,
      paidAttemptsPrevented,
      duplicateRenderPrevented,
      moderationBlocksByTier: Object.fromEntries(renderSuccessRuntimeStats.moderationBlocksByTier.entries()),
      rateLimitsByProvider: Object.fromEntries(renderSuccessRuntimeStats.rateLimitsByProvider.entries()),
      providerOutputMissingCount,
      maxPaidAttempts: env.RENDER_SUCCESS_MAX_PAID_ATTEMPTS,
      autoRetry: env.RENDER_SUCCESS_AUTO_RETRY,
      probeEnabled: env.ENABLE_RENDER_PROBE,
      error: serializeDiagnosticError(error),
    };
  }
}
