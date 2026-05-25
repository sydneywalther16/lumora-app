import { createHash } from 'node:crypto';
import Replicate, { type Prediction } from 'replicate';
import { env } from '../lib/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import { parseProviderVideoOutput } from './providerOutputParser';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { sanitizeProviderPrompt } from './providerPromptSanitizer';
import { getCinematicCharacterProfileForUser, type CharacterReferenceImageUrls } from './characterProfiles';
import { scoreReferenceConfidence } from './sceneOptimization';
import {
  alternateLikenessProvidersConfigured,
  buildAlternateLikenessProviderCanaryStatus,
} from './likenessProviderCanary';
import { getAlternateExactLikenessProviderStatuses } from './alternateLikenessProviderMemory';
import { chooseExactLikenessRoute } from './exactLikenessRouter';
import { buildLikenessProviderRegistry } from './likenessProviderRegistry';
import {
  chooseSoraSelfCharacterCreateRoute,
  getOpenAISoraProviderReadiness,
  getSelfProviderCharacterDiagnostics,
} from './providers/openaiSoraProvider';
import {
  SEEDANCE_FAST_MODEL,
  SEEDANCE_QUALITY_MODEL,
  isReplicateRateLimitError,
  seedancePayloadSummary,
  validateSeedanceProviderPayload,
  type SeedanceProviderPayload,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';
import {
  getSelfVerificationVideoDiagnostics,
  getSelfVerificationVideoReferenceAsset,
  markSeedanceVideoReferenceCanaryResult,
  SEEDANCE_VIDEO_REFERENCE_PROMPT,
} from './selfVerificationVideo';
import {
  prepareVerificationVideoForProvider,
  type VerificationVideoNormalizationDiagnostics,
  type VerificationVideoPreflightMetadata,
} from './verificationVideoNormalizer';

export const SEEDANCE_CANARY_PROMPT =
  'A peaceful sunlit garden path with flowers swaying gently in the breeze, soft storybook cinematic style, calm natural motion.';
export const SEEDANCE_REFERENCE_CANARY_PROMPT =
  'The character from [Image1] walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion.';
export const SEEDANCE_CANARY_DURATION_SECONDS = 5;
export const SEEDANCE_CANARY_ASPECT_RATIO = '9:16';
export const SEEDANCE_CANARY_RESOLUTION = '480p';
export const SEEDANCE_CANARY_GENERATE_AUDIO = false;

const CANARY_USER_ID = '00000000-0000-4000-8000-000000000000';
const CANARY_TIMEOUT_MS = 4 * 60 * 1000;
const RATE_LIMIT_SAFETY_BUFFER_MS = 2_000;
const REFERENCE_CANARY_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const VERIFICATION_VIDEO_BUCKET = 'self-capture-videos';
const VERIFICATION_VIDEO_SIGNED_URL_TTL_SECONDS = 60 * 60;
const VERIFICATION_VIDEO_PAYLOAD_PLACEHOLDER_URL = 'https://private.lumora.local/self-verification-video.mp4';
const VIDEO_REFERENCE_TRANSIENT_RETRY_DELAY_MS = 15 * 60 * 1000;
const activeCanaryProcessors = new Set<string>();

const SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS = {
  reference_videos_bracket: {
    fieldName: 'reference_videos',
    promptToken: '[Video1]',
    promptTokenStyle: 'bracket',
    enabledByLocalReplicateMapping: true,
    documentationSource: 'replicate_seedance_fast_reference_videos',
  },
  reference_videos_at: {
    fieldName: 'reference_videos',
    promptToken: '@Video1',
    promptTokenStyle: 'at',
    enabledByLocalReplicateMapping: true,
    documentationSource: 'seedance_multimodal_at_token_docs',
  },
  video_urls_at: {
    fieldName: 'video_urls',
    promptToken: '@Video1',
    promptTokenStyle: 'at',
    enabledByLocalReplicateMapping: true,
    documentationSource: 'seedance_fal_style_video_urls_docs',
  },
} as const satisfies Record<string, {
  fieldName: 'reference_videos' | 'video_urls';
  promptToken: '[Video1]' | '@Video1';
  promptTokenStyle: 'bracket' | 'at';
  enabledByLocalReplicateMapping: boolean;
  documentationSource: string;
}>;

type CanaryKind = 'text' | 'reference' | 'video_reference';
type CanaryLifecycleStatus = 'queued' | 'rendering' | 'rate_limited' | 'completed' | 'failed' | 'canceled';
export type SeedanceVideoReferenceCanaryVariant = 'reference_videos_bracket' | 'reference_videos_at' | 'video_urls_at';
type CanaryVariant = 'text_only' | 'reference_images' | 'verification_video_reference' | SeedanceVideoReferenceCanaryVariant;
export type SeedanceReferenceMatrixVariant = CanaryVariant | 'image_to_video';

type ProviderFailureDiagnostics = {
  providerErrorCategory: string;
  providerErrorSummary: string | null;
  providerLogsExcerpt: string | null;
  predictionGetUrlHost: string | null;
  providerStatus: string | null;
  metricsSummary: string | null;
};

export type ReferenceRouteReadiness = {
  state: 'succeeded' | 'failed' | 'unknown';
  referenceRole: string | null;
  variant: SeedanceReferenceMatrixVariant | null;
  failureCategory: string | null;
  seedanceReferenceRoutesBlocked?: boolean;
};

type CanaryMetadata = {
  kind: CanaryKind;
  canaryVariant: CanaryVariant;
  providerInput: SeedanceProviderPayload;
  payloadSummary: ReturnType<typeof seedancePayloadSummary>;
  selectedReference?: CanaryReferenceDiagnostics | null;
  selectedVerificationVideo?: CanaryVerificationVideoDiagnostics | null;
  verificationVideoAsset?: {
    bucket: string;
    objectPath: string;
  } | null;
  providerFailure?: ProviderFailureDiagnostics | null;
  saveAsDraft: boolean;
  userId: string | null;
  characterId: string | null;
  referenceImages: SeedanceReferenceImage[];
  createdAt: string;
};

type CanaryJobRow = {
  id: string;
  userId: string;
  projectId: string | null;
  provider: string;
  providerJobId: string | null;
  providerPredictionId: string | null;
  providerPredictionUrl: string | null;
  providerStatus: string | null;
  providerModel: string | null;
  prompt: string;
  status: CanaryLifecycleStatus | string;
  characterId: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  resultAssetUrl: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  errorCategory: string | null;
  retryAfterSeconds: number | null;
  retryAvailableAt: string | null;
  sceneMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type LatestRealPathRow = {
  id: string;
  userId: string | null;
  characterId: string | null;
  provider: string | null;
  providerName: string | null;
  providerModel: string | null;
  prompt: string | null;
  status: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  referenceCount: number | null;
  characterName: string | null;
  sceneMetadata: Record<string, unknown> | null;
  renderMode: string | null;
  providerFallbackStage: string | null;
  renderSuccessRole: string | null;
  createdAt: string;
};

export type CanaryReferenceDiagnostics = {
  selected: boolean;
  role: string | null;
  label: string | null;
  host: string | null;
  savedToLumora: boolean;
  whySelected: string;
  source: string | null;
  sourcesChecked?: string[];
  reachable?: boolean | null;
  contentType?: string | null;
  contentLength?: number | null;
  accessStatus?: number | null;
  accessError?: string | null;
};

export type CanaryReferenceSelection = {
  reference: SeedanceReferenceImage | null;
  diagnostics: CanaryReferenceDiagnostics;
};

export type CanaryVerificationVideoDiagnostics = {
  selected: boolean;
  bucket: string | null;
  objectPathPresent: boolean;
  host: string | null;
  signedUrlGenerated: boolean;
  reachable?: boolean | null;
  contentType?: string | null;
  contentLength?: number | null;
  accessStatus?: number | null;
  accessError?: string | null;
  source: 'verification_video_asset_id' | 'verification_video_url' | 'none';
  variant?: SeedanceVideoReferenceCanaryVariant | null;
  referenceFieldName?: 'reference_videos' | 'video_urls' | null;
  promptTokenStyle?: 'bracket' | 'at' | null;
  normalizedAssetUsed?: boolean | null;
  normalizedStatus?: VerificationVideoNormalizationDiagnostics['normalizedStatus'] | null;
  normalizationTriggered?: boolean | null;
  normalizationReason?: VerificationVideoNormalizationDiagnostics['normalizationReason'] | null;
  normalizationErrorCategory?: VerificationVideoNormalizationDiagnostics['normalizationErrorCategory'] | null;
  normalizationExitCode?: number | null;
  normalizationStderrExcerpt?: string | null;
  normalizationStdoutExcerpt?: string | null;
  normalizationFfmpegArgs?: string[] | null;
  normalizationEncoderFallbackUsed?: boolean | null;
  normalizationResolutionFallbackUsed?: boolean | null;
  preflight?: VerificationVideoPreflightMetadata | null;
  normalizedPreflight?: VerificationVideoPreflightMetadata | null;
  preflightOk?: boolean | null;
  preflightFailureReason?: string | null;
};

type CanaryVerificationVideoRuntime = {
  bucket: string;
  objectPath: string;
  diagnostics: CanaryVerificationVideoDiagnostics;
};

export type SelfCharacterCandidate = {
  id: string;
  characterId: string;
  ownerUserId: string;
  name: string;
  displayName: string;
  isSelf: boolean;
  referenceImageUrls: Partial<CharacterReferenceImageUrls>;
  referenceImages: Record<string, unknown>;
  source: SelfReferenceSourceName;
  sourcePriority: number;
  updatedAt: string;
};

export type SelfReferenceSourceName =
  | 'self_characters.reference_image_urls'
  | 'profiles.self_reference_image_urls'
  | 'character_profiles.reference_image_urls';

type SelfReferenceSourceResult = {
  candidates: SelfCharacterCandidate[];
  sourcesChecked: string[];
  sourceErrors: string[];
};

export type SelfReferenceResolution = {
  candidate: SelfCharacterCandidate | null;
  selection: CanaryReferenceSelection;
  candidates: SelfCharacterCandidate[];
  sourcesChecked: string[];
  sourceErrors: string[];
};

export class SelfReferenceCanarySelectionError extends Error {
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;

  constructor(message: string, payload: Record<string, unknown> = {}, statusCode = 400) {
    super(message);
    this.name = 'SelfReferenceCanarySelectionError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

const canaryJobSelect = `
  id,
  user_id as "userId",
  project_id as "projectId",
  provider,
  provider_job_id as "providerJobId",
  provider_prediction_id as "providerPredictionId",
  provider_prediction_url as "providerPredictionUrl",
  provider_status as "providerStatus",
  provider_model as "providerModel",
  prompt,
  status,
  character_id as "characterId",
  duration_seconds as "durationSeconds",
  aspect_ratio as "aspectRatio",
  result_asset_url as "resultAssetUrl",
  output_url as "outputUrl",
  thumbnail_url as "thumbnailUrl",
  error_message as "errorMessage",
  error_category as "errorCategory",
  retry_after_seconds as "retryAfterSeconds",
  retry_available_at as "retryAvailableAt",
  scene_metadata as "sceneMetadata",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function mapCanaryRow(row: Record<string, unknown>): CanaryJobRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    projectId: typeof row.projectId === 'string' ? row.projectId : null,
    provider: String(row.provider ?? 'seedance-canary'),
    providerJobId: typeof row.providerJobId === 'string' ? row.providerJobId : null,
    providerPredictionId: typeof row.providerPredictionId === 'string' ? row.providerPredictionId : null,
    providerPredictionUrl: typeof row.providerPredictionUrl === 'string' ? row.providerPredictionUrl : null,
    providerStatus: typeof row.providerStatus === 'string' ? row.providerStatus : null,
    providerModel: typeof row.providerModel === 'string' ? row.providerModel : null,
    prompt: String(row.prompt ?? ''),
    status: String(row.status ?? 'queued'),
    characterId: typeof row.characterId === 'string' ? row.characterId : null,
    durationSeconds: typeof row.durationSeconds === 'number' ? row.durationSeconds : null,
    aspectRatio: typeof row.aspectRatio === 'string' ? row.aspectRatio : null,
    resultAssetUrl: typeof row.resultAssetUrl === 'string' ? row.resultAssetUrl : null,
    outputUrl: typeof row.outputUrl === 'string' ? row.outputUrl : null,
    thumbnailUrl: typeof row.thumbnailUrl === 'string' ? row.thumbnailUrl : null,
    errorMessage: typeof row.errorMessage === 'string' ? row.errorMessage : null,
    errorCategory: typeof row.errorCategory === 'string' ? row.errorCategory : null,
    retryAfterSeconds: typeof row.retryAfterSeconds === 'number' ? row.retryAfterSeconds : null,
    retryAvailableAt: typeof row.retryAvailableAt === 'string' ? row.retryAvailableAt : null,
    sceneMetadata: row.sceneMetadata && typeof row.sceneMetadata === 'object'
      ? row.sceneMetadata as Record<string, unknown>
      : null,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

function canaryMetadata(row: CanaryJobRow): CanaryMetadata | null {
  const metadata = row.sceneMetadata?.seedanceCanary;
  if (!metadata || typeof metadata !== 'object') return null;
  return metadata as CanaryMetadata;
}

function predictionUrl(prediction: Prediction) {
  const urls = prediction.urls as Record<string, unknown> | undefined;
  const getUrl = typeof urls?.get === 'string' ? urls.get : null;
  return getUrl ?? (prediction.id ? `https://replicate.com/p/${prediction.id}` : null);
}

function redactMessage(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 360);
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function referenceUrlsValue(value: unknown): Partial<CharacterReferenceImageUrls> {
  const record = recordValue(value);
  return {
    manualReferenceImageUrl: textValue(record.manualReferenceImageUrl) || null,
    frontFace: textValue(record.frontFace),
    frontFaceUrl: textValue(record.frontFaceUrl) || null,
    frontFacePath: textValue(record.frontFacePath) || null,
    leftAngle: textValue(record.leftAngle),
    leftAngleUrl: textValue(record.leftAngleUrl) || null,
    leftAnglePath: textValue(record.leftAnglePath) || null,
    rightAngle: textValue(record.rightAngle),
    rightAngleUrl: textValue(record.rightAngleUrl) || null,
    rightAnglePath: textValue(record.rightAnglePath) || null,
    fullBody: textValue(record.fullBody) || null,
    fullBodyUrl: textValue(record.fullBodyUrl) || null,
    fullBodyPath: textValue(record.fullBodyPath) || null,
    expressive: textValue(record.expressive) || null,
    expressiveUrl: textValue(record.expressiveUrl) || null,
    expressivePath: textValue(record.expressivePath) || null,
  };
}

function redactedId(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 10 ? `${value.slice(0, 2)}...` : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function redactedName(value: string | null | undefined) {
  const text = textValue(value);
  if (!text) return null;
  return `${text.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(8, text.length - 1)))}`;
}

function redactedHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
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

function retryInfo(error: unknown) {
  const retryAfterMs = isReplicateRateLimitError(error)
    ? error.retryAfterMs
    : rawRetryAfterMs(error);
  const delayMs = Math.max(5_000, (retryAfterMs ?? 10_000) + RATE_LIMIT_SAFETY_BUFFER_MS);
  return {
    retryAfterSeconds: Math.max(1, Math.ceil(delayMs / 1000)),
    retryAvailableAt: new Date(Date.now() + delayMs).toISOString(),
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyProviderFailure(value: unknown) {
  const raw = typeof value === 'string' ? value : errorText(value);
  const lower = raw.toLowerCase();
  if (lower.includes('moderation') || lower.includes('safety') || lower.includes('policy') || lower.includes('nsfw')) return 'provider_moderation';
  if (lower.includes('schema') || lower.includes('validation') || lower.includes('invalid input') || lower.includes('input')) return 'input_schema_invalid';
  if (lower.includes('balance') || lower.includes('credit')) return 'provider_rate_limited_low_balance';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  return 'provider';
}

function isTransientProviderUnavailableText(value: string) {
  const lower = value.toLowerCase();
  return /\be004\b/i.test(value) ||
    lower.includes('service is temporarily unavailable') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('try again later') ||
    lower.includes('provider unavailable') ||
    lower.includes('upstream unavailable');
}

export function classifyReferenceCanaryFailure(value: unknown, providerStatus?: string | null) {
  const raw = typeof value === 'string' ? value : errorText(value);
  const lower = raw.toLowerCase();
  if (lower.includes('flagged as sensitive') || lower.includes('input or output was flagged') || /\be005\b/i.test(raw)) return 'reference_moderation_block';
  if (lower.includes('moderation') || lower.includes('safety') || lower.includes('policy') || lower.includes('nsfw')) return 'reference_moderation_block';
  if (lower.includes('schema') || lower.includes('validation') || lower.includes('invalid input') || lower.includes('reference_images')) return 'reference_input_schema';
  if (lower.includes('403') || lower.includes('404') || lower.includes('asset') || lower.includes('download') || lower.includes('access')) return 'reference_asset_access';
  const normalizedStatus = (providerStatus ?? '').toLowerCase();
  if (normalizedStatus === 'failed' || normalizedStatus === 'canceled') {
    if (!raw.trim() || /^prediction\s+(failed|canceled)\.?$/i.test(raw.trim())) return 'reference_unknown_provider_failure';
    return 'reference_provider_failed';
  }
  if (lower.includes('output') || lower.includes('video url')) return 'reference_output_missing';
  return 'reference_unknown_provider_failure';
}

export function classifyVideoReferenceCanaryFailure(value: unknown, providerStatus?: string | null) {
  const raw = typeof value === 'string' ? value : errorText(value);
  const lower = raw.toLowerCase();
  if (isTransientProviderUnavailableText(raw)) return 'video_reference_provider_unavailable';
  if (lower.includes('flagged as sensitive') || lower.includes('input or output was flagged') || /\be005\b/i.test(raw)) return 'video_reference_moderation_block';
  if (lower.includes('moderation') || lower.includes('safety') || lower.includes('policy') || lower.includes('nsfw')) return 'video_reference_moderation_block';
  if (lower.includes('unknown field') || lower.includes('unrecognized field') || lower.includes('unsupported field') || lower.includes('schema')) return 'video_reference_input_schema';
  if (/\be006\b/i.test(raw) || lower.includes('the input was invalid') || lower.includes('different inputs') || lower.includes('invalid input')) return 'video_reference_input_invalid';
  if (lower.includes('validation') || lower.includes('reference_videos') || lower.includes('video_urls')) return 'video_reference_input_schema';
  if (lower.includes('403') || lower.includes('404') || lower.includes('asset') || lower.includes('download') || lower.includes('access')) return 'verification_video_asset_access';
  const normalizedStatus = (providerStatus ?? '').toLowerCase();
  if (normalizedStatus === 'failed' || normalizedStatus === 'canceled') {
    if (!raw.trim() || /^prediction\s+(failed|canceled)\.?$/i.test(raw.trim())) return 'video_reference_provider_failed';
    return 'video_reference_provider_failed';
  }
  if (lower.includes('output') || lower.includes('video url')) return 'video_reference_output_missing';
  return 'video_reference_provider_failed';
}

function isVideoReferenceTransientUnavailable(category: string | null | undefined) {
  return category === 'video_reference_provider_unavailable';
}

function videoReferenceRetryLaterInfo() {
  return {
    retryAfterSeconds: Math.ceil(VIDEO_REFERENCE_TRANSIENT_RETRY_DELAY_MS / 1000),
    retryAvailableAt: new Date(Date.now() + VIDEO_REFERENCE_TRANSIENT_RETRY_DELAY_MS).toISOString(),
  };
}

export function videoReferenceRouteStatusForFailure(category: string) {
  if (category === 'video_reference_moderation_block') {
    return 'failed_blocked';
  }
  if (
    category === 'video_reference_input_invalid' ||
    category === 'verification_video_preflight_failed' ||
    category === 'video_reference_input_schema'
  ) {
    return 'input_needs_repair';
  }
  return isVideoReferenceTransientUnavailable(category) ? 'transient_unavailable' : category;
}

export function isSeedanceVideoReferenceBlockedStatus(input: {
  status?: string | null;
  failureCategory?: string | null;
}) {
  return [
    input.status,
    input.failureCategory,
  ].some((value) => (
    value === 'failed_blocked' ||
    value === 'blocked' ||
    value === 'video_reference_moderation_block' ||
    value === 'reference_moderation_block'
  ));
}

export function seedanceVideoReferenceBlockedRetestPayload(input: {
  selectedVerificationVideo?: CanaryVerificationVideoDiagnostics | null;
  status?: string | null;
  failureCategory?: string | null;
}) {
  return {
    ok: false,
    provider: 'seedance-fast',
    route: 'seedance_video_reference',
    canaryStatus: 'failed_blocked',
    verificationVideoPresent: true,
    verificationConsentPresent: true,
    providerPredictionCreated: false,
    outputPresent: false,
    outputUrlPresent: false,
    parsedVideoUrlPresent: false,
    failureCategory: input.failureCategory ?? 'video_reference_moderation_block',
    selectedVerificationVideo: input.selectedVerificationVideo ?? null,
    message: 'This Seedance video-reference route is already blocked. Use -ForceRetest if you intentionally want to spend another attempt.',
    recommendedNextAction: 'Configure Runway/Kling likeness canary or continue soft guidance.',
  };
}

function classifyCanaryFailure(kind: CanaryKind, value: unknown, providerStatus?: string | null) {
  if (kind === 'reference') return classifyReferenceCanaryFailure(value, providerStatus);
  if (kind === 'video_reference') return classifyVideoReferenceCanaryFailure(value, providerStatus);
  return classifyProviderFailure(value);
}

export function canaryRateLimitStatus() {
  return 'rate_limited' as const;
}

function imageTokens(referenceCount: number) {
  return Array.from({ length: referenceCount }, (_item, index) => `[Image${index + 1}]`);
}

function videoTokens(referenceCount: number, style: 'bracket' | 'at' = 'bracket') {
  return Array.from({ length: referenceCount }, (_item, index) => (
    style === 'at' ? `@Video${index + 1}` : `[Video${index + 1}]`
  ));
}

export function buildReferenceImagePrompt(referenceImages: SeedanceReferenceImage[]) {
  const tokens = imageTokens(referenceImages.length);
  if (!tokens.length) return SEEDANCE_CANARY_PROMPT;
  const tokenText = tokens.join(', ');
  return `The character from ${tokenText} walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion.`;
}

export function buildSeedanceVideoReferencePrompt(variant: SeedanceVideoReferenceCanaryVariant = 'reference_videos_bracket') {
  const spec = SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS[variant] ?? SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS.reference_videos_bracket;
  if (spec.promptToken === '[Video1]') return SEEDANCE_VIDEO_REFERENCE_PROMPT;
  return `The verified self character from ${spec.promptToken} walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion.`;
}

function promptContainsAllImageTokens(prompt: string, referenceCount: number) {
  if (referenceCount <= 0) return false;
  return imageTokens(referenceCount).every((token) => prompt.includes(token));
}

function promptContainsAllVideoTokens(prompt: string, referenceCount: number) {
  if (referenceCount <= 0) return false;
  const bracketTokens = videoTokens(referenceCount, 'bracket');
  const atTokens = videoTokens(referenceCount, 'at');
  return bracketTokens.every((token) => prompt.includes(token)) ||
    atTokens.every((token) => prompt.includes(token));
}

export function buildSeedanceCanaryPayload(input: {
  referenceImages?: SeedanceReferenceImage[];
} = {}): SeedanceProviderPayload {
  const references = selectPrimaryCanaryReference(input.referenceImages ?? []);
  const sanitizer = sanitizeProviderPrompt({
    prompt: references.length ? buildReferenceImagePrompt(references) : SEEDANCE_CANARY_PROMPT,
  });
  const payload: SeedanceProviderPayload = {
    prompt: sanitizer.prompt,
    duration: SEEDANCE_CANARY_DURATION_SECONDS,
    aspect_ratio: SEEDANCE_CANARY_ASPECT_RATIO,
    resolution: SEEDANCE_CANARY_RESOLUTION,
    generate_audio: SEEDANCE_CANARY_GENERATE_AUDIO,
  };
  if (references.length) payload.reference_images = references.map((reference) => reference.url);
  return payload;
}

export function buildSeedanceVerificationVideoCanaryPayload(
  referenceVideoUrl = VERIFICATION_VIDEO_PAYLOAD_PLACEHOLDER_URL,
  variant: SeedanceVideoReferenceCanaryVariant = 'reference_videos_bracket',
): SeedanceProviderPayload {
  const spec = SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS[variant] ?? SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS.reference_videos_bracket;
  const sanitizer = sanitizeProviderPrompt({
    prompt: buildSeedanceVideoReferencePrompt(variant),
  });
  const payload: SeedanceProviderPayload = {
    prompt: sanitizer.prompt,
    duration: SEEDANCE_CANARY_DURATION_SECONDS,
    aspect_ratio: SEEDANCE_CANARY_ASPECT_RATIO,
    resolution: SEEDANCE_CANARY_RESOLUTION,
    generate_audio: SEEDANCE_CANARY_GENERATE_AUDIO,
  };
  if (spec.fieldName === 'video_urls') {
    payload.video_urls = [referenceVideoUrl];
  } else {
    payload.reference_videos = [referenceVideoUrl];
  }
  return payload;
}

export function selectPrimaryCanaryReference(references: SeedanceReferenceImage[]) {
  const seen = new Set<string>();
  return references.flatMap((reference, index) => {
    const url = typeof reference.url === 'string' ? reference.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{
      url,
      label: reference.label ?? `Reference ${index + 1}`,
      role: reference.role ?? 'reference',
      token: '[Image1]',
    }];
  }).slice(0, 1);
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

function canaryReferenceCandidates(character: {
  referenceImageUrls?: Partial<CharacterReferenceImageUrls> | null;
  referenceImages?: Record<string, unknown> | null;
  source?: string | null;
}) {
  const urls = {
    ...referenceUrlsValue(character.referenceImages),
    ...(character.referenceImageUrls ?? {}),
  };
  const source = character.source ?? null;
  return [
    {
      url: urls.frontFaceUrl ?? urls.frontFacePath ?? urls.frontFace ?? null,
      label: 'Primary front face',
      role: 'front_angle',
      source,
      whySelected: 'Primary saved Lumora front reference has the strongest identity signal.',
    },
    {
      url: urls.expressiveUrl ?? urls.expressivePath ?? urls.expressive ?? null,
      label: 'Clean face reference',
      role: 'face_upper_body',
      source,
      whySelected: 'Clean face or upper-body saved Lumora reference is the strongest available option.',
    },
    {
      url: urls.leftAngleUrl ?? urls.leftAnglePath ?? urls.leftAngle ?? null,
      label: 'Left angle',
      role: 'side_angle_left',
      source,
      whySelected: 'Side saved Lumora reference is used because primary/face references are unavailable.',
    },
    {
      url: urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle ?? null,
      label: 'Right angle',
      role: 'side_angle_right',
      source,
      whySelected: 'Side saved Lumora reference is used because primary/face references are unavailable.',
    },
    {
      url: urls.fullBodyUrl ?? urls.fullBodyPath ?? urls.fullBody ?? null,
      label: 'Full body',
      role: 'full_body',
      source,
      whySelected: 'Full-body saved Lumora reference is used because face references are unavailable.',
    },
    {
      url: urls.manualReferenceImageUrl ?? null,
      label: 'Manual reference override',
      role: 'manual_reference_override',
      source,
      whySelected: 'Manual reference override is never selected for canary.',
    },
  ];
}

export function selectStrongestCanaryReference(character: {
  referenceImageUrls?: Partial<CharacterReferenceImageUrls> | null;
  referenceImages?: Record<string, unknown> | null;
  source?: string | null;
  sourcesChecked?: string[];
}): CanaryReferenceSelection {
  const candidates = canaryReferenceCandidates(character);
  for (const candidate of candidates) {
    const url = textValue(candidate.url);
    const reference: SeedanceReferenceImage = {
      url,
      label: candidate.label,
      role: candidate.role,
      token: '[Image1]',
    };
    if (!url || isManualReference(reference)) continue;
    const confidence = scoreReferenceConfidence(reference);
    if (!confidence.savedToLumora || confidence.reasons.includes('Protected or temporary source')) continue;
    return {
      reference,
      diagnostics: {
        selected: true,
        role: reference.role ?? null,
        label: reference.label ?? null,
        host: redactedHost(url),
        savedToLumora: confidence.savedToLumora,
        whySelected: candidate.whySelected,
        source: candidate.source,
        sourcesChecked: character.sourcesChecked,
      },
    };
  }

  return {
    reference: null,
    diagnostics: {
      selected: false,
      role: null,
      label: null,
      host: null,
      savedToLumora: false,
      whySelected: 'No saved Lumora reference was available after excluding manual overrides and protected/external URLs.',
      source: null,
      sourcesChecked: character.sourcesChecked,
    },
  };
}

function createPathSelfReferenceCount(candidate: Pick<SelfCharacterCandidate, 'referenceImageUrls' | 'referenceImages' | 'source'>) {
  return canaryReferenceCandidates(candidate)
    .filter((entry) => {
      const url = textValue(entry.url);
      if (!url) return false;
      const reference: SeedanceReferenceImage = {
        url,
        label: entry.label,
        role: entry.role,
        token: '[Image1]',
      };
      if (isManualReference(reference)) return false;
      const confidence = scoreReferenceConfidence(reference);
      return confidence.savedToLumora && !confidence.reasons.includes('Protected or temporary source');
    })
    .length;
}

export type SelfReferenceMatrixCandidate = {
  userId: string;
  characterId: string;
  ownerSource: string;
  referenceRole: string;
  referenceLabel: string;
  reference: SeedanceReferenceImage;
  diagnostics: CanaryReferenceDiagnostics;
};

function matrixCandidateKey(candidate: SelfReferenceMatrixCandidate) {
  return `${candidate.referenceRole}|${candidate.reference.url}`;
}

function matrixRoleMatches(role: string, requestedRole?: string | null) {
  if (!requestedRole || requestedRole === 'all') return true;
  return role === requestedRole;
}

export function matrixCandidatesFromSelfCandidates(input: {
  candidates: SelfCharacterCandidate[];
  sourcesChecked?: string[];
  referenceRole?: string | null;
}) {
  const seen = new Set<string>();
  const matrixCandidates: SelfReferenceMatrixCandidate[] = [];

  for (const candidate of sortSelfCandidates(input.candidates)) {
    for (const entry of canaryReferenceCandidates(candidate)) {
      const url = textValue(entry.url);
      const reference: SeedanceReferenceImage = {
        url,
        label: entry.label,
        role: entry.role,
        token: '[Image1]',
      };
      if (!url || isManualReference(reference) || !matrixRoleMatches(reference.role ?? '', input.referenceRole)) continue;
      const confidence = scoreReferenceConfidence(reference);
      if (!confidence.savedToLumora || confidence.reasons.includes('Protected or temporary source')) continue;
      const next: SelfReferenceMatrixCandidate = {
        userId: candidate.ownerUserId,
        characterId: candidate.characterId,
        ownerSource: candidate.source,
        referenceRole: reference.role ?? 'reference',
        referenceLabel: reference.label ?? 'Reference image',
        reference,
        diagnostics: {
          selected: true,
          role: reference.role ?? null,
          label: reference.label ?? null,
          host: redactedHost(url),
          savedToLumora: true,
          whySelected: entry.whySelected,
          source: candidate.source,
          sourcesChecked: input.sourcesChecked,
        },
      };
      const key = matrixCandidateKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      matrixCandidates.push(next);
    }
  }

  return matrixCandidates;
}

function outputShapeSummary(output: unknown) {
  if (output == null) return 'null';
  if (typeof output === 'string') {
    if (/^https?:\/\//i.test(output)) {
      try {
        const url = new URL(output);
        return `string_url(host=${url.host}, path_ext=${url.pathname.split('.').pop() ?? 'none'})`;
      } catch {
        return 'string_url';
      }
    }
    return `string(length=${output.length})`;
  }
  if (Array.isArray(output)) return `array(length=${output.length})`;
  if (typeof output === 'object') return `object(keys=${Object.keys(output as Record<string, unknown>).slice(0, 12).join(',')})`;
  return typeof output;
}

function safeJsonSummary(value: unknown, maxLength = 500) {
  if (value == null) return null;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return redactMessage(text)?.slice(0, maxLength) ?? null;
}

function logsExcerpt(logs: unknown) {
  return safeJsonSummary(logs, 500);
}

function providerErrorSummary(error: unknown) {
  return safeJsonSummary(error, 360);
}

function urlHost(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function metricsSummary(metrics: unknown) {
  if (!metrics || typeof metrics !== 'object') return null;
  return safeJsonSummary(metrics, 260);
}

export function providerFailureDiagnostics(input: {
  prediction: Prediction;
  category: string;
}): ProviderFailureDiagnostics {
  return {
    providerErrorCategory: input.category,
    providerErrorSummary: providerErrorSummary(input.prediction.error),
    providerLogsExcerpt: logsExcerpt(input.prediction.logs),
    predictionGetUrlHost: urlHost(predictionUrl(input.prediction)),
    providerStatus: input.prediction.status,
    metricsSummary: metricsSummary(input.prediction.metrics),
  };
}

export type ReferenceAssetAccessDiagnostics = {
  reachable: boolean;
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  host: string | null;
  error: string | null;
};

type VerificationVideoAccessDiagnostics = ReferenceAssetAccessDiagnostics & {
  signedUrlGenerated: boolean;
};

function referenceAssetErrorMessage(diagnostics: ReferenceAssetAccessDiagnostics) {
  if (diagnostics.reachable) return null;
  if (diagnostics.status) return `Selected reference was not publicly reachable (${diagnostics.status}).`;
  return diagnostics.error ?? 'Selected reference was not publicly reachable.';
}

function verificationVideoAssetErrorMessage(diagnostics: VerificationVideoAccessDiagnostics) {
  if (diagnostics.reachable) return null;
  if (diagnostics.status) return `Self verification video was not reachable by the provider (${diagnostics.status}).`;
  return diagnostics.error ?? 'Self verification video was not reachable by the provider.';
}

export async function verifyReferenceAssetAccess(url: string): Promise<ReferenceAssetAccessDiagnostics> {
  const host = redactedHost(url);
  const inspectResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type');
    const contentLengthText = response.headers.get('content-length');
    const contentLength = contentLengthText ? Number(contentLengthText) : null;
    const imageContentType = Boolean(contentType?.toLowerCase().startsWith('image/'));
    const oversized = Number.isFinite(contentLength) && contentLength !== null && contentLength > REFERENCE_CANARY_MAX_IMAGE_BYTES;
    return {
      reachable: response.ok && imageContentType && !oversized,
      status: response.status,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      host,
      error: response.ok && !imageContentType
        ? 'Reference URL did not return image content.'
        : oversized
          ? 'Reference image is larger than the canary safety limit.'
          : null,
    };
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(url, { method: 'HEAD', signal: controller.signal });
    const diagnostics = await inspectResponse(head);
    if (diagnostics.reachable || (head.status !== 403 && head.status !== 405)) return diagnostics;
  } catch {
    // Some storage/CDN frontends reject HEAD; a small GET below is the provider-relevant check.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { range: 'bytes=0-1' },
      signal: getController.signal,
    });
    return inspectResponse(response);
  } catch (error) {
    return {
      reachable: false,
      status: null,
      contentType: null,
      contentLength: null,
      host,
      error: redactMessage(errorText(error)),
    };
  } finally {
    clearTimeout(getTimeout);
  }
}

function parseSupabaseStorageObjectPath(url: string | null | undefined) {
  const text = textValue(url);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      objectPath: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function verificationVideoDiagnostics(input: {
  bucket?: string | null;
  objectPath?: string | null;
  signedUrlGenerated?: boolean;
  access?: VerificationVideoAccessDiagnostics | null;
  source?: CanaryVerificationVideoDiagnostics['source'];
  variant?: SeedanceVideoReferenceCanaryVariant | null;
  normalization?: VerificationVideoNormalizationDiagnostics | null;
}): CanaryVerificationVideoDiagnostics {
  const spec = input.variant
    ? SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS[input.variant]
    : null;
  const selectedPreflight = input.normalization?.normalizedAssetUsed
    ? input.normalization.normalized ?? input.normalization.original
    : input.normalization?.original ?? null;
  return {
    selected: Boolean(input.objectPath),
    bucket: input.bucket ?? null,
    objectPathPresent: Boolean(input.objectPath),
    host: input.access?.host ?? null,
    signedUrlGenerated: Boolean(input.signedUrlGenerated ?? input.access?.signedUrlGenerated),
    reachable: input.access?.reachable ?? null,
    contentType: input.access?.contentType ?? null,
    contentLength: input.access?.contentLength ?? null,
    accessStatus: input.access?.status ?? null,
    accessError: input.access?.error ?? null,
    source: input.source ?? 'none',
    variant: input.variant ?? null,
    referenceFieldName: spec?.fieldName ?? null,
    promptTokenStyle: spec?.promptTokenStyle ?? null,
    normalizedAssetUsed: input.normalization?.normalizedAssetUsed ?? null,
    normalizedStatus: input.normalization?.normalizedStatus ?? null,
    normalizationTriggered: input.normalization?.normalizationTriggered ?? null,
    normalizationReason: input.normalization?.normalizationReason ?? null,
    normalizationErrorCategory: input.normalization?.normalizationErrorCategory ?? null,
    normalizationExitCode: input.normalization?.normalizationExitCode ?? null,
    normalizationStderrExcerpt: input.normalization?.normalizationStderrExcerpt ?? null,
    normalizationStdoutExcerpt: input.normalization?.normalizationStdoutExcerpt ?? null,
    normalizationFfmpegArgs: input.normalization?.normalizationFfmpegArgs ?? null,
    normalizationEncoderFallbackUsed: input.normalization?.normalizationEncoderFallbackUsed ?? null,
    normalizationResolutionFallbackUsed: input.normalization?.normalizationResolutionFallbackUsed ?? null,
    preflight: input.normalization?.original ?? null,
    normalizedPreflight: input.normalization?.normalized ?? null,
    preflightOk: selectedPreflight?.preflightOk ?? null,
    preflightFailureReason: input.normalization?.failureReason ?? selectedPreflight?.preflightFailureReason ?? null,
  };
}

async function signedVerificationVideoUrl(input: CanaryVerificationVideoRuntime) {
  if (!supabaseAdmin) {
    throw Object.assign(new Error('Supabase admin client is required to sign private verification video assets.'), {
      code: 'verification_video_asset_access',
    });
  }
  const { data, error } = await supabaseAdmin.storage
    .from(input.bucket)
    .createSignedUrl(input.objectPath, VERIFICATION_VIDEO_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw Object.assign(new Error(error?.message ?? 'Could not create a signed URL for the self verification video.'), {
      code: 'verification_video_asset_access',
    });
  }
  return data.signedUrl;
}

export async function verifyVerificationVideoAssetAccess(url: string, input: { signedUrlGenerated?: boolean } = {}): Promise<VerificationVideoAccessDiagnostics> {
  const host = redactedHost(url);
  const inspectResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type');
    const contentLengthText = response.headers.get('content-length');
    const contentLength = contentLengthText ? Number(contentLengthText) : null;
    const videoContentType = Boolean(contentType?.toLowerCase().startsWith('video/'));
    const oversized = Number.isFinite(contentLength) && contentLength !== null && contentLength > 100 * 1024 * 1024;
    return {
      reachable: response.ok && videoContentType && !oversized,
      status: response.status,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      host,
      signedUrlGenerated: Boolean(input.signedUrlGenerated),
      error: response.ok && !videoContentType
        ? 'Self verification URL did not return video content.'
        : oversized
          ? 'Self verification video is larger than the canary safety limit.'
          : null,
    };
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(url, { method: 'HEAD', signal: controller.signal });
    const diagnostics = await inspectResponse(head);
    if (diagnostics.reachable || (head.status !== 403 && head.status !== 405)) return diagnostics;
  } catch {
    // Some signed storage URLs reject HEAD; try a tiny GET below.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { range: 'bytes=0-1' },
      signal: getController.signal,
    });
    return inspectResponse(response);
  } catch (error) {
    return {
      reachable: false,
      status: null,
      contentType: null,
      contentLength: null,
      host,
      signedUrlGenerated: Boolean(input.signedUrlGenerated),
      error: redactMessage(errorText(error)),
    };
  } finally {
    clearTimeout(getTimeout);
  }
}

function withReferenceAccessDiagnostics(
  diagnostics: CanaryReferenceDiagnostics,
  access: ReferenceAssetAccessDiagnostics,
): CanaryReferenceDiagnostics {
  return {
    ...diagnostics,
    reachable: access.reachable,
    contentType: access.contentType,
    contentLength: access.contentLength,
    accessStatus: access.status,
    accessError: access.error,
  };
}

async function verifyOutputReachable(outputUrl: string) {
  if (/^\/[^/]/.test(outputUrl)) return true;
  if (!/^https?:\/\//i.test(outputUrl)) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(outputUrl, { method: 'HEAD', signal: controller.signal });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 403) return false;
  } catch {
    // Signed provider URLs often reject HEAD; try a tiny GET below.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), 8_000);
  try {
    const response = await fetch(outputUrl, {
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

async function getCanaryJob(jobId: string) {
  const result = await query<Record<string, unknown>>(
    `select ${canaryJobSelect}
     from generation_jobs
     where id = $1
       and render_mode in ('seedance_canary', 'seedance_reference_canary', 'seedance_video_reference_canary')
     limit 1`,
    [jobId],
  );
  return result.rows[0] ? mapCanaryRow(result.rows[0]) : null;
}

async function insertCanaryJob(input: {
  kind: CanaryKind;
  userId?: string | null;
  characterId?: string | null;
  referenceImages?: SeedanceReferenceImage[];
  selectedReference?: CanaryReferenceDiagnostics | null;
  verificationVideo?: CanaryVerificationVideoRuntime | null;
  videoReferenceVariant?: SeedanceVideoReferenceCanaryVariant;
  saveAsDraft?: boolean;
}) {
  const references = input.kind === 'reference'
    ? selectPrimaryCanaryReference(input.referenceImages ?? [])
    : [];
  const providerInput = input.kind === 'video_reference'
    ? buildSeedanceVerificationVideoCanaryPayload(
        VERIFICATION_VIDEO_PAYLOAD_PLACEHOLDER_URL,
        input.videoReferenceVariant ?? 'reference_videos_bracket',
      )
    : buildSeedanceCanaryPayload({ referenceImages: references });
  const validation = validateSeedanceProviderPayload(providerInput);
  if (!validation.ok) {
    throw new Error(`Canary payload validation failed: ${validation.issues.map((issue) => `${issue.field} ${issue.expected}`).join(', ')}`);
  }
  const userId = isUuidLike(input.userId) ? input.userId as string : CANARY_USER_ID;
  const canaryVariant: CanaryVariant = input.kind === 'video_reference'
    ? input.videoReferenceVariant ?? 'reference_videos_bracket'
    : references.length
      ? 'reference_images'
      : 'text_only';
  const renderMode = input.kind === 'video_reference'
    ? 'seedance_video_reference_canary'
    : input.kind === 'reference'
      ? 'seedance_reference_canary'
      : 'seedance_canary';
  const metadata: CanaryMetadata = {
    kind: input.kind,
    canaryVariant,
    providerInput,
    payloadSummary: seedancePayloadSummary(providerInput),
    selectedReference: input.selectedReference ?? null,
    selectedVerificationVideo: input.verificationVideo?.diagnostics ?? null,
    verificationVideoAsset: input.verificationVideo
      ? {
          bucket: input.verificationVideo.bucket,
          objectPath: input.verificationVideo.objectPath,
        }
      : null,
    providerFailure: null,
    saveAsDraft: Boolean(input.saveAsDraft),
    userId: isUuidLike(input.userId) ? input.userId as string : null,
    characterId: input.characterId ?? null,
    referenceImages: references,
    createdAt: new Date().toISOString(),
  };
  const result = await query<Record<string, unknown>>(
    `insert into generation_jobs (
       user_id,
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
       provider_status,
       scene_metadata,
       reference_count,
       render_mode,
       provider_fallback_stage,
       created_at,
       updated_at
     )
     values ($1, $2, 'replicate', $3, 'video', $4, 'queued', $5, $6, $7, 'private', 'queued', $8::jsonb, $9, $10, 'seedance_canary', now(), now())
     returning ${canaryJobSelect}`,
    [
      userId,
      input.kind === 'video_reference'
        ? 'seedance-video-reference-canary'
        : input.kind === 'reference'
          ? 'seedance-reference-canary'
          : 'seedance-canary',
      SEEDANCE_FAST_MODEL,
      providerInput.prompt,
      input.characterId ?? null,
      providerInput.duration,
      providerInput.aspect_ratio,
      JSON.stringify({ seedanceCanary: metadata }),
      input.kind === 'video_reference' ? 1 : references.length,
      renderMode,
    ],
  );
  return mapCanaryRow(result.rows[0]);
}

async function updateCanaryJob(jobId: string, values: {
  status?: string;
  providerStatus?: string | null;
  providerPredictionId?: string | null;
  providerPredictionUrl?: string | null;
  outputUrl?: string | null;
  projectId?: string | null;
  errorMessage?: string | null;
  errorCategory?: string | null;
  retryAfterSeconds?: number | null;
  retryAvailableAt?: string | null;
  outputShapeSummaryValue?: string | null;
  providerFailure?: ProviderFailureDiagnostics | null;
}) {
  const result = await query<Record<string, unknown>>(
    `update generation_jobs
     set
       status = coalesce($2, status),
       provider_status = coalesce($3, provider_status),
       provider_job_id = coalesce($4, provider_job_id),
       provider_prediction_id = coalesce($4, provider_prediction_id),
       provider_prediction_url = coalesce($5, provider_prediction_url),
       result_asset_url = coalesce($6, result_asset_url),
       output_url = coalesce($6, output_url),
       project_id = coalesce($7, project_id),
       error_message = $8,
       error_category = $9,
       retry_after_seconds = $10,
       retry_available_at = $11,
       scene_metadata = jsonb_set(
         case
           when $12::text is null then coalesce(scene_metadata, '{}'::jsonb)
           else jsonb_set(coalesce(scene_metadata, '{}'::jsonb), '{seedanceCanary,outputShapeSummary}', to_jsonb($12::text), true)
         end,
         '{seedanceCanary,providerFailure}',
         coalesce($13::jsonb, coalesce(scene_metadata, '{}'::jsonb)#>'{seedanceCanary,providerFailure}', 'null'::jsonb),
         true
       ),
       updated_at = now()
     where id = $1
     returning ${canaryJobSelect}`,
    [
      jobId,
      values.status ?? null,
      values.providerStatus ?? null,
      values.providerPredictionId ?? null,
      values.providerPredictionUrl ?? null,
      values.outputUrl ?? null,
      values.projectId ?? null,
      values.errorMessage ?? null,
      values.errorCategory ?? null,
      values.retryAfterSeconds ?? null,
      values.retryAvailableAt ?? null,
      values.outputShapeSummaryValue ?? null,
      values.providerFailure === undefined ? null : JSON.stringify(values.providerFailure),
    ],
  );
  return result.rows[0] ? mapCanaryRow(result.rows[0]) : null;
}

async function runtimeCanaryProviderInput(metadata: CanaryMetadata): Promise<SeedanceProviderPayload> {
  if (metadata.kind !== 'video_reference') return metadata.providerInput;
  const asset = metadata.verificationVideoAsset;
  if (!asset?.bucket || !asset.objectPath) {
    throw Object.assign(new Error('Self verification video storage path is missing.'), {
      code: 'verification_video_asset_access',
    });
  }
  const runtime = {
    bucket: asset.bucket,
    objectPath: asset.objectPath,
    diagnostics: metadata.selectedVerificationVideo ?? verificationVideoDiagnostics({
      bucket: asset.bucket,
      objectPath: asset.objectPath,
      source: 'verification_video_asset_id',
    }),
  };
  const signedUrl = await signedVerificationVideoUrl(runtime);
  const access = await verifyVerificationVideoAssetAccess(signedUrl, { signedUrlGenerated: true });
  if (!access.reachable) {
    throw Object.assign(new Error(verificationVideoAssetErrorMessage(access) ?? 'Self verification video was not reachable.'), {
      code: 'verification_video_asset_access',
    });
  }
  const providerInput: SeedanceProviderPayload = {
    ...metadata.providerInput,
  };
  if (metadata.providerInput.video_urls?.length) {
    delete providerInput.reference_videos;
    providerInput.video_urls = [signedUrl];
  } else {
    delete providerInput.video_urls;
    providerInput.reference_videos = [signedUrl];
  }
  return providerInput;
}

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export async function persistReferenceRouteResult(input: {
  userId?: string | null;
  characterId?: string | null;
  referenceRole?: string | null;
  referenceLabel?: string | null;
  provider?: string | null;
  providerModel?: string | null;
  variant?: SeedanceReferenceMatrixVariant | null;
  succeeded: boolean;
  failureCategory?: string | null;
  providerErrorCategory?: string | null;
  outputUrlPresent?: boolean | null;
  notes?: Record<string, unknown>;
}) {
  if (!isUuidLike(input.userId)) return;
  const provider = input.provider ?? 'seedance-fast';
  const variant = input.variant ?? 'reference_images';
  const referenceRole = input.referenceRole ?? 'unknown_reference';
  const characterId = input.characterId ?? 'creator-self';
  const memoryKey = `reference-route:${input.userId}:${characterId}:${provider}:${variant}:${referenceRole}`;
  const notes = {
    referenceRole,
    referenceLabel: input.referenceLabel ?? null,
    variant,
    succeeded: input.succeeded,
    failureCategory: input.failureCategory ?? null,
    providerErrorCategory: input.providerErrorCategory ?? null,
    outputUrlPresent: Boolean(input.outputUrlPresent),
    route: referenceRole === 'verification_video' ? 'seedance_video_reference' : 'seedance_reference',
    routeStatus: input.succeeded
      ? 'succeeded'
      : input.failureCategory === 'video_reference_moderation_block' || input.failureCategory === 'reference_moderation_block'
        ? 'blocked'
        : 'failed',
    ...(input.notes ?? {}),
  };

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
         reference_strategy,
         reference_count,
         prompt_fingerprint,
         success_count,
         failure_count,
         last_success_at,
         last_failure_at,
         last_failure_category,
         notes,
         metadata,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, 'reference_route_canary', 'likeness_route', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $14::jsonb, now(), now())
       on conflict (memory_key)
       do update set
         provider_model = excluded.provider_model,
         reference_strategy = excluded.reference_strategy,
         reference_count = excluded.reference_count,
         success_count = excluded.success_count,
         failure_count = excluded.failure_count,
         last_success_at = excluded.last_success_at,
         last_failure_at = excluded.last_failure_at,
         last_failure_category = excluded.last_failure_category,
         notes = excluded.notes,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        memoryKey,
        input.userId,
        input.characterId ?? null,
        provider,
        input.providerModel ?? SEEDANCE_FAST_MODEL,
        referenceRole,
        variant === 'text_only' ? 0 : 1,
        fingerprint(memoryKey),
        input.succeeded ? 1 : 0,
        input.succeeded ? 0 : 1,
        input.succeeded ? new Date().toISOString() : null,
        input.succeeded ? null : new Date().toISOString(),
        input.failureCategory ?? null,
        JSON.stringify(notes),
      ],
    );
  } catch (error) {
    console.warn('REFERENCE ROUTE MEMORY PERSISTENCE SKIPPED:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (provider === 'seedance-fast' && input.failureCategory === 'reference_moderation_block') {
    await persistReferenceRouteResult({
      ...input,
      provider: 'seedance-quality',
      providerModel: SEEDANCE_QUALITY_MODEL,
      notes: {
        ...(input.notes ?? {}),
        inferredFromProvider: 'seedance-fast',
        inferredReason: 'Seedance reference route moderation block applies to automatic Seedance likeness routing.',
      },
    });
  }
}

async function replicateClient() {
  if (!env.REPLICATE_API_TOKEN) return null;
  return new Replicate({
    auth: env.REPLICATE_API_TOKEN,
    useFileOutput: false,
  });
}

async function handleCanarySuccess(input: {
  job: CanaryJobRow;
  metadata: CanaryMetadata;
  prediction: Prediction;
}) {
  const outputParse = parseProviderVideoOutput(input.prediction.output);
  const shape = outputShapeSummary(input.prediction.output);
  if (!outputParse.ok) {
    const category = input.metadata.kind === 'reference'
      ? 'reference_output_missing'
      : input.metadata.kind === 'video_reference'
        ? 'video_reference_output_missing'
        : outputParse.category;
    if (input.metadata.kind === 'reference' || input.metadata.kind === 'video_reference') {
      await persistReferenceRouteResult({
        userId: input.metadata.userId,
        characterId: input.metadata.characterId,
        referenceRole: input.metadata.kind === 'video_reference' ? 'verification_video' : input.metadata.selectedReference?.role,
        referenceLabel: input.metadata.kind === 'video_reference' ? 'Self verification video' : input.metadata.selectedReference?.label,
        provider: 'seedance-fast',
        providerModel: SEEDANCE_FAST_MODEL,
        variant: input.metadata.canaryVariant,
        succeeded: false,
        failureCategory: category,
        providerErrorCategory: category,
        outputUrlPresent: false,
      });
    }
    if (input.metadata.kind === 'video_reference') {
      await markSeedanceVideoReferenceCanaryResult({
        userId: input.metadata.userId,
        characterId: input.metadata.characterId,
        routeStatus: category,
        provider: 'seedance',
      });
    }
    return updateCanaryJob(input.job.id, {
      status: 'failed',
      providerStatus: 'succeeded',
      errorMessage: 'Provider succeeded but did not return a usable video URL.',
      errorCategory: category,
      outputShapeSummaryValue: shape,
    });
  }

  const reachable = await verifyOutputReachable(outputParse.videoUrl);
  const missingCategory = input.metadata.kind === 'reference'
    ? 'reference_output_missing'
    : input.metadata.kind === 'video_reference'
      ? 'video_reference_output_missing'
      : 'provider_output_unreachable';
  if (!reachable) {
    if (input.metadata.kind === 'reference' || input.metadata.kind === 'video_reference') {
      await persistReferenceRouteResult({
        userId: input.metadata.userId,
        characterId: input.metadata.characterId,
        referenceRole: input.metadata.kind === 'video_reference' ? 'verification_video' : input.metadata.selectedReference?.role,
        referenceLabel: input.metadata.kind === 'video_reference' ? 'Self verification video' : input.metadata.selectedReference?.label,
        provider: 'seedance-fast',
        providerModel: SEEDANCE_FAST_MODEL,
        variant: input.metadata.canaryVariant,
        succeeded: false,
        failureCategory: missingCategory,
        providerErrorCategory: missingCategory,
        outputUrlPresent: true,
      });
    }
    if (input.metadata.kind === 'video_reference') {
      await markSeedanceVideoReferenceCanaryResult({
        userId: input.metadata.userId,
        characterId: input.metadata.characterId,
        routeStatus: missingCategory,
        provider: 'seedance',
      });
    }
    return updateCanaryJob(input.job.id, {
      status: 'failed',
      providerStatus: 'succeeded',
      errorMessage: 'Provider returned a video URL, but Lumora could not verify it was reachable.',
      errorCategory: missingCategory,
      outputShapeSummaryValue: shape,
    });
  }

  let outputUrl = outputParse.videoUrl;
  let projectId = input.job.projectId;
  if (input.metadata.saveAsDraft && input.metadata.userId) {
    const persisted = await persistCompletedGeneration({
      userId: input.metadata.userId,
      id: input.prediction.id,
      title: 'Seedance canary',
      prompt: input.metadata.providerInput.prompt,
      finalPrompt: input.metadata.providerInput.prompt,
      provider: 'replicate',
      engine: 'seedance-2.0',
      model: SEEDANCE_FAST_MODEL,
      displayEngine: 'Seedance Canary',
      videoUrl: outputParse.videoUrl,
      characterId: input.metadata.characterId,
      durationSeconds: input.metadata.providerInput.duration,
      aspectRatio: input.metadata.providerInput.aspect_ratio,
      privacy: 'private',
    });
    outputUrl = persisted.videoUrl;
    projectId = persisted.projectId ?? projectId;
  }

  if (input.metadata.kind === 'reference' || input.metadata.kind === 'video_reference') {
    await persistReferenceRouteResult({
      userId: input.metadata.userId,
      characterId: input.metadata.characterId,
      referenceRole: input.metadata.kind === 'video_reference' ? 'verification_video' : input.metadata.selectedReference?.role,
      referenceLabel: input.metadata.kind === 'video_reference' ? 'Self verification video' : input.metadata.selectedReference?.label,
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      variant: input.metadata.canaryVariant,
      succeeded: true,
      outputUrlPresent: true,
    });
  }
  if (input.metadata.kind === 'video_reference') {
    await markSeedanceVideoReferenceCanaryResult({
      userId: input.metadata.userId,
      characterId: input.metadata.characterId,
      routeStatus: 'canary_succeeded',
      provider: 'seedance',
    });
  }

  return updateCanaryJob(input.job.id, {
    status: 'completed',
    providerStatus: 'succeeded',
    outputUrl,
    projectId,
    errorMessage: null,
    errorCategory: null,
    outputShapeSummaryValue: shape,
  });
}

async function processSeedanceCanaryJob(jobId: string, options: { pollUntilTerminal?: boolean } = {}) {
  if (activeCanaryProcessors.has(jobId)) return getCanaryJob(jobId);
  activeCanaryProcessors.add(jobId);
  try {
    let job = await getCanaryJob(jobId);
    if (!job) return null;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') return job;
    if (job.status === 'rate_limited' && job.retryAvailableAt && Date.parse(job.retryAvailableAt) > Date.now()) return job;

    const metadata = canaryMetadata(job);
    if (!metadata) {
      return updateCanaryJob(job.id, {
        status: 'failed',
        errorMessage: 'Canary metadata was missing.',
        errorCategory: 'metadata',
      });
    }

    try {
      const replicate = await replicateClient();
      if (!replicate) {
        return updateCanaryJob(job.id, {
          status: 'failed',
          errorMessage: 'Seedance canary is not configured. Set REPLICATE_API_TOKEN on the API server.',
          errorCategory: 'provider_setup',
        });
      }

      if (!job.providerPredictionId) {
        const providerInput = await runtimeCanaryProviderInput(metadata);
        const validation = validateSeedanceProviderPayload(providerInput);
        if (!validation.ok) {
          if (metadata.kind === 'video_reference') {
            await markSeedanceVideoReferenceCanaryResult({
              userId: metadata.userId,
              characterId: metadata.characterId,
              routeStatus: videoReferenceRouteStatusForFailure('video_reference_input_schema'),
              provider: 'seedance',
            });
          }
          return updateCanaryJob(job.id, {
            status: 'failed',
            errorMessage: `input_schema_invalid: ${validation.issues.map((issue) => `${issue.field} expected ${issue.expected}`).join('; ')}`,
            errorCategory: metadata.kind === 'video_reference' ? 'video_reference_input_schema' : 'input_schema_invalid',
          });
        }

        job = await updateCanaryJob(job.id, {
          status: 'rendering',
          providerStatus: 'starting',
          errorMessage: null,
          errorCategory: null,
          retryAfterSeconds: null,
          retryAvailableAt: null,
        }) ?? job;
        const prediction = await replicate.predictions.create({
          model: SEEDANCE_FAST_MODEL,
          input: providerInput,
          wait: false,
        });
        job = await updateCanaryJob(job.id, {
          status: 'rendering',
          providerStatus: prediction.status,
          providerPredictionId: prediction.id,
          providerPredictionUrl: predictionUrl(prediction),
          errorMessage: null,
          errorCategory: null,
        }) ?? job;
        if (!options.pollUntilTerminal) return job;
      }

      if (!job.providerPredictionId) return job;
      const prediction = await replicate.predictions.get(job.providerPredictionId);
      job = await updateCanaryJob(job.id, {
        status: prediction.status === 'succeeded'
          ? 'rendering'
          : prediction.status === 'canceled'
            ? 'canceled'
            : prediction.status === 'failed'
              ? 'failed'
              : 'rendering',
        providerStatus: prediction.status,
        providerPredictionId: prediction.id,
        providerPredictionUrl: predictionUrl(prediction),
        outputShapeSummaryValue: outputShapeSummary(prediction.output),
      }) ?? job;

      if (prediction.status === 'succeeded') {
        return handleCanarySuccess({ job, metadata, prediction });
      }

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        const detail = typeof prediction.error === 'string'
          ? prediction.error
          : prediction.logs ?? `Prediction ${prediction.status}.`;
        const category = classifyCanaryFailure(metadata.kind, detail, prediction.status);
        const transientVideoReferenceFailure = metadata.kind === 'video_reference' && isVideoReferenceTransientUnavailable(category);
        const retryLater = transientVideoReferenceFailure ? videoReferenceRetryLaterInfo() : null;
        if (metadata.kind === 'reference' || (metadata.kind === 'video_reference' && !transientVideoReferenceFailure)) {
          await persistReferenceRouteResult({
            userId: metadata.userId,
            characterId: metadata.characterId,
            referenceRole: metadata.kind === 'video_reference' ? 'verification_video' : metadata.selectedReference?.role,
            referenceLabel: metadata.kind === 'video_reference' ? 'Self verification video' : metadata.selectedReference?.label,
            provider: 'seedance-fast',
            providerModel: SEEDANCE_FAST_MODEL,
            variant: metadata.canaryVariant,
            succeeded: false,
            failureCategory: category,
            providerErrorCategory: category,
            outputUrlPresent: false,
          });
        }
        if (metadata.kind === 'video_reference') {
          await markSeedanceVideoReferenceCanaryResult({
            userId: metadata.userId,
            characterId: metadata.characterId,
            routeStatus: videoReferenceRouteStatusForFailure(category),
            provider: 'seedance',
          });
        }
        return updateCanaryJob(job.id, {
          status: prediction.status === 'canceled' ? 'canceled' : 'failed',
          providerStatus: prediction.status,
          errorMessage: redactMessage(detail),
          errorCategory: category,
          retryAfterSeconds: retryLater?.retryAfterSeconds ?? null,
          retryAvailableAt: retryLater?.retryAvailableAt ?? null,
          outputShapeSummaryValue: outputShapeSummary(prediction.output),
          providerFailure: providerFailureDiagnostics({ prediction, category }),
        });
      }

      return job;
    } catch (error) {
      if (isRateLimitLike(error)) {
        const retry = retryInfo(error);
        return updateCanaryJob(job.id, {
          status: 'rate_limited',
          providerStatus: 'rate_limited',
          errorMessage: 'Rate limited. Waiting before retrying the same canary job.',
          errorCategory: 'rate_limited',
          retryAfterSeconds: retry.retryAfterSeconds,
          retryAvailableAt: retry.retryAvailableAt,
        });
      }
      const category = classifyCanaryFailure(metadata.kind, error);
      const transientVideoReferenceFailure = metadata.kind === 'video_reference' && isVideoReferenceTransientUnavailable(category);
      const retryLater = transientVideoReferenceFailure ? videoReferenceRetryLaterInfo() : null;
      if (metadata.kind === 'reference' || (metadata.kind === 'video_reference' && !transientVideoReferenceFailure)) {
        await persistReferenceRouteResult({
          userId: metadata.userId,
          characterId: metadata.characterId,
          referenceRole: metadata.kind === 'video_reference' ? 'verification_video' : metadata.selectedReference?.role,
          referenceLabel: metadata.kind === 'video_reference' ? 'Self verification video' : metadata.selectedReference?.label,
          provider: 'seedance-fast',
          providerModel: SEEDANCE_FAST_MODEL,
          variant: metadata.canaryVariant,
          succeeded: false,
          failureCategory: category,
          providerErrorCategory: category,
          outputUrlPresent: false,
        });
      }
      if (metadata.kind === 'video_reference') {
        await markSeedanceVideoReferenceCanaryResult({
          userId: metadata.userId,
          characterId: metadata.characterId,
          routeStatus: videoReferenceRouteStatusForFailure(category),
          provider: 'seedance',
        });
      }
      return updateCanaryJob(job.id, {
        status: 'failed',
        errorMessage: redactMessage(errorText(error)),
        errorCategory: category,
        retryAfterSeconds: retryLater?.retryAfterSeconds ?? null,
        retryAvailableAt: retryLater?.retryAvailableAt ?? null,
      });
    }
  } finally {
    activeCanaryProcessors.delete(jobId);
  }
}

export async function startSeedanceCanary(input: {
  saveAsDraft?: boolean;
  userId?: string | null;
}) {
  const job = await insertCanaryJob({
    kind: 'text',
    saveAsDraft: input.saveAsDraft,
    userId: input.userId,
  });
  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
}

export async function startSeedanceReferenceCanary(input: {
  userId: string;
  characterId: string;
  saveAsDraft?: boolean;
}) {
  const profile = await getCinematicCharacterProfileForUser(input.userId, input.characterId).catch(() => null);
  const selection = selectStrongestCanaryReference({
    referenceImageUrls: profile?.referenceImageUrls ?? null,
  });
  if (!selection.reference) {
    throw new Error('Reference canary requires one saved Lumora reference for this character.');
  }
  const referenceAccess = await verifyReferenceAssetAccess(selection.reference.url);
  const selectedReference = withReferenceAccessDiagnostics(selection.diagnostics, referenceAccess);
  const job = await insertCanaryJob({
    kind: 'reference',
    saveAsDraft: input.saveAsDraft,
    userId: input.userId,
    characterId: input.characterId,
    referenceImages: [selection.reference],
    selectedReference,
  });
  if (!referenceAccess.reachable) {
    await persistReferenceRouteResult({
      userId: input.userId,
      characterId: input.characterId,
      referenceRole: selectedReference.role,
      referenceLabel: selectedReference.label,
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      variant: 'reference_images',
      succeeded: false,
      failureCategory: 'reference_asset_access',
      providerErrorCategory: 'reference_asset_access',
      outputUrlPresent: false,
      notes: { selectedReferenceReachable: false, selectedReferenceContentType: selectedReference.contentType },
    });
    const failed = await updateCanaryJob(job.id, {
      status: 'failed',
      providerStatus: 'reference_asset_access',
      errorMessage: referenceAssetErrorMessage(referenceAccess),
      errorCategory: 'reference_asset_access',
    });
    return formatSeedanceCanaryStatus(failed ?? job);
  }
  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
}

export async function startSeedanceReferenceCanaryForMatrix(input: {
  userId: string;
  characterId: string;
  reference: SeedanceReferenceImage;
  selectedReference: CanaryReferenceDiagnostics;
  saveAsDraft?: boolean;
}) {
  const referenceAccess = await verifyReferenceAssetAccess(input.reference.url);
  const selectedReference = withReferenceAccessDiagnostics(input.selectedReference, referenceAccess);
  const job = await insertCanaryJob({
    kind: 'reference',
    saveAsDraft: input.saveAsDraft,
    userId: input.userId,
    characterId: input.characterId,
    referenceImages: [input.reference],
    selectedReference,
  });

  if (!referenceAccess.reachable) {
    await persistReferenceRouteResult({
      userId: input.userId,
      characterId: input.characterId,
      referenceRole: selectedReference.role,
      referenceLabel: selectedReference.label,
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      variant: 'reference_images',
      succeeded: false,
      failureCategory: 'reference_asset_access',
      providerErrorCategory: 'reference_asset_access',
      outputUrlPresent: false,
      notes: { selectedReferenceReachable: false, selectedReferenceContentType: selectedReference.contentType },
    });
    const failed = await updateCanaryJob(job.id, {
      status: 'failed',
      providerStatus: 'reference_asset_access',
      errorMessage: referenceAssetErrorMessage(referenceAccess),
      errorCategory: 'reference_asset_access',
    });
    return formatSeedanceCanaryStatus(failed ?? job);
  }

  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
}

function mapSelfCandidate(row: Record<string, unknown>, source: SelfReferenceSourceName, sourcePriority: number): SelfCharacterCandidate {
  return {
    id: String(row.id),
    characterId: textValue(row.characterId) || String(row.id),
    ownerUserId: textValue(row.ownerUserId) || textValue(row.userId) || String(row.id),
    name: textValue(row.name),
    displayName: textValue(row.displayName) || textValue(row.name),
    isSelf: row.isSelf === true,
    referenceImageUrls: referenceUrlsValue(row.referenceImageUrls),
    referenceImages: recordValue(row.referenceImages),
    source,
    sourcePriority,
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

function redactedSourceError(error: unknown) {
  return redactMessage(errorText(error)) ?? 'unavailable';
}

async function safeSourceQuery(input: {
  source: SelfReferenceSourceName;
  sourcePriority: number;
  sourcesChecked: string[];
  sourceErrors: string[];
  sql: string;
  params: unknown[];
}) {
  input.sourcesChecked.push(input.source);
  try {
    const result = await query<Record<string, unknown>>(input.sql, input.params);
    return result.rows.map((row) => mapSelfCandidate(row, input.source, input.sourcePriority));
  } catch (error) {
    input.sourceErrors.push(`${input.source}: ${redactedSourceError(error)}`);
    return [];
  }
}

function sortSelfCandidates(candidates: SelfCharacterCandidate[]) {
  return [...candidates].sort((a, b) => {
    if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

async function listSelfCharacterCandidates(userId?: string | null): Promise<SelfReferenceSourceResult> {
  const uuidUserId = isUuidLike(userId) ? userId : null;
  const sourcesChecked: string[] = [];
  const sourceErrors: string[] = [];
  const selfCharacterCandidates = await safeSourceQuery({
    source: 'self_characters.reference_image_urls',
    sourcePriority: 0,
    sourcesChecked,
    sourceErrors,
    sql: `select
       coalesce(id::text, 'creator-self') as id,
       'creator-self' as "characterId",
       user_id as "ownerUserId",
       coalesce(name, 'Creator Self') as name,
       coalesce(name, 'Creator Self') as "displayName",
       true as "isSelf",
       reference_image_urls as "referenceImageUrls",
       coalesce(style_preferences->'identityProfile', '{}'::jsonb) as "referenceImages",
       updated_at as "updatedAt"
     from self_characters
     where ($1::uuid is null or user_id = $1)
     order by updated_at desc nulls last, created_at desc nulls last
     limit 20`,
    params: [uuidUserId],
  });
  const profileCandidates = await safeSourceQuery({
    source: 'profiles.self_reference_image_urls',
    sourcePriority: 1,
    sourcesChecked,
    sourceErrors,
    sql: `select
       coalesce(id::text, user_id::text, 'creator-self') as id,
       coalesce(default_self_character_id, 'creator-self') as "characterId",
       coalesce(user_id, id) as "ownerUserId",
       coalesce(default_self_character_name, display_name, 'Creator Self') as name,
       coalesce(default_self_character_name, display_name, 'Creator Self') as "displayName",
       true as "isSelf",
       self_reference_image_urls as "referenceImageUrls",
       coalesce(self_character_editor_draft, '{}'::jsonb) as "referenceImages",
       updated_at as "updatedAt"
     from profiles
     where ($1::uuid is null or user_id = $1 or id = $1)
       and self_reference_image_urls is not null
     order by updated_at desc nulls last
     limit 20`,
    params: [uuidUserId],
  });
  const profileSelfCandidates = await safeSourceQuery({
    source: 'character_profiles.reference_image_urls',
    sourcePriority: 2,
    sourcesChecked,
    sourceErrors,
    sql: `select
       id,
       character_id as "characterId",
       owner_user_id as "ownerUserId",
       name,
       display_name as "displayName",
       is_self as "isSelf",
       reference_image_urls as "referenceImageUrls",
       reference_images as "referenceImages",
       updated_at as "updatedAt"
     from character_profiles
     where ($1::uuid is null or owner_user_id = $1)
       and (
         coalesce(is_self, false) = true
         or character_id = 'creator-self'
         or lower(coalesce(name, '')) in ('self', 'creator self', 'my self', 'me')
       )
     order by updated_at desc nulls last, created_at desc
     limit 20`,
    params: [uuidUserId],
  });

  return {
    candidates: sortSelfCandidates([
      ...selfCharacterCandidates,
      ...profileCandidates,
      ...profileSelfCandidates,
    ]),
    sourcesChecked,
    sourceErrors,
  };
}

export async function listSelfReferenceMatrixCandidates(input: {
  userId?: string | null;
  referenceRole?: string | null;
}) {
  const sourceResult = await listSelfCharacterCandidates(input.userId);
  return {
    candidates: matrixCandidatesFromSelfCandidates({
      candidates: sourceResult.candidates,
      sourcesChecked: sourceResult.sourcesChecked,
      referenceRole: input.referenceRole,
    }),
    sourcesChecked: sourceResult.sourcesChecked,
    sourceErrors: sourceResult.sourceErrors,
  };
}

function redactedCandidate(candidate: SelfCharacterCandidate) {
  return {
    id: redactedId(candidate.id),
    characterId: redactedId(candidate.characterId),
    ownerUserId: redactedId(candidate.ownerUserId),
    name: redactedName(candidate.displayName || candidate.name),
    source: candidate.source,
    savedReferenceCount: createPathSelfReferenceCount(candidate),
    updatedAt: candidate.updatedAt,
  };
}

function noSavedSelfReferencePayload(resolution: SelfReferenceResolution) {
  return {
    error: 'no_saved_self_reference',
    message: 'No saved Lumora self reference found.',
    sourcesChecked: resolution.sourcesChecked,
    sourceErrors: resolution.sourceErrors,
    candidates: resolution.candidates.map(redactedCandidate),
    selectedReference: resolution.selection.diagnostics,
    recommendedNextAction: 'Open Create or Characters and re-save the self reference photos to Lumora storage, then rerun the self reference canary.',
  };
}

export function noSavedSelfReferencePayloadForTest(resolution: SelfReferenceResolution) {
  return noSavedSelfReferencePayload(resolution);
}

function noSavedSelfReferenceError(resolution: SelfReferenceResolution) {
  return new SelfReferenceCanarySelectionError('No saved Lumora self reference found.', noSavedSelfReferencePayload(resolution), 404);
}

function pickBestSelfReferenceResolution(input: {
  candidates: SelfCharacterCandidate[];
  sourcesChecked: string[];
  sourceErrors: string[];
  userId?: string | null;
}): SelfReferenceResolution {
  const candidates = sortSelfCandidates(input.candidates);
  const selections = candidates.map((candidate) => ({
    candidate,
    selection: selectStrongestCanaryReference({
      referenceImageUrls: candidate.referenceImageUrls,
      referenceImages: candidate.referenceImages,
      source: candidate.source,
      sourcesChecked: input.sourcesChecked,
    }),
  }));
  const usable = selections.filter((entry) => Boolean(entry.selection.reference));
  const emptySelection = selectStrongestCanaryReference({
    referenceImageUrls: null,
    source: null,
    sourcesChecked: input.sourcesChecked,
  });

  if (!usable.length) {
    return {
      candidate: null,
      selection: selections[0]?.selection ?? emptySelection,
      candidates,
      sourcesChecked: input.sourcesChecked,
      sourceErrors: input.sourceErrors,
    };
  }

  if (isUuidLike(input.userId)) {
    const chosen = usable[0];
    return {
      candidate: chosen.candidate,
      selection: chosen.selection,
      candidates,
      sourcesChecked: input.sourcesChecked,
      sourceErrors: input.sourceErrors,
    };
  }

  const ownerIds = Array.from(new Set(usable.map((entry) => entry.candidate.ownerUserId).filter(Boolean)));
  if (ownerIds.length <= 1) {
    const chosen = usable[0];
    return {
      candidate: chosen.candidate,
      selection: chosen.selection,
      candidates,
      sourcesChecked: input.sourcesChecked,
      sourceErrors: input.sourceErrors,
    };
  }

  return {
    candidate: null,
    selection: usable[0].selection,
    candidates: usable.map((entry) => entry.candidate),
    sourcesChecked: input.sourcesChecked,
    sourceErrors: input.sourceErrors,
  };
}

export function resolveSelfReferenceCanarySourceForTest(input: {
  candidates: SelfCharacterCandidate[];
  sourcesChecked?: string[];
  sourceErrors?: string[];
  userId?: string | null;
}) {
  return pickBestSelfReferenceResolution({
    candidates: input.candidates,
    sourcesChecked: input.sourcesChecked ?? [],
    sourceErrors: input.sourceErrors ?? [],
    userId: input.userId,
  });
}

function selfReferenceDiagnosticsFromResolution(resolution: SelfReferenceResolution) {
  const candidate = resolution.candidate ?? resolution.candidates[0] ?? null;
  return {
    createSelfReferenceCount: candidate ? createPathSelfReferenceCount(candidate) : 0,
    canarySelfReferenceCount: resolution.selection.reference ? 1 : 0,
    referenceSourcesChecked: resolution.sourcesChecked,
    strongestReferenceSource: resolution.selection.diagnostics.source,
    selfReferenceCandidateCount: resolution.candidates.length,
    selfReferenceSourceErrors: resolution.sourceErrors,
  };
}

async function buildCreateSelfReferenceDiagnostics(userId?: string | null) {
  const sourceResult = await listSelfCharacterCandidates(userId);
  const resolution = pickBestSelfReferenceResolution({
    ...sourceResult,
    userId,
  });
  return selfReferenceDiagnosticsFromResolution(resolution);
}

async function findSelfReferenceCanaryCandidate(userId?: string | null): Promise<SelfReferenceResolution> {
  const sourceResult = await listSelfCharacterCandidates(userId);
  const resolution = pickBestSelfReferenceResolution({
    ...sourceResult,
    userId,
  });

  if (!resolution.candidate || !resolution.selection.reference) {
    const ownerIds = Array.from(new Set(resolution.candidates.map((candidate) => candidate.ownerUserId).filter(Boolean)));
    if (!isUuidLike(userId) && ownerIds.length > 1 && resolution.candidates.some((candidate) => createPathSelfReferenceCount(candidate) > 0)) {
      throw new SelfReferenceCanarySelectionError('Multiple possible self characters found. Provide a userId.', {
        error: 'multiple_self_reference_candidates',
        message: 'Multiple possible saved self references were found. Provide a userId.',
        sourcesChecked: resolution.sourcesChecked,
        sourceErrors: resolution.sourceErrors,
        candidates: resolution.candidates.map(redactedCandidate),
        recommendedNextAction: 'Rerun the script with -UserId for the owner shown in Create diagnostics.',
      }, 409);
    }

    throw noSavedSelfReferenceError(resolution);
  }

  return resolution;
}

export async function startSeedanceSelfReferenceCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
}) {
  const resolution = await findSelfReferenceCanaryCandidate(input.userId);
  const candidate = resolution.candidate;
  const selection = resolution.selection;
  if (!candidate || !selection.reference) throw noSavedSelfReferenceError(resolution);
  const referenceAccess = await verifyReferenceAssetAccess(selection.reference.url);
  const selectedReference = withReferenceAccessDiagnostics(selection.diagnostics, referenceAccess);

  const job = await insertCanaryJob({
    kind: 'reference',
    saveAsDraft: input.saveAsDraft,
    userId: candidate.ownerUserId,
    characterId: candidate.characterId,
    referenceImages: [selection.reference],
    selectedReference,
  });
  if (!referenceAccess.reachable) {
    await persistReferenceRouteResult({
      userId: candidate.ownerUserId,
      characterId: candidate.characterId,
      referenceRole: selectedReference.role,
      referenceLabel: selectedReference.label,
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      variant: 'reference_images',
      succeeded: false,
      failureCategory: 'reference_asset_access',
      providerErrorCategory: 'reference_asset_access',
      outputUrlPresent: false,
      notes: { selectedReferenceReachable: false, selectedReferenceContentType: selectedReference.contentType },
    });
    const failed = await updateCanaryJob(job.id, {
      status: 'failed',
      providerStatus: 'reference_asset_access',
      errorMessage: referenceAssetErrorMessage(referenceAccess),
      errorCategory: 'reference_asset_access',
    });
    return formatSeedanceCanaryStatus(failed ?? job);
  }
  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
}

async function resolveSelfVerificationVideoRuntime(input: {
  userId?: string | null;
  characterId?: string | null;
}): Promise<{
  ok: true;
  runtime: CanaryVerificationVideoRuntime;
  access: VerificationVideoAccessDiagnostics;
} | {
  ok: false;
  statusCode: number;
  error: string;
  message: string;
  verificationVideoPresent: boolean;
  verificationConsentPresent: boolean;
  diagnostics: CanaryVerificationVideoDiagnostics;
  recommendedNextAction: string;
}> {
  const asset = await getSelfVerificationVideoReferenceAsset(input);
  if (!asset.schemaReady) {
    return {
      ok: false,
      statusCode: 500,
      error: 'self_verification_schema_missing',
      message: 'Apply the self verification video migration before testing video references.',
      verificationVideoPresent: false,
      verificationConsentPresent: false,
      diagnostics: verificationVideoDiagnostics({}),
      recommendedNextAction: 'Apply the self verification video migration.',
    };
  }
  if (!asset.selfVerificationVideoPresent) {
    return {
      ok: false,
      statusCode: 404,
      error: 'verification_video_missing',
      message: 'Record a private self verification video before testing the Seedance video-reference route.',
      verificationVideoPresent: false,
      verificationConsentPresent: asset.selfVerificationConsentPresent,
      diagnostics: verificationVideoDiagnostics({}),
      recommendedNextAction: 'Record self verification video.',
    };
  }
  if (!asset.selfVerificationConsentPresent) {
    return {
      ok: false,
      statusCode: 400,
      error: 'verification_consent_missing',
      message: 'Consent is required before using the self verification video for likeness testing.',
      verificationVideoPresent: true,
      verificationConsentPresent: false,
      diagnostics: verificationVideoDiagnostics({}),
      recommendedNextAction: 'Confirm self verification consent.',
    };
  }

  const parsedStoragePath = parseSupabaseStorageObjectPath(asset.verificationVideoUrl);
  const bucket = parsedStoragePath?.bucket === VERIFICATION_VIDEO_BUCKET
    ? parsedStoragePath.bucket
    : VERIFICATION_VIDEO_BUCKET;
  const objectPath = textValue(asset.verificationVideoAssetId) ||
    (parsedStoragePath?.bucket === VERIFICATION_VIDEO_BUCKET ? parsedStoragePath.objectPath : '');
  const source: CanaryVerificationVideoDiagnostics['source'] = textValue(asset.verificationVideoAssetId)
    ? 'verification_video_asset_id'
    : parsedStoragePath?.objectPath
      ? 'verification_video_url'
      : 'none';

  if (!objectPath) {
    return {
      ok: false,
      statusCode: 424,
      error: 'verification_video_asset_access',
      message: 'Self verification video needs a private storage object path before provider testing.',
      verificationVideoPresent: true,
      verificationConsentPresent: true,
      diagnostics: verificationVideoDiagnostics({ source }),
      recommendedNextAction: 'Replace the self verification video so Lumora can sign it server-side.',
    };
  }

  const runtime = {
    bucket,
    objectPath,
    diagnostics: verificationVideoDiagnostics({ bucket, objectPath, source }),
  };
  const signedUrl = await signedVerificationVideoUrl(runtime);
  const access = await verifyVerificationVideoAssetAccess(signedUrl, { signedUrlGenerated: true });
  return {
    ok: true,
    runtime: {
      ...runtime,
      diagnostics: verificationVideoDiagnostics({
        bucket,
        objectPath,
        source,
        signedUrlGenerated: true,
        access,
      }),
    },
    access,
  };
}

export async function startSeedanceVideoReferenceCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
  variant?: SeedanceVideoReferenceCanaryVariant;
  forceNormalize?: boolean;
  allowOriginalFallback?: boolean;
  forceRetest?: boolean;
}) {
  const variant = input.variant ?? 'reference_videos_bracket';
  const resolved = await resolveSelfVerificationVideoRuntime({
    userId: input.userId,
    characterId: null,
  });
  if (!resolved.ok) {
    const failure = resolved as {
      error: string;
      message: string;
      verificationVideoPresent: boolean;
      verificationConsentPresent: boolean;
      diagnostics: CanaryVerificationVideoDiagnostics;
      recommendedNextAction: string;
    };
    if (isUuidLike(input.userId) && failure.error !== 'self_verification_schema_missing') {
      await markSeedanceVideoReferenceCanaryResult({
        userId: input.userId,
        characterId: null,
        routeStatus: failure.error,
        provider: 'seedance',
      }).catch(() => null);
    }
    return {
      ok: false,
      provider: 'seedance-fast',
      route: 'seedance_video_reference',
      canaryStatus: failure.error,
      verificationVideoPresent: failure.verificationVideoPresent,
      verificationConsentPresent: failure.verificationConsentPresent,
      providerPredictionCreated: false,
      outputPresent: false,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      failureCategory: failure.error,
      selectedVerificationVideo: failure.diagnostics,
      message: failure.message,
      recommendedNextAction: failure.recommendedNextAction,
      warning: 'This endpoint is gated because a mapped route may consume provider credits.',
    };
  }

  const existingDiagnostics = await getSelfVerificationVideoDiagnostics({
    userId: input.userId,
    characterId: null,
  });
  if (!input.forceRetest && isSeedanceVideoReferenceBlockedStatus({
    status: existingDiagnostics.seedanceVideoReferenceCanaryStatus,
    failureCategory: existingDiagnostics.seedanceVideoReferenceLastFailureCategory,
  })) {
    return seedanceVideoReferenceBlockedRetestPayload({
      selectedVerificationVideo: resolved.runtime.diagnostics,
      status: existingDiagnostics.seedanceVideoReferenceCanaryStatus,
      failureCategory: existingDiagnostics.seedanceVideoReferenceLastFailureCategory ?? 'video_reference_moderation_block',
    });
  }

  const prepared = await prepareVerificationVideoForProvider({
    bucket: resolved.runtime.bucket,
    objectPath: resolved.runtime.objectPath,
    userId: input.userId,
    forceNormalize: input.forceNormalize,
    requireNormalized: true,
    allowOriginalFallback: input.allowOriginalFallback === true,
  });
  let selectedRuntime: CanaryVerificationVideoRuntime = prepared.ok
    ? {
        bucket: prepared.bucket,
        objectPath: prepared.objectPath,
        diagnostics: verificationVideoDiagnostics({
          bucket: prepared.bucket,
          objectPath: prepared.objectPath,
          source: 'verification_video_asset_id',
          variant,
          normalization: prepared.diagnostics,
        }),
      }
    : {
        ...resolved.runtime,
        diagnostics: verificationVideoDiagnostics({
          bucket: resolved.runtime.bucket,
          objectPath: resolved.runtime.objectPath,
          source: resolved.runtime.diagnostics.source,
          variant,
          normalization: prepared.diagnostics,
        }),
      };

  if (prepared.ok === false) {
    const job = await insertCanaryJob({
      kind: 'video_reference',
      saveAsDraft: input.saveAsDraft,
      userId: input.userId,
      characterId: 'creator-self',
      verificationVideo: selectedRuntime,
      videoReferenceVariant: variant,
    });
    if (isUuidLike(input.userId)) {
      await markSeedanceVideoReferenceCanaryResult({
        userId: input.userId,
        characterId: null,
        routeStatus: videoReferenceRouteStatusForFailure(prepared.errorCategory),
        provider: 'seedance',
      });
    }
    const failed = await updateCanaryJob(job.id, {
      status: 'failed',
      providerStatus: prepared.errorCategory,
      errorMessage: prepared.message,
      errorCategory: prepared.errorCategory,
    });
    return formatSeedanceCanaryStatus(failed ?? job);
  }

  const signedSelectedUrl = await signedVerificationVideoUrl(selectedRuntime);
  const selectedAccess = await verifyVerificationVideoAssetAccess(signedSelectedUrl, { signedUrlGenerated: true });
  selectedRuntime.diagnostics = verificationVideoDiagnostics({
    bucket: selectedRuntime.bucket,
    objectPath: selectedRuntime.objectPath,
    source: 'verification_video_asset_id',
    variant,
    signedUrlGenerated: true,
    access: selectedAccess,
    normalization: prepared.diagnostics,
  });

  const job = await insertCanaryJob({
    kind: 'video_reference',
    saveAsDraft: input.saveAsDraft,
    userId: input.userId,
    characterId: 'creator-self',
    verificationVideo: selectedRuntime,
    videoReferenceVariant: variant,
  });

  if (!selectedAccess.reachable) {
    await persistReferenceRouteResult({
      userId: input.userId,
      characterId: 'creator-self',
      referenceRole: 'verification_video',
      referenceLabel: 'Self verification video',
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      variant,
      succeeded: false,
      failureCategory: 'verification_video_asset_access',
      providerErrorCategory: 'verification_video_asset_access',
      outputUrlPresent: false,
      notes: {
        selectedVerificationVideoReachable: false,
        selectedVerificationVideoContentType: selectedRuntime.diagnostics.contentType,
        normalizedAssetUsed: selectedRuntime.diagnostics.normalizedAssetUsed,
      },
    });
    if (isUuidLike(input.userId)) {
      await markSeedanceVideoReferenceCanaryResult({
        userId: input.userId,
        characterId: null,
        routeStatus: 'verification_video_asset_access',
        provider: 'seedance',
      });
    }
    const failed = await updateCanaryJob(job.id, {
      status: 'failed',
      providerStatus: 'verification_video_asset_access',
      errorMessage: verificationVideoAssetErrorMessage(selectedAccess),
      errorCategory: 'verification_video_asset_access',
    });
    return formatSeedanceCanaryStatus(failed ?? job);
  }

  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
}

export async function normalizeSeedanceVerificationVideoForDiagnostics(input: {
  userId?: string | null;
  forceNormalize?: boolean;
}) {
  const resolved = await resolveSelfVerificationVideoRuntime({
    userId: input.userId,
    characterId: null,
  });
  if (!resolved.ok) {
    const failure = resolved as {
      error: string;
      message: string;
      verificationVideoPresent: boolean;
      verificationConsentPresent: boolean;
      diagnostics: CanaryVerificationVideoDiagnostics;
      recommendedNextAction: string;
    };
    return {
      ok: false,
      route: 'normalize_verification_video',
      verificationVideoPresent: failure.verificationVideoPresent,
      verificationConsentPresent: failure.verificationConsentPresent,
      providerPredictionCreated: false,
      normalizedAssetUsed: false,
      normalizationTriggered: false,
      normalizationReason: null,
      selectedVerificationVideo: failure.diagnostics,
      failureCategory: failure.error,
      message: failure.message,
      recommendedNextAction: failure.recommendedNextAction,
    };
  }

  const prepared = await prepareVerificationVideoForProvider({
    bucket: resolved.runtime.bucket,
    objectPath: resolved.runtime.objectPath,
    userId: input.userId,
    forceNormalize: input.forceNormalize,
    requireNormalized: true,
    allowOriginalFallback: false,
  });
  const selectedVerificationVideo = verificationVideoDiagnostics({
    bucket: prepared.ok ? prepared.bucket : resolved.runtime.bucket,
    objectPath: prepared.ok ? prepared.objectPath : resolved.runtime.objectPath,
    source: prepared.ok ? 'verification_video_asset_id' : resolved.runtime.diagnostics.source,
    variant: 'reference_videos_bracket',
    normalization: prepared.diagnostics,
  });

  if (prepared.ok === true) {
    return {
      ok: true,
      route: 'normalize_verification_video',
      verificationVideoPresent: true,
      verificationConsentPresent: true,
      providerPredictionCreated: false,
      normalizedAssetUsed: selectedVerificationVideo.normalizedAssetUsed,
      normalizationTriggered: selectedVerificationVideo.normalizationTriggered,
      normalizationReason: selectedVerificationVideo.normalizationReason,
      normalizationErrorCategory: selectedVerificationVideo.normalizationErrorCategory,
      normalizationExitCode: selectedVerificationVideo.normalizationExitCode,
      normalizationStderrExcerpt: selectedVerificationVideo.normalizationStderrExcerpt,
      normalizationStdoutExcerpt: selectedVerificationVideo.normalizationStdoutExcerpt,
      normalizationFfmpegArgs: selectedVerificationVideo.normalizationFfmpegArgs,
      normalizationEncoderFallbackUsed: selectedVerificationVideo.normalizationEncoderFallbackUsed,
      normalizationResolutionFallbackUsed: selectedVerificationVideo.normalizationResolutionFallbackUsed,
      normalizedPreflightMetadata: selectedVerificationVideo.normalizedPreflight,
      selectedVerificationVideo,
      failureCategory: null,
      message: 'Verification video normalized and persisted for provider-safe canary use.',
      recommendedNextAction: 'Run Seedance video-reference canary with the normalized asset.',
    };
  }

  const failedPreparation = prepared as Extract<typeof prepared, { ok: false }>;
  return {
    ok: false,
    route: 'normalize_verification_video',
    verificationVideoPresent: true,
    verificationConsentPresent: true,
    providerPredictionCreated: false,
    normalizedAssetUsed: selectedVerificationVideo.normalizedAssetUsed,
    normalizationTriggered: selectedVerificationVideo.normalizationTriggered,
    normalizationReason: selectedVerificationVideo.normalizationReason,
    normalizationErrorCategory: selectedVerificationVideo.normalizationErrorCategory,
    normalizationExitCode: selectedVerificationVideo.normalizationExitCode,
    normalizationStderrExcerpt: selectedVerificationVideo.normalizationStderrExcerpt,
    normalizationStdoutExcerpt: selectedVerificationVideo.normalizationStdoutExcerpt,
    normalizationFfmpegArgs: selectedVerificationVideo.normalizationFfmpegArgs,
    normalizationEncoderFallbackUsed: selectedVerificationVideo.normalizationEncoderFallbackUsed,
    normalizationResolutionFallbackUsed: selectedVerificationVideo.normalizationResolutionFallbackUsed,
    normalizedPreflightMetadata: selectedVerificationVideo.normalizedPreflight,
    selectedVerificationVideo,
    failureCategory: failedPreparation.errorCategory,
    message: failedPreparation.message,
    recommendedNextAction: 'Fix verification video normalization before running provider canaries.',
  };
}

export async function getSeedanceCanaryStatus(jobId: string) {
  const job = await getCanaryJob(jobId);
  if (!job) return null;

  if (
    job.status === 'queued' ||
    (job.status === 'rendering' && job.providerPredictionId) ||
    (job.status === 'rate_limited' && (!job.retryAvailableAt || Date.parse(job.retryAvailableAt) <= Date.now()))
  ) {
    const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: true });
    return formatSeedanceCanaryStatus(processed ?? job);
  }

  return formatSeedanceCanaryStatus(job);
}

export async function getLatestSeedanceVideoReferenceCanaryStatus() {
  const result = await query<Record<string, unknown>>(
    `select ${canaryJobSelect}
     from generation_jobs
     where render_mode = 'seedance_video_reference_canary'
     order by updated_at desc nulls last, created_at desc
     limit 1`,
  );
  return result.rows[0] ? formatSeedanceCanaryStatus(mapCanaryRow(result.rows[0])) : null;
}

export function formatSeedanceCanaryStatus(job: CanaryJobRow) {
  const metadata = canaryMetadata(job);
  const providerFailure = metadata?.providerFailure ?? null;
  const outputParse = parseProviderVideoOutput(job.outputUrl ?? job.resultAssetUrl);
  const outputShape = typeof metadata?.payloadSummary === 'object'
    ? (job.sceneMetadata?.seedanceCanary as Record<string, unknown> | undefined)?.outputShapeSummary
    : null;
  const retryAfter = job.retryAvailableAt
    ? Math.max(0, Math.ceil((Date.parse(job.retryAvailableAt) - Date.now()) / 1000))
    : job.retryAfterSeconds;
  const status = job.status === 'completed' && !outputParse.ok ? 'failed' : job.status;
  const nextAction = (() => {
    if (status === 'completed' && outputParse.ok) return 'canary_succeeded';
    if (status === 'rate_limited') return retryAfter && retryAfter > 0 ? 'wait_for_retry_after' : 'retry_same_canary';
    if (status === 'rendering') return job.providerPredictionId ? 'poll_provider_prediction' : 'create_provider_prediction';
    if (status === 'queued') return 'create_provider_prediction';
    if (status === 'failed') {
      if (job.errorCategory === 'video_reference_moderation_block') return 'configure_alternate_likeness_provider';
      if (job.errorCategory === 'video_reference_provider_unavailable') return 'retry_later';
      if (job.errorCategory === 'video_reference_input_invalid' || job.errorCategory === 'verification_video_preflight_failed') return 'normalize_video_or_try_schema_variant';
      if (job.errorCategory === 'input_schema_invalid' || job.errorCategory === 'video_reference_input_schema') return 'fix_provider_payload_schema';
      if (job.errorCategory === 'reference_asset_access' || job.errorCategory === 'verification_video_asset_access') return 'fix_reference_asset_access';
      if (
        job.errorCategory === 'reference_moderation' ||
        job.errorCategory === 'reference_moderation_block' ||
        job.errorCategory === 'video_reference_moderation_block'
      ) return 'reference_path_blocked_try_text_only';
      if (
        job.errorCategory === 'reference_provider_failed' ||
        job.errorCategory === 'reference_unknown_provider_failure' ||
        job.errorCategory === 'video_reference_provider_failed'
      ) {
        return 'inspect_provider_error_or_try_text_only';
      }
      if (job.errorCategory?.includes('output')) return 'fix_output_parser_or_storage';
      return 'inspect_provider_error';
    }
    return 'none';
  })();
  const canaryStatus = status === 'completed' && outputParse.ok
    ? 'canary_succeeded'
    : job.errorCategory === 'video_reference_moderation_block'
      ? 'failed_blocked'
    : job.errorCategory === 'video_reference_provider_unavailable'
      ? 'retry_later'
      : job.errorCategory === 'video_reference_input_invalid' || job.errorCategory === 'verification_video_preflight_failed'
        ? 'input_needs_repair'
      : status;
  const recommendedNextAction = job.errorCategory === 'video_reference_moderation_block'
    ? 'Configure Runway/Kling likeness canary or continue soft guidance.'
    : job.errorCategory === 'video_reference_provider_unavailable'
    ? 'Retry Seedance video reference canary later'
    : job.errorCategory === 'video_reference_input_invalid' || job.errorCategory === 'verification_video_preflight_failed'
      ? 'Normalize verification video or try a schema variant'
    : nextAction;

  return {
    canaryJobId: job.id,
    jobId: job.id,
    provider: 'seedance-fast',
    providerModel: SEEDANCE_FAST_MODEL,
    predictionId: job.providerPredictionId,
    predictionUrl: job.providerPredictionUrl,
    providerPredictionIdExists: Boolean(job.providerPredictionId),
    providerPredictionCreated: Boolean(job.providerPredictionId),
    providerStatus: job.providerStatus,
    lifecycleStatus: status,
    status,
    canaryStatus,
    outputUrlPresent: Boolean(job.outputUrl ?? job.resultAssetUrl),
    outputPresent: Boolean(job.outputUrl ?? job.resultAssetUrl),
    parsedOutputUrlPresent: outputParse.ok,
    parsedVideoUrlPresent: outputParse.ok,
    outputShapeSummary: typeof outputShape === 'string' ? outputShape : null,
    errorCategory: job.errorCategory,
    providerErrorCategory: providerFailure?.providerErrorCategory ?? job.errorCategory,
    providerErrorSummary: providerFailure?.providerErrorSummary ?? null,
    providerLogsExcerpt: providerFailure?.providerLogsExcerpt ?? null,
    predictionGetUrlHost: providerFailure?.predictionGetUrlHost ?? null,
    providerMetricsSummary: providerFailure?.metricsSummary ?? null,
    redactedErrorDetail: redactMessage(job.errorMessage),
    retryAfterSeconds: retryAfter ?? null,
    retryAvailableAt: job.retryAvailableAt,
    nextAction,
    recommendedNextAction,
    payloadSummary: metadata?.payloadSummary ?? null,
    canaryVariant: metadata?.canaryVariant ?? null,
    promptContainsImageToken: metadata?.providerInput
      ? promptContainsAllImageTokens(metadata.providerInput.prompt, metadata.providerInput.reference_images?.length ?? 0)
      : false,
    promptContainsVideoToken: metadata?.providerInput
      ? promptContainsAllVideoTokens(
          metadata.providerInput.prompt,
          metadata.providerInput.reference_videos?.length ?? metadata.providerInput.video_urls?.length ?? 0,
        )
      : false,
    referenceFieldName: metadata?.providerInput?.reference_videos?.length
      ? 'reference_videos'
      : metadata?.providerInput?.video_urls?.length
        ? 'video_urls'
        : metadata?.providerInput?.reference_images?.length
          ? 'reference_images'
          : 'omitted',
    promptTokenStyle: metadata?.kind === 'video_reference'
      ? SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS[
          (metadata.canaryVariant as SeedanceVideoReferenceCanaryVariant) in SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS
            ? metadata.canaryVariant as SeedanceVideoReferenceCanaryVariant
            : 'reference_videos_bracket'
        ].promptTokenStyle
      : null,
    verificationVideoPresent: metadata?.kind === 'video_reference' ? true : undefined,
    verificationConsentPresent: metadata?.kind === 'video_reference' ? true : undefined,
    referenceAssetReachable: metadata?.selectedReference?.reachable ?? null,
    selectedReferenceContentType: metadata?.selectedReference?.contentType ?? null,
    selectedReferenceHost: metadata?.selectedReference?.host ?? null,
    selectedReferenceSource: metadata?.selectedReference?.source ?? null,
    selectedReference: metadata?.selectedReference ?? null,
    selectedVerificationVideo: metadata?.selectedVerificationVideo ?? null,
    normalizedAssetUsed: metadata?.selectedVerificationVideo?.normalizedAssetUsed ?? null,
    normalizationTriggered: metadata?.selectedVerificationVideo?.normalizationTriggered ?? null,
    normalizationReason: metadata?.selectedVerificationVideo?.normalizationReason ?? null,
    normalizationErrorCategory: metadata?.selectedVerificationVideo?.normalizationErrorCategory ?? null,
    normalizationExitCode: metadata?.selectedVerificationVideo?.normalizationExitCode ?? null,
    normalizationStderrExcerpt: metadata?.selectedVerificationVideo?.normalizationStderrExcerpt ?? null,
    normalizationStdoutExcerpt: metadata?.selectedVerificationVideo?.normalizationStdoutExcerpt ?? null,
    normalizationFfmpegArgs: metadata?.selectedVerificationVideo?.normalizationFfmpegArgs ?? null,
    normalizationEncoderFallbackUsed: metadata?.selectedVerificationVideo?.normalizationEncoderFallbackUsed ?? null,
    normalizationResolutionFallbackUsed: metadata?.selectedVerificationVideo?.normalizationResolutionFallbackUsed ?? null,
    normalizedPreflightMetadata: metadata?.selectedVerificationVideo?.normalizedPreflight ?? null,
    message: status === 'completed' && outputParse.ok
      ? 'Seedance canary succeeded with a verified video URL.'
      : status === 'rate_limited'
        ? 'Rate limited. Waiting before retrying the same canary job.'
        : job.errorCategory === 'video_reference_provider_unavailable'
          ? 'Seedance video reference route reached the provider, but the provider was temporarily unavailable.'
        : job.errorCategory === 'video_reference_input_invalid'
          ? 'Seedance reached the provider, but the video-reference input needs repair or a schema variant.'
        : job.errorCategory === 'video_reference_moderation_block'
          ? 'Seedance video reference route is blocked by provider safety. Lumora will keep using soft self guidance until an alternate likeness provider succeeds.'
        : job.errorCategory === 'verification_video_preflight_failed'
          ? 'Verification video needs a provider-safe format before Seedance can test it.'
        : status === 'failed'
          ? 'Seedance canary failed before a verified video URL was returned.'
          : 'Seedance canary is running.',
    warning: 'This may consume provider credits.',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function redactRenderPathCompareValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) ? '[redacted-url]' : value;
  }
  if (Array.isArray(value)) return value.map(redactRenderPathCompareValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key.toLowerCase().includes('url') ? '[redacted-url]' : redactRenderPathCompareValue(item),
    ]));
  }
  return value;
}

function promptRiskTerms(prompt: string | null | undefined) {
  const terms = ['photoshoot', 'influencer', 'superstar', 'model', 'public figure', 'celebrity', 'glamour', 'seductive'];
  const lower = (prompt ?? '').toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function metadataHasText(metadata: Record<string, unknown> | null, pattern: RegExp) {
  if (!metadata) return false;
  return pattern.test(JSON.stringify(metadata).toLowerCase());
}

function payloadReferenceFieldShape(payload: SeedanceProviderPayload | null) {
  if (!payload) return 'omitted';
  if ('reference_videos' in payload) {
    return Array.isArray(payload.reference_videos)
      ? `reference_videos array<string>(length=${payload.reference_videos.length})`
      : `reference_videos ${typeof payload.reference_videos}`;
  }
  if ('video_urls' in payload) {
    return Array.isArray(payload.video_urls)
      ? `video_urls array<string>(length=${payload.video_urls.length})`
      : `video_urls ${typeof payload.video_urls}`;
  }
  if ('reference_images' in payload) {
    return Array.isArray(payload.reference_images)
      ? `reference_images array<string>(length=${payload.reference_images.length})`
      : `reference_images ${typeof payload.reference_images}`;
  }
  return 'omitted';
}

function schemaTextHasField(schema: unknown, field: string) {
  return new RegExp(`"${field}"`).test(JSON.stringify(schema ?? {}));
}

export async function buildSeedanceInputSchemaDiagnostics() {
  const localSupportedInputFields = [
    'prompt',
    'duration',
    'aspect_ratio',
    'resolution',
    'generate_audio',
    'reference_images',
    'reference_videos',
    'video_urls',
  ];
  let fetchedSchema: unknown = null;
  let providerSchemaFetchAvailable = false;
  let providerSchemaFetchError: string | null = null;

  if (env.REPLICATE_API_TOKEN) {
    try {
      const response = await fetch(`https://api.replicate.com/v1/models/${SEEDANCE_FAST_MODEL}`, {
        headers: {
          authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
          accept: 'application/json',
        },
      });
      providerSchemaFetchAvailable = response.ok;
      if (response.ok) {
        const body = await response.json() as Record<string, unknown>;
        fetchedSchema = body.latest_version ?? body;
      } else {
        providerSchemaFetchError = `Replicate schema fetch returned HTTP ${response.status}.`;
      }
    } catch (error) {
      providerSchemaFetchError = redactMessage(errorText(error));
    }
  }

  const fields = {
    reference_videos: localSupportedInputFields.includes('reference_videos') || schemaTextHasField(fetchedSchema, 'reference_videos'),
    video_urls: localSupportedInputFields.includes('video_urls') || schemaTextHasField(fetchedSchema, 'video_urls'),
    image_urls: schemaTextHasField(fetchedSchema, 'image_urls'),
    reference_images: localSupportedInputFields.includes('reference_images') || schemaTextHasField(fetchedSchema, 'reference_images'),
    audio_urls: schemaTextHasField(fetchedSchema, 'audio_urls'),
  };
  const variants = Object.entries(SEEDANCE_VIDEO_REFERENCE_VARIANT_SPECS).map(([id, spec]) => ({
    id,
    fieldName: spec.fieldName,
    promptTokenStyle: spec.promptTokenStyle,
    promptToken: spec.promptToken,
    enabled: spec.enabledByLocalReplicateMapping,
    documentationSource: spec.documentationSource,
  }));
  const recommendedVariant = fields.reference_videos
    ? 'reference_videos_bracket'
    : fields.video_urls
      ? 'video_urls_at'
      : null;

  return {
    ok: true,
    modelId: SEEDANCE_FAST_MODEL,
    knownSupportedInputFields: localSupportedInputFields,
    providerSchemaFetchAvailable,
    providerSchemaFetchError,
    fields,
    variants,
    recommendedVariant,
    privateUrlsExposed: false,
  };
}

function hasManualOverrideText(value: unknown) {
  return /manual_reference_override|manual reference|manual override/i.test(JSON.stringify(value ?? ''));
}

function hasExternalUrlText(value: unknown) {
  const text = JSON.stringify(value ?? '');
  const matches = text.match(/https?:\/\/[^"'\s)]+/gi) ?? [];
  return matches.some((url) => {
    try {
      const host = new URL(url).host.toLowerCase();
      return !(host.includes('supabase.co') || host.includes('lumora'));
    } catch {
      return true;
    }
  });
}

export async function buildRenderPathCompareDiagnostics() {
  try {
    const canaryPayload = buildSeedanceCanaryPayload();
    const referenceCanaryResult = await query<Record<string, unknown>>(
      `select ${canaryJobSelect}
       from generation_jobs
       where render_mode = 'seedance_reference_canary'
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const referenceCanaryRow = referenceCanaryResult.rows[0]
      ? mapCanaryRow(referenceCanaryResult.rows[0])
      : null;
    const referenceCanaryMetadata = referenceCanaryRow ? canaryMetadata(referenceCanaryRow) : null;
    const referencePayload = referenceCanaryMetadata?.providerInput ?? null;
    const videoReferenceCanaryResult = await query<Record<string, unknown>>(
      `select ${canaryJobSelect}
       from generation_jobs
       where render_mode = 'seedance_video_reference_canary'
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const videoReferenceCanaryRow = videoReferenceCanaryResult.rows[0]
      ? mapCanaryRow(videoReferenceCanaryResult.rows[0])
      : null;
    const videoReferenceCanaryMetadata = videoReferenceCanaryRow ? canaryMetadata(videoReferenceCanaryRow) : null;
    const videoReferencePayload = videoReferenceCanaryMetadata?.providerInput ?? null;
    const realResult = await query<LatestRealPathRow>(
      `select
         id,
         user_id as "userId",
         character_id as "characterId",
         provider,
         provider_name as "providerName",
         provider_model as "providerModel",
         prompt,
         status,
         duration_seconds as "durationSeconds",
         aspect_ratio as "aspectRatio",
         reference_count as "referenceCount",
         character_name as "characterName",
         scene_metadata as "sceneMetadata",
         render_mode as "renderMode",
         provider_fallback_stage as "providerFallbackStage",
         render_success_role as "renderSuccessRole",
         created_at as "createdAt"
       from generation_jobs
       where output_type = 'video'
         and coalesce(render_mode, '') not in ('seedance_canary', 'seedance_reference_canary', 'seedance_video_reference_canary')
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const real = realResult.rows[0] ?? null;
    const realPrompt = real?.prompt ?? '';
    const realRenderSuccessMetadata = real?.sceneMetadata?.renderSuccessEngine &&
      typeof real.sceneMetadata.renderSuccessEngine === 'object'
      ? real.sceneMetadata.renderSuccessEngine as Record<string, unknown>
      : {};
    const textSelfGuidanceDescriptorPreview = typeof realRenderSuccessMetadata.textSelfGuidanceDescriptorPreview === 'string'
      ? realRenderSuccessMetadata.textSelfGuidanceDescriptorPreview
      : typeof realRenderSuccessMetadata.selfLikenessDescriptor === 'string'
        ? realRenderSuccessMetadata.selfLikenessDescriptor
        : null;
    const selectedLikenessMode = realRenderSuccessMetadata.selfLikenessIntensity === 'light' || realRenderSuccessMetadata.selfLikenessIntensity === 'strong'
      ? realRenderSuccessMetadata.selfLikenessIntensity
      : 'balanced';
    const selfReferenceDiagnostics = await buildCreateSelfReferenceDiagnostics(real?.userId ?? null);
    const referenceRouteSummary = await getReferenceRouteSummary({
      userId: real?.userId ?? null,
      characterId: real?.characterId ?? null,
    });
    const openaiSoraReadiness = getOpenAISoraProviderReadiness();
    const openaiSoraIdentity = await getSelfProviderCharacterDiagnostics({
      userId: real?.userId ?? null,
      characterId: real?.characterId ?? null,
    });
    const selfVerificationVideo = await getSelfVerificationVideoDiagnostics({
      userId: real?.userId ?? null,
      characterId: real?.characterId ?? null,
    });
    const openaiSoraRoute = chooseSoraSelfCharacterCreateRoute({
      readiness: openaiSoraReadiness,
      providerCharacterId: openaiSoraIdentity.selfProviderCharacterIdPresent ? 'present' : null,
      providerCharacterStatus: openaiSoraIdentity.selfProviderCharacterStatus,
      likenessProviderStatus: openaiSoraIdentity.likenessProviderStatus,
    });
    const alternateProviderStatuses = await getAlternateExactLikenessProviderStatuses({
      userId: real?.userId ?? null,
      characterId: real?.characterId ?? null,
    });
    const likenessProviderRegistry = buildLikenessProviderRegistry({
      openAISoraReadiness: openaiSoraReadiness,
      selfProviderCharacter: openaiSoraIdentity,
      selfVerificationVideo,
      referenceRouteSummary,
      alternateProviderStatuses,
    });
    const exactLikenessRouterChoice = chooseExactLikenessRoute({
      openAISoraReadiness: openaiSoraReadiness,
      selfProviderCharacter: openaiSoraIdentity,
      referenceRouteSummary,
      providerRegistry: likenessProviderRegistry,
    });
    const canarySummary = await buildSeedanceCanarySummaryDiagnostics();
    const canary = {
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      references: false,
      referenceCount: 0,
      duration: canaryPayload.duration,
      resolution: canaryPayload.resolution,
      aspect_ratio: canaryPayload.aspect_ratio,
      generate_audio: canaryPayload.generate_audio ?? 'omitted',
      promptLength: canaryPayload.prompt.length,
      promptRiskTerms: promptRiskTerms(canaryPayload.prompt),
      displayNamePresent: false,
      storyMemoryIncluded: false,
      sceneFlowIncluded: false,
      manualOverrideIncluded: false,
      externalUrlsIncluded: false,
      referenceFieldShape: payloadReferenceFieldShape(canaryPayload),
      payloadFields: Object.keys(canaryPayload),
    };
    const referenceCanary = referencePayload ? {
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      references: true,
      referenceCount: referencePayload.reference_images?.length ?? 0,
      referenceFieldName: referencePayload.reference_images?.length ? 'reference_images' : 'omitted',
      referenceAssetReachable: referenceCanaryMetadata?.selectedReference?.reachable ?? null,
      selectedReferenceContentType: referenceCanaryMetadata?.selectedReference?.contentType ?? null,
      duration: referencePayload.duration,
      resolution: referencePayload.resolution,
      aspect_ratio: referencePayload.aspect_ratio,
      generate_audio: referencePayload.generate_audio ?? 'omitted',
      promptLength: referencePayload.prompt.length,
      promptContainsImageToken: promptContainsAllImageTokens(referencePayload.prompt, referencePayload.reference_images?.length ?? 0),
      promptRiskTerms: promptRiskTerms(referencePayload.prompt),
      displayNamePresent: false,
      storyMemoryIncluded: false,
      sceneFlowIncluded: false,
      manualOverrideIncluded: Boolean(referenceCanaryMetadata?.selectedReference?.role === 'manual_reference_override'),
      externalUrlsIncluded: hasExternalUrlText(referencePayload.reference_images ?? []),
      referenceFieldShape: payloadReferenceFieldShape(referencePayload),
      selectedReference: referenceCanaryMetadata?.selectedReference ?? null,
      providerErrorSummary: referenceCanaryMetadata?.providerFailure?.providerErrorSummary ?? redactMessage(referenceCanaryRow?.errorMessage ?? null),
      canaryVariant: referenceCanaryMetadata?.canaryVariant ?? null,
      payloadFields: Object.keys(referencePayload),
      status: referenceCanaryRow?.status ?? null,
      errorCategory: referenceCanaryRow?.errorCategory ?? null,
    } : null;
    const videoReferenceCanary = videoReferencePayload ? {
      provider: 'seedance-fast',
      providerModel: SEEDANCE_FAST_MODEL,
      references: true,
      referenceCount: videoReferencePayload.reference_videos?.length ?? videoReferencePayload.video_urls?.length ?? 0,
      referenceFieldName: videoReferencePayload.reference_videos?.length
        ? 'reference_videos'
        : videoReferencePayload.video_urls?.length
          ? 'video_urls'
          : 'omitted',
      referenceAssetReachable: videoReferenceCanaryMetadata?.selectedVerificationVideo?.reachable ?? null,
      selectedReferenceContentType: videoReferenceCanaryMetadata?.selectedVerificationVideo?.contentType ?? null,
      duration: videoReferencePayload.duration,
      resolution: videoReferencePayload.resolution,
      aspect_ratio: videoReferencePayload.aspect_ratio,
      generate_audio: videoReferencePayload.generate_audio ?? 'omitted',
      promptLength: videoReferencePayload.prompt.length,
      promptContainsVideoToken: promptContainsAllVideoTokens(
        videoReferencePayload.prompt,
        videoReferencePayload.reference_videos?.length ?? videoReferencePayload.video_urls?.length ?? 0,
      ),
      promptRiskTerms: promptRiskTerms(videoReferencePayload.prompt),
      displayNamePresent: false,
      storyMemoryIncluded: false,
      sceneFlowIncluded: false,
      manualOverrideIncluded: false,
      externalUrlsIncluded: false,
      referenceFieldShape: payloadReferenceFieldShape(videoReferencePayload),
      selectedVerificationVideo: videoReferenceCanaryMetadata?.selectedVerificationVideo ?? null,
      preflightMetadata: videoReferenceCanaryMetadata?.selectedVerificationVideo?.preflight ?? null,
      normalizedPreflightMetadata: videoReferenceCanaryMetadata?.selectedVerificationVideo?.normalizedPreflight ?? null,
      normalizedAssetUsed: videoReferenceCanaryMetadata?.selectedVerificationVideo?.normalizedAssetUsed ?? null,
      providerErrorSummary: videoReferenceCanaryMetadata?.providerFailure?.providerErrorSummary ?? redactMessage(videoReferenceCanaryRow?.errorMessage ?? null),
      canaryVariant: videoReferenceCanaryMetadata?.canaryVariant ?? null,
      payloadFields: Object.keys(videoReferencePayload),
      status: videoReferenceCanaryRow?.status ?? null,
      providerStatus: videoReferenceCanaryRow?.providerStatus ?? null,
      retryAvailableAt: videoReferenceCanaryRow?.retryAvailableAt ?? null,
      errorCategory: videoReferenceCanaryRow?.errorCategory ?? null,
    } : null;
    const routeChoice = chooseCreateRouteFromReferenceSummary({
      referenceCount: real?.referenceCount ?? 0,
      seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
      hasSuccessfulReferenceRoute: referenceRouteSummary.knownSuccessfulReferenceRoutes.length > 0,
    });
    const realPath = real ? {
      id: real.id,
      provider: real.providerName ?? real.provider,
      providerModel: real.providerModel,
      references: (real.referenceCount ?? 0) > 0,
      referenceCount: real.referenceCount ?? 0,
      referenceFieldName: (real.referenceCount ?? 0) > 0 ? 'reference_images' : 'omitted',
      referenceAssetReachable: null,
      selectedReferenceContentType: null,
      duration: real.durationSeconds,
      resolution: (real.sceneMetadata?.seedanceCanary as Record<string, unknown> | undefined)?.resolution ?? 'unknown',
      aspect_ratio: real.aspectRatio,
      generate_audio: 'unknown',
      promptLength: realPrompt.length,
      promptContainsImageToken: promptContainsAllImageTokens(realPrompt, real.referenceCount ?? 0),
      promptRiskTerms: promptRiskTerms(realPrompt),
      displayNamePresent: Boolean(real.characterName && realPrompt.toLowerCase().includes(real.characterName.toLowerCase())),
      storyMemoryIncluded: metadataHasText(real.sceneMetadata, /story|continuity|memory/),
      sceneFlowIncluded: Boolean(real.renderMode?.includes('scene') || real.providerFallbackStage?.includes('scene') || metadataHasText(real.sceneMetadata, /sceneflow|scene_execution|beats/)),
      manualOverrideIncluded: hasManualOverrideText(real.sceneMetadata),
      externalUrlsIncluded: hasExternalUrlText(real.sceneMetadata),
      referenceFieldShape: (real.referenceCount ?? 0) > 0 ? 'unknown_create_path' : 'omitted',
      providerErrorSummary: null,
      canaryVariant: null,
      createVariant: (real.referenceCount ?? 0) > 0 ? 'reference_images' : 'text_only',
      textSelfGuidanceAvailable: Boolean(realRenderSuccessMetadata.textSelfGuidanceAvailable || textSelfGuidanceDescriptorPreview),
      selectedLikenessMode,
      chosenCreateRoute: routeChoice.chosenCreateRoute,
      whyChosen: routeChoice.whyChosen,
      renderMode: real.renderMode,
      providerFallbackStage: real.providerFallbackStage,
      renderSuccessRole: real.renderSuccessRole,
    } : null;

    return {
      ok: true,
      textCanary: canary,
      referenceCanary: redactRenderPathCompareValue(referenceCanary),
      videoReferenceCanary: redactRenderPathCompareValue(videoReferenceCanary),
      realCreate: redactRenderPathCompareValue(realPath),
      createSelfReferenceCount: selfReferenceDiagnostics.createSelfReferenceCount,
      canarySelfReferenceCount: selfReferenceDiagnostics.canarySelfReferenceCount,
      referenceSourcesChecked: selfReferenceDiagnostics.referenceSourcesChecked,
      strongestReferenceSource: selfReferenceDiagnostics.strongestReferenceSource,
      selfReferenceCandidateCount: selfReferenceDiagnostics.selfReferenceCandidateCount,
      selfReferenceSourceErrors: selfReferenceDiagnostics.selfReferenceSourceErrors,
      textCanarySucceeded: canarySummary.canaryEverSucceeded,
      textOnlyCanarySucceeded: canarySummary.canaryEverSucceeded,
      textSelfGuidanceAvailable: Boolean(textSelfGuidanceDescriptorPreview || referenceRouteSummary.seedanceReferenceRoutesBlocked),
      textSelfGuidanceDescriptorPreview,
      selfVerificationVideoPresent: selfVerificationVideo.selfVerificationVideoPresent,
      selfVerificationConsentPresent: selfVerificationVideo.selfVerificationConsentPresent,
      seedanceVideoReferenceCanaryStatus: selfVerificationVideo.seedanceVideoReferenceCanaryStatus,
      seedanceVideoReferenceLastFailureCategory: selfVerificationVideo.seedanceVideoReferenceLastFailureCategory,
      seedanceVideoReferenceProviderStatus: selfVerificationVideo.seedanceVideoReferenceProviderStatus,
      seedanceVideoReferenceRetryAvailableAt: videoReferenceCanaryRow?.retryAvailableAt ?? null,
      seedanceImageReferenceBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
      selectedLikenessMode,
      alternateLikenessProvidersConfigured: alternateLikenessProvidersConfigured().map((provider) => provider.provider),
      alternateLikenessProviderCanaryStatus: buildAlternateLikenessProviderCanaryStatus(),
      openaiVideoEnabled: openaiSoraReadiness.openaiVideoEnabled,
      openaiVideoModel: openaiSoraReadiness.openaiVideoModel,
      openaiCharacterEnabled: openaiSoraReadiness.openaiCharacterEnabled,
      openaiCharacterConfigured: openaiSoraReadiness.openaiCharacterConfigured,
      openaiRawRestAvailable: openaiSoraReadiness.openaiRawRestAvailable,
      openaiSdkVideosAvailable: openaiSoraReadiness.openaiSdkVideosAvailable,
      openaiVideosDeprecated: openaiSoraReadiness.openaiVideosDeprecated,
      shutdownDate: openaiSoraReadiness.shutdownDate,
      characterCreationSupported: openaiSoraReadiness.characterCreationSupported,
      characterVideoUsageMapped: openaiSoraReadiness.characterVideoUsageMapped,
      selfProviderCharacterIdPresent: openaiSoraIdentity.selfProviderCharacterIdPresent,
      selfProviderCharacterStatus: openaiSoraIdentity.selfProviderCharacterStatus,
      soraCharacterCanaryStatus: openaiSoraIdentity.soraCharacterCanaryStatus,
      selectedCreateLikenessRoute: openaiSoraRoute.selectedCreateLikenessRoute,
      openaiSoraWhyChosen: openaiSoraRoute.whyChosen,
      openaiSoraRecommendedNextAction: openaiSoraReadiness.openaiCharacterConfigured
        ? openaiSoraIdentity.selfProviderCharacterIdPresent
          ? openaiSoraReadiness.characterVideoUsageMapped
            ? 'run canary'
            : 'continue using Seedance text-first until character video usage is mapped'
          : 'upload consent video and create provider character'
        : 'enable OPENAI_VIDEO_ENABLED and OPENAI_VIDEO_CHARACTER_ENABLED',
      exactLikenessRouterChoice: {
        route: exactLikenessRouterChoice.route,
        provider: exactLikenessRouterChoice.provider,
        confidence: exactLikenessRouterChoice.confidence,
        exactLikeness: exactLikenessRouterChoice.exactLikeness,
        reason: exactLikenessRouterChoice.reason,
        requiredSetup: exactLikenessRouterChoice.requiredSetup,
        canaryStatus: exactLikenessRouterChoice.canaryStatus,
        fallbackRoute: exactLikenessRouterChoice.fallbackRoute,
        recommendedNextAction: exactLikenessRouterChoice.recommendedNextAction,
      },
      exactLikenessAvailable: exactLikenessRouterChoice.exactLikeness,
      exactLikenessProvider: exactLikenessRouterChoice.exactLikeness ? exactLikenessRouterChoice.provider : null,
      exactLikenessReason: exactLikenessRouterChoice.reason,
      softGuidanceAvailable: true,
      likenessProviderRegistry,
      alternateProvidersConfigured: likenessProviderRegistry.filter((provider) => provider.configured).map((provider) => provider.id),
      runwayConfigured: Boolean(likenessProviderRegistry.find((provider) => provider.id === 'runway_gen4_reference')?.configured),
      runwayCanaryStatus: likenessProviderRegistry.find((provider) => provider.id === 'runway_gen4_reference')?.canaryStatus ?? 'not_configured',
      klingConfigured: Boolean(likenessProviderRegistry.find((provider) => provider.id === 'kling_reference')?.configured),
      klingCanaryStatus: likenessProviderRegistry.find((provider) => provider.id === 'kling_reference')?.canaryStatus ?? 'not_configured',
      openaiSoraDeprecated: openaiSoraReadiness.openaiVideosDeprecated,
      lumoraIdentityPackStatus: 'research_only',
      recommendedNextAction: exactLikenessRouterChoice.recommendedNextAction,
      seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
      frontReferenceCanaryResult: referenceRouteSummary.allReferenceRouteResults.find((route) => route.referenceRole === 'front_angle') ?? null,
      sideReferenceCanaryResult: referenceRouteSummary.allReferenceRouteResults.find((route) => route.referenceRole === 'side_angle_left' || route.referenceRole === 'side_angle_right') ?? null,
      fullBodyReferenceCanaryResult: referenceRouteSummary.allReferenceRouteResults.find((route) => route.referenceRole === 'full_body') ?? null,
      chosenCreateRoute: realPath?.chosenCreateRoute ?? (referenceRouteSummary.seedanceReferenceRoutesBlocked ? 'text_only_success_first' : 'none'),
      whyChosen: realPath?.whyChosen ?? (referenceRouteSummary.seedanceReferenceRoutesBlocked ? 'all Seedance self reference routes blocked' : 'No recent Create render found.'),
      publishRequiresVerifiedOutput: true,
      continueStoryRequiresVerifiedOutput: true,
      knownBlockedReferenceRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
      knownSuccessfulReferenceRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
      createAttemptsKnownBlockedRoute: Boolean(realPath?.references && !referenceRouteSummary.knownSuccessfulReferenceRoutes.length && referenceRouteSummary.knownBlockedReferenceRoutes.length),
      providerReadiness: {
        seedance: {
          configured: Boolean(env.REPLICATE_API_TOKEN),
          referenceCapable: true,
          canaryTested: referenceRouteSummary.allReferenceRouteResults.length > 0,
          lastReferenceResult: referenceRouteSummary.allReferenceRouteResults[0] ?? null,
        },
        veo: {
          configured: Boolean(env.GOOGLE_API_KEY),
          referenceCapable: false,
          canaryTested: false,
          lastReferenceResult: null,
        },
        runway: {
          configured: Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY),
          referenceCapable: false,
          canaryTested: false,
          lastReferenceResult: null,
        },
        klingReference: {
          configured: Boolean(env.KLING_ENABLED && env.KLING_API_KEY && env.KLING_REFERENCE_MODEL),
          referenceCapable: false,
          canaryTested: false,
          lastReferenceResult: null,
        },
      },
      differences: realPath ? {
        references: realPath.references !== canary.references,
        duration: realPath.duration !== canary.duration,
        resolution: realPath.resolution !== canary.resolution,
        aspectRatio: realPath.aspect_ratio !== canary.aspect_ratio,
        provider: realPath.provider !== canary.provider,
        generateAudio: realPath.generate_audio !== canary.generate_audio,
        promptLengthDelta: realPath.promptLength - canary.promptLength,
        promptRiskTermsAdded: realPath.promptRiskTerms.filter((term) => !canary.promptRiskTerms.includes(term)),
        displayNamePresent: realPath.displayNamePresent,
        storyMemoryIncluded: realPath.storyMemoryIncluded,
        sceneFlowIncluded: realPath.sceneFlowIncluded,
        manualOverrideIncluded: realPath.manualOverrideIncluded,
        externalUrlsIncluded: realPath.externalUrlsIncluded,
        referenceFieldShape: realPath.referenceFieldShape,
        promptContainsImageToken: realPath.promptContainsImageToken,
        referenceFieldName: realPath.referenceFieldName,
      } : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeDiagnosticError(error),
    };
  }
}

export async function buildSeedanceCanarySummaryDiagnostics() {
  try {
    const referenceRouteSummary = await getReferenceRouteSummary({});
    const result = await query<CanaryJobRow>(
      `select ${canaryJobSelect}
       from generation_jobs
       where render_mode in ('seedance_canary', 'seedance_reference_canary')
       order by updated_at desc nulls last, created_at desc
       limit 20`,
    );
    const rows = result.rows.map((row) => mapCanaryRow(row as unknown as Record<string, unknown>));
    const textCanaries = rows.filter((row) => row.provider === 'seedance-canary');
    const referenceCanaries = rows.filter((row) => row.provider === 'seedance-reference-canary');
    const textSucceeded = textCanaries.some((row) => row.status === 'completed' && parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl).ok);
    const referenceSucceeded = referenceCanaries.some((row) => row.status === 'completed' && parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl).ok);
    const lastText = textCanaries[0] ?? null;
    const lastReference = referenceCanaries[0] ?? null;
    const recommendedNextAction = referenceRouteSummary.seedanceReferenceRoutesBlocked && textSucceeded
      ? 'configure alternate likeness provider'
      : !textCanaries.length
      ? 'Run text canary'
      : !textSucceeded
        ? lastText?.errorCategory?.includes('output')
          ? 'Fix output parser'
          : 'Provider setup/rate limit issue'
        : !referenceCanaries.length
          ? 'Run self reference canary'
        : !referenceSucceeded
            ? lastReference?.errorCategory === 'reference_moderation'
              ? 'Provider moderation blocks references'
              : lastReference?.errorCategory === 'reference_moderation_block'
                ? 'Provider moderation blocks this reference route'
              : lastReference?.errorCategory === 'reference_input_schema'
                ? 'Fix Seedance reference_images payload shape'
                : lastReference?.errorCategory === 'reference_asset_access'
                  ? 'Fix Asset Persistence or selected reference URL'
                  : lastReference?.errorCategory === 'reference_output_missing'
                    ? 'Fix reference output parser'
                    : lastReference?.errorCategory === 'reference_provider_failed' || lastReference?.errorCategory === 'reference_unknown_provider_failure'
                      ? 'Inspect Seedance reference provider error or use text-only first'
                    : `Reference canary failed: ${lastReference?.errorCategory ?? 'provider_unknown'}`
            : 'Align Create Success First with reference canary payload';

    return {
      canaryEverSucceeded: textSucceeded,
      lastCanaryStatus: lastText?.status ?? null,
      lastReferenceCanaryStatus: lastReference?.status ?? null,
      seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
      knownBlockedReferenceRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
      knownSuccessfulReferenceRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
      recommendedNextAction,
    };
  } catch {
    return {
      canaryEverSucceeded: false,
      lastCanaryStatus: null,
      lastReferenceCanaryStatus: null,
      seedanceReferenceRoutesBlocked: false,
      knownBlockedReferenceRoutes: [],
      knownSuccessfulReferenceRoutes: [],
      recommendedNextAction: 'Run text canary',
    };
  }
}

export async function getReferenceCanaryReadiness(input: {
  userId?: string | null;
  characterId?: string | null;
}) {
  try {
    const result = await query<Record<string, unknown>>(
      `select ${canaryJobSelect}
       from generation_jobs
       where render_mode = 'seedance_reference_canary'
         and ($1::uuid is null or user_id = $1)
         and ($2::text is null or character_id = $2)
       order by updated_at desc nulls last, created_at desc
       limit 1`,
      [
        isUuidLike(input.userId) ? input.userId : null,
        input.characterId ?? null,
      ],
    );
    const row = result.rows[0] ? mapCanaryRow(result.rows[0]) : null;
    if (!row) {
      return { state: 'unknown' as const, failureCategory: null as string | null };
    }
    const outputParse = parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl);
    if (row.status === 'completed' && outputParse.ok) {
      return { state: 'succeeded' as const, failureCategory: null as string | null };
    }
    if (row.status === 'failed' || row.status === 'canceled') {
      return { state: 'failed' as const, failureCategory: row.errorCategory };
    }
    return { state: 'unknown' as const, failureCategory: row.errorCategory };
  } catch {
    return { state: 'unknown' as const, failureCategory: null as string | null };
  }
}

type ReferenceRouteMemoryRow = {
  userId: string | null;
  characterId: string | null;
  referenceRole: string | null;
  referenceLabel: string | null;
  provider: string | null;
  providerModel: string | null;
  variant: string | null;
  successCount: number | null;
  failureCount: number | null;
  failureCategory: string | null;
  providerErrorCategory: string | null;
  lastTestedAt: string | null;
  outputUrlPresent: boolean | null;
};

const seedanceSelfReferenceRoles = ['front_angle', 'full_body', 'side_angle_left', 'side_angle_right'] as const;

function routeMemoryFromRow(row: ReferenceRouteMemoryRow) {
  return {
    userId: row.userId,
    characterId: row.characterId,
    referenceRole: row.referenceRole,
    referenceLabel: row.referenceLabel,
    provider: row.provider,
    providerModel: row.providerModel,
    variant: row.variant,
    succeeded: (row.successCount ?? 0) > 0 && (row.successCount ?? 0) >= (row.failureCount ?? 0),
    failureCategory: row.failureCategory,
    providerErrorCategory: row.providerErrorCategory,
    lastTestedAt: row.lastTestedAt,
    outputUrlPresent: Boolean(row.outputUrlPresent),
  };
}

async function persistInferredSeedanceQualityBlocks(rows: ReferenceRouteMemoryRow[]) {
  const qualityKeys = new Set(
    rows
      .filter((row) => row.provider === 'seedance-quality')
      .map((row) => `${row.userId ?? ''}|${row.characterId ?? ''}|${row.referenceRole ?? ''}`),
  );
  const fastBlocks = rows.filter((row) => (
    row.provider === 'seedance-fast' &&
    row.failureCategory === 'reference_moderation_block' &&
    row.referenceRole &&
    !qualityKeys.has(`${row.userId ?? ''}|${row.characterId ?? ''}|${row.referenceRole ?? ''}`)
  ));

  for (const row of fastBlocks) {
    await persistReferenceRouteResult({
      userId: row.userId,
      characterId: row.characterId,
      referenceRole: row.referenceRole,
      referenceLabel: row.referenceLabel,
      provider: 'seedance-quality',
      providerModel: SEEDANCE_QUALITY_MODEL,
      variant: (row.variant as SeedanceReferenceMatrixVariant | null) ?? 'reference_images',
      succeeded: false,
      failureCategory: 'reference_moderation_block',
      providerErrorCategory: row.providerErrorCategory ?? 'reference_moderation_block',
      outputUrlPresent: false,
      notes: {
        inferredFromProvider: 'seedance-fast',
        inferredReason: 'Seedance Fast reference moderation block disables automatic Seedance Quality likeness routing.',
      },
    });
  }
}

export function buildReferenceRouteSummaryFromRows(rows: ReferenceRouteMemoryRow[]) {
  const routes = rows.map(routeMemoryFromRow);
  const knownSuccessfulReferenceRoutes = routes.filter((route) => route.succeeded);
  const knownBlockedReferenceRoutes = routes.filter((route) => !route.succeeded);
  const best = knownSuccessfulReferenceRoutes[0] ?? null;
  const blockedRoles = new Set(
    knownBlockedReferenceRoutes
      .filter((route) => route.provider === 'seedance-fast' || route.provider === 'seedance-quality')
      .map((route) => route.referenceRole)
      .filter((role): role is string => Boolean(role)),
  );
  const seedanceReferenceRoutesBlocked = knownSuccessfulReferenceRoutes.length === 0 &&
    seedanceSelfReferenceRoles.every((role) => blockedRoles.has(role));

  return {
    state: best ? 'succeeded' as const : knownBlockedReferenceRoutes.length ? 'failed' as const : 'unknown' as const,
    referenceRole: best?.referenceRole ?? null,
    variant: (best?.variant as SeedanceReferenceMatrixVariant | null) ?? null,
    failureCategory: knownBlockedReferenceRoutes[0]?.failureCategory ?? null,
    seedanceReferenceRoutesBlocked,
    blockedReferenceRoles: Array.from(blockedRoles),
    requiredReferenceRoles: [...seedanceSelfReferenceRoles],
    knownSuccessfulReferenceRoutes,
    knownBlockedReferenceRoutes,
    allReferenceRouteResults: routes,
  };
}

export function chooseCreateRouteFromReferenceSummary(input: {
  referenceCount?: number | null;
  seedanceReferenceRoutesBlocked?: boolean;
  hasSuccessfulReferenceRoute?: boolean;
}) {
  if (input.hasSuccessfulReferenceRoute && (input.referenceCount ?? 0) > 0) {
    return {
      chosenCreateRoute: 'reference_images',
      whyChosen: 'Create used a reference route after at least one reference route succeeded.',
    };
  }
  if (input.seedanceReferenceRoutesBlocked) {
    return {
      chosenCreateRoute: 'text_only_success_first',
      whyChosen: 'all Seedance self reference routes blocked',
    };
  }
  if ((input.referenceCount ?? 0) > 0) {
    return {
      chosenCreateRoute: 'reference_images',
      whyChosen: 'Create used reference guidance without a known successful reference route.',
    };
  }
  return {
    chosenCreateRoute: 'text_only_success_first',
    whyChosen: 'No successful reference route exists, so Success First uses the proven text-only path.',
  };
}

export async function getReferenceRouteSummary(input: {
  userId?: string | null;
  characterId?: string | null;
}) {
  try {
    const result = await query<ReferenceRouteMemoryRow>(
      `select
         user_id as "userId",
         character_id as "characterId",
         reference_strategy as "referenceRole",
         notes->>'referenceLabel' as "referenceLabel",
         provider,
         provider_model as "providerModel",
         notes->>'variant' as "variant",
         success_count as "successCount",
         failure_count as "failureCount",
         last_failure_category as "failureCategory",
         notes->>'providerErrorCategory' as "providerErrorCategory",
         greatest(coalesce(last_success_at, '-infinity'::timestamptz), coalesce(last_failure_at, '-infinity'::timestamptz), updated_at) as "lastTestedAt",
         coalesce((notes->>'outputUrlPresent')::boolean, false) as "outputUrlPresent"
       from render_success_memory
       where render_mode = 'reference_route_canary'
         and ($1::uuid is null or user_id = $1)
         and ($2::text is null or character_id = $2)
       order by greatest(coalesce(last_success_at, '-infinity'::timestamptz), coalesce(last_failure_at, '-infinity'::timestamptz), updated_at) desc
       limit 40`,
      [
        isUuidLike(input.userId) ? input.userId : null,
        input.characterId ?? null,
      ],
    );
    await persistInferredSeedanceQualityBlocks(result.rows);
    return buildReferenceRouteSummaryFromRows(result.rows);
  } catch {
    return {
      state: 'unknown' as const,
      referenceRole: null,
      variant: null,
      failureCategory: null,
      seedanceReferenceRoutesBlocked: false,
      blockedReferenceRoles: [],
      requiredReferenceRoles: [...seedanceSelfReferenceRoles],
      knownSuccessfulReferenceRoutes: [],
      knownBlockedReferenceRoutes: [],
      allReferenceRouteResults: [],
    };
  }
}

export async function getReferenceRouteReadiness(input: {
  userId?: string | null;
  characterId?: string | null;
}): Promise<ReferenceRouteReadiness> {
  const summary = await getReferenceRouteSummary(input);
  return {
    state: summary.state,
    referenceRole: summary.referenceRole,
    variant: summary.variant,
    failureCategory: summary.failureCategory,
    seedanceReferenceRoutesBlocked: summary.seedanceReferenceRoutesBlocked,
  };
}
