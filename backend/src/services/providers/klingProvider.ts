import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import { persistAlternateExactLikenessCanaryResult } from '../alternateLikenessProviderMemory';
import { persistCompletedGeneration } from '../generationPersistence';
import { parseProviderVideoOutput } from '../providerOutputParser';
import { serializeDiagnosticError } from '../schemaDiagnostics';
import {
  falAuthorizationHeader,
  getConfiguredFalKey,
  getFalAccountStatus,
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
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]+/gi, '[redacted-auth]')
    .slice(0, 320);
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
    input.statusCode === 429 ||
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

export function getKlingProviderReadiness(input: {
  statuses?: Array<{
    provider: string;
    status: string;
    lastFailureCategory?: string | null;
    providerModel?: string | null;
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
  const status: KlingReadinessStatus = !configured
    ? 'not_configured'
    : !implemented
      ? 'configured_not_implemented'
    : stored?.status === 'canary_succeeded'
      ? 'canary_succeeded'
    : lastFailureCategory === 'kling_billing_required' && input.falAccountStatus?.errorCategory === 'fal_ok'
      ? 'configured_ready_for_canary'
    : input.falAccountStatus && isFalBillingRequired(input.falAccountStatus)
      ? 'billing_required'
    : lastFailureCategory === 'kling_moderation_block'
      ? 'blocked'
    : lastFailureCategory === 'kling_billing_required'
      ? 'billing_required'
    : lastFailureCategory === 'kling_provider_unavailable'
      ? 'provider_unavailable'
    : stored?.status === 'canary_failed'
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
  });
}

async function retrieveKlingQueueStatus(input: {
  model: string;
  requestId: string;
}) {
  return falJson<KlingQueueStatusResponse>({
    path: queueUrl(input.model, `/requests/${encodeURIComponent(input.requestId)}/status`),
    method: 'GET',
  });
}

async function retrieveKlingQueueResult(input: {
  model: string;
  requestId: string;
}) {
  return falJson<KlingQueueStatusResponse>({
    path: queueUrl(input.model, `/requests/${encodeURIComponent(input.requestId)}`),
    method: 'GET',
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

export async function startKlingSelfLikenessCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
} = {}) {
  const readiness = getKlingProviderReadiness();
  if (!readiness.configured || !readiness.selectedModel) {
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: readiness.configured,
      readinessStatus: readiness.status,
      canaryStatus: readiness.status,
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
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
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
      failureCategory: 'configured_not_implemented',
      recommendedNextAction: readiness.recommendedNextAction,
    };
  }

  const falAccount = await getFalAccountStatus();
  if (!falAccount.ok) {
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
      selectedModel: readiness.selectedModel,
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
      failureCategory,
      providerErrorSummary: falAccount.errorSummary,
      recommendedNextAction: falAccount.recommendedNextAction,
    };
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
      outputUrlPresent: false,
      parsedVideoUrlPresent: false,
      verifiedVideoPresent: false,
      verifiedPersistedVideo: false,
      providerJobCreated: false,
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
      providerModel: readiness.selectedModel,
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
      selectedModel: readiness.selectedModel,
      referenceCount: referenceSet.candidates.length,
      referencesChecked: access.checked,
      verificationVideoUsed: false,
      providerJobCreated: false,
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
    const submitted = await submitKlingQueueRequest({
      model: readiness.selectedModel,
      payload,
    });
    const jobId = requestId(submitted) ?? fallbackRequestId;
    const finalJob = await pollKlingQueue({
      model: readiness.selectedModel,
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
          selectedModel: readiness.selectedModel,
          providerJobCreated: false,
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
        providerModel: readiness.selectedModel,
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
        selectedModel: readiness.selectedModel,
        providerJobCreated: true,
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
        model: readiness.selectedModel,
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
      providerModel: readiness.selectedModel,
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
      selectedModel: readiness.selectedModel,
      providerJobCreated: true,
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
        selectedModel: readiness.selectedModel,
        providerJobCreated: false,
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
      providerModel: readiness.selectedModel,
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
      selectedModel: readiness.selectedModel,
      providerJobCreated: false,
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
