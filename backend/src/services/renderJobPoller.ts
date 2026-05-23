import Replicate, { type Prediction } from 'replicate';
import { env } from '../lib/env';
import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import { createSeedanceGeneration } from './generationService';
import { isAssetPersistenceError } from './assetPersistence';
import { providerFallbackDiagnosticsFromError } from './providerFallbackOrchestrator';
import {
  isSeedanceModerationError,
  isReplicateRateLimitError,
  SEEDANCE_FAST_MODEL,
  SEEDANCE_QUALITY_MODEL,
  type SeedanceQualityMode,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';
import { isProviderOutputError, parseProviderVideoOutput } from './providerOutputParser';
import { serializeDiagnosticError } from './schemaDiagnostics';
import type { RenderSuccessMode } from './sceneOptimization';

const activeProcessors = new Set<string>();
const activeRenderLocks = new Set<string>();
let duplicateRenderPreventedCount = 0;
const ACTIVE_STATUSES = ['queued', 'rendering', 'processing', 'rate_limited'] as const;
const RENDER_TIMEOUT_MS = 30 * 60 * 1000;
const RATE_LIMIT_SAFETY_BUFFER_MS = 2_000;

export type AsyncRenderJobInput = {
  prompt: string;
  title?: string | null;
  userId: string;
  quality: SeedanceQualityMode;
  engine: 'seedance-2.0' | 'seedance-quality';
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  renderPreference?: RenderSuccessMode | null;
  referenceImages: SeedanceReferenceImage[];
  referenceImageUrls?: Record<string, unknown> | null;
  additionalReferenceImageUrls?: string[] | null;
};

export type AsyncRenderJobRecord = {
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
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastPolledAt: string | null;
  retryCount: number;
  timeoutAt: string | null;
  retryAfterSeconds: number | null;
  retryAvailableAt: string | null;
  rateLimitedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function modelForQuality(quality: SeedanceQualityMode) {
  return quality === 'quality' ? SEEDANCE_QUALITY_MODEL : SEEDANCE_FAST_MODEL;
}

function displayEngineForQuality(quality: SeedanceQualityMode) {
  return quality === 'quality' ? 'Seedance Quality' : 'Seedance Fast';
}

function predictionUrl(prediction: Prediction) {
  const urls = prediction.urls as Record<string, unknown> | undefined;
  const getUrl = typeof urls?.get === 'string' ? urls.get : null;
  return getUrl ?? (prediction.id ? `https://replicate.com/p/${prediction.id}` : null);
}

function asyncMetadata(input: AsyncRenderJobInput) {
  return {
    asyncRender: {
      prompt: input.prompt,
      title: input.title ?? null,
      quality: input.quality,
      engine: input.engine,
      characterId: input.characterId ?? null,
      characterName: input.characterName ?? null,
      characterAvatar: input.characterAvatar ?? null,
      isDefaultSelfCharacter: Boolean(input.isDefaultSelfCharacter),
      renderPreference: input.renderPreference ?? 'balanced',
      referenceImages: input.referenceImages,
      referenceImageUrls: input.referenceImageUrls ?? {},
      additionalReferenceImageUrls: input.additionalReferenceImageUrls ?? [],
      createdAt: new Date().toISOString(),
    },
  };
}

function metadataInput(job: AsyncRenderJobRecord): AsyncRenderJobInput | null {
  const metadata = job.sceneMetadata?.asyncRender;
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt : job.prompt;
  const quality = record.quality === 'quality' ? 'quality' : 'fast';
  const referenceImages = Array.isArray(record.referenceImages)
    ? record.referenceImages.filter((item): item is SeedanceReferenceImage => (
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { url?: unknown }).url === 'string'
      ))
    : [];

  return {
    prompt,
    title: typeof record.title === 'string' ? record.title : null,
    userId: job.userId,
    quality,
    engine: record.engine === 'seedance-quality' ? 'seedance-quality' : 'seedance-2.0',
    characterId: typeof record.characterId === 'string' ? record.characterId : job.characterId,
    characterName: typeof record.characterName === 'string' ? record.characterName : null,
    characterAvatar: typeof record.characterAvatar === 'string' ? record.characterAvatar : null,
    isDefaultSelfCharacter: record.isDefaultSelfCharacter === true,
    renderPreference: record.renderPreference === 'cinematic_quality' ||
      record.renderPreference === 'success_first' ||
      record.renderPreference === 'balanced'
      ? record.renderPreference
      : 'balanced',
    referenceImages,
    referenceImageUrls: (record.referenceImageUrls && typeof record.referenceImageUrls === 'object')
      ? record.referenceImageUrls as Record<string, unknown>
      : {},
    additionalReferenceImageUrls: Array.isArray(record.additionalReferenceImageUrls)
      ? record.additionalReferenceImageUrls.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function mapRow(row: Record<string, unknown>): AsyncRenderJobRecord {
  return {
    id: String(row.id),
    userId: String(row.userId ?? row.user_id),
    projectId: typeof row.projectId === 'string' ? row.projectId : null,
    provider: String(row.provider ?? 'seedance-2.0'),
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
    startedAt: typeof row.startedAt === 'string' ? row.startedAt : null,
    completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
    failedAt: typeof row.failedAt === 'string' ? row.failedAt : null,
    lastPolledAt: typeof row.lastPolledAt === 'string' ? row.lastPolledAt : null,
    retryCount: typeof row.retryCount === 'number' ? row.retryCount : 0,
    timeoutAt: typeof row.timeoutAt === 'string' ? row.timeoutAt : null,
    retryAfterSeconds: typeof row.retryAfterSeconds === 'number' ? row.retryAfterSeconds : null,
    retryAvailableAt: typeof row.retryAvailableAt === 'string' ? row.retryAvailableAt : null,
    rateLimitedAt: typeof row.rateLimitedAt === 'string' ? row.rateLimitedAt : null,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

const asyncRenderJobSelect = `
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
  started_at as "startedAt",
  completed_at as "completedAt",
  failed_at as "failedAt",
  last_polled_at as "lastPolledAt",
  retry_count as "retryCount",
  timeout_at as "timeoutAt",
  retry_after_seconds as "retryAfterSeconds",
  retry_available_at as "retryAvailableAt",
  rate_limited_at as "rateLimitedAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

async function createRenderingProject(input: AsyncRenderJobInput) {
  const thumbnailUrl: string | null = null;
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
       aspect_ratio,
       created_at,
       updated_at
     )
     values ($1, $2, $3, $4, $4, $5, 'rendering', 'replicate', $6, $7, $8, $9, 'video', $10, $10, $11, $12, $13, $14, 'private', 'private', '16:9', now(), now())
     returning id`,
    [
      input.userId,
      input.title || 'Lumora render',
      input.prompt,
      input.prompt,
      input.engine,
      input.engine,
      displayEngineForQuality(input.quality),
      modelForQuality(input.quality),
      input.referenceImages.length > 0 ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
      thumbnailUrl,
      input.characterId ?? null,
      input.characterName ?? null,
      input.characterAvatar ?? null,
      Boolean(input.isDefaultSelfCharacter),
    ],
  );

  return result.rows[0]?.id ?? null;
}

async function insertRenderJob(input: AsyncRenderJobInput, projectId: string | null) {
  const timeoutAt = new Date(Date.now() + RENDER_TIMEOUT_MS).toISOString();
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
       created_at,
       updated_at
     )
     values ($1, $2, $3, 'replicate', $4, 'video', $5, 'queued', $6, 5, '16:9', 'private', $7, 'queued', $8::jsonb, $9, $10, $11, now(), now())
     returning ${asyncRenderJobSelect}`,
    [
      input.userId,
      projectId,
      input.engine,
      modelForQuality(input.quality),
      input.prompt,
      input.characterId ?? null,
      null,
      JSON.stringify(asyncMetadata(input)),
      timeoutAt,
      input.referenceImages.length,
      input.renderPreference ?? 'balanced',
    ],
  );

  return mapRow(result.rows[0]);
}

export async function getAsyncRenderJob(jobId: string) {
  const result = await query<Record<string, unknown>>(
    `select ${asyncRenderJobSelect}
     from generation_jobs
     where id = $1
     limit 1`,
    [jobId],
  );

  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function findActiveRenderJob(input: AsyncRenderJobInput) {
  const result = await query<Record<string, unknown>>(
    `select ${asyncRenderJobSelect}
     from generation_jobs
     where user_id = $1
       and provider = $2
       and status = any($3::text[])
       and created_at > now() - interval '30 minutes'
     order by created_at desc
     limit 1`,
    [input.userId, input.engine, ACTIVE_STATUSES],
  );

  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function updateProviderState(input: {
  jobId: string;
  prediction: Prediction;
  model: string;
  referenceCount: number;
  renderMode?: string | null;
  providerFallbackStage?: string | null;
}) {
  await query(
    `update generation_jobs
     set
       status = case when status = 'completed' then status else 'rendering' end,
       provider_job_id = coalesce(provider_job_id, $2),
       provider_prediction_id = $2,
       provider_prediction_url = $3,
       provider_status = $4,
       provider_name = 'replicate',
       provider_model = $5,
       started_at = coalesce(started_at, now()),
       last_polled_at = now(),
       reference_count = $6,
       render_mode = coalesce($7, render_mode),
      provider_fallback_stage = coalesce($8, provider_fallback_stage),
       retry_after_seconds = null,
       retry_available_at = null,
       updated_at = now()
     where id = $1`,
    [
      input.jobId,
      input.prediction.id,
      predictionUrl(input.prediction),
      input.prediction.status,
      input.model,
      input.referenceCount,
      input.renderMode ?? null,
      input.providerFallbackStage ?? null,
    ],
  );
}

async function updateProjectStatus(projectId: string | null, status: string, errorMessage?: string | null) {
  if (!projectId) return;
  await query(
    `update projects
     set status = $2,
         error_message = coalesce($3, error_message),
         updated_at = now()
     where id = $1`,
    [projectId, status, errorMessage ?? null],
  ).catch(() => undefined);
}

async function markJobCompleted(input: {
  jobId: string;
  projectId: string | null;
  providerJobId: string | null;
  providerStatus?: string | null;
  outputUrl: string;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  providerModel?: string | null;
}) {
  const result = await query<Record<string, unknown>>(
    `update generation_jobs
     set
       status = 'completed',
       provider_status = coalesce($5, provider_status, 'succeeded'),
       provider_job_id = coalesce($3, provider_job_id),
       provider_prediction_id = coalesce($3, provider_prediction_id),
       provider_model = coalesce($7, provider_model),
       result_asset_url = $4,
       output_url = $4,
       thumbnail_url = $6,
       poster_url = $8,
       thumbnail_source = case when coalesce($6::text, $8::text) is not null then 'generated_poster' else 'video_output' end,
       error_message = null,
       error_category = null,
       completed_at = now(),
       last_polled_at = now(),
       updated_at = now()
     where id = $1
     returning ${asyncRenderJobSelect}`,
    [
      input.jobId,
      input.projectId,
      input.providerJobId,
      input.outputUrl,
      input.providerStatus ?? null,
      input.thumbnailUrl ?? null,
      input.providerModel ?? null,
      input.posterUrl ?? input.thumbnailUrl ?? null,
    ],
  );

  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

async function markJobFailed(input: {
  jobId: string;
  projectId: string | null;
  message: string;
  category: string;
  status?: 'failed' | 'paused';
}) {
  await query(
    `update generation_jobs
     set
       status = $2,
       error_message = $3,
       error_category = $4,
       failed_at = now(),
       last_polled_at = now(),
       updated_at = now()
     where id = $1`,
    [input.jobId, input.status ?? 'failed', input.message, input.category],
  );
  await updateProjectStatus(input.projectId, input.status ?? 'failed', input.message);
}

async function markJobRateLimited(input: {
  jobId: string;
  projectId: string | null;
  message: string;
  retryAfterSeconds: number | null;
  retryAvailableAt: string | null;
}) {
  await query(
    `update generation_jobs
     set
       status = 'rate_limited',
       provider_status = 'rate_limited',
       error_message = $2,
       error_category = 'rate_limited',
       retry_after_seconds = $3,
       retry_available_at = $4,
       rate_limited_at = now(),
       last_polled_at = now(),
       updated_at = now()
     where id = $1`,
    [input.jobId, input.message, input.retryAfterSeconds, input.retryAvailableAt],
  );
  await updateProjectStatus(input.projectId, 'rendering', input.message);
}

async function resumeRateLimitedJob(job: AsyncRenderJobRecord) {
  const nextStatus = job.providerPredictionId ? 'rendering' : 'queued';
  await query(
    `update generation_jobs
     set
       status = $2,
       provider_status = case when $2 = 'queued' then 'queued' else coalesce(provider_status, 'processing') end,
       error_message = null,
       error_category = null,
       retry_after_seconds = null,
       retry_available_at = null,
       updated_at = now()
     where id = $1`,
    [job.id, nextStatus],
  );
  await updateProjectStatus(job.projectId, 'rendering');
  return await getAsyncRenderJob(job.id) ?? job;
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

function rateLimitDelaySeconds(error: unknown) {
  if (isReplicateRateLimitError(error)) {
    return error.retryAfterSeconds ?? (
      typeof error.retryAfterMs === 'number'
        ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
        : null
    );
  }
  const retryAfterMs = rawRetryAfterMs(error);
  return typeof retryAfterMs === 'number'
    ? Math.max(1, Math.ceil(retryAfterMs / 1000))
    : null;
}

function rateLimitRetryMs(error: unknown) {
  if (isReplicateRateLimitError(error) && typeof error.retryAfterMs === 'number') return error.retryAfterMs;
  const raw = rawRetryAfterMs(error);
  return typeof raw === 'number' ? raw : 10_000;
}

function rateLimitAvailableAt(error: unknown) {
  const retryMs = rateLimitRetryMs(error);
  if (isReplicateRateLimitError(error) && error.retryAvailableAt) {
    const parsed = Date.parse(error.retryAvailableAt);
    if (Number.isFinite(parsed)) {
      return new Date(parsed + RATE_LIMIT_SAFETY_BUFFER_MS).toISOString();
    }
  }
  return new Date(Date.now() + retryMs + RATE_LIMIT_SAFETY_BUFFER_MS).toISOString();
}

function cooldownExpired(job: AsyncRenderJobRecord) {
  return job.status === 'rate_limited' &&
    (!job.retryAvailableAt || Date.parse(job.retryAvailableAt) <= Date.now());
}

function cooldownActive(job: AsyncRenderJobRecord) {
  return job.status === 'rate_limited' &&
    Boolean(job.retryAvailableAt && Date.parse(job.retryAvailableAt) > Date.now());
}

function errorCategory(error: unknown) {
  if (isRateLimitLike(error)) return 'rate_limited';
  if (isProviderOutputError(error)) return error.category;
  if (isAssetPersistenceError(error)) return 'asset_persistence';
  if (isSeedanceModerationError(error) || providerFallbackDiagnosticsFromError(error)) return 'moderation';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  return 'provider';
}

function creatorErrorMessage(error: unknown) {
  if (isAssetPersistenceError(error)) {
    return 'One reference image needs to be re-uploaded before Lumora can use it.';
  }
  if (isSeedanceModerationError(error) || providerFallbackDiagnosticsFromError(error)) {
    return 'This scene needs a simpler direction before rendering.';
  }
  if (isRateLimitLike(error)) {
    const seconds = rateLimitDelaySeconds(error);
    return seconds
      ? `Render queue is cooling down. Lumora will resume automatically in about ${seconds} seconds.`
      : 'Render queue is cooling down. Lumora will resume automatically.';
  }
  if (isProviderOutputError(error)) {
    return 'Provider completed without a usable video output.';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')) {
    return 'This scene is saved, but no video has completed yet.';
  }
  return message || 'Lumora paused this render.';
}

export function processAsyncRenderJob(jobId: string) {
  if (activeProcessors.has(jobId)) return;
  activeProcessors.add(jobId);

  void (async () => {
    let job = await getAsyncRenderJob(jobId);
    if (!job) {
      activeProcessors.delete(jobId);
      return;
    }
    const input = metadataInput(job);
    if (!input) {
      await markJobFailed({
        jobId,
        projectId: job.projectId,
        message: 'Lumora could not resume this render job.',
        category: 'metadata',
      });
      activeProcessors.delete(jobId);
      return;
    }

    let lockKey: string | null = null;
    let lockAcquired = false;

    try {
      lockKey = `render:${job.userId}`;
      if (activeRenderLocks.has(lockKey)) {
        activeProcessors.delete(jobId);
        setTimeout(() => processAsyncRenderJob(jobId), 2_000);
        return;
      }
      activeRenderLocks.add(lockKey);
      lockAcquired = true;
      await updateProjectStatus(job.projectId, 'rendering');
      const result = await createSeedanceGeneration({
        ...input,
        projectId: job.projectId,
        onPredictionCreated: (event) => updateProviderState({
          jobId,
          prediction: event.prediction,
          model: event.model,
          referenceCount: event.referenceImageCount,
          renderMode: event.renderingMode,
          providerFallbackStage: event.providerFallbackStage ?? event.attemptLabel,
        }),
        onPredictionPolled: (event) => updateProviderState({
          jobId,
          prediction: event.prediction,
          model: event.model,
          referenceCount: event.referenceImageCount,
          renderMode: event.renderingMode,
          providerFallbackStage: event.providerFallbackStage ?? event.attemptLabel,
        }),
      });

      job = await getAsyncRenderJob(jobId);
      await markJobCompleted({
        jobId,
        projectId: job?.projectId ?? null,
        providerJobId: result.providerJobId,
        providerStatus: 'succeeded',
        outputUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl,
        posterUrl: result.posterUrl,
        providerModel: result.model,
      });
      await updateProjectStatus(job?.projectId ?? null, 'completed');
    } catch (error) {
      job = await getAsyncRenderJob(jobId);
      const category = errorCategory(error);
      if (category === 'rate_limited') {
        await markJobRateLimited({
          jobId,
          projectId: job?.projectId ?? null,
          message: creatorErrorMessage(error),
          retryAfterSeconds: rateLimitDelaySeconds(error),
          retryAvailableAt: rateLimitAvailableAt(error),
        });
      } else {
        await markJobFailed({
          jobId,
          projectId: job?.projectId ?? null,
          message: creatorErrorMessage(error),
          category,
          status: category === 'timeout' ? 'paused' : 'failed',
        });
      }
    } finally {
      if (lockAcquired && lockKey) activeRenderLocks.delete(lockKey);
      activeProcessors.delete(jobId);
    }
  })();
}

export async function createAsyncSeedanceRenderJob(input: AsyncRenderJobInput) {
  if (!isUuidLike(input.userId)) {
    throw new Error('Sign in before rendering so Lumora can save your scene to Drafts.');
  }

  const activeJob = await findActiveRenderJob(input);
  if (activeJob) {
    duplicateRenderPreventedCount += 1;
    const retryReady = activeJob.status === 'rate_limited' &&
      (!activeJob.retryAvailableAt || Date.parse(activeJob.retryAvailableAt) <= Date.now());
    const job = retryReady ? await resumeRateLimitedJob(activeJob) : activeJob;
    if (job.providerPredictionId && job.status === 'rendering') {
      void pollRenderJob(job);
    } else if (job.status === 'queued' || job.status === 'rendering') {
      processAsyncRenderJob(job.id);
    }
    return {
      job,
      duplicateOf: job.id,
      message: job.status === 'rate_limited'
        ? formatRenderJobStatus(job).progressLabel
        : 'Lumora is already rendering this scene.',
    };
  }

  const projectId = await createRenderingProject(input);
  const job = await insertRenderJob(input, projectId);
  processAsyncRenderJob(job.id);

  return {
    job,
    duplicateOf: null,
    message: 'Lumora is rendering your scene.',
  };
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
  if (!/^https?:\/\//i.test(input.outputUrl)) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const head = await fetch(input.outputUrl, { method: 'HEAD', signal: controller.signal });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 403) return false;
  } catch {
    // Some signed video URLs reject HEAD; try a tiny GET before giving up.
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

async function finalizePredictionJob(job: AsyncRenderJobRecord, prediction: Prediction) {
  const input = metadataInput(job);
  const outputParse = parseProviderVideoOutput(prediction.output);
  if (!input) {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: 'Lumora could not resume this render job.',
      category: 'metadata',
    });
    return await getAsyncRenderJob(job.id) ?? job;
  }
  if (!outputParse.ok) {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: 'Provider completed without a usable video output.',
      category: outputParse.category,
    });
    return await getAsyncRenderJob(job.id) ?? job;
  }

  const persistence = await persistCompletedGeneration({
    userId: job.userId,
    id: prediction.id,
    projectId: job.projectId,
    title: input.title,
    prompt: input.prompt,
    finalPrompt: input.prompt,
    provider: 'replicate',
    engine: input.engine,
    model: job.providerModel ?? modelForQuality(input.quality),
    displayEngine: displayEngineForQuality(input.quality),
    videoUrl: outputParse.videoUrl,
    thumbnailUrl: null,
    characterId: input.characterId,
    characterName: input.characterName,
    characterAvatar: input.characterAvatar,
    isDefaultSelfCharacter: input.isDefaultSelfCharacter,
    durationSeconds: 5,
    aspectRatio: '16:9',
    privacy: 'private',
  });

  const persistedOutputParse = parseProviderVideoOutput(persistence.videoUrl);
  const outputVerified = persistedOutputParse.ok && await verifyOutputReachable({
    outputUrl: persistedOutputParse.videoUrl,
    storagePath: persistence.storagePath,
  });
  if (!outputVerified) {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: 'Provider completed without a usable video output.',
      category: persistedOutputParse.ok ? 'provider_output_unreachable' : persistedOutputParse.category,
    });
    return await getAsyncRenderJob(job.id) ?? job;
  }

  const completed = await markJobCompleted({
    jobId: job.id,
    projectId: job.projectId,
    providerJobId: prediction.id,
    providerStatus: prediction.status,
    outputUrl: persistedOutputParse.videoUrl,
    thumbnailUrl: persistence.thumbnailUrl,
    posterUrl: persistence.posterUrl,
    providerModel: job.providerModel ?? modelForQuality(input.quality),
  });
  await updateProjectStatus(job.projectId, 'completed');
  return completed ?? job;
}

export async function pollRenderJob(job: AsyncRenderJobRecord) {
  const completedWithOutput = job.status === 'completed' && parseProviderVideoOutput(job.outputUrl ?? job.resultAssetUrl).ok;
  if (job.status === 'rate_limited' || !job.providerPredictionId || completedWithOutput || job.status === 'failed') return job;
  if (job.timeoutAt && Date.parse(job.timeoutAt) < Date.now()) {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: 'This scene is saved, but no video has completed yet.',
      category: 'timeout',
      status: 'paused',
    });
    return await getAsyncRenderJob(job.id) ?? job;
  }

  const replicate = await replicateClient();
  if (!replicate) return job;

  let prediction: Prediction;
  try {
    prediction = await replicate.predictions.get(job.providerPredictionId);
  } catch (error) {
    if (!isRateLimitLike(error)) throw error;
    await markJobRateLimited({
      jobId: job.id,
      projectId: job.projectId,
      message: creatorErrorMessage(error),
      retryAfterSeconds: rateLimitDelaySeconds(error),
      retryAvailableAt: rateLimitAvailableAt(error),
    });
    return await getAsyncRenderJob(job.id) ?? job;
  }
  await updateProviderState({
    jobId: job.id,
    prediction,
    model: job.providerModel ?? modelForQuality(job.provider === 'seedance-quality' ? 'quality' : 'fast'),
    referenceCount: job.referenceCount ?? 0,
    renderMode: job.renderMode,
    providerFallbackStage: job.providerFallbackStage,
  });

  if (prediction.status === 'succeeded') {
    return finalizePredictionJob(job, prediction);
  }

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: typeof prediction.error === 'string' ? prediction.error : `Renderer ${prediction.status}.`,
      category: 'provider',
    });
  }

  return await getAsyncRenderJob(job.id) ?? job;
}

export async function getRenderJobStatus(jobId: string) {
  const job = await getAsyncRenderJob(jobId);
  if (!job) return null;

  if (cooldownExpired(job)) {
    const resumed = await resumeRateLimitedJob(job);
    if (resumed.providerPredictionId) {
      return formatRenderJobStatus(await pollRenderJob(resumed));
    }
    processAsyncRenderJob(resumed.id);
    return formatRenderJobStatus(await getAsyncRenderJob(resumed.id) ?? resumed);
  }

  if (job.status === 'queued' || (job.status === 'rendering' && !job.providerPredictionId)) {
    processAsyncRenderJob(job.id);
  }

  const refreshed = await pollRenderJob(job);
  return formatRenderJobStatus(refreshed);
}

export async function resumeAsyncRenderJob(jobId: string) {
  const job = await getAsyncRenderJob(jobId);
  if (!job) return null;

  if (cooldownActive(job)) return formatRenderJobStatus(job);
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'paused') {
    return formatRenderJobStatus(job);
  }

  const resumed = job.status === 'rate_limited' ? await resumeRateLimitedJob(job) : job;
  if (resumed.providerPredictionId) {
    return formatRenderJobStatus(await pollRenderJob(resumed));
  }

  if (resumed.status === 'queued' || resumed.status === 'rendering') {
    processAsyncRenderJob(resumed.id);
  }
  return formatRenderJobStatus(await getAsyncRenderJob(resumed.id) ?? resumed);
}

export async function resumeExpiredAsyncRenderCooldowns(limit = 5) {
  const result = await query<{ id: string }>(
    `select id
     from generation_jobs
     where status = 'rate_limited'
       and render_success_role is null
       and (retry_available_at is null or retry_available_at <= now())
     order by updated_at asc
     limit $1`,
    [Math.max(1, Math.min(20, Math.round(limit)))],
  );
  for (const row of result.rows) {
    await resumeAsyncRenderJob(row.id).catch(() => null);
  }
  return result.rows.length;
}

export function formatRenderJobStatus(job: AsyncRenderJobRecord) {
  const rawOutputUrl = job.outputUrl ?? job.resultAssetUrl;
  const outputParse = parseProviderVideoOutput(rawOutputUrl);
  const outputUrl = outputParse.ok ? outputParse.videoUrl : null;
  const status = job.status === 'completed' && !outputUrl
    ? 'failed'
    : job.status === 'processing'
      ? 'rendering'
      : job.status;
  const retrySeconds = job.retryAvailableAt
    ? Math.max(0, Math.ceil((Date.parse(job.retryAvailableAt) - Date.now()) / 1000))
    : job.retryAfterSeconds;
  const progressLabel =
    status === 'completed' && outputUrl
      ? 'Your cinematic draft is saved.'
      : status === 'rate_limited'
        ? retrySeconds && retrySeconds > 0
          ? `Render queue is cooling down. Lumora will resume automatically in about ${retrySeconds} seconds.`
          : 'Render queue is cooling down. Lumora will resume automatically.'
      : status === 'failed'
        ? 'Lumora paused this render.'
        : status === 'paused'
          ? 'This scene took longer than expected.'
          : job.providerPredictionId
            ? 'Rendering your cinematic take...'
            : 'Starting render...';

  return {
    id: job.id,
    jobId: job.id,
    projectId: job.projectId,
    status,
    providerStatus: job.providerStatus,
    progressLabel,
    engine: job.provider,
    provider: job.providerName ?? 'replicate',
    model: job.providerModel,
    providerJobId: job.providerJobId,
    providerPredictionId: job.providerPredictionId,
    providerPredictionUrl: job.providerPredictionUrl,
    prompt: job.prompt,
    outputUrl: outputUrl ?? '',
    videoUrl: outputUrl ?? '',
    thumbnailUrl: job.thumbnailUrl,
    error: job.errorMessage,
    errorMessage: job.errorMessage,
    errorCategory: job.errorCategory,
    renderMode: job.renderMode,
    providerFallbackStage: job.providerFallbackStage,
    referenceCount: job.referenceCount,
    retryAfterSeconds: retrySeconds ?? null,
    retryAvailableAt: job.retryAvailableAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function handleReplicateWebhookPayload(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const predictionId = typeof record.id === 'string' ? record.id : null;
  if (!predictionId) return { ok: false, updated: false, reason: 'missing_prediction_id' };

  const result = await query<Record<string, unknown>>(
    `select ${asyncRenderJobSelect}
     from generation_jobs
     where provider_prediction_id = $1
     order by created_at desc
     limit 1`,
    [predictionId],
  );
  const job = result.rows[0] ? mapRow(result.rows[0]) : null;
  if (!job) return { ok: true, updated: false, reason: 'job_not_found' };

  const prediction = record as unknown as Prediction;
  if (prediction.status === 'succeeded') {
    await finalizePredictionJob(job, prediction);
  } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await markJobFailed({
      jobId: job.id,
      projectId: job.projectId,
      message: typeof prediction.error === 'string' ? prediction.error : `Renderer ${prediction.status}.`,
      category: 'provider',
    });
  } else {
    await updateProviderState({
      jobId: job.id,
      prediction,
      model: job.providerModel ?? modelForQuality(job.provider === 'seedance-quality' ? 'quality' : 'fast'),
      referenceCount: job.referenceCount ?? 0,
      renderMode: job.renderMode,
      providerFallbackStage: job.providerFallbackStage,
    });
  }

  return { ok: true, updated: true, jobId: job.id };
}

export async function buildAsyncRenderJobDiagnostics() {
  try {
    await resumeExpiredAsyncRenderCooldowns().catch(() => 0);
    const result = await query<{
      pendingJobCount: number;
      renderingJobCount: number;
      stuckJobCount: number;
      jobsMissingProviderPredictionId: number;
      jobsRenderingOverExpectedDuration: number;
      replicateRateLimitedCount: number;
      lastRetryAfterSeconds: number | null;
    }>(
      `select
         count(*) filter (where status = 'queued')::int as "pendingJobCount",
         count(*) filter (where status in ('rendering', 'processing'))::int as "renderingJobCount",
         count(*) filter (
           where status in ('queued', 'rendering', 'processing')
             and timeout_at is not null
             and timeout_at < now()
         )::int as "stuckJobCount",
         count(*) filter (
           where status in ('rendering', 'processing')
             and provider_prediction_id is null
         )::int as "jobsMissingProviderPredictionId",
         count(*) filter (
           where status in ('rendering', 'processing')
             and coalesce(started_at, created_at) < now() - interval '30 minutes'
         )::int as "jobsRenderingOverExpectedDuration",
         count(*) filter (
           where status = 'rate_limited' or error_category = 'rate_limited'
         )::int as "replicateRateLimitedCount",
         (
           select retry_after_seconds
           from generation_jobs
           where error_category = 'rate_limited' or status = 'rate_limited'
           order by updated_at desc
           limit 1
         )::int as "lastRetryAfterSeconds"
       from generation_jobs`,
    );
    const row = result.rows[0] ?? {
      pendingJobCount: 0,
      renderingJobCount: 0,
      stuckJobCount: 0,
      jobsMissingProviderPredictionId: 0,
      jobsRenderingOverExpectedDuration: 0,
      replicateRateLimitedCount: 0,
      lastRetryAfterSeconds: null,
    };

    return {
      ok: row.stuckJobCount === 0,
      ...row,
      webhookConfigured: Boolean(env.REPLICATE_WEBHOOK_SECRET),
      pollerConfigured: true,
      activeInProcessJobs: activeProcessors.size,
      activeRenderLocks: activeRenderLocks.size,
      duplicateRenderPreventedCount,
    };
  } catch (error) {
    return {
      ok: false,
      pendingJobCount: 0,
      renderingJobCount: 0,
      stuckJobCount: 0,
      jobsMissingProviderPredictionId: 0,
      jobsRenderingOverExpectedDuration: 0,
      replicateRateLimitedCount: 0,
      lastRetryAfterSeconds: null,
      webhookConfigured: Boolean(env.REPLICATE_WEBHOOK_SECRET),
      pollerConfigured: false,
      activeInProcessJobs: activeProcessors.size,
      activeRenderLocks: activeRenderLocks.size,
      duplicateRenderPreventedCount,
      error: serializeDiagnosticError(error),
    };
  }
}
