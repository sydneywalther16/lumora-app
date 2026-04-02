import { query } from './db';

export type GenerationRecord = {
  id: string;
  projectId: string | null;
  status: string;
  outputType: string;
  provider: string;
  resultAssetUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function createGenerationJob(input: {
  userId: string;
  projectId: string | null;
  provider: string;
  providerJobId?: string | null;
  outputType: 'image' | 'video';
  prompt: string;
  status: string;
}) {
  const result = await query<GenerationRecord>(
    `insert into generation_jobs (user_id, project_id, provider, provider_job_id, output_type, prompt, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [input.userId, input.projectId, input.provider, input.providerJobId ?? null, input.outputType, input.prompt, input.status],
  );

  return result.rows[0];
}

export async function listGenerationJobsForUser(userId: string) {
  const result = await query<GenerationRecord>(
    `select
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"
     from generation_jobs
     where user_id = $1
     order by created_at desc
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
    `update generation_jobs
     set
       status = $2,
       result_asset_url = coalesce($3, result_asset_url),
       error_message = $4,
       updated_at = now()
     where id = $1
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [input.jobId, input.status, input.resultAssetUrl ?? null, input.errorMessage ?? null],
  );

  return result.rows[0] ?? null;
}

export async function claimQueuedGenerationJob() {
  const result = await query<GenerationRecord>(
    `update generation_jobs
     set status = 'processing', updated_at = now()
     where id = (
       select id from generation_jobs
       where status in ('queued', 'queued-demo')
       order by created_at asc
       for update skip locked
       limit 1
     )
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
  );

  return result.rows[0] ?? null;
}
