import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import {
  getAlternateExactLikenessProviderStatuses,
  persistAlternateExactLikenessCanaryResult,
  type AlternateExactLikenessProviderStatus,
} from '../alternateLikenessProviderMemory';
import { persistCompletedGeneration } from '../generationPersistence';
import { parseProviderVideoOutput } from '../providerOutputParser';
import { serializeDiagnosticError } from '../schemaDiagnostics';
import {
  falAuthorizationHeader,
  getConfiguredFalKey,
  getFalAccountStatus,
  isFalAccountBlockingKling,
  isFalBillingRequired,
  type FalAccountStatus,
} from './falAccountDiagnostics';
import {
  listSelfReferenceMatrixCandidates,
  verifyReferenceAssetAccess,
  type SelfReferenceMatrixCandidate,
} from '../seedanceCanary';
import { query } from '../db';

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
const KLING_REFERENCE_PROMPT =
  'Keep the referenced self character from @Element1 consistent while the character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft cinematic storybook style, gentle camera motion.';
const KLING_CANARY_STAGES = [
  'auth_probe_gate',
  'resolve_self_character',
  'load_references',
  'select_references',
  'sign_reference_urls',
  'build_payload',
  'create_attempt_record',
  'submit_fal_job',
  'poll_fal_job',
  'parse_output',
  'persist_verified_video',
] as const;

export type KlingCanaryVariant =
  | 'configured'
  | 'o1_reference_to_video'
  | 'o1_standard_reference_to_video'
  | 'elements_standard';

export type KlingReadinessStatus =
  | 'not_configured'
  | 'configured_not_implemented'
  | 'configured_ready_for_canary'
  | 'canary_succeeded'
  | 'canary_failed'
  | 'blocked'
  | 'provider_unavailable'
  | 'billing_required';

export type KlingCanaryStage = typeof KLING_CANARY_STAGES[number];

type KlingQueueSubmitResponse = {
  request_id?: string;
  requestId?: string;
  status_url?: string;
  response_url?: string;
  status?: string;
  [key: string]: unknown;
};

type KlingQueueStatusResponse = {
  status?: string;
  error?: unknown;
  logs?: unknown;
  output?: unknown;
  result?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

type KlingReferenceSet = {
  selected: SelfReferenceMatrixCandidate;
  frontalImageUrl: string;
  referenceImageUrls: string[];
  candidates: SelfReferenceMatrixCandidate[];
};

type KlingRecoveryRow = {
  userId: string | null;
  characterId: string | null;
  providerModel: string | null;
  referenceRole: string | null;
  referenceLabel: string | null;
  notes: unknown;
};

function redactKlingError(value: unknown) {
  const text = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : String(value ?? '');
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
    .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
    .slice(0, 1000);
}

export function classifyKlingFailure(input: {
  statusCode?: number | null;
  detail?: unknown;
}) {
  const detail = redactKlingError(input.detail);
  const lower = detail.toLowerCase();
  if (
    lower.includes('exhausted balance') ||
    lower.includes('user is locked') ||
    lower.includes('account locked') ||
    lower.includes('top up') ||
    lower.includes('billing required') ||
    lower.includes('insufficient credit') ||
    lower.includes('insufficient balance')
  ) {
    return { category: 'kling_billing_required', detail };
  }
  if (
    input.statusCode === 401 ||
    input.statusCode === 403 ||
    lower.includes('not permitted to perform this action') ||
    lower.includes('insufficient permissions') ||
    lower.includes('missing required scope') ||
    lower.includes('does not have permission')
  ) {
    return { category: 'kling_auth_or_scope_failed', detail };
  }
  if (
    input.statusCode === 404 ||
    lower.includes('model not found') ||
    lower.includes('endpoint not found') ||
    lower.includes('not found')
  ) {
    return { category: 'kling_model_not_found', detail };
  }
  if (input.statusCode === 429) {
    return { category: 'kling_rate_limited', detail };
  }
  if (
    input.statusCode === 502 ||
    input.statusCode === 503 ||
    input.statusCode === 504 ||
    lower.includes('temporarily unavailable') ||
    lower.includes('try again later') ||
    lower.includes('provider unavailable') ||
    lower.includes('upstream unavailable') ||
    lower.includes('timeout') ||
    lower.includes('rate limit')
  ) {
    return { category: 'kling_provider_unavailable', detail };
  }
  if (
    lower.includes('safety') ||
    lower.includes('moderation') ||
    lower.includes('policy') ||
    lower.includes('flagged') ||
    lower.includes('sensitive')
  ) {
    return { category: 'kling_moderation_block', detail };
  }
  if (
    input.statusCode === 400 ||
    input.statusCode === 422 ||
    lower.includes('invalid') ||
    lower.includes('schema') ||
    lower.includes('unknown field') ||
    lower.includes('missing required') ||
    lower.includes('validation')
  ) {
    return { category: 'kling_input_schema', detail };
  }
  if (
    lower.includes('image url') ||
    lower.includes('asset') ||
    lower.includes('download') ||
    lower.includes('fetch') ||
    lower.includes('not reachable') ||
    lower.includes('403') ||
    lower.includes('404')
  ) {
    return { category: 'kling_asset_access', detail };
  }
  return { category: 'kling_provider_failed', detail };
}

export function buildKlingReferenceToVideoPayload(input: {
  frontalImageUrl: string;
  referenceImageUrls?: string[];
  prompt?: string;
}) {
  const references = (input.referenceImageUrls ?? [])
    .filter((url) => url && url !== input.frontalImageUrl)
    .slice(0, 3);
  return {
    prompt: input.prompt ?? KLING_REFERENCE_PROMPT,
    image_urls: [input.frontalImageUrl],
    elements: [{
      frontal_image_url: input.frontalImageUrl,
      reference_image_urls: references,
    }],
    duration: '5',
    aspect_ratio: '9:16',
  };
}

function outputShapeSummary(output: unknown) {
  if (Array.isArray(output)) return `array(${output.length})`;
  if (output && typeof output === 'object') {
    return `object(${Object.keys(output as Record<string, unknown>).slice(0, 8).join(',')})`;
  }
  return typeof output;
}

function providerResponseShapeSummary(value: unknown) {
  if (!value || typeof value !== 'object') return { type: typeof value, fieldNames: [] as string[] };
  if (Array.isArray(value)) return { type: 'array', length: value.length, fieldNames: [] as string[] };
  return {
    type: 'object',
    fieldNames: Object.keys(value as Record<string, unknown>).sort(),
  };
}

function redactFalUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return redactKlingError(value);
  }
}

function configuredModel() {
  return env.KLING_REFERENCE_MODEL || env.KLING_ELEMENTS_MODEL || env.KLING_MODEL || null;
}

export function modelForVariant(variant: KlingCanaryVariant | null | undefined, configured: string | null) {
  if (!variant || variant === 'configured') return configured;
  if (variant === 'o1_reference_to_video') return 'fal-ai/kling-video/o1/reference-to-video';
  if (variant === 'o1_standard_reference_to_video') return 'fal-ai/kling-video/o1/standard/reference-to-video';
  if (variant === 'elements_standard') return env.KLING_ELEMENTS_MODEL || 'fal-ai/kling-video/v1.6/standard/elements';
  return configured;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function falErrorMessage(value: unknown) {
  const record = recordValue(value);
  const error = recordValue(record.error);
  const detail = record.detail ?? record.message ?? error.message ?? record.error;
  if (typeof detail === 'string') return redactKlingError(detail);
  return redactKlingError(detail || value);
}

function falErrorType(value: unknown) {
  const record = recordValue(value);
  const error = recordValue(record.error);
  const candidate = record.type ?? record.code ?? record.status ?? error.type ?? error.code;
  return typeof candidate === 'string' || typeof candidate === 'number'
    ? String(candidate)
    : null;
}

export function klingPayloadShapeSummary(payload: unknown) {
  const record = recordValue(payload);
  const prompt = typeof record.prompt === 'string' ? record.prompt : '';
  return {
    imageUrlsCount: Array.isArray(record.image_urls) ? record.image_urls.length : 0,
    elementsCount: Array.isArray(record.elements) ? record.elements.length : 0,
    hasPrompt: Boolean(prompt.trim()),
    promptTokenStyle: prompt.includes('@Element1')
      ? '@Element1'
      : prompt.includes('@Image1')
        ? '@Image1'
        : prompt.includes('[Image1]')
          ? '[Image1]'
          : 'none',
    fieldNames: Object.keys(record).sort(),
    privateUrlsRedacted: true,
  };
}

export function getKlingProviderReadiness(input: {
  statuses?: Array<{
    provider: string;
    status: string;
    lastFailureCategory?: string | null;
    providerModel?: string | null;
    providerJobCreated?: boolean | null;
  }> | null;
  falAccountStatus?: FalAccountStatus | null;
} = {}) {
  const model = configuredModel();
  const falKey = getConfiguredFalKey();
  const configured = Boolean(env.KLING_ENABLED && falKey.key && model);
  const provider = (env.KLING_PROVIDER ?? 'fal').toLowerCase();
  const implemented = provider === 'fal';
  const stored = input.statuses?.find((status) => status.provider === 'kling_reference') ?? null;
  const lastFailureCategory = stored?.lastFailureCategory ?? null;
  const falAccountAllowsCanary = input.falAccountStatus && !isFalAccountBlockingKling(input.falAccountStatus);
  const storedFailureCreatedProviderJob = stored?.providerJobCreated === true;
  const status: KlingReadinessStatus = !configured
    ? 'not_configured'
    : !implemented
      ? 'configured_not_implemented'
    : stored?.status === 'canary_succeeded'
      ? 'canary_succeeded'
    : lastFailureCategory === 'kling_billing_required' && falAccountAllowsCanary
      ? 'configured_ready_for_canary'
    : stored?.status === 'canary_failed' && !storedFailureCreatedProviderJob && falAccountAllowsCanary
      ? 'configured_ready_for_canary'
    : input.falAccountStatus && isFalBillingRequired(input.falAccountStatus)
      ? 'billing_required'
    : lastFailureCategory === 'kling_moderation_block'
      ? 'blocked'
    : lastFailureCategory === 'kling_billing_required'
      ? 'billing_required'
    : lastFailureCategory === 'kling_provider_unavailable'
      ? 'provider_unavailable'
    : stored?.status === 'canary_failed' && storedFailureCreatedProviderJob
      ? 'canary_failed'
      : 'configured_ready_for_canary';

  return {
    provider: 'kling_reference',
    displayName: 'Kling reference route',
    configured,
    enabled: env.KLING_ENABLED,
    apiKeyConfigured: Boolean(falKey.key),
    falKeySource: falKey.source,
    providerTransport: provider,
    model: env.KLING_MODEL ?? null,
    referenceModel: env.KLING_REFERENCE_MODEL ?? null,
    elementsModel: env.KLING_ELEMENTS_MODEL ?? null,
    selectedModel: model,
    status,
    implemented,
    canarySucceeded: status === 'canary_succeeded',
    canaryFailed: status === 'canary_failed' || status === 'blocked' || status === 'provider_unavailable',
    recommendedNextAction: !configured
      ? 'Set KLING_ENABLED=true, FAL_KEY or KLING_API_KEY, and KLING_REFERENCE_MODEL to test Kling likeness.'
      : !implemented
        ? 'Kling provider is configured, but only KLING_PROVIDER=fal is implemented.'
      : status === 'canary_succeeded'
        ? 'Kling canary succeeded; router may use it for exact likeness.'
      : status === 'blocked'
        ? 'Kling route was blocked by provider safety. Keep soft self guidance or test another provider.'
      : status === 'billing_required'
        ? 'Fal billing requires attention. Run fal account diagnostics, add credits if needed, then retry Kling.'
      : status === 'provider_unavailable'
        ? 'Kling provider was temporarily unavailable. Retry later if you want to spend another canary attempt.'
      : status === 'canary_failed'
        ? 'Inspect the last Kling canary failure before production routing.'
        : 'Run the Kling likeness canary before production routing.',
  };
}

function storedKlingStatus(statuses: AlternateExactLikenessProviderStatus[] | null | undefined) {
  return statuses?.find((status) => status.provider === 'kling_reference') ?? null;
}

export function shouldReturnStoredKlingCanaryStatus(input: {
  stored?: AlternateExactLikenessProviderStatus | null;
  forceRetest?: boolean;
}) {
  const stored = input.stored ?? null;
  if (!stored) return false;
  if (
    stored.providerJobCreated === true &&
    (stored.lastFailureCategory === 'kling_poll_pending' || stored.lastFailureCategory === 'kling_poll_failed')
  ) {
    return true;
  }
  if (input.forceRetest) return false;
  if (stored.lastFailureCategory === 'kling_billing_required') return false;
  if (stored.lastFailureCategory === 'kling_moderation_block') return true;
  return stored.status === 'canary_failed' && Boolean(stored.lastFailureCategory) && stored.providerJobCreated === true;
}

function storedKlingStatusReason(stored: AlternateExactLikenessProviderStatus) {
  if (stored.lastFailureCategory === 'kling_poll_pending' || stored.lastFailureCategory === 'kling_poll_failed') {
    return 'A Kling provider job already exists but was not recovered yet. Run the Kling recovery script before starting another paid canary.';
  }
  if (stored.lastFailureCategory === 'kling_moderation_block') {
    return 'Kling route was previously blocked by provider safety. Use ForceRetest only if you intentionally want another paid attempt.';
  }
  return 'Kling has a stored canary failure. Use ForceRetest if you intentionally want a fresh paid canary attempt.';
}

function storedKlingStatusPayload(input: {
  readiness: ReturnType<typeof getKlingProviderReadiness>;
  stored: AlternateExactLikenessProviderStatus;
  reason: string;
}) {
  return {
    ok: false,
    provider: 'kling',
    route: 'kling_reference',
    configured: input.readiness.configured,
    readinessStatus: input.readiness.status,
    canaryStatus: input.readiness.status,
    selectedModel: input.readiness.selectedModel,
    outputUrlPresent: input.stored.outputUrlPresent,
    parsedVideoUrlPresent: false,
    verifiedVideoPresent: false,
    verifiedPersistedVideo: false,
    providerJobCreated: false,
    providerJobCreatedStored: input.stored.providerJobCreated ?? null,
    attemptId: input.stored.attemptId ?? null,
    providerJobId: input.stored.providerJobId ?? null,
    requestId: input.stored.providerJobId ?? null,
    providerJobIdPresent: Boolean(input.stored.providerJobId),
    skipStage: input.stored.lastFailureCategory === 'kling_poll_pending' || input.stored.lastFailureCategory === 'kling_poll_failed'
      ? 'poll_fal_job'
      : null,
    skipReason: input.stored.lastFailureCategory === 'kling_poll_pending'
      ? 'existing_provider_job_pending_recovery'
      : input.stored.lastFailureCategory === 'kling_poll_failed'
        ? 'existing_provider_job_poll_failed'
        : null,
    storedStatusReturned: true,
    freshCanaryAttemptCreated: false,
    attemptMode: 'returning_stored_status',
    lastFailureCategory: input.stored.lastFailureCategory,
    failureCategory: input.stored.lastFailureCategory ?? 'kling_canary_stored_status',
    recommendedNextAction: input.reason,
  };
}

function stageStatus(input: {
  completed?: KlingCanaryStage[];
  active?: KlingCanaryStage | null;
  failed?: KlingCanaryStage | null;
}) {
  const completed = new Set(input.completed ?? []);
  return Object.fromEntries(KLING_CANARY_STAGES.map((stage) => {
    if (input.failed === stage) return [stage, 'failed'];
    if (input.active === stage) return [stage, 'in_progress'];
    if (completed.has(stage)) return [stage, 'completed'];
    return [stage, 'pending'];
  }));
}

function safeProviderSummary(value: unknown, fallback: string) {
  const redacted = redactKlingError(value);
  return redacted.trim() ? redacted : fallback;
}

function stoppedBeforeFalSummary(stage: KlingCanaryStage, reason: string) {
  return `Kling canary stopped before fal submission at ${stage}: ${reason}.`;
}

function stageFailureSummary(stage: KlingCanaryStage, reason: string, providerJobCreated?: boolean) {
  if (providerJobCreated || KLING_CANARY_STAGES.indexOf(stage) >= KLING_CANARY_STAGES.indexOf('poll_fal_job')) {
    if (stage === 'poll_fal_job') {
      return `Kling provider job was created, but Lumora failed while polling fal job status: ${reason}.`;
    }
    if (stage === 'parse_output') {
      return `Kling provider job was created, but Lumora could not parse a verified video output: ${reason}.`;
    }
    if (stage === 'persist_verified_video') {
      return `Kling provider job was created and returned output, but Lumora could not persist the verified video: ${reason}.`;
    }
    return `Kling provider job was created, but Lumora failed at ${stage}: ${reason}.`;
  }
  return stoppedBeforeFalSummary(stage, reason);
}

function readinessStatusForFailure(failureCategory: string, fallback: KlingReadinessStatus) {
  if (failureCategory === 'kling_billing_required') return 'billing_required';
  if (failureCategory === 'kling_provider_unavailable') return 'provider_unavailable';
  if (failureCategory === 'kling_moderation_block') return 'blocked';
  return fallback;
}

function canaryStatusForFailure(failureCategory: string) {
  if (failureCategory === 'kling_billing_required') return 'billing_required';
  return 'canary_failed';
}

export function buildKlingStageFailurePayload(input: {
  readiness?: ReturnType<typeof getKlingProviderReadiness> | null;
  selectedModel?: string | null;
  failureCategory: string;
  skipStage: KlingCanaryStage;
  skipReason: string;
  completedStages?: KlingCanaryStage[];
  attemptId?: string | null;
  attemptCreated?: boolean;
  providerJobCreated?: boolean;
  forceRetest?: boolean;
  storedIgnored?: boolean;
  forceRetestHonored?: boolean;
  configured?: boolean;
  providerErrorSummary?: unknown;
  recommendedNextAction: string;
  extras?: Record<string, unknown>;
}) {
  const summary = safeProviderSummary(
    input.providerErrorSummary,
    stageFailureSummary(input.skipStage, input.skipReason, input.providerJobCreated),
  );
  return {
    ok: false,
    provider: 'kling',
    route: 'kling_reference',
    configured: input.configured ?? input.readiness?.configured ?? true,
    readinessStatus: readinessStatusForFailure(input.failureCategory, input.readiness?.status ?? 'canary_failed'),
    canaryStatus: canaryStatusForFailure(input.failureCategory),
    selectedModel: input.selectedModel ?? input.readiness?.selectedModel ?? null,
    attemptId: input.attemptId ?? null,
    attemptCreated: Boolean(input.attemptCreated),
    providerJobCreated: Boolean(input.providerJobCreated),
    providerJobIdPresent: Boolean(input.providerJobCreated),
    providerStatus: null,
    storedStatusReturned: false,
    freshCanaryAttemptCreated: Boolean(input.attemptCreated),
    attemptMode: 'provider_call_failed_before_job',
    forceRetestRequested: Boolean(input.forceRetest),
    forceRetestHonored: Boolean(input.forceRetestHonored ?? input.forceRetest),
    storedStatusIgnored: Boolean(input.storedIgnored),
    reasonIfNotHonored: input.forceRetest && input.forceRetestHonored === false ? input.skipReason : null,
    skipStage: input.skipStage,
    skipReason: input.skipReason,
    stageStatus: stageStatus({
      completed: input.completedStages,
      failed: input.skipStage,
    }),
    outputUrlPresent: false,
    parsedVideoUrlPresent: false,
    verifiedVideoPresent: false,
    verifiedPersistedVideo: false,
    failureCategory: input.failureCategory,
    providerErrorSummary: summary,
    recommendedNextAction: input.recommendedNextAction,
    ...(input.extras ?? {}),
  };
}

function valueFromError(error: unknown, key: string) {
  const record = recordValue(error);
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

export function buildKlingPreJobFailureDiagnostics(input: {
  error: unknown;
  selectedModel: string;
  payload: unknown;
}) {
  const failureCategory = typeof valueFromError(input.error, 'failureCategory') === 'string'
    ? String(valueFromError(input.error, 'failureCategory'))
    : 'kling_client_exception';
  const falHttpStatus = typeof valueFromError(input.error, 'falHttpStatus') === 'number'
    ? Number(valueFromError(input.error, 'falHttpStatus'))
    : typeof valueFromError(input.error, 'statusCode') === 'number'
      ? Number(valueFromError(input.error, 'statusCode'))
      : null;
  const providerErrorSummary = safeProviderSummary(
    typeof valueFromError(input.error, 'failureDetail') === 'string'
      ? valueFromError(input.error, 'failureDetail')
      : serializeDiagnosticError(input.error),
    'Kling canary failed during fal job submission before a provider job id was returned.',
  );
  const endpointUsed = typeof valueFromError(input.error, 'endpointUsed') === 'string'
    ? String(valueFromError(input.error, 'endpointUsed'))
    : queueUrl(input.selectedModel);
  const payloadShapeSummary = recordValue(valueFromError(input.error, 'payloadShapeSummary'));
  return {
    failureCategory,
    falHttpStatus,
    falErrorType: typeof valueFromError(input.error, 'falErrorType') === 'string'
      ? String(valueFromError(input.error, 'falErrorType'))
      : null,
    falErrorMessage: typeof valueFromError(input.error, 'falErrorMessage') === 'string'
      ? String(valueFromError(input.error, 'falErrorMessage'))
      : providerErrorSummary,
    falErrorBodyRedacted: typeof valueFromError(input.error, 'falErrorBodyRedacted') === 'string'
      ? String(valueFromError(input.error, 'falErrorBodyRedacted'))
      : providerErrorSummary,
    endpointUsed,
    modelSlug: typeof valueFromError(input.error, 'modelSlug') === 'string'
      ? String(valueFromError(input.error, 'modelSlug'))
      : input.selectedModel,
    payloadShapeSummary: Object.keys(payloadShapeSummary).length > 0
      ? payloadShapeSummary
      : klingPayloadShapeSummary(input.payload),
    providerErrorSummary,
  };
}

function preJobErrorPayload(input: {
  error: unknown;
  readiness: ReturnType<typeof getKlingProviderReadiness>;
  selectedModel: string;
  payload: unknown;
  referenceSet: KlingReferenceSet;
  attemptId: string;
  forceRetest?: boolean;
  storedIgnored: boolean;
  completedStages: KlingCanaryStage[];
}) {
  const diagnostics = buildKlingPreJobFailureDiagnostics({
    error: input.error,
    selectedModel: input.selectedModel,
    payload: input.payload,
  });
  const failureCategory = diagnostics.failureCategory;
  return buildKlingStageFailurePayload({
    readiness: input.readiness,
    selectedModel: input.selectedModel,
    failureCategory,
    skipStage: 'submit_fal_job',
    skipReason: diagnostics.falErrorMessage || diagnostics.providerErrorSummary || failureCategory,
    completedStages: input.completedStages,
    attemptId: input.attemptId,
    attemptCreated: true,
    forceRetest: input.forceRetest,
    storedIgnored: input.storedIgnored,
    providerErrorSummary: diagnostics.providerErrorSummary,
    recommendedNextAction: failureCategory === 'kling_model_not_found'
      ? 'The configured Kling/fal model slug was not found. Try a supported variant such as o1_standard_reference_to_video.'
      : failureCategory === 'kling_input_schema'
        ? 'Fal rejected the Kling payload before job creation. Inspect payload shape and try another Kling variant.'
      : failureCategory === 'kling_auth_or_scope_failed'
        ? 'Check the fal inference key permissions in Render. Do not paste the key into scripts or chat.'
      : failureCategory === 'kling_rate_limited'
        ? 'Fal rate-limited this request. Wait before retrying the Kling canary.'
      : failureCategory === 'kling_billing_required'
        ? 'Fal billing requires attention. Run fal account diagnostics, add credits if needed, then retry Kling.'
      : failureCategory === 'kling_provider_unavailable'
        ? 'Fal or Kling was unavailable before job creation. Retry later.'
      : failureCategory === 'kling_client_exception'
        ? 'The backend could not reach fal or submit the request. Check network/provider availability and retry later.'
        : 'Kling job creation failed before fal returned a job id. Inspect the redacted fal error and model slug.',
    extras: {
    falHttpStatus: diagnostics.falHttpStatus,
    falErrorType: diagnostics.falErrorType,
    falErrorMessage: diagnostics.falErrorMessage,
    falErrorBodyRedacted: diagnostics.falErrorBodyRedacted,
    endpointUsed: diagnostics.endpointUsed,
    modelSlug: diagnostics.modelSlug,
    payloadShapeSummary: diagnostics.payloadShapeSummary,
    referenceCount: input.referenceSet.candidates.length,
    selectedReferenceRole: input.referenceSet.selected.referenceRole,
    selectedReferenceLabel: input.referenceSet.selected.referenceLabel,
    verificationVideoUsed: false,
    },
  });
}

export function buildKlingPollFailurePayload(input: {
  readiness?: ReturnType<typeof getKlingProviderReadiness> | null;
  selectedModel: string;
  attemptId?: string | null;
  providerJobId?: string | null;
  providerStatusUrl?: string | null;
  pollEndpointUsed?: string | null;
  error: unknown;
  completedStages?: KlingCanaryStage[];
  forceRetest?: boolean;
  storedIgnored?: boolean;
  referenceCount?: number | null;
  selectedReferenceRole?: string | null;
  selectedReferenceLabel?: string | null;
}) {
  const pollErrorMessage = safeProviderSummary(
    typeof valueFromError(input.error, 'failureDetail') === 'string'
      ? valueFromError(input.error, 'failureDetail')
      : serializeDiagnosticError(input.error),
    'Fal polling failed before Lumora could retrieve the Kling job status.',
  );
  return buildKlingStageFailurePayload({
    readiness: input.readiness ?? null,
    selectedModel: input.selectedModel,
    failureCategory: 'kling_poll_failed',
    skipStage: 'poll_fal_job',
    skipReason: 'internal_exception',
    completedStages: input.completedStages,
    attemptId: input.attemptId ?? null,
    attemptCreated: Boolean(input.attemptId),
    providerJobCreated: true,
    forceRetest: input.forceRetest,
    storedIgnored: input.storedIgnored,
    providerErrorSummary: pollErrorMessage,
    recommendedNextAction: 'Recover or poll the existing Kling job before starting another canary.',
    extras: {
      pollErrorType: input.error instanceof Error ? input.error.name : typeof input.error,
      pollErrorMessage,
      providerJobId: input.providerJobId ?? null,
      requestId: input.providerJobId ?? null,
      providerJobIdPresent: Boolean(input.providerJobId),
      providerStatusUrl: input.providerStatusUrl ?? null,
      pollEndpointUsed: input.pollEndpointUsed ?? (
        input.providerJobId ? queueUrl(input.selectedModel, `/requests/${encodeURIComponent(input.providerJobId)}/status`) : null
      ),
      referenceCount: input.referenceCount ?? null,
      selectedReferenceRole: input.selectedReferenceRole ?? null,
      selectedReferenceLabel: input.selectedReferenceLabel ?? null,
      verificationVideoUsed: false,
    },
  });
}

function requestId(response: KlingQueueSubmitResponse) {
  return response.request_id ?? response.requestId ?? (
    typeof response.id === 'string' ? response.id : null
  );
}

function queueUrl(model: string, suffix = '') {
  return `${FAL_QUEUE_BASE_URL}/${model}${suffix}`;
}

async function falJson<T>(input: {
  path: string;
  method: string;
  body?: unknown;
  modelSlug?: string | null;
}) {
  const falKey = getConfiguredFalKey();
  if (!falKey.key) {
    throw Object.assign(new Error('fal key missing'), {
      failureCategory: 'not_configured',
      failureDetail: 'fal key missing',
    });
  }
  const response = await fetch(input.path, {
    method: input.method,
    headers: {
      Authorization: falAuthorizationHeader(falKey.key),
      'Content-Type': 'application/json',
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const failure = classifyKlingFailure({
      statusCode: response.status,
      detail: payload,
    });
    throw Object.assign(new Error(failure.detail || 'Kling API request failed.'), {
      statusCode: response.status,
      failureCategory: failure.category,
      failureDetail: failure.detail,
      falHttpStatus: response.status,
      falErrorType: falErrorType(payload),
      falErrorMessage: falErrorMessage(payload),
      falErrorBodyRedacted: redactKlingError(payload),
      endpointUsed: input.path,
      modelSlug: input.modelSlug ?? null,
      payloadShapeSummary: input.body === undefined ? null : klingPayloadShapeSummary(input.body),
    });
  }

  return payload as T;
}

async function submitKlingQueueRequest(input: {
  model: string;
  payload: unknown;
}) {
  return falJson<KlingQueueSubmitResponse>({
    path: queueUrl(input.model),
    method: 'POST',
    body: input.payload,
    modelSlug: input.model,
  });
}

async function retrieveKlingQueueStatus(input: {
  model: string;
  requestId: string;
}) {
  return falJson<KlingQueueStatusResponse>({
    path: queueUrl(input.model, `/requests/${encodeURIComponent(input.requestId)}/status`),
    method: 'GET',
    modelSlug: input.model,
  });
}

async function retrieveKlingQueueResult(input: {
  model: string;
  requestId: string;
}) {
  return falJson<KlingQueueStatusResponse>({
    path: queueUrl(input.model, `/requests/${encodeURIComponent(input.requestId)}`),
    method: 'GET',
    modelSlug: input.model,
  });
}

function terminalKlingStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'COMPLETED' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'FAILED' ||
    normalized === 'CANCELED' ||
    normalized === 'CANCELLED';
}

function succeededKlingStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'COMPLETED' || normalized === 'SUCCEEDED';
}

function klingStatusFromResponse(response: KlingQueueStatusResponse | null | undefined) {
  if (!response) return null;
  if (typeof response.status === 'string') return response.status;
  if (response.completed === true) return 'COMPLETED';
  return null;
}

async function pollKlingQueue(input: {
  model: string;
  requestId: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 180_000);
  let latest = await retrieveKlingQueueStatus(input);

  while (!terminalKlingStatus(klingStatusFromResponse(latest)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    latest = await retrieveKlingQueueStatus(input);
  }

  if (succeededKlingStatus(klingStatusFromResponse(latest))) {
    return retrieveKlingQueueResult(input);
  }
  return latest;
}

function rankReference(candidate: SelfReferenceMatrixCandidate) {
  const role = candidate.referenceRole;
  if (role === 'front_angle') return 0;
  if (role === 'side_angle_left') return 1;
  if (role === 'side_angle_right') return 2;
  if (role === 'full_body') return 3;
  return 4;
}

function selectReferenceSet(candidates: SelfReferenceMatrixCandidate[]): KlingReferenceSet | null {
  const sorted = [...candidates].sort((a, b) => rankReference(a) - rankReference(b));
  const selected = sorted[0] ?? null;
  if (!selected) return null;
  return {
    selected,
    frontalImageUrl: selected.reference.url,
    referenceImageUrls: sorted
      .map((candidate) => candidate.reference.url)
      .filter((url) => url && url !== selected.reference.url)
      .slice(0, 3),
    candidates: sorted.slice(0, 4),
  };
}

async function verifyReferenceSet(referenceSet: KlingReferenceSet) {
  const checked = [];
  for (const candidate of referenceSet.candidates) {
    const access = await verifyReferenceAssetAccess(candidate.reference.url);
    checked.push({
      role: candidate.referenceRole,
      label: candidate.referenceLabel,
      reachable: access.reachable,
      status: access.status,
      contentType: access.contentType,
      host: access.host,
      error: access.error,
    });
    if (!access.reachable) return { ok: false as const, checked };
  }
  return { ok: true as const, checked };
}

export function providerOutputFromKlingResult(result: KlingQueueStatusResponse) {
  return result.output ?? result.result ?? result.data ?? result;
}

export function parseKlingQueueVideoOutput(result: KlingQueueStatusResponse) {
  return parseProviderVideoOutput(providerOutputFromKlingResult(result));
}

export function createKlingCanaryAttemptMarker(input: {
  selectedModel: string;
  variant?: KlingCanaryVariant | null;
}) {
  return {
    attemptId: `kling-canary-${randomUUID()}`,
    selectedModel: input.selectedModel,
    variant: input.variant ?? 'configured',
    createdAt: new Date().toISOString(),
  };
}

function submittedJobNotes(input: {
  attempt: ReturnType<typeof createKlingCanaryAttemptMarker>;
  jobId: string;
  submitted: KlingQueueSubmitResponse;
  payload: unknown;
  referenceSet?: KlingReferenceSet | null;
}) {
  return {
    attemptId: input.attempt.attemptId,
    attemptCreated: true,
    providerJobCreated: true,
    providerJobId: input.jobId,
    requestId: input.jobId,
    providerStatus: input.submitted.status ?? null,
    providerStatusUrl: redactFalUrl(input.submitted.status_url),
    providerResponseUrl: redactFalUrl(input.submitted.response_url),
    providerCancelUrlPresent: Boolean(input.submitted.cancel_url),
    providerResponseShape: providerResponseShapeSummary(input.submitted),
    payloadShapeSummary: klingPayloadShapeSummary(input.payload),
    referenceCount: input.referenceSet?.candidates.length ?? null,
    verificationVideoUsed: false,
  };
}

export function buildKlingSubmittedJobNotesForTest(input: {
  attemptId?: string;
  jobId: string;
  submitted: KlingQueueSubmitResponse;
  payload: unknown;
}) {
  return submittedJobNotes({
    attempt: {
      attemptId: input.attemptId ?? 'kling-canary-test',
      selectedModel: 'test-model',
      variant: 'configured',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    jobId: input.jobId,
    submitted: input.submitted,
    payload: input.payload,
    referenceSet: null,
  });
}

async function persistKlingSubmittedJob(input: {
  userId?: string | null;
  characterId?: string | null;
  selectedModel: string;
  referenceSet: KlingReferenceSet;
  attempt: ReturnType<typeof createKlingCanaryAttemptMarker>;
  jobId: string;
  submitted: KlingQueueSubmitResponse;
  payload: unknown;
}) {
  await persistAlternateExactLikenessCanaryResult({
    userId: input.userId ?? input.referenceSet.selected.userId,
    characterId: input.characterId ?? input.referenceSet.selected.characterId,
    provider: 'kling_reference',
    providerModel: input.selectedModel,
    referenceRole: input.referenceSet.selected.referenceRole,
    referenceLabel: input.referenceSet.selected.referenceLabel,
    succeeded: false,
    failureCategory: 'kling_poll_pending',
    providerErrorCategory: 'kling_poll_pending',
    outputUrlPresent: false,
    notes: submittedJobNotes({
      attempt: input.attempt,
      jobId: input.jobId,
      submitted: input.submitted,
      payload: input.payload,
      referenceSet: input.referenceSet,
    }),
  });
}

function notesRecord(value: unknown) {
  return recordValue(value);
}

function noteString(notes: unknown, key: string) {
  const value = notesRecord(notes)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function findRecoverableKlingAttempt(input: {
  userId?: string | null;
  attemptId?: string | null;
  providerJobId?: string | null;
}) {
  const result = await query<KlingRecoveryRow>(
    `select
       user_id as "userId",
       character_id as "characterId",
       provider_model as "providerModel",
       reference_strategy as "referenceRole",
       notes->>'referenceLabel' as "referenceLabel",
       notes
     from render_success_memory
     where render_mode = 'exact_likeness_provider_canary'
       and provider in ('kling_reference', 'kling')
       and lower(coalesce(notes->>'providerJobCreated', 'false')) = 'true'
       and lower(coalesce(notes->>'outputUrlPresent', 'false')) <> 'true'
       and ($1::uuid is null or user_id = $1)
       and ($2::text is null or notes->>'attemptId' = $2)
       and (
         $3::text is null
         or notes->>'providerJobId' = $3
         or notes->>'requestId' = $3
       )
     order by updated_at desc
     limit 1`,
    [
      input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.userId)
        ? input.userId
        : null,
      input.attemptId ?? null,
      input.providerJobId ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function buildKlingProviderShapeDiagnostics(input: {
  userId?: string | null;
  variant?: KlingCanaryVariant;
} = {}) {
  const [statuses, falAccount] = await Promise.all([
    getAlternateExactLikenessProviderStatuses({
      userId: input.userId ?? null,
      characterId: null,
    }),
    getFalAccountStatus(),
  ]);
  const readiness = getKlingProviderReadiness({ statuses, falAccountStatus: falAccount });
  const selectedModel = modelForVariant(input.variant, readiness.selectedModel);
  const matrix = await listSelfReferenceMatrixCandidates({
    userId: input.userId ?? null,
    referenceRole: 'all',
  }).catch((error) => ({
    candidates: [],
    sourcesChecked: [],
    sourceErrors: [serializeDiagnosticError(error)],
  }));
  const referenceSet = selectReferenceSet(matrix.candidates);
  const fallbackReference = 'https://redacted.lumora.local/reference.jpg';
  const payload = buildKlingReferenceToVideoPayload({
    frontalImageUrl: fallbackReference,
    referenceImageUrls: referenceSet
      ? referenceSet.referenceImageUrls.map((_url, index) => `https://redacted.lumora.local/reference-${index + 2}.jpg`)
      : [],
  });
  const stored = storedKlingStatus(statuses);
  return {
    ok: true,
    provider: 'kling',
    route: 'kling_reference',
    variant: input.variant ?? 'configured',
    configured: readiness.configured,
    providerTransport: readiness.providerTransport,
    configuredModelSlug: readiness.selectedModel,
    selectedModelSlug: selectedModel,
    falEndpointPath: selectedModel ? `/${selectedModel}` : null,
    falEndpointUrl: selectedModel ? `${FAL_QUEUE_BASE_URL}/${selectedModel}` : null,
    expectedPayloadFieldNames: Object.keys(payload).sort(),
    selectedReferenceRoles: referenceSet
      ? referenceSet.candidates.map((candidate) => candidate.referenceRole)
      : [],
    referenceCount: referenceSet?.candidates.length ?? 0,
    usesElements: true,
    promptTokenStyle: klingPayloadShapeSummary(payload).promptTokenStyle,
    canaryReadiness: readiness.status,
    lastFailureCategory: stored?.lastFailureCategory ?? null,
    payloadShapeSummary: klingPayloadShapeSummary(payload),
    privateUrlsRedacted: true,
    readiness,
  };
}

export async function recoverKlingSelfLikenessCanary(input: {
  userId?: string | null;
  attemptId?: string | null;
  providerJobId?: string | null;
  saveAsDraft?: boolean;
} = {}) {
  const [statuses, falAccount] = await Promise.all([
    getAlternateExactLikenessProviderStatuses({
      userId: input.userId ?? null,
      characterId: null,
    }),
    getFalAccountStatus(),
  ]);
  const readiness = getKlingProviderReadiness({ statuses, falAccountStatus: falAccount });
  let row: KlingRecoveryRow | null = null;
  try {
    row = await findRecoverableKlingAttempt({
      userId: input.userId ?? null,
      attemptId: input.attemptId ?? null,
      providerJobId: input.providerJobId ?? null,
    });
  } catch (error) {
    if (!input.providerJobId) {
      return buildKlingStageFailurePayload({
        readiness,
        selectedModel: readiness.selectedModel,
        failureCategory: 'kling_poll_failed',
        skipStage: 'poll_fal_job',
        skipReason: 'recoverable_attempt_lookup_failed',
        completedStages: ['auth_probe_gate'],
        providerErrorSummary: serializeDiagnosticError(error),
        recommendedNextAction: 'Pass a providerJobId from the canary response, or fix render_success_memory diagnostics before recovery.',
      });
    }
  }

  const notes = row?.notes ?? {};
  const selectedModel = row?.providerModel || readiness.selectedModel || configuredModel();
  const providerJobId = input.providerJobId ?? noteString(notes, 'providerJobId') ?? noteString(notes, 'requestId');
  const attemptId = input.attemptId ?? noteString(notes, 'attemptId') ?? null;
  if (!selectedModel || !providerJobId) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_poll_failed',
      skipStage: 'poll_fal_job',
      skipReason: 'recoverable_provider_job_not_found',
      completedStages: ['auth_probe_gate'],
      providerErrorSummary: 'No recoverable Kling provider job id was found.',
      recommendedNextAction: 'Run a Kling canary only when you intend to spend a new attempt, or pass a providerJobId from the previous response.',
    });
  }

  let finalJob: KlingQueueStatusResponse;
  try {
    finalJob = await pollKlingQueue({
      model: selectedModel,
      requestId: providerJobId,
    });
  } catch (error) {
    return buildKlingPollFailurePayload({
      readiness,
      selectedModel,
      attemptId,
      providerJobId,
      providerStatusUrl: noteString(notes, 'providerStatusUrl'),
      pollEndpointUsed: queueUrl(selectedModel, `/requests/${encodeURIComponent(providerJobId)}/status`),
      error,
      completedStages: ['auth_probe_gate', 'submit_fal_job'],
      referenceCount: null,
      selectedReferenceRole: row?.referenceRole ?? null,
      selectedReferenceLabel: row?.referenceLabel ?? null,
    });
  }

  const providerStatus = klingStatusFromResponse(finalJob);
  const output = providerOutputFromKlingResult(finalJob);
  const parsedOutput = parseProviderVideoOutput(output);
  const recoveredOutputFailureReason = 'reason' in parsedOutput ? parsedOutput.reason : null;
  if (!succeededKlingStatus(providerStatus) || !parsedOutput.ok) {
    const failureCategory = succeededKlingStatus(providerStatus)
      ? 'kling_recover_output_missing'
      : classifyKlingFailure({ detail: finalJob.error ?? finalJob }).category;
    await persistAlternateExactLikenessCanaryResult({
      userId: row?.userId ?? input.userId ?? null,
      characterId: row?.characterId ?? null,
      provider: 'kling_reference',
      providerModel: selectedModel,
      referenceRole: row?.referenceRole ?? 'recovered_provider_job',
      referenceLabel: row?.referenceLabel ?? 'Recovered Kling provider job',
      succeeded: false,
      failureCategory,
      providerErrorCategory: failureCategory,
      outputUrlPresent: false,
      notes: {
        ...notesRecord(notes),
        attemptId,
        providerJobCreated: true,
        providerJobId,
        requestId: providerJobId,
        providerStatus,
        recoveryAttempted: true,
        outputShapeSummary: outputShapeSummary(output),
      },
    });
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      recovery: true,
      selectedModel,
      attemptId,
      providerJobCreated: true,
      providerJobId,
      requestId: providerJobId,
      providerJobIdPresent: true,
      providerStatus,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      failureCategory,
      canaryStatus: 'canary_failed',
      skipStage: 'parse_output',
      skipReason: recoveredOutputFailureReason ?? 'provider_job_not_completed',
      outputShapeSummary: outputShapeSummary(output),
      providerErrorSummary: failureCategory === 'kling_recover_output_missing'
        ? `Recovered Kling job did not contain a usable video output: ${recoveredOutputFailureReason ?? 'output missing'}`
        : safeProviderSummary(finalJob.error ?? finalJob, `Recovered Kling job status was ${providerStatus ?? 'unknown'}.`),
      recommendedNextAction: 'Do not start another Kling canary yet unless you intend to spend a new provider attempt.',
    };
  }

  const persisted = await persistCompletedGeneration({
    userId: row?.userId ?? input.userId ?? null,
    id: `kling-recover-${providerJobId}`,
    title: 'Kling likeness recovery',
    prompt: KLING_REFERENCE_PROMPT,
    finalPrompt: KLING_REFERENCE_PROMPT,
    provider: 'kling',
    engine: 'kling',
    model: selectedModel,
    videoUrl: parsedOutput.videoUrl,
    thumbnailUrl: null,
    characterId: row?.characterId ?? null,
    characterName: null,
    characterAvatar: null,
    isDefaultSelfCharacter: true,
    durationSeconds: 5,
    aspectRatio: '9:16',
    privacy: input.saveAsDraft ? 'private' : 'private',
  });

  await persistAlternateExactLikenessCanaryResult({
    userId: row?.userId ?? input.userId ?? null,
    characterId: row?.characterId ?? null,
    provider: 'kling_reference',
    providerModel: selectedModel,
    referenceRole: row?.referenceRole ?? 'recovered_provider_job',
    referenceLabel: row?.referenceLabel ?? 'Recovered Kling provider job',
    succeeded: true,
    outputUrlPresent: true,
    notes: {
      ...notesRecord(notes),
      attemptId,
      providerJobCreated: true,
      providerJobId,
      requestId: providerJobId,
      providerStatus,
      recoveryAttempted: true,
      outputUrlPresent: true,
      verifiedPersistedVideo: Boolean(persisted.storagePath || persisted.projectId || parsedOutput.videoUrl),
    },
  });

  return {
    ok: true,
    provider: 'kling',
    route: 'kling_reference',
    recovery: true,
    selectedModel,
    attemptId,
    providerJobCreated: true,
    providerJobId,
    requestId: providerJobId,
    providerJobIdPresent: true,
    providerStatus,
    outputUrlPresent: true,
    parsedVideoUrlPresent: true,
    verifiedVideoPresent: true,
    verifiedPersistedVideo: Boolean(persisted.storagePath || persisted.projectId || parsedOutput.videoUrl),
    failureCategory: null,
    canaryStatus: 'kling_recover_succeeded',
    projectId: persisted.projectId,
    storagePathPresent: Boolean(persisted.storagePath),
    recommendedNextAction: 'Kling recovery succeeded. Lumora can treat this provider route as canary-proven after production enablement.',
  };
}

export async function startKlingSelfLikenessCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
  forceRetest?: boolean;
  variant?: KlingCanaryVariant;
} = {}) {
  const completedStages: KlingCanaryStage[] = [];
  let statuses: AlternateExactLikenessProviderStatus[] = [];
  let falAccount: FalAccountStatus;
  try {
    [statuses, falAccount] = await Promise.all([
      getAlternateExactLikenessProviderStatuses({
        userId: input.userId ?? null,
        characterId: null,
      }),
      getFalAccountStatus(),
    ]);
    completedStages.push('auth_probe_gate');
  } catch (error) {
    return buildKlingStageFailurePayload({
      selectedModel: null,
      configured: false,
      failureCategory: 'kling_internal_preflight_failed',
      skipStage: 'auth_probe_gate',
      skipReason: 'auth_or_memory_probe_failed',
      completedStages,
      forceRetest: input.forceRetest,
      forceRetestHonored: false,
      providerErrorSummary: serializeDiagnosticError(error),
      recommendedNextAction: 'Kling could not complete its local auth/memory probe. Check backend diagnostics before retrying.',
    });
  }
  const readiness = getKlingProviderReadiness({ statuses, falAccountStatus: falAccount });
  const selectedModel = modelForVariant(input.variant, readiness.selectedModel);
  const stored = storedKlingStatus(statuses);

  if (!readiness.configured || !selectedModel) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'not_configured',
      skipStage: 'auth_probe_gate',
      skipReason: 'provider_not_configured',
      completedStages,
      forceRetest: input.forceRetest,
      forceRetestHonored: false,
      providerErrorSummary: 'Kling provider is not configured with an enabled fal key and model.',
      recommendedNextAction: readiness.recommendedNextAction,
    });
  }

  if (!readiness.implemented) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'configured_not_implemented',
      skipStage: 'auth_probe_gate',
      skipReason: 'provider_transport_not_implemented',
      completedStages,
      forceRetest: input.forceRetest,
      forceRetestHonored: false,
      providerErrorSummary: 'Kling provider is configured, but the selected transport is not implemented.',
      recommendedNextAction: readiness.recommendedNextAction,
    });
  }

  if (isFalAccountBlockingKling(falAccount)) {
    const failureCategory = isFalBillingRequired(falAccount)
      ? 'kling_billing_required'
      : falAccount.errorCategory;
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory,
      skipStage: 'auth_probe_gate',
      skipReason: 'blocked_by_fal_account_status',
      completedStages,
      forceRetest: input.forceRetest,
      forceRetestHonored: false,
      providerErrorSummary: falAccount.errorSummary,
      recommendedNextAction: falAccount.recommendedNextAction,
      extras: {
        falAccountStatus: {
          falKeyPresent: falAccount.falKeyPresent,
          falKeySource: falAccount.falKeySource,
          authOk: falAccount.authOk,
          balancePresent: falAccount.balancePresent,
          balanceAmount: falAccount.balanceAmount,
          balanceCurrency: falAccount.balanceCurrency,
          locked: falAccount.locked,
          billingRequired: falAccount.billingRequired,
          errorCategory: falAccount.errorCategory,
        },
      },
    });
  }

  if (shouldReturnStoredKlingCanaryStatus({ stored, forceRetest: input.forceRetest })) {
    return storedKlingStatusPayload({
      readiness: stored?.lastFailureCategory === 'kling_moderation_block'
        ? { ...readiness, status: 'blocked' }
        : readiness,
      stored: stored!,
      reason: storedKlingStatusReason(stored!),
    });
  }

  completedStages.push('resolve_self_character');

  let matrix: Awaited<ReturnType<typeof listSelfReferenceMatrixCandidates>>;
  try {
    matrix = await listSelfReferenceMatrixCandidates({
      userId: input.userId ?? null,
      referenceRole: 'all',
    });
    completedStages.push('load_references');
  } catch (error) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_internal_preflight_failed',
      skipStage: 'load_references',
      skipReason: 'reference_matrix_load_failed',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: serializeDiagnosticError(error),
      recommendedNextAction: 'Lumora could not load saved self references. Check reference storage diagnostics before retrying Kling.',
    });
  }
  const referenceSet = selectReferenceSet(matrix.candidates);
  if (!referenceSet) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_no_references',
      skipStage: 'select_references',
      skipReason: 'no_saved_self_reference',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      recommendedNextAction: 'Open Create or Characters and re-save the self reference photos to Lumora storage, then rerun the Kling canary.',
      extras: {
        sourcesChecked: matrix.sourcesChecked,
        sourceErrors: matrix.sourceErrors,
      },
    });
  }
  completedStages.push('select_references');

  let access: Awaited<ReturnType<typeof verifyReferenceSet>>;
  try {
    access = await verifyReferenceSet(referenceSet);
  } catch (error) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_asset_access',
      skipStage: 'sign_reference_urls',
      skipReason: 'reference_asset_signing_or_access_failed',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: serializeDiagnosticError(error),
      recommendedNextAction: 'A saved Lumora reference could not be signed or checked. Repair references before testing Kling again.',
      extras: {
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
      },
    });
  }
  if (!access.ok) {
    await persistAlternateExactLikenessCanaryResult({
      userId: referenceSet.selected.userId,
      characterId: referenceSet.selected.characterId,
      provider: 'kling_reference',
      providerModel: selectedModel,
      referenceRole: referenceSet.selected.referenceRole,
      referenceLabel: referenceSet.selected.referenceLabel,
      succeeded: false,
      failureCategory: 'kling_asset_access',
      providerErrorCategory: 'kling_asset_access',
      outputUrlPresent: false,
      notes: { referencesChecked: access.checked },
    });
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_asset_access',
      skipStage: 'sign_reference_urls',
      skipReason: 'reference_asset_access_failed',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: 'One or more saved Lumora references were not provider-reachable.',
      recommendedNextAction: 'A saved Lumora reference was not provider-reachable. Repair references before testing Kling again.',
      extras: {
        referenceCount: referenceSet.candidates.length,
        referencesChecked: access.checked,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
        verificationVideoUsed: false,
      },
    });
  }
  completedStages.push('sign_reference_urls');

  let payload: ReturnType<typeof buildKlingReferenceToVideoPayload>;
  try {
    payload = buildKlingReferenceToVideoPayload({
      frontalImageUrl: referenceSet.frontalImageUrl,
      referenceImageUrls: referenceSet.referenceImageUrls,
    });
    completedStages.push('build_payload');
  } catch (error) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_payload_build_failed',
      skipStage: 'build_payload',
      skipReason: 'payload_construction_failed',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: serializeDiagnosticError(error),
      recommendedNextAction: 'Kling payload construction failed. Inspect provider shape diagnostics before retrying.',
      extras: {
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
      },
    });
  }

  let attempt: ReturnType<typeof createKlingCanaryAttemptMarker>;
  try {
    attempt = createKlingCanaryAttemptMarker({
      selectedModel,
      variant: input.variant,
    });
    completedStages.push('create_attempt_record');
  } catch (error) {
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory: 'kling_attempt_record_failed',
      skipStage: 'create_attempt_record',
      skipReason: 'local_attempt_record_failed',
      completedStages,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: serializeDiagnosticError(error),
      recommendedNextAction: 'Lumora could not create a local Kling canary attempt record. Check backend diagnostics before retrying.',
      extras: {
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
      },
    });
  }

  const fallbackRequestId = randomUUID();
  let activeStage: KlingCanaryStage = 'submit_fal_job';
  let submitted: KlingQueueSubmitResponse | null = null;
  let jobId: string | null = null;

  try {
    try {
      submitted = await submitKlingQueueRequest({
        model: selectedModel,
        payload,
      });
      completedStages.push('submit_fal_job');
    } catch (error) {
      const response = preJobErrorPayload({
        error,
        readiness,
        selectedModel,
        payload,
        referenceSet,
        attemptId: attempt.attemptId,
        forceRetest: input.forceRetest,
        storedIgnored: Boolean(input.forceRetest && stored),
        completedStages,
      }) as ReturnType<typeof preJobErrorPayload> & Record<string, unknown>;
      await persistAlternateExactLikenessCanaryResult({
        userId: referenceSet.selected.userId,
        characterId: referenceSet.selected.characterId,
        provider: 'kling_reference',
        providerModel: selectedModel,
        referenceRole: referenceSet.selected.referenceRole,
        referenceLabel: referenceSet.selected.referenceLabel,
        succeeded: false,
        failureCategory: String(response.failureCategory ?? 'kling_provider_failed'),
        providerErrorCategory: String(response.failureCategory ?? 'kling_provider_failed'),
        outputUrlPresent: false,
        notes: {
          attemptId: attempt.attemptId,
          attemptCreated: true,
          providerJobCreated: false,
          skipStage: 'submit_fal_job',
          skipReason: response.skipReason,
          falHttpStatus: response.falHttpStatus ?? null,
          modelSlug: response.modelSlug ?? selectedModel,
          payloadShapeSummary: response.payloadShapeSummary ?? null,
          providerErrorSummary: response.providerErrorSummary,
        },
      });
      return response;
    }
    jobId = requestId(submitted) ?? fallbackRequestId;
    await persistKlingSubmittedJob({
      userId: referenceSet.selected.userId,
      characterId: referenceSet.selected.characterId,
      selectedModel,
      referenceSet,
      attempt,
      jobId,
      submitted,
      payload,
    });
    activeStage = 'poll_fal_job';
    let finalJob: KlingQueueStatusResponse;
    try {
      finalJob = await pollKlingQueue({
        model: selectedModel,
        requestId: jobId,
      });
    } catch (error) {
      const response = buildKlingPollFailurePayload({
        readiness,
        selectedModel,
        attemptId: attempt.attemptId,
        providerJobId: jobId,
        providerStatusUrl: redactFalUrl(submitted.status_url),
        pollEndpointUsed: queueUrl(selectedModel, `/requests/${encodeURIComponent(jobId)}/status`),
        error,
        completedStages,
        forceRetest: input.forceRetest,
        storedIgnored: Boolean(input.forceRetest && stored),
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
      });
      const responseRecord = response as Record<string, unknown>;
      await persistAlternateExactLikenessCanaryResult({
        userId: referenceSet.selected.userId,
        characterId: referenceSet.selected.characterId,
        provider: 'kling_reference',
        providerModel: selectedModel,
        referenceRole: referenceSet.selected.referenceRole,
        referenceLabel: referenceSet.selected.referenceLabel,
        succeeded: false,
        failureCategory: 'kling_poll_failed',
        providerErrorCategory: 'kling_poll_failed',
        outputUrlPresent: false,
        notes: {
          ...submittedJobNotes({ attempt, jobId, submitted, payload, referenceSet }),
          skipStage: 'poll_fal_job',
          skipReason: 'internal_exception',
          pollErrorType: responseRecord.pollErrorType ?? null,
          pollErrorMessage: responseRecord.pollErrorMessage ?? null,
        },
      });
      return response;
    }
    completedStages.push('poll_fal_job');
    activeStage = 'parse_output';
    const output = providerOutputFromKlingResult(finalJob);
    const parsedOutput = parseProviderVideoOutput(output);
    const parsedFailureReason = 'reason' in parsedOutput ? parsedOutput.reason : null;
    const failed = !succeededKlingStatus(finalJob.status);

    if (failed || !parsedOutput.ok) {
      const failure = failed
        ? classifyKlingFailure({ detail: finalJob.error ?? finalJob })
        : { category: 'kling_output_parse_failed', detail: `output shape ${outputShapeSummary(output)}; ${parsedFailureReason ?? 'video output missing'}` };
      if (failure.category === 'kling_billing_required') {
        return {
          ok: false,
          provider: 'kling',
          route: 'kling_reference',
          configured: true,
          readinessStatus: 'billing_required',
          canaryStatus: 'billing_required',
          selectedModel,
          providerJobCreated: true,
          storedStatusReturned: false,
          freshCanaryAttemptCreated: true,
          attemptMode: 'blocked_by_billing',
          attemptId: attempt.attemptId,
          attemptCreated: true,
          forceRetestRequested: Boolean(input.forceRetest),
          forceRetestHonored: Boolean(input.forceRetest),
          storedStatusIgnored: Boolean(input.forceRetest && stored),
          reasonIfNotHonored: null,
          providerJobIdPresent: Boolean(jobId),
          providerJobId: jobId,
          requestId: jobId,
          providerStatusUrl: redactFalUrl(submitted.status_url),
          pollEndpointUsed: queueUrl(selectedModel, `/requests/${encodeURIComponent(jobId)}/status`),
          providerStatus: finalJob.status ?? submitted.status ?? null,
          referenceCount: referenceSet.candidates.length,
          selectedReferenceRole: referenceSet.selected.referenceRole,
          selectedReferenceLabel: referenceSet.selected.referenceLabel,
          verificationVideoUsed: false,
          outputUrlPresent: false,
          parsedVideoUrlPresent: false,
          verifiedVideoPresent: false,
          verifiedPersistedVideo: false,
          outputShapeSummary: outputShapeSummary(output),
          skipStage: 'poll_fal_job',
          skipReason: failure.detail || 'billing_required_after_provider_job',
          stageStatus: stageStatus({ completed: completedStages, failed: 'poll_fal_job' }),
          failureCategory: failure.category,
          providerErrorSummary: safeProviderSummary(failure.detail, stageFailureSummary('poll_fal_job', 'billing_required_after_provider_job', true)),
          recommendedNextAction: 'Fal billing requires attention. Run fal account diagnostics, add credits if needed, then retry Kling.',
        };
      }
      await persistAlternateExactLikenessCanaryResult({
        userId: referenceSet.selected.userId,
        characterId: referenceSet.selected.characterId,
        provider: 'kling_reference',
        providerModel: selectedModel,
        referenceRole: referenceSet.selected.referenceRole,
        referenceLabel: referenceSet.selected.referenceLabel,
        succeeded: false,
        failureCategory: failure.category,
        providerErrorCategory: failure.category,
        outputUrlPresent: false,
        notes: {
          attemptId: attempt.attemptId,
          attemptCreated: true,
          providerJobCreated: true,
          providerStatus: finalJob.status ?? null,
          referenceCount: referenceSet.candidates.length,
          verificationVideoUsed: false,
        },
      });
      return {
        ok: false,
        provider: 'kling',
        route: 'kling_reference',
        configured: true,
        readinessStatus: failure.category === 'kling_provider_unavailable'
          ? 'provider_unavailable'
          : failure.category === 'kling_moderation_block'
            ? 'blocked'
            : 'canary_failed',
        canaryStatus: 'canary_failed',
        selectedModel,
        providerJobCreated: true,
        storedStatusReturned: false,
        freshCanaryAttemptCreated: true,
        attemptMode: input.forceRetest ? 'force_retest_fresh_canary_attempt' : 'creating_fresh_canary_attempt',
        attemptId: attempt.attemptId,
        attemptCreated: true,
        forceRetestRequested: Boolean(input.forceRetest),
        forceRetestHonored: Boolean(input.forceRetest),
        storedStatusIgnored: Boolean(input.forceRetest && stored),
        reasonIfNotHonored: null,
        providerJobIdPresent: Boolean(jobId),
        providerJobId: jobId,
        requestId: jobId,
        providerStatusUrl: redactFalUrl(submitted.status_url),
        pollEndpointUsed: queueUrl(selectedModel, `/requests/${encodeURIComponent(jobId)}/status`),
        providerStatus: finalJob.status ?? submitted.status ?? null,
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
        verificationVideoUsed: false,
        outputUrlPresent: false,
        parsedVideoUrlPresent: false,
        verifiedVideoPresent: false,
        verifiedPersistedVideo: false,
        outputShapeSummary: outputShapeSummary(output),
        skipStage: failed ? 'poll_fal_job' : 'parse_output',
        skipReason: failure.detail || (failed ? 'provider_job_failed' : 'provider_output_missing'),
        stageStatus: stageStatus({ completed: completedStages, failed: failed ? 'poll_fal_job' : 'parse_output' }),
        failureCategory: failure.category,
        providerErrorSummary: safeProviderSummary(failure.detail, `Kling canary failed after provider job creation: ${failure.category}.`),
        recommendedNextAction: failure.category === 'kling_provider_unavailable'
          ? 'Kling provider was unavailable. Retry later if you want to spend another canary attempt.'
          : 'Kling did not return a verified video. Keep using soft self guidance or test another exact provider.',
      };
    }
    completedStages.push('parse_output');

    let persisted = null as Awaited<ReturnType<typeof persistCompletedGeneration>> | null;
    if (input.saveAsDraft) {
      activeStage = 'persist_verified_video';
      persisted = await persistCompletedGeneration({
        userId: referenceSet.selected.userId ?? input.userId ?? null,
        id: `kling-canary-${jobId}`,
        title: 'Kling likeness canary',
        prompt: KLING_REFERENCE_PROMPT,
        finalPrompt: KLING_REFERENCE_PROMPT,
        provider: 'kling',
        engine: 'kling',
        model: selectedModel,
        videoUrl: parsedOutput.videoUrl,
        thumbnailUrl: null,
        characterId: referenceSet.selected.characterId,
        characterName: null,
        characterAvatar: null,
        isDefaultSelfCharacter: true,
        durationSeconds: 5,
        aspectRatio: '9:16',
        privacy: 'private',
      });
    }
    completedStages.push('persist_verified_video');

    await persistAlternateExactLikenessCanaryResult({
      userId: referenceSet.selected.userId,
      characterId: referenceSet.selected.characterId,
      provider: 'kling_reference',
      providerModel: selectedModel,
      referenceRole: referenceSet.selected.referenceRole,
      referenceLabel: referenceSet.selected.referenceLabel,
      succeeded: true,
      outputUrlPresent: true,
      notes: {
        attemptId: attempt.attemptId,
        attemptCreated: true,
        providerJobCreated: true,
        providerStatus: finalJob.status ?? null,
        persistedToDraft: Boolean(persisted),
        referenceCount: referenceSet.candidates.length,
        verificationVideoUsed: false,
      },
    });

    return {
      ok: true,
      provider: 'kling',
      route: 'kling_reference',
      configured: true,
      readinessStatus: 'canary_succeeded',
      canaryStatus: 'canary_succeeded',
      selectedModel,
      providerJobCreated: true,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: true,
      attemptMode: input.forceRetest ? 'force_retest_fresh_canary_attempt' : 'creating_fresh_canary_attempt',
      attemptId: attempt.attemptId,
      attemptCreated: true,
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: Boolean(input.forceRetest),
      storedStatusIgnored: Boolean(input.forceRetest && stored),
      reasonIfNotHonored: null,
      providerJobIdPresent: Boolean(jobId),
      providerJobId: jobId,
      requestId: jobId,
      providerStatusUrl: redactFalUrl(submitted.status_url),
      pollEndpointUsed: queueUrl(selectedModel, `/requests/${encodeURIComponent(jobId)}/status`),
      providerStatus: finalJob.status ?? submitted.status ?? null,
      referenceCount: referenceSet.candidates.length,
      selectedReferenceRole: referenceSet.selected.referenceRole,
      selectedReferenceLabel: referenceSet.selected.referenceLabel,
      verificationVideoUsed: false,
      outputUrlPresent: true,
      parsedVideoUrlPresent: true,
      verifiedVideoPresent: true,
      verifiedPersistedVideo: Boolean(persisted?.storagePath || persisted?.projectId),
      outputShapeSummary: outputShapeSummary(output),
      projectId: persisted?.projectId ?? null,
      storagePathPresent: Boolean(persisted?.storagePath),
      stageStatus: stageStatus({ completed: completedStages }),
      recommendedNextAction: 'Kling canary succeeded. Lumora can route exact likeness through Kling after production enablement.',
    };
  } catch (error) {
    const failureCategory = typeof (error as { failureCategory?: unknown }).failureCategory === 'string'
      ? String((error as { failureCategory: string }).failureCategory)
      : 'kling_provider_failed';
    if (failureCategory === 'kling_billing_required') {
      return {
        ok: false,
        provider: 'kling',
        route: 'kling_reference',
        configured: true,
        readinessStatus: 'billing_required',
        canaryStatus: 'billing_required',
        selectedModel,
        providerJobCreated: Boolean(jobId),
        providerJobIdPresent: Boolean(jobId),
        providerJobId: jobId,
        requestId: jobId,
        storedStatusReturned: false,
        freshCanaryAttemptCreated: true,
        attemptMode: 'blocked_by_billing',
        attemptId: attempt.attemptId,
        attemptCreated: true,
        forceRetestRequested: Boolean(input.forceRetest),
        forceRetestHonored: Boolean(input.forceRetest),
        storedStatusIgnored: Boolean(input.forceRetest && stored),
        reasonIfNotHonored: null,
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
        verificationVideoUsed: false,
        outputUrlPresent: false,
        parsedVideoUrlPresent: false,
        verifiedVideoPresent: false,
        verifiedPersistedVideo: false,
        skipStage: activeStage,
        skipReason: 'billing_required',
        stageStatus: stageStatus({ completed: completedStages, failed: activeStage }),
        failureCategory,
        providerErrorSummary: safeProviderSummary(
          typeof (error as { failureDetail?: unknown }).failureDetail === 'string'
            ? (error as { failureDetail: string }).failureDetail
            : serializeDiagnosticError(error),
          stageFailureSummary(activeStage, 'billing_required', Boolean(jobId)),
        ),
        recommendedNextAction: 'Fal billing requires attention. Run fal account diagnostics, add credits if needed, then retry Kling.',
      };
    }

    await persistAlternateExactLikenessCanaryResult({
      userId: referenceSet.selected.userId,
      characterId: referenceSet.selected.characterId,
      provider: 'kling_reference',
      providerModel: selectedModel,
      referenceRole: referenceSet.selected.referenceRole,
      referenceLabel: referenceSet.selected.referenceLabel,
      succeeded: false,
      failureCategory,
      providerErrorCategory: failureCategory,
      outputUrlPresent: false,
      notes: {
        attemptId: attempt.attemptId,
        attemptCreated: true,
        providerJobCreated: Boolean(jobId),
        skipStage: activeStage,
        referenceCount: referenceSet.candidates.length,
        verificationVideoUsed: false,
      },
    });
    return buildKlingStageFailurePayload({
      readiness,
      selectedModel,
      failureCategory,
      skipStage: activeStage,
      skipReason: 'internal_exception',
      completedStages,
      attemptId: attempt.attemptId,
      attemptCreated: true,
      forceRetest: input.forceRetest,
      storedIgnored: Boolean(input.forceRetest && stored),
      providerErrorSummary: typeof (error as { failureDetail?: unknown }).failureDetail === 'string'
        ? (error as { failureDetail: string }).failureDetail
        : serializeDiagnosticError(error),
      recommendedNextAction: failureCategory === 'kling_provider_unavailable'
        ? 'Kling provider was unavailable. Retry later if you want to spend another canary attempt.'
        : 'Kling canary failed. Keep using soft self guidance while reviewing provider diagnostics.',
      extras: {
        providerJobCreated: Boolean(jobId),
        providerJobIdPresent: Boolean(jobId),
        providerJobId: jobId,
        requestId: jobId,
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
        verificationVideoUsed: false,
      },
    });
  }
}
