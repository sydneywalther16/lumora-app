import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import {
  persistSeedanceReferenceImages,
  type AssetPersistenceSummary,
} from './assetPersistence';
import {
  type SeedanceModerationDiagnostics,
  type SeedancePredictionEvent,
  type SeedanceAspectRatio,
  type SeedanceQualityMode,
  type SeedanceResolution,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';
import {
  generateSeedanceWithProviderFallback,
  type ProviderFallbackDiagnostics,
} from './providerFallbackOrchestrator';
import type {
  RenderSuccessMode,
  SceneOptimizationDiagnostics,
} from './sceneOptimization';

const optionalGenerationJobColumns = [
  'character_id',
  'duration_seconds',
  'aspect_ratio',
  'privacy',
  'scene_execution_id',
  'scene_id',
  'clip_order',
  'scene_metadata',
] as const;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function optionalGenerationSchemaError(error: unknown) {
  const record = recordValue(error);
  const text = [
    error instanceof Error ? error.message : '',
    stringValue(record.message),
    stringValue(record.code),
    stringValue(record.column),
  ].join(' ').toLowerCase();

  return (
    text.includes('42703') ||
    optionalGenerationJobColumns.some((column) => text.includes(column))
  ) && optionalGenerationJobColumns.some((column) => text.includes(column));
}

function warnOptionalGenerationSchemaFallback(operation: string, error: unknown) {
  console.warn('GENERATION JOB OPTIONAL SCHEMA FALLBACK:', {
    operation,
    missingMigration: 'Run Character Profiles / Scene Executor migrations in Supabase.',
    error: error instanceof Error ? error.message : error,
  });
}

function generationCharacterId(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export type GenerationRecord = {
  id: string;
  projectId: string | null;
  characterId: string | null;
  title: string;
  prompt: string;
  status: string;
  outputType: string;
  provider: string;
  durationSeconds: number | null;
  aspectRatio: string | null;
  privacy: string;
  resultAssetUrl: string | null;
  errorMessage: string | null;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
  sceneMetadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type SeedanceGenerationRecord = {
  id: string;
  jobId: string;
  status: 'completed';
  engine: 'seedance-2.0' | 'seedance-quality';
  provider: 'replicate';
  model: string;
  providerJobId: string;
  prompt: string;
  outputUrl: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  posterUrl: string | null;
  durationSeconds: number;
  aspectRatio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  message: string;
  createdAt: string;
  projectId: string | null;
  storagePath: string | null;
  warnings: string[];
  finalPrompt: string;
  referenceImages: SeedanceReferenceImage[];
  referenceImageCount: number;
  multimodalReferenceMode: boolean;
  assetPersistence?: AssetPersistenceSummary;
  moderationDiagnostics?: SeedanceModerationDiagnostics;
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics;
  sceneOptimization?: SceneOptimizationDiagnostics | null;
  renderReliability?: {
    complexityScore: number | null;
    referenceQualityScore: number | null;
    successMode: RenderSuccessMode | null;
    referenceStrategy: string | null;
    creatorMessage: string | null;
  } | null;
  suggestedPrompt?: string;
  sanitizedPrompt?: string;
  rawOutput: unknown;
};

export async function createSeedanceGeneration(input: {
  prompt: string;
  quality?: SeedanceQualityMode;
  userId?: string | null;
  projectId?: string | null;
  title?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  renderPreference?: RenderSuccessMode | string | null;
  referenceImages?: SeedanceReferenceImage[];
  durationSeconds?: number | null;
  onPredictionCreated?: (event: SeedancePredictionEvent) => void | Promise<void>;
  onPredictionPolled?: (event: SeedancePredictionEvent) => void | Promise<void>;
}): Promise<SeedanceGenerationRecord> {
  const persistedReferences = await persistSeedanceReferenceImages({
    userId: input.userId ?? null,
    characterId: input.characterId ?? null,
    referenceImages: input.referenceImages,
    usage: 'character_reference_image',
  });
  const result = await generateSeedanceWithProviderFallback({
    prompt: input.prompt,
    quality: input.quality,
    renderPreference: input.renderPreference,
    referenceImages: persistedReferences.referenceImages,
    userId: input.userId,
    characterId: input.characterId,
    characterName: input.characterName,
    projectId: input.projectId,
    durationSeconds: input.durationSeconds,
    onPredictionCreated: input.onPredictionCreated,
    onPredictionPolled: input.onPredictionPolled,
  });
  const createdAt = new Date().toISOString();
  const persistence = await persistCompletedGeneration({
    userId: input.userId ?? null,
    id: result.id,
    projectId: input.projectId ?? null,
    title: input.title ?? null,
    prompt: input.prompt,
    finalPrompt: result.finalPrompt,
    provider: result.provider,
    engine: input.quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
    model: result.model,
    displayEngine: input.quality === 'quality' ? 'Seedance Quality' : 'Seedance Fast',
    videoUrl: result.videoUrl,
    thumbnailUrl: null,
    characterId: input.characterId ?? null,
    characterName: input.characterName ?? null,
    characterAvatar: input.characterAvatar ?? null,
    isDefaultSelfCharacter: input.isDefaultSelfCharacter ?? null,
    durationSeconds: result.settings.duration,
    aspectRatio: result.settings.aspect_ratio,
  });

  return {
    id: result.id,
    jobId: result.id,
    status: 'completed',
    engine: input.quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
    provider: result.provider,
    model: result.model,
    providerJobId: result.providerJobId,
    prompt: result.finalPrompt,
    outputUrl: persistence.videoUrl,
    videoUrl: persistence.videoUrl,
    thumbnailUrl: null,
    posterUrl: null,
    durationSeconds: result.settings.duration,
    aspectRatio: result.settings.aspect_ratio,
    resolution: result.settings.resolution,
    message: 'Seedance 2.0 video generated successfully.',
    createdAt,
    projectId: persistence.projectId,
    storagePath: persistence.storagePath,
    warnings: [...result.warnings, ...persistence.warnings],
    finalPrompt: result.finalPrompt,
    referenceImages: result.referenceImages,
    referenceImageCount: result.referenceImageCount,
    multimodalReferenceMode: result.multimodalReferenceMode,
    assetPersistence: persistedReferences.summary,
    moderationDiagnostics: result.moderationDiagnostics,
    providerFallbackDiagnostics: result.providerFallbackDiagnostics,
    sceneOptimization: result.providerFallbackDiagnostics?.sceneOptimization ?? null,
    renderReliability: result.providerFallbackDiagnostics
      ? {
          complexityScore: result.providerFallbackDiagnostics.complexityScore ?? null,
          referenceQualityScore: result.providerFallbackDiagnostics.referenceQualityScore ?? null,
          successMode: result.providerFallbackDiagnostics.successMode ?? null,
          referenceStrategy: result.providerFallbackDiagnostics.referenceStrategy ?? null,
          creatorMessage: result.providerFallbackDiagnostics.creatorMessage ?? null,
        }
      : null,
    suggestedPrompt: result.suggestedPrompt,
    sanitizedPrompt: result.sanitizedPrompt,
    rawOutput: result.rawOutput,
  };
}

export async function createGenerationJob(input: {
  userId: string;
  projectId: string | null;
  provider: string;
  providerJobId?: string | null;
  outputType: 'image' | 'video';
  prompt: string;
  status: string;
  characterId?: string | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  privacy?: string;
  resultAssetUrl?: string | null;
  errorMessage?: string | null;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
  sceneMetadata?: Record<string, unknown> | null;
}) {
  try {
    const result = await query<GenerationRecord>(
      `insert into generation_jobs (
         user_id,
         project_id,
         provider,
         provider_job_id,
         output_type,
         prompt,
         status,
         character_id,
         duration_seconds,
         aspect_ratio,
         privacy,
         result_asset_url,
         error_message,
         scene_execution_id,
         scene_id,
         clip_order,
         scene_metadata
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
       returning
         id,
         project_id as "projectId",
         character_id as "characterId",
         '' as title,
         prompt,
         status,
         output_type as "outputType",
         provider,
         duration_seconds as "durationSeconds",
         aspect_ratio as "aspectRatio",
         privacy,
         result_asset_url as "resultAssetUrl",
         error_message as "errorMessage",
         scene_execution_id as "sceneExecutionId",
         scene_id as "sceneId",
         clip_order as "clipOrder",
         scene_metadata as "sceneMetadata",
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        input.userId,
        input.projectId,
        input.provider,
        input.providerJobId ?? null,
        input.outputType,
        input.prompt,
        input.status,
        generationCharacterId(input.characterId),
        input.durationSeconds ?? null,
        input.aspectRatio ?? null,
        input.privacy ?? 'private',
        input.resultAssetUrl ?? null,
        input.errorMessage ?? null,
        input.sceneExecutionId ?? null,
        input.sceneId ?? null,
        input.clipOrder ?? null,
        JSON.stringify(input.sceneMetadata ?? {}),
      ],
    );

    return result.rows[0];
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('createGenerationJob', error);
  }

  const fallback = await query<GenerationRecord>(
    `insert into generation_jobs (
       user_id,
       project_id,
       provider,
       provider_job_id,
       output_type,
       prompt,
       status,
       result_asset_url,
       error_message
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning
       id,
       project_id as "projectId",
       null::text as "characterId",
       '' as title,
       prompt,
       status,
       output_type as "outputType",
       provider,
       null::integer as "durationSeconds",
       null::text as "aspectRatio",
       'private'::text as privacy,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       null::text as "sceneExecutionId",
       null::text as "sceneId",
       null::integer as "clipOrder",
       null::jsonb as "sceneMetadata",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [
      input.userId,
      input.projectId,
      input.provider,
      input.providerJobId ?? null,
      input.outputType,
      input.prompt,
      input.status,
      input.resultAssetUrl ?? null,
      input.errorMessage ?? null,
    ],
  );

  return fallback.rows[0];
}

export async function listGenerationJobsForUser(userId: string) {
  try {
    const result = await query<GenerationRecord>(
      `select
         gj.id,
         gj.project_id as "projectId",
         gj.character_id as "characterId",
         coalesce(p.title, 'Untitled concept') as title,
         gj.prompt,
         gj.status,
         gj.output_type as "outputType",
         gj.provider,
         gj.duration_seconds as "durationSeconds",
         gj.aspect_ratio as "aspectRatio",
         gj.privacy,
         gj.result_asset_url as "resultAssetUrl",
         gj.error_message as "errorMessage",
         gj.scene_execution_id as "sceneExecutionId",
         gj.scene_id as "sceneId",
         gj.clip_order as "clipOrder",
         gj.scene_metadata as "sceneMetadata",
         gj.created_at as "createdAt",
         gj.updated_at as "updatedAt"
       from generation_jobs gj
       left join projects p on p.id = gj.project_id
       where gj.user_id = $1
       order by gj.created_at desc
       limit 50`,
      [userId],
    );

    return result.rows;
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('listGenerationJobsForUser', error);
  }

  const fallback = await query<GenerationRecord>(
    `select
       gj.id,
       gj.project_id as "projectId",
       null::text as "characterId",
       coalesce(p.title, 'Untitled concept') as title,
       gj.prompt,
       gj.status,
       gj.output_type as "outputType",
       gj.provider,
       null::integer as "durationSeconds",
       null::text as "aspectRatio",
       'private'::text as privacy,
       gj.result_asset_url as "resultAssetUrl",
       gj.error_message as "errorMessage",
       null::text as "sceneExecutionId",
       null::text as "sceneId",
       null::integer as "clipOrder",
       null::jsonb as "sceneMetadata",
       gj.created_at as "createdAt",
       gj.updated_at as "updatedAt"
     from generation_jobs gj
     left join projects p on p.id = gj.project_id
     where gj.user_id = $1
     order by gj.created_at desc
     limit 50`,
    [userId],
  );

  return fallback.rows;
}

export async function updateGenerationJobStatus(input: {
  jobId: string;
  status: string;
  providerJobId?: string | null;
  resultAssetUrl?: string | null;
  errorMessage?: string | null;
}) {
  const values = [
    input.jobId,
    input.status,
    input.providerJobId ?? null,
    input.resultAssetUrl ?? null,
    input.errorMessage ?? null,
  ];

  try {
    const result = await query<GenerationRecord>(
      `update generation_jobs gj
       set
         status = $2,
         provider_job_id = coalesce($3, provider_job_id),
         result_asset_url = coalesce($4, result_asset_url),
         error_message = $5,
         updated_at = now()
       where id = $1
       returning
         gj.id,
         gj.project_id as "projectId",
         gj.character_id as "characterId",
         '' as title,
         gj.prompt,
         gj.status,
         gj.output_type as "outputType",
         gj.provider,
         gj.duration_seconds as "durationSeconds",
         gj.aspect_ratio as "aspectRatio",
         gj.privacy,
         gj.result_asset_url as "resultAssetUrl",
         gj.error_message as "errorMessage",
         gj.scene_execution_id as "sceneExecutionId",
         gj.scene_id as "sceneId",
         gj.clip_order as "clipOrder",
         gj.scene_metadata as "sceneMetadata",
         gj.created_at as "createdAt",
         gj.updated_at as "updatedAt"`,
      values,
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('updateGenerationJobStatus', error);
  }

  const fallback = await query<GenerationRecord>(
    `update generation_jobs gj
     set
       status = $2,
       provider_job_id = coalesce($3, provider_job_id),
       result_asset_url = coalesce($4, result_asset_url),
       error_message = $5,
       updated_at = now()
     where id = $1
     returning
       gj.id,
       gj.project_id as "projectId",
       null::text as "characterId",
       '' as title,
       gj.prompt,
       gj.status,
       gj.output_type as "outputType",
       gj.provider,
       null::integer as "durationSeconds",
       null::text as "aspectRatio",
       'private'::text as privacy,
       gj.result_asset_url as "resultAssetUrl",
       gj.error_message as "errorMessage",
       null::text as "sceneExecutionId",
       null::text as "sceneId",
       null::integer as "clipOrder",
       null::jsonb as "sceneMetadata",
       gj.created_at as "createdAt",
       gj.updated_at as "updatedAt"`,
    values,
  );

  return fallback.rows[0] ?? null;
}

export async function updateGenerationJobSceneMetadata(input: {
  jobId: string;
  sceneMetadata: Record<string, unknown>;
}) {
  const values = [input.jobId, JSON.stringify(input.sceneMetadata)];

  try {
    const result = await query<GenerationRecord>(
      `update generation_jobs gj
       set
         scene_metadata = $2::jsonb,
         updated_at = now()
       where id = $1
       returning
         gj.id,
         gj.project_id as "projectId",
         gj.character_id as "characterId",
         '' as title,
         gj.prompt,
         gj.status,
         gj.output_type as "outputType",
         gj.provider,
         gj.duration_seconds as "durationSeconds",
         gj.aspect_ratio as "aspectRatio",
         gj.privacy,
         gj.result_asset_url as "resultAssetUrl",
         gj.error_message as "errorMessage",
         gj.scene_execution_id as "sceneExecutionId",
         gj.scene_id as "sceneId",
         gj.clip_order as "clipOrder",
         gj.scene_metadata as "sceneMetadata",
         gj.created_at as "createdAt",
         gj.updated_at as "updatedAt"`,
      values,
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('updateGenerationJobSceneMetadata', error);
  }

  try {
    const fallback = await query<GenerationRecord>(
      `update generation_jobs gj
       set
         scene_metadata = $2::jsonb,
         updated_at = now()
       where id = $1
       returning
         gj.id,
         gj.project_id as "projectId",
         null::text as "characterId",
         '' as title,
         gj.prompt,
         gj.status,
         gj.output_type as "outputType",
         gj.provider,
         null::integer as "durationSeconds",
         null::text as "aspectRatio",
         'private'::text as privacy,
         gj.result_asset_url as "resultAssetUrl",
         gj.error_message as "errorMessage",
         null::text as "sceneExecutionId",
         null::text as "sceneId",
         null::integer as "clipOrder",
         gj.scene_metadata as "sceneMetadata",
         gj.created_at as "createdAt",
         gj.updated_at as "updatedAt"`,
      values,
    );

    return fallback.rows[0] ?? null;
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('updateGenerationJobSceneMetadata.noop', error);
    return null;
  }
}

export async function claimQueuedGenerationJob() {
  try {
    const result = await query<GenerationRecord>(
      `update generation_jobs gj
       set
         status = 'processing',
         updated_at = now()
       where gj.id = (
         select id
         from generation_jobs
         where status = 'queued-demo'
         order by created_at asc
         for update skip locked
         limit 1
       )
       returning
         gj.id,
         gj.project_id as "projectId",
         gj.character_id as "characterId",
         '' as title,
         gj.prompt,
         gj.status,
         gj.output_type as "outputType",
         gj.provider,
         gj.duration_seconds as "durationSeconds",
         gj.aspect_ratio as "aspectRatio",
         gj.privacy,
         gj.result_asset_url as "resultAssetUrl",
         gj.error_message as "errorMessage",
         gj.created_at as "createdAt",
         gj.updated_at as "updatedAt"`,
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (!optionalGenerationSchemaError(error)) throw error;
    warnOptionalGenerationSchemaFallback('claimQueuedGenerationJob', error);
  }

  const fallback = await query<GenerationRecord>(
    `update generation_jobs gj
     set
       status = 'processing',
       updated_at = now()
     where gj.id = (
       select id
       from generation_jobs
       where status = 'queued-demo'
       order by created_at asc
       for update skip locked
       limit 1
     )
     returning
       gj.id,
       gj.project_id as "projectId",
       null::text as "characterId",
       '' as title,
       gj.prompt,
       gj.status,
       gj.output_type as "outputType",
       gj.provider,
       null::integer as "durationSeconds",
       null::text as "aspectRatio",
       'private'::text as privacy,
       gj.result_asset_url as "resultAssetUrl",
       gj.error_message as "errorMessage",
       gj.created_at as "createdAt",
       gj.updated_at as "updatedAt"`,
  );

  return fallback.rows[0] ?? null;
}
