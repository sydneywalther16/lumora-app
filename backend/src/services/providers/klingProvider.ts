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

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
const KLING_REFERENCE_PROMPT =
  'Keep the referenced self character from @Element1 consistent while the character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft cinematic storybook style, gentle camera motion.';

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
  if (input.statusCode === 401) {
    return { category: 'kling_auth_failed', detail };
  }
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
    input.statusCode === 403 ||
    lower.includes('not permitted to perform this action') ||
    lower.includes('insufficient permissions') ||
    lower.includes('missing required scope') ||
    lower.includes('does not have permission')
  ) {
    return { category: 'kling_key_scope_failed', detail };
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
  if (!stored || input.forceRetest) return false;
  if (stored.lastFailureCategory === 'kling_billing_required') return false;
  if (stored.lastFailureCategory === 'kling_moderation_block') return true;
  return stored.status === 'canary_failed' && Boolean(stored.lastFailureCategory) && stored.providerJobCreated === true;
}

function storedKlingStatusReason(stored: AlternateExactLikenessProviderStatus) {
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
    storedStatusReturned: true,
    freshCanaryAttemptCreated: false,
    attemptMode: 'returning_stored_status',
    lastFailureCategory: input.stored.lastFailureCategory,
    failureCategory: input.stored.lastFailureCategory ?? 'kling_canary_stored_status',
    recommendedNextAction: input.reason,
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
    : 'kling_provider_failed';
  const falHttpStatus = typeof valueFromError(input.error, 'falHttpStatus') === 'number'
    ? Number(valueFromError(input.error, 'falHttpStatus'))
    : typeof valueFromError(input.error, 'statusCode') === 'number'
      ? Number(valueFromError(input.error, 'statusCode'))
      : null;
  const providerErrorSummary = typeof valueFromError(input.error, 'failureDetail') === 'string'
    ? String(valueFromError(input.error, 'failureDetail'))
    : serializeDiagnosticError(input.error);
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
  forceRetest?: boolean;
  storedIgnored: boolean;
}) {
  const diagnostics = buildKlingPreJobFailureDiagnostics({
    error: input.error,
    selectedModel: input.selectedModel,
    payload: input.payload,
  });
  const failureCategory = diagnostics.failureCategory;
  return {
    ok: false,
    provider: 'kling',
    route: 'kling_reference',
    configured: true,
    readinessStatus: failureCategory === 'kling_billing_required'
      ? 'billing_required'
      : failureCategory === 'kling_provider_unavailable'
        ? 'provider_unavailable'
        : input.readiness.status,
    canaryStatus: failureCategory === 'kling_billing_required'
      ? 'billing_required'
      : 'canary_failed',
    selectedModel: input.selectedModel,
    providerJobCreated: false,
    providerJobIdPresent: false,
    providerStatus: null,
    storedStatusReturned: false,
    freshCanaryAttemptCreated: true,
    attemptMode: 'provider_call_failed_before_job',
    forceRetestRequested: Boolean(input.forceRetest),
    forceRetestHonored: Boolean(input.forceRetest),
    storedStatusIgnored: input.storedIgnored,
    reasonIfNotHonored: null,
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
    outputUrlPresent: false,
    parsedVideoUrlPresent: false,
    verifiedVideoPresent: false,
    verifiedPersistedVideo: false,
    failureCategory,
    providerErrorSummary: diagnostics.providerErrorSummary,
    recommendedNextAction: failureCategory === 'kling_model_not_found'
      ? 'The configured Kling/fal model slug was not found. Try a supported variant such as o1_standard_reference_to_video.'
      : failureCategory === 'kling_input_schema'
        ? 'Fal rejected the Kling payload before job creation. Inspect payload shape and try another Kling variant.'
      : failureCategory === 'kling_auth_failed' || failureCategory === 'kling_key_scope_failed'
        ? 'Check the fal inference key permissions in Render. Do not paste the key into scripts or chat.'
      : failureCategory === 'kling_rate_limited'
        ? 'Fal rate-limited this request. Wait before retrying the Kling canary.'
      : failureCategory === 'kling_billing_required'
        ? 'Fal billing requires attention. Run fal account diagnostics, add credits if needed, then retry Kling.'
      : failureCategory === 'kling_provider_unavailable'
        ? 'Fal or Kling was unavailable before job creation. Retry later.'
      : 'Kling job creation failed before fal returned a job id. Inspect the redacted fal error and model slug.',
  };
}

function requestId(response: KlingQueueSubmitResponse) {
  return response.request_id ?? response.requestId ?? null;
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

async function pollKlingQueue(input: {
  model: string;
  requestId: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 180_000);
  let latest = await retrieveKlingQueueStatus(input);

  while (!terminalKlingStatus(latest.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    latest = await retrieveKlingQueueStatus(input);
  }

  if (succeededKlingStatus(latest.status)) {
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

function providerOutputFromKlingResult(result: KlingQueueStatusResponse) {
  return result.output ?? result.result ?? result.data ?? result;
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

export async function startKlingSelfLikenessCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
  forceRetest?: boolean;
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
  const stored = storedKlingStatus(statuses);

  if (!readiness.configured || !selectedModel) {
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: readiness.configured,
      readinessStatus: readiness.status,
      canaryStatus: readiness.status,
      selectedModel,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'blocked_by_configuration',
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: false,
      storedStatusIgnored: false,
      reasonIfNotHonored: 'provider_not_configured',
      failureCategory: 'not_configured',
      recommendedNextAction: readiness.recommendedNextAction,
    };
  }

  if (!readiness.implemented) {
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: true,
      readinessStatus: readiness.status,
      canaryStatus: readiness.status,
      selectedModel,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'blocked_by_configuration',
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: false,
      storedStatusIgnored: false,
      reasonIfNotHonored: 'provider_transport_not_implemented',
      failureCategory: 'configured_not_implemented',
      recommendedNextAction: readiness.recommendedNextAction,
    };
  }

  if (isFalAccountBlockingKling(falAccount)) {
    const failureCategory = isFalBillingRequired(falAccount)
      ? 'kling_billing_required'
      : falAccount.errorCategory;
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: readiness.configured,
      readinessStatus: failureCategory === 'kling_billing_required' ? 'billing_required' : readiness.status,
      canaryStatus: failureCategory === 'kling_billing_required' ? 'billing_required' : readiness.status,
      selectedModel,
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
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'blocked_by_billing',
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: false,
      storedStatusIgnored: false,
      reasonIfNotHonored: 'blocked_by_fal_account_status',
      failureCategory,
      providerErrorSummary: falAccount.errorSummary,
      recommendedNextAction: falAccount.recommendedNextAction,
    };
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

  const matrix = await listSelfReferenceMatrixCandidates({
    userId: input.userId ?? null,
    referenceRole: 'all',
  });
  const referenceSet = selectReferenceSet(matrix.candidates);
  if (!referenceSet) {
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: true,
      readinessStatus: readiness.status,
      canaryStatus: 'canary_failed',
      selectedModel,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'preflight_failed',
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: false,
      storedStatusIgnored: Boolean(input.forceRetest && stored),
      reasonIfNotHonored: 'no_saved_self_reference',
      failureCategory: 'no_saved_self_reference',
      sourcesChecked: matrix.sourcesChecked,
      sourceErrors: matrix.sourceErrors,
      recommendedNextAction: 'Open Create or Characters and re-save the self reference photos to Lumora storage, then rerun the Kling canary.',
    };
  }

  const access = await verifyReferenceSet(referenceSet);
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
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: true,
      readinessStatus: 'canary_failed',
      canaryStatus: 'canary_failed',
      selectedModel,
      referenceCount: referenceSet.candidates.length,
      referencesChecked: access.checked,
      verificationVideoUsed: false,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'preflight_failed',
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: false,
      storedStatusIgnored: Boolean(input.forceRetest && stored),
      reasonIfNotHonored: 'reference_asset_access_failed',
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      failureCategory: 'kling_asset_access',
      recommendedNextAction: 'A saved Lumora reference was not provider-reachable. Repair references before testing Kling again.',
    };
  }

  const payload = buildKlingReferenceToVideoPayload({
    frontalImageUrl: referenceSet.frontalImageUrl,
    referenceImageUrls: referenceSet.referenceImageUrls,
  });
  const fallbackRequestId = randomUUID();

  try {
    let submitted: KlingQueueSubmitResponse;
    try {
      submitted = await submitKlingQueueRequest({
        model: selectedModel,
        payload,
      });
    } catch (error) {
      return preJobErrorPayload({
        error,
        readiness,
        selectedModel,
        payload,
        referenceSet,
        forceRetest: input.forceRetest,
        storedIgnored: Boolean(input.forceRetest && stored),
      });
    }
    const jobId = requestId(submitted) ?? fallbackRequestId;
    const finalJob = await pollKlingQueue({
      model: selectedModel,
      requestId: jobId,
    });
    const output = providerOutputFromKlingResult(finalJob);
    const parsedOutput = parseProviderVideoOutput(output);
    const failed = !succeededKlingStatus(finalJob.status);

    if (failed || !parsedOutput.ok) {
      const failure = failed
        ? classifyKlingFailure({ detail: finalJob.error ?? finalJob })
        : { category: 'kling_output_missing', detail: `output shape ${outputShapeSummary(output)}` };
      if (failure.category === 'kling_billing_required') {
        return {
          ok: false,
          provider: 'kling',
          route: 'kling_reference',
          configured: true,
          readinessStatus: 'billing_required',
          canaryStatus: 'billing_required',
          selectedModel,
          providerJobCreated: false,
          storedStatusReturned: false,
          freshCanaryAttemptCreated: false,
          attemptMode: 'blocked_by_billing',
          forceRetestRequested: Boolean(input.forceRetest),
          forceRetestHonored: Boolean(input.forceRetest),
          storedStatusIgnored: Boolean(input.forceRetest && stored),
          reasonIfNotHonored: null,
          providerJobIdPresent: Boolean(jobId),
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
          failureCategory: failure.category,
          providerErrorSummary: failure.detail,
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
        forceRetestRequested: Boolean(input.forceRetest),
        forceRetestHonored: Boolean(input.forceRetest),
        storedStatusIgnored: Boolean(input.forceRetest && stored),
        reasonIfNotHonored: null,
        providerJobIdPresent: Boolean(jobId),
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
        failureCategory: failure.category,
        providerErrorSummary: failure.detail,
        recommendedNextAction: failure.category === 'kling_provider_unavailable'
          ? 'Kling provider was unavailable. Retry later if you want to spend another canary attempt.'
          : 'Kling did not return a verified video. Keep using soft self guidance or test another exact provider.',
      };
    }

    let persisted = null as Awaited<ReturnType<typeof persistCompletedGeneration>> | null;
    if (input.saveAsDraft) {
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
      forceRetestRequested: Boolean(input.forceRetest),
      forceRetestHonored: Boolean(input.forceRetest),
      storedStatusIgnored: Boolean(input.forceRetest && stored),
      reasonIfNotHonored: null,
      providerJobIdPresent: Boolean(jobId),
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
        providerJobCreated: false,
        storedStatusReturned: false,
        freshCanaryAttemptCreated: false,
        attemptMode: 'blocked_by_billing',
        forceRetestRequested: Boolean(input.forceRetest),
        forceRetestHonored: false,
        storedStatusIgnored: Boolean(input.forceRetest && stored),
        reasonIfNotHonored: 'blocked_by_billing',
        referenceCount: referenceSet.candidates.length,
        selectedReferenceRole: referenceSet.selected.referenceRole,
        selectedReferenceLabel: referenceSet.selected.referenceLabel,
        verificationVideoUsed: false,
        outputUrlPresent: false,
        parsedVideoUrlPresent: false,
        verifiedVideoPresent: false,
        verifiedPersistedVideo: false,
        failureCategory,
        providerErrorSummary: typeof (error as { failureDetail?: unknown }).failureDetail === 'string'
          ? (error as { failureDetail: string }).failureDetail
          : serializeDiagnosticError(error),
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
        referenceCount: referenceSet.candidates.length,
        verificationVideoUsed: false,
      },
    });
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: true,
      readinessStatus: failureCategory === 'kling_provider_unavailable'
        ? 'provider_unavailable'
        : failureCategory === 'kling_moderation_block'
          ? 'blocked'
          : 'canary_failed',
      canaryStatus: 'canary_failed',
      selectedModel,
      providerJobCreated: false,
      storedStatusReturned: false,
      freshCanaryAttemptCreated: false,
      attemptMode: 'provider_call_failed_before_job',
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
      failureCategory,
      providerErrorSummary: typeof (error as { failureDetail?: unknown }).failureDetail === 'string'
        ? (error as { failureDetail: string }).failureDetail
        : serializeDiagnosticError(error),
      recommendedNextAction: failureCategory === 'kling_provider_unavailable'
        ? 'Kling provider was unavailable. Retry later if you want to spend another canary attempt.'
        : 'Kling canary failed. Keep using soft self guidance while reviewing provider diagnostics.',
    };
  }
}
