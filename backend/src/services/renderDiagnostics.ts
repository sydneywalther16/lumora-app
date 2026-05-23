import { query } from './db';
import { env } from '../lib/env';
import { parseProviderVideoOutput } from './providerOutputParser';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { buildSeedanceCanarySummaryDiagnostics, getReferenceRouteSummary } from './seedanceCanary';
import {
  alternateLikenessProvidersConfigured,
  buildAlternateLikenessProviderCanaryStatus,
} from './likenessProviderCanary';

type LatestRenderRow = {
  id: string;
  userId: string | null;
  projectId: string | null;
  characterId: string | null;
  status: string;
  provider: string | null;
  providerPredictionId: string | null;
  providerStatus: string | null;
  providerModel: string | null;
  outputUrl: string | null;
  resultAssetUrl: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  retryAfterSeconds: number | null;
  retryAvailableAt: string | null;
  sceneMetadata: Record<string, unknown> | null;
  renderSuccessGroupId: string | null;
  renderSuccessRole: string | null;
  renderSuccessAttemptTier: number | null;
  renderSuccessReferenceCount: number | null;
  renderSuccessPaid: boolean | null;
  updatedAt: string;
  createdAt: string;
};

type AttemptSummaryRow = {
  count: number;
  paidAttemptsUsed: number;
  attemptsWithPrediction: number;
};

function redactMessage(value: string | null) {
  if (!value) return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 220);
}

function canaryProviderFailure(row: LatestRenderRow | null) {
  const metadata = row?.sceneMetadata?.seedanceCanary;
  if (!metadata || typeof metadata !== 'object') return null;
  const providerFailure = (metadata as Record<string, unknown>).providerFailure;
  if (!providerFailure || typeof providerFailure !== 'object') return null;
  const record = providerFailure as Record<string, unknown>;
  return {
    providerErrorCategory: typeof record.providerErrorCategory === 'string' ? record.providerErrorCategory : row?.errorCategory ?? null,
    providerErrorSummary: typeof record.providerErrorSummary === 'string' ? redactMessage(record.providerErrorSummary) : null,
    providerLogsExcerpt: typeof record.providerLogsExcerpt === 'string' ? redactMessage(record.providerLogsExcerpt) : null,
    predictionGetUrlHost: typeof record.predictionGetUrlHost === 'string' ? record.predictionGetUrlHost : null,
  };
}

function renderSuccessEngineMetadata(row: LatestRenderRow | null) {
  const metadata = row?.sceneMetadata?.renderSuccessEngine;
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

function textSelfGuidanceDiagnostics(row: LatestRenderRow | null) {
  const metadata = renderSuccessEngineMetadata(row);
  const descriptor = typeof metadata.textSelfGuidanceDescriptorPreview === 'string'
    ? metadata.textSelfGuidanceDescriptorPreview
    : typeof metadata.selfLikenessDescriptor === 'string'
      ? metadata.selfLikenessDescriptor
      : null;
  const selectedLikenessMode = metadata.selfLikenessIntensity === 'light' || metadata.selfLikenessIntensity === 'strong'
    ? metadata.selfLikenessIntensity
    : 'balanced';

  return {
    textSelfGuidanceAvailable: Boolean(metadata.textSelfGuidanceAvailable || descriptor),
    textSelfGuidanceDescriptorPreview: descriptor,
    selectedLikenessMode,
    alternateLikenessProvidersConfigured: alternateLikenessProvidersConfigured().map((provider) => provider.provider),
    alternateLikenessProviderCanaryStatus: buildAlternateLikenessProviderCanaryStatus(),
  };
}

function publishable(row: LatestRenderRow) {
  const parsed = parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl);
  return row.status === 'completed' && parsed.ok;
}

function cooldownExpired(row: Pick<LatestRenderRow, 'status' | 'retryAvailableAt'> | null) {
  if (!row || row.status !== 'rate_limited') return false;
  if (!row.retryAvailableAt) return true;
  const parsed = Date.parse(row.retryAvailableAt);
  return !Number.isFinite(parsed) || parsed <= Date.now();
}

function whyNotCompleted(row: LatestRenderRow, parsedOutputPresent: boolean) {
  if (row.status === 'completed' && parsedOutputPresent) return null;
  if (row.status === 'completed' && !parsedOutputPresent) return 'Provider/draft status is completed but no usable video URL is present.';
  if (row.status === 'rate_limited') return 'Render queue is cooling down; this is not a failed attempt.';
  if (row.status === 'queued') return 'Render job is queued and has not produced provider output yet.';
  if (row.status === 'rendering' || row.status === 'processing') return 'Provider render is still active or waiting to be polled.';
  if (row.status === 'paused') return row.errorCategory
    ? `Paused after ${row.errorCategory}.`
    : 'Paused before a verified video output was saved.';
  if (row.status === 'failed') return row.errorCategory
    ? `Failed after ${row.errorCategory}.`
    : 'Failed before a verified video output was saved.';
  return 'No verified video output has been saved yet.';
}

function whyPaused(row: LatestRenderRow, attemptRow: LatestRenderRow | null) {
  if (row.status !== 'paused' && row.status !== 'failed') return null;
  const category = row.errorCategory ?? attemptRow?.errorCategory ?? null;
  if (!category) return 'No failure category was recorded.';
  if (category === 'rate_limited') return 'Rate limit should remain cooling_down/rate_limited, not final paused.';
  if (category.includes('output')) return 'Provider did not return a usable video URL.';
  return `Final state reached after ${category}.`;
}

function nextResumeAction(row: LatestRenderRow, attemptRow: LatestRenderRow | null) {
  const active = attemptRow ?? row;
  if (active.status === 'rate_limited') {
    return cooldownExpired(active)
      ? 'resume_same_attempt_now'
      : 'wait_for_cooldown_then_resume_same_attempt';
  }
  if (active.status === 'queued') return 'start_or_resume_provider_attempt';
  if ((active.status === 'rendering' || active.status === 'processing') && active.providerPredictionId) {
    return 'poll_existing_provider_prediction';
  }
  if (active.status === 'rendering' || active.status === 'processing') {
    return 'create_provider_prediction_if_no_duplicate_active';
  }
  if (row.status === 'completed' && publishable(row)) return 'none_video_verified';
  if (row.status === 'paused' || row.status === 'failed') return 'manual_ultra_safe_or_new_render_required';
  return 'continue_success_ladder';
}

function nextAttemptPlanned(row: LatestRenderRow, attemptRow: LatestRenderRow | null, attemptsCount: number | null) {
  const active = attemptRow ?? row;
  if (active.status === 'rate_limited') return `retry tier ${active.renderSuccessAttemptTier ?? row.renderSuccessAttemptTier ?? 'current'} after cooldown`;
  if (active.status === 'rendering' || active.status === 'processing' || active.status === 'queued') return `continue tier ${active.renderSuccessAttemptTier ?? row.renderSuccessAttemptTier ?? 'current'}`;
  if (row.status === 'completed' && publishable(row)) return null;
  if (attemptsCount == null) return null;
  const nextTier = Math.min(5, attemptsCount + 1);
  return nextTier > attemptsCount ? `tier ${nextTier} if within safe budget` : null;
}

function referenceRouteRecommendation(input: {
  publishable: boolean;
  canaryEverSucceeded: boolean;
  seedanceReferenceRoutesBlocked?: boolean;
  successfulRoutes: unknown[];
  blockedRoutes: Array<{ failureCategory?: string | null }>;
  referenceCount: number | null;
}) {
  if (input.publishable) return 'none_video_verified';
  if (input.seedanceReferenceRoutesBlocked && input.canaryEverSucceeded) return 'configure alternate likeness provider';
  if (!input.canaryEverSucceeded) return 'Run text canary';
  if (input.successfulRoutes.length > 0 && (input.referenceCount ?? 0) > 0) {
    return 'Align Create Success First with successful reference route';
  }
  if (input.successfulRoutes.length > 0) return 'Use successful reference route';
  if (input.blockedRoutes.length > 0) {
    const category = input.blockedRoutes[0]?.failureCategory ?? 'reference_unknown_provider_failure';
    return `Reference route blocked: ${category}. Start text-only and test the next saved reference route.`;
  }
  return 'Run reference matrix canary';
}

export async function buildLastRenderDiagnostics() {
  try {
    const latest = await query<LatestRenderRow>(
      `select
         id,
         user_id as "userId",
         project_id as "projectId",
         character_id as "characterId",
         status,
         provider,
         provider_prediction_id as "providerPredictionId",
         provider_status as "providerStatus",
         provider_model as "providerModel",
         output_url as "outputUrl",
         result_asset_url as "resultAssetUrl",
         error_category as "errorCategory",
         error_message as "errorMessage",
         retry_after_seconds as "retryAfterSeconds",
         retry_available_at as "retryAvailableAt",
         scene_metadata as "sceneMetadata",
         render_success_group_id as "renderSuccessGroupId",
         render_success_role as "renderSuccessRole",
         render_success_attempt_tier as "renderSuccessAttemptTier",
         render_success_reference_count as "renderSuccessReferenceCount",
         render_success_paid as "renderSuccessPaid",
         updated_at as "updatedAt",
         created_at as "createdAt"
       from generation_jobs
       order by updated_at desc nulls last, created_at desc
       limit 1`,
    );
    const row = latest.rows[0] ?? null;
    if (!row) {
      const canarySummary = await buildSeedanceCanarySummaryDiagnostics();
      const referenceRouteSummary = await getReferenceRouteSummary({});
      const textGuidance = textSelfGuidanceDiagnostics(null);
      return {
        ok: true,
        latestGenerationJob: null,
        seedanceCanary: canarySummary,
        ...textGuidance,
        textOnlyCanarySucceeded: canarySummary.canaryEverSucceeded,
        referenceRouteState: referenceRouteSummary.state,
        seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
        chosenCreateRoute: referenceRouteSummary.seedanceReferenceRoutesBlocked ? 'text_only_success_first' : 'none',
        whyChosen: referenceRouteSummary.seedanceReferenceRoutesBlocked ? 'all Seedance self reference routes blocked' : 'No recent Create render found.',
        publishRequiresVerifiedOutput: true,
        continueStoryRequiresVerifiedOutput: true,
        knownSuccessfulReferenceRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
        knownBlockedReferenceRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
        referenceMatrixRecommendedNextAction: referenceRouteRecommendation({
          publishable: false,
          canaryEverSucceeded: canarySummary.canaryEverSucceeded,
          successfulRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
          blockedRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
          seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
          referenceCount: 0,
        }),
      };
    }

    const parsedOutput = parseProviderVideoOutput(row.outputUrl ?? row.resultAssetUrl);
    const canarySummary = await buildSeedanceCanarySummaryDiagnostics();
    const attempts = row.renderSuccessGroupId
      ? await query<AttemptSummaryRow>(
          `select
             count(*)::int as count,
             count(*) filter (where render_success_paid = true and provider_prediction_id is not null)::int as "paidAttemptsUsed",
             count(*) filter (where provider_prediction_id is not null)::int as "attemptsWithPrediction"
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
             user_id as "userId",
             project_id as "projectId",
             character_id as "characterId",
             status,
             provider,
             provider_prediction_id as "providerPredictionId",
             provider_status as "providerStatus",
             provider_model as "providerModel",
             output_url as "outputUrl",
             result_asset_url as "resultAssetUrl",
             error_category as "errorCategory",
             error_message as "errorMessage",
             retry_after_seconds as "retryAfterSeconds",
             retry_available_at as "retryAvailableAt",
             scene_metadata as "sceneMetadata",
             render_success_group_id as "renderSuccessGroupId",
             render_success_role as "renderSuccessRole",
             render_success_attempt_tier as "renderSuccessAttemptTier",
             render_success_reference_count as "renderSuccessReferenceCount",
             render_success_paid as "renderSuccessPaid",
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
    const activeRow = attemptRow ?? row;
    const attemptsSummary = attempts?.rows[0] ?? null;
    const parsedAttemptOutput = attemptRow
      ? parseProviderVideoOutput(attemptRow.outputUrl ?? attemptRow.resultAssetUrl)
      : null;
    const cooldownRow = activeRow.status === 'rate_limited' ? activeRow : row.status === 'rate_limited' ? row : null;
    const providerFailure = canaryProviderFailure(activeRow) ?? canaryProviderFailure(row);
    const textGuidance = textSelfGuidanceDiagnostics(row);
    const referenceRouteSummary = await getReferenceRouteSummary({
      userId: row.userId,
      characterId: row.characterId,
    });
    const referenceRouteNextAction = referenceRouteRecommendation({
      publishable: publishableValue,
      canaryEverSucceeded: canarySummary.canaryEverSucceeded,
      successfulRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
      blockedRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
      seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
      referenceCount: activeRow.renderSuccessReferenceCount ?? row.renderSuccessReferenceCount,
    });

    return {
      ok: true,
      latestGenerationJob: {
        id: row.id,
        currentJobId: activeRow.id,
        projectId: row.projectId,
        status: publishableValue ? row.status : row.status === 'completed' ? 'failed' : row.status,
        currentStatus: activeRow.status,
        provider: row.provider,
        currentAttemptProvider: activeRow.provider,
        providerPredictionId: row.providerPredictionId,
        providerPredictionIdExists: Boolean(activeRow.providerPredictionId ?? row.providerPredictionId),
        providerStatus: activeRow.providerStatus ?? row.providerStatus,
        providerModel: activeRow.providerModel ?? row.providerModel,
        retryAfterSeconds: activeRow.retryAfterSeconds ?? row.retryAfterSeconds,
        cooldownUntil: cooldownRow?.retryAvailableAt ?? null,
        retryAvailableAt: cooldownRow?.retryAvailableAt ?? null,
        cooldownExpired: cooldownExpired(cooldownRow),
        autoResumeEnabled: env.RENDER_SUCCESS_AUTO_RETRY,
        nextResumeAction: nextResumeAction(row, attemptRow),
        paidAttemptsUsed: attemptsSummary?.paidAttemptsUsed ?? (row.renderSuccessPaid && row.providerPredictionId ? 1 : 0),
        paidAttemptBudget: env.RENDER_SUCCESS_MAX_PAID_ATTEMPTS,
        outputUrlPresent: Boolean(row.outputUrl),
        resultAssetUrlPresent: Boolean(row.resultAssetUrl),
        parsedOutputUrlPresent: parsedOutput.ok,
        currentAttemptOutputUrlPresent: Boolean(attemptRow?.outputUrl ?? attemptRow?.resultAssetUrl),
        currentAttemptParsedOutputUrlPresent: parsedAttemptOutput?.ok ?? null,
        parsedOutputCategory: parsedOutput.category,
        lastAttemptTier: row.renderSuccessAttemptTier,
        attemptsCount: attemptsSummary?.count ?? null,
        attemptsWithPrediction: attemptsSummary?.attemptsWithPrediction ?? null,
        currentAttemptStatus: attemptRow?.status ?? null,
        currentAttemptNumber: attemptRow?.renderSuccessAttemptTier ?? null,
        currentAttemptTier: attemptRow?.renderSuccessAttemptTier ?? null,
        failureCategory: row.errorCategory ?? attemptRow?.errorCategory ?? null,
        failureMessageRedacted: redactMessage(row.errorMessage ?? attemptRow?.errorMessage ?? null),
        providerErrorCategory: providerFailure?.providerErrorCategory ?? row.errorCategory ?? attemptRow?.errorCategory ?? null,
        providerErrorSummary: providerFailure?.providerErrorSummary ?? null,
        providerLogsExcerpt: providerFailure?.providerLogsExcerpt ?? null,
        predictionGetUrlHost: providerFailure?.predictionGetUrlHost ?? null,
        publishable: publishableValue,
        continueStoryEligible: publishableValue,
        hasVerifiedVideoOutput: publishableValue,
        whyNotCompleted: whyNotCompleted(row, parsedOutput.ok),
        whyPaused: whyPaused(row, attemptRow),
        nextAttemptPlanned: nextAttemptPlanned(row, attemptRow, attemptsSummary?.count ?? null),
        canaryEverSucceeded: canarySummary.canaryEverSucceeded,
        ...textGuidance,
        textOnlyCanarySucceeded: canarySummary.canaryEverSucceeded,
        lastCanaryStatus: canarySummary.lastCanaryStatus,
        lastReferenceCanaryStatus: canarySummary.lastReferenceCanaryStatus,
        referenceRouteState: referenceRouteSummary.state,
        seedanceReferenceRoutesBlocked: referenceRouteSummary.seedanceReferenceRoutesBlocked,
        chosenCreateRoute: referenceRouteSummary.seedanceReferenceRoutesBlocked ? 'text_only_success_first' : activeRow.renderSuccessReferenceCount && activeRow.renderSuccessReferenceCount > 0 ? 'reference_images' : 'text_only_success_first',
        whyChosen: referenceRouteSummary.seedanceReferenceRoutesBlocked
          ? 'all Seedance self reference routes blocked'
          : activeRow.renderSuccessReferenceCount && activeRow.renderSuccessReferenceCount > 0
            ? 'Create used reference guidance after a successful route was available.'
            : 'No successful reference route exists, so Success First uses the proven text-only path.',
        publishRequiresVerifiedOutput: true,
        continueStoryRequiresVerifiedOutput: true,
        knownSuccessfulReferenceRoutes: referenceRouteSummary.knownSuccessfulReferenceRoutes,
        knownBlockedReferenceRoutes: referenceRouteSummary.knownBlockedReferenceRoutes,
        lastReferenceRouteFailureCategory: referenceRouteSummary.failureCategory,
        referenceMatrixRecommendedNextAction: referenceRouteNextAction,
        recommendedNextAction: canarySummary.recommendedNextAction,
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
