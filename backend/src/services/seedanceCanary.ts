import Replicate, { type Prediction } from 'replicate';
import { env } from '../lib/env';
import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import { parseProviderVideoOutput } from './providerOutputParser';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { sanitizeProviderPrompt } from './providerPromptSanitizer';
import { getCinematicCharacterProfileForUser, type CharacterReferenceImageUrls } from './characterProfiles';
import { scoreReferenceConfidence } from './sceneOptimization';
import {
  SEEDANCE_FAST_MODEL,
  isReplicateRateLimitError,
  seedancePayloadSummary,
  validateSeedanceProviderPayload,
  type SeedanceProviderPayload,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';

export const SEEDANCE_CANARY_PROMPT =
  'A peaceful sunlit garden path with flowers swaying gently in the breeze, soft storybook cinematic style, calm natural motion.';
export const SEEDANCE_REFERENCE_CANARY_PROMPT =
  'the cast character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion';
export const SEEDANCE_CANARY_DURATION_SECONDS = 5;
export const SEEDANCE_CANARY_ASPECT_RATIO = '9:16';
export const SEEDANCE_CANARY_RESOLUTION = '480p';
export const SEEDANCE_CANARY_GENERATE_AUDIO = false;

const CANARY_USER_ID = '00000000-0000-4000-8000-000000000000';
const CANARY_TIMEOUT_MS = 4 * 60 * 1000;
const RATE_LIMIT_SAFETY_BUFFER_MS = 2_000;
const activeCanaryProcessors = new Set<string>();

type CanaryKind = 'text' | 'reference';
type CanaryLifecycleStatus = 'queued' | 'rendering' | 'rate_limited' | 'completed' | 'failed' | 'canceled';

type CanaryMetadata = {
  kind: CanaryKind;
  providerInput: SeedanceProviderPayload;
  payloadSummary: ReturnType<typeof seedancePayloadSummary>;
  selectedReference?: CanaryReferenceDiagnostics | null;
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
};

export type CanaryReferenceSelection = {
  reference: SeedanceReferenceImage | null;
  diagnostics: CanaryReferenceDiagnostics;
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

export function classifyReferenceCanaryFailure(value: unknown) {
  const raw = typeof value === 'string' ? value : errorText(value);
  const lower = raw.toLowerCase();
  if (lower.includes('moderation') || lower.includes('safety') || lower.includes('policy') || lower.includes('nsfw')) return 'reference_moderation';
  if (lower.includes('schema') || lower.includes('validation') || lower.includes('invalid input') || lower.includes('reference_images')) return 'reference_input_schema';
  if (lower.includes('403') || lower.includes('404') || lower.includes('asset') || lower.includes('download') || lower.includes('access') || lower.includes('url')) return 'reference_asset_access';
  if (lower.includes('output') || lower.includes('video url')) return 'reference_output_missing';
  return 'provider_unknown';
}

function classifyCanaryFailure(kind: CanaryKind, value: unknown) {
  return kind === 'reference' ? classifyReferenceCanaryFailure(value) : classifyProviderFailure(value);
}

export function canaryRateLimitStatus() {
  return 'rate_limited' as const;
}

export function buildSeedanceCanaryPayload(input: {
  referenceImages?: SeedanceReferenceImage[];
} = {}): SeedanceProviderPayload {
  const references = selectPrimaryCanaryReference(input.referenceImages ?? []);
  const sanitizer = sanitizeProviderPrompt({
    prompt: references.length ? SEEDANCE_REFERENCE_CANARY_PROMPT : SEEDANCE_CANARY_PROMPT,
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
      role: 'side_angle',
      source,
      whySelected: 'Side saved Lumora reference is used because primary/face references are unavailable.',
    },
    {
      url: urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle ?? null,
      label: 'Right angle',
      role: 'side_angle',
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
       and render_mode in ('seedance_canary', 'seedance_reference_canary')
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
  saveAsDraft?: boolean;
}) {
  const references = input.kind === 'reference'
    ? selectPrimaryCanaryReference(input.referenceImages ?? [])
    : [];
  const providerInput = buildSeedanceCanaryPayload({ referenceImages: references });
  const validation = validateSeedanceProviderPayload(providerInput);
  if (!validation.ok) {
    throw new Error(`Canary payload validation failed: ${validation.issues.map((issue) => `${issue.field} ${issue.expected}`).join(', ')}`);
  }
  const userId = isUuidLike(input.userId) ? input.userId as string : CANARY_USER_ID;
  const metadata: CanaryMetadata = {
    kind: input.kind,
    providerInput,
    payloadSummary: seedancePayloadSummary(providerInput),
    selectedReference: input.selectedReference ?? null,
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
      input.kind === 'reference' ? 'seedance-reference-canary' : 'seedance-canary',
      SEEDANCE_FAST_MODEL,
      providerInput.prompt,
      input.characterId ?? null,
      providerInput.duration,
      providerInput.aspect_ratio,
      JSON.stringify({ seedanceCanary: metadata }),
      references.length,
      input.kind === 'reference' ? 'seedance_reference_canary' : 'seedance_canary',
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
       scene_metadata = case
         when $12::text is null then scene_metadata
         else jsonb_set(coalesce(scene_metadata, '{}'::jsonb), '{seedanceCanary,outputShapeSummary}', to_jsonb($12::text), true)
       end,
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
    ],
  );
  return result.rows[0] ? mapCanaryRow(result.rows[0]) : null;
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
    const category = input.metadata.kind === 'reference' ? 'reference_output_missing' : outputParse.category;
    return updateCanaryJob(input.job.id, {
      status: 'failed',
      providerStatus: 'succeeded',
      errorMessage: 'Provider succeeded but did not return a usable video URL.',
      errorCategory: category,
      outputShapeSummaryValue: shape,
    });
  }

  const reachable = await verifyOutputReachable(outputParse.videoUrl);
  const missingCategory = input.metadata.kind === 'reference' ? 'reference_output_missing' : 'provider_output_unreachable';
  if (!reachable) {
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

    const validation = validateSeedanceProviderPayload(metadata.providerInput);
    if (!validation.ok) {
      return updateCanaryJob(job.id, {
        status: 'failed',
        errorMessage: `input_schema_invalid: ${validation.issues.map((issue) => `${issue.field} expected ${issue.expected}`).join('; ')}`,
        errorCategory: 'input_schema_invalid',
      });
    }

    const replicate = await replicateClient();
    if (!replicate) {
      return updateCanaryJob(job.id, {
        status: 'failed',
        errorMessage: 'Seedance canary is not configured. Set REPLICATE_API_TOKEN on the API server.',
        errorCategory: 'provider_setup',
      });
    }

    try {
      if (!job.providerPredictionId) {
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
          input: metadata.providerInput,
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
        return updateCanaryJob(job.id, {
          status: prediction.status === 'canceled' ? 'canceled' : 'failed',
          providerStatus: prediction.status,
          errorMessage: redactMessage(detail),
          errorCategory: classifyCanaryFailure(metadata.kind, detail),
          outputShapeSummaryValue: outputShapeSummary(prediction.output),
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
      return updateCanaryJob(job.id, {
        status: 'failed',
        errorMessage: redactMessage(errorText(error)),
        errorCategory: classifyCanaryFailure(metadata.kind, error),
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
  const job = await insertCanaryJob({
    kind: 'reference',
    saveAsDraft: input.saveAsDraft,
    userId: input.userId,
    characterId: input.characterId,
    referenceImages: [selection.reference],
    selectedReference: selection.diagnostics,
  });
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

  const job = await insertCanaryJob({
    kind: 'reference',
    saveAsDraft: input.saveAsDraft,
    userId: candidate.ownerUserId,
    characterId: candidate.characterId,
    referenceImages: [selection.reference],
    selectedReference: selection.diagnostics,
  });
  const processed = await processSeedanceCanaryJob(job.id, { pollUntilTerminal: false });
  return formatSeedanceCanaryStatus(processed ?? job);
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

export function formatSeedanceCanaryStatus(job: CanaryJobRow) {
  const metadata = canaryMetadata(job);
  const outputParse = parseProviderVideoOutput(job.outputUrl ?? job.resultAssetUrl);
  const outputShape = typeof metadata?.payloadSummary === 'object'
    ? (job.sceneMetadata?.seedanceCanary as Record<string, unknown> | undefined)?.outputShapeSummary
    : null;
  const retryAfter = job.retryAvailableAt
    ? Math.max(0, Math.ceil((Date.parse(job.retryAvailableAt) - Date.now()) / 1000))
    : job.retryAfterSeconds;
  const status = job.status === 'completed' && !outputParse.ok ? 'failed' : job.status;
  const nextAction =
    status === 'completed' && outputParse.ok
      ? 'canary_succeeded'
      : status === 'rate_limited'
        ? retryAfter && retryAfter > 0 ? 'wait_for_retry_after' : 'retry_same_canary'
        : status === 'rendering'
          ? job.providerPredictionId ? 'poll_provider_prediction' : 'create_provider_prediction'
          : status === 'queued'
            ? 'create_provider_prediction'
            : status === 'failed'
              ? job.errorCategory === 'input_schema_invalid'
                ? 'fix_provider_payload_schema'
                : job.errorCategory?.includes('output')
                  ? 'fix_output_parser_or_storage'
                  : 'inspect_provider_error'
              : 'none';

  return {
    canaryJobId: job.id,
    jobId: job.id,
    provider: 'seedance-fast',
    providerModel: SEEDANCE_FAST_MODEL,
    predictionId: job.providerPredictionId,
    predictionUrl: job.providerPredictionUrl,
    providerPredictionIdExists: Boolean(job.providerPredictionId),
    providerStatus: job.providerStatus,
    lifecycleStatus: status,
    status,
    outputUrlPresent: Boolean(job.outputUrl ?? job.resultAssetUrl),
    parsedOutputUrlPresent: outputParse.ok,
    outputShapeSummary: typeof outputShape === 'string' ? outputShape : null,
    errorCategory: job.errorCategory,
    redactedErrorDetail: redactMessage(job.errorMessage),
    retryAfterSeconds: retryAfter ?? null,
    retryAvailableAt: job.retryAvailableAt,
    nextAction,
    payloadSummary: metadata?.payloadSummary ?? null,
    selectedReference: metadata?.selectedReference ?? null,
    message: status === 'completed' && outputParse.ok
      ? 'Seedance canary succeeded with a verified video URL.'
      : status === 'rate_limited'
        ? 'Rate limited. Waiting before retrying the same canary job.'
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
  if (!payload || !('reference_images' in payload)) return 'omitted';
  return Array.isArray(payload.reference_images)
    ? `array<string>(length=${payload.reference_images.length})`
    : typeof payload.reference_images;
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
         and coalesce(render_mode, '') not in ('seedance_canary', 'seedance_reference_canary')
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const real = realResult.rows[0] ?? null;
    const realPrompt = real?.prompt ?? '';
    const selfReferenceDiagnostics = await buildCreateSelfReferenceDiagnostics(real?.userId ?? null);
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
      duration: referencePayload.duration,
      resolution: referencePayload.resolution,
      aspect_ratio: referencePayload.aspect_ratio,
      generate_audio: referencePayload.generate_audio ?? 'omitted',
      promptLength: referencePayload.prompt.length,
      promptRiskTerms: promptRiskTerms(referencePayload.prompt),
      displayNamePresent: false,
      storyMemoryIncluded: false,
      sceneFlowIncluded: false,
      manualOverrideIncluded: Boolean(referenceCanaryMetadata?.selectedReference?.role === 'manual_reference_override'),
      externalUrlsIncluded: hasExternalUrlText(referencePayload.reference_images ?? []),
      referenceFieldShape: payloadReferenceFieldShape(referencePayload),
      selectedReference: referenceCanaryMetadata?.selectedReference ?? null,
      payloadFields: Object.keys(referencePayload),
      status: referenceCanaryRow?.status ?? null,
      errorCategory: referenceCanaryRow?.errorCategory ?? null,
    } : null;
    const realPath = real ? {
      id: real.id,
      provider: real.providerName ?? real.provider,
      providerModel: real.providerModel,
      references: (real.referenceCount ?? 0) > 0,
      referenceCount: real.referenceCount ?? 0,
      duration: real.durationSeconds,
      resolution: (real.sceneMetadata?.seedanceCanary as Record<string, unknown> | undefined)?.resolution ?? 'unknown',
      aspect_ratio: real.aspectRatio,
      generate_audio: 'unknown',
      promptLength: realPrompt.length,
      promptRiskTerms: promptRiskTerms(realPrompt),
      displayNamePresent: Boolean(real.characterName && realPrompt.toLowerCase().includes(real.characterName.toLowerCase())),
      storyMemoryIncluded: metadataHasText(real.sceneMetadata, /story|continuity|memory/),
      sceneFlowIncluded: Boolean(real.renderMode?.includes('scene') || real.providerFallbackStage?.includes('scene') || metadataHasText(real.sceneMetadata, /sceneflow|scene_execution|beats/)),
      manualOverrideIncluded: hasManualOverrideText(real.sceneMetadata),
      externalUrlsIncluded: hasExternalUrlText(real.sceneMetadata),
      referenceFieldShape: (real.referenceCount ?? 0) > 0 ? 'unknown_create_path' : 'omitted',
      renderMode: real.renderMode,
      providerFallbackStage: real.providerFallbackStage,
      renderSuccessRole: real.renderSuccessRole,
    } : null;

    return {
      ok: true,
      textCanary: canary,
      referenceCanary: redactRenderPathCompareValue(referenceCanary),
      realCreate: redactRenderPathCompareValue(realPath),
      createSelfReferenceCount: selfReferenceDiagnostics.createSelfReferenceCount,
      canarySelfReferenceCount: selfReferenceDiagnostics.canarySelfReferenceCount,
      referenceSourcesChecked: selfReferenceDiagnostics.referenceSourcesChecked,
      strongestReferenceSource: selfReferenceDiagnostics.strongestReferenceSource,
      selfReferenceCandidateCount: selfReferenceDiagnostics.selfReferenceCandidateCount,
      selfReferenceSourceErrors: selfReferenceDiagnostics.selfReferenceSourceErrors,
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
    const recommendedNextAction = !textCanaries.length
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
              : lastReference?.errorCategory === 'reference_input_schema'
                ? 'Fix Seedance reference_images payload shape'
                : lastReference?.errorCategory === 'reference_asset_access'
                  ? 'Fix Asset Persistence or selected reference URL'
                  : lastReference?.errorCategory === 'reference_output_missing'
                    ? 'Fix reference output parser'
                    : `Reference canary failed: ${lastReference?.errorCategory ?? 'provider_unknown'}`
            : 'Align Create Success First with reference canary payload';

    return {
      canaryEverSucceeded: textSucceeded,
      lastCanaryStatus: lastText?.status ?? null,
      lastReferenceCanaryStatus: lastReference?.status ?? null,
      recommendedNextAction,
    };
  } catch {
    return {
      canaryEverSucceeded: false,
      lastCanaryStatus: null,
      lastReferenceCanaryStatus: null,
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
