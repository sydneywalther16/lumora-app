import { query } from './db';
import { persistCompletedGeneration } from './generationPersistence';
import {
  generateSeedanceVideo,
  type SeedanceQualityMode,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';

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
  durationSeconds: 5;
  aspectRatio: '16:9';
  resolution: '720p';
  message: string;
  createdAt: string;
  projectId: string | null;
  storagePath: string | null;
  warnings: string[];
  finalPrompt: string;
  referenceImages: SeedanceReferenceImage[];
  referenceImageCount: number;
  multimodalReferenceMode: boolean;
  rawOutput: unknown;
};

export async function createSeedanceGeneration(input: {
  prompt: string;
  quality?: SeedanceQualityMode;
  userId?: string | null;
  title?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  referenceImages?: SeedanceReferenceImage[];
}): Promise<SeedanceGenerationRecord> {
  const result = await generateSeedanceVideo(input.prompt, {
    quality: input.quality,
    referenceImages: input.referenceImages,
  });
  const createdAt = new Date().toISOString();
  const persistence = await persistCompletedGeneration({
    userId: input.userId ?? null,
    id: result.id,
    title: input.title ?? null,
    prompt: input.prompt,
    finalPrompt: result.finalPrompt,
    provider: result.provider,
    engine: input.quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
    model: result.model,
    displayEngine: input.quality === 'quality' ? 'Seedance Quality' : 'Seedance Fast',
    videoUrl: result.videoUrl,
    thumbnailUrl: result.videoUrl,
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
}) {
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
       result_asset_url
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      input.characterId ?? null,
      input.durationSeconds ?? null,
      input.aspectRatio ?? null,
      input.privacy ?? 'private',
      input.resultAssetUrl ?? null,
    ],
  );

  return result.rows[0];
}

export async function listGenerationJobsForUser(userId: string) {
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
}

export async function updateGenerationJobStatus(input: {
  jobId: string;
  status: string;
  resultAssetUrl?: string | null;
  errorMessage?: string | null;
}) {
  const result = await query<GenerationRecord>(
    `update generation_jobs gj
     set
       status = $2,
       result_asset_url = coalesce($3, result_asset_url),
       error_message = $4,
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
       gj.created_at as "createdAt",
       gj.updated_at as "updatedAt"`,
    [input.jobId, input.status, input.resultAssetUrl ?? null, input.errorMessage ?? null],
  );

  return result.rows[0] ?? null;
}

export async function claimQueuedGenerationJob() {
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
}
