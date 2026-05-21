import { query } from './db';
import { parseProviderVideoOutput } from './providerOutputParser';
import { serializeDiagnosticError } from './schemaDiagnostics';

type LatestRenderRow = {
  id: string;
  projectId: string | null;
  status: string;
  provider: string | null;
  providerPredictionId: string | null;
  providerStatus: string | null;
  providerModel: string | null;
  outputUrl: string | null;
  resultAssetUrl: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  renderSuccessGroupId: string | null;
  renderSuccessRole: string | null;
  renderSuccessAttemptTier: number | null;
  renderSuccessReferenceCount: number | null;
  updatedAt: string;
  createdAt: string;
};

function redactMessage(value: string | null) {
  if (!value) return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 220);
}

function publishable(row: LatestRenderRow) {
  const parsed = parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl);
  return row.status === 'completed' && parsed.ok;
}

export async function buildLastRenderDiagnostics() {
  try {
    const latest = await query<LatestRenderRow>(
      `select
         id,
         project_id as "projectId",
         status,
         provider,
         provider_prediction_id as "providerPredictionId",
         provider_status as "providerStatus",
         provider_model as "providerModel",
         output_url as "outputUrl",
         result_asset_url as "resultAssetUrl",
         error_category as "errorCategory",
         error_message as "errorMessage",
         render_success_group_id as "renderSuccessGroupId",
         render_success_role as "renderSuccessRole",
         render_success_attempt_tier as "renderSuccessAttemptTier",
         render_success_reference_count as "renderSuccessReferenceCount",
         updated_at as "updatedAt",
         created_at as "createdAt"
       from generation_jobs
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const row = latest.rows[0] ?? null;
    if (!row) {
      return {
        ok: true,
        latestGenerationJob: null,
      };
    }

    const parsedOutput = parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl);
    const attempts = row.renderSuccessGroupId
      ? await query<{ count: number }>(
          `select count(*)::int as count
           from generation_jobs
           where render_success_group_id = $1
             and render_success_role = 'attempt'`,
          [row.renderSuccessGroupId],
        )
      : null;
    const currentAttempt = row.renderSuccessGroupId
      ? await query<LatestRenderRow>(
          `select
             id,
             project_id as "projectId",
             status,
             provider,
             provider_prediction_id as "providerPredictionId",
             provider_status as "providerStatus",
             provider_model as "providerModel",
             output_url as "outputUrl",
             result_asset_url as "resultAssetUrl",
             error_category as "errorCategory",
             error_message as "errorMessage",
             render_success_group_id as "renderSuccessGroupId",
             render_success_role as "renderSuccessRole",
             render_success_attempt_tier as "renderSuccessAttemptTier",
             render_success_reference_count as "renderSuccessReferenceCount",
             updated_at as "updatedAt",
             created_at as "createdAt"
           from generation_jobs
           where render_success_group_id = $1
             and render_success_role = 'attempt'
           order by updated_at desc nulls last, created_at desc
           limit 1`,
          [row.renderSuccessGroupId],
        )
      : null;
    const attemptRow = currentAttempt?.rows[0] ?? null;
    const publishableValue = publishable(row);

    return {
      ok: true,
      latestGenerationJob: {
        id: row.id,
        projectId: row.projectId,
        status: publishableValue ? row.status : row.status === 'completed' ? 'failed' : row.status,
        provider: row.provider,
        providerPredictionId: row.providerPredictionId,
        providerStatus: row.providerStatus,
        providerModel: row.providerModel,
        outputUrlPresent: Boolean(row.outputUrl),
        resultAssetUrlPresent: Boolean(row.resultAssetUrl),
        parsedOutputUrlPresent: parsedOutput.ok,
        parsedOutputCategory: parsedOutput.category,
        lastAttemptTier: row.renderSuccessAttemptTier,
        attemptsCount: attempts?.rows[0]?.count ?? null,
        currentAttemptStatus: attemptRow?.status ?? null,
        currentAttemptTier: attemptRow?.renderSuccessAttemptTier ?? null,
        failureCategory: row.errorCategory ?? attemptRow?.errorCategory ?? null,
        failureMessageRedacted: redactMessage(row.errorMessage ?? attemptRow?.errorMessage ?? null),
        publishable: publishableValue,
        continueStoryEligible: publishableValue,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      },
    };
  } catch (error) {
    return {
      ok: false,
      latestGenerationJob: null,
      error: serializeDiagnosticError(error),
    };
  }
}
