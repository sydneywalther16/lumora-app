import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import { persistAlternateExactLikenessCanaryResult } from '../alternateLikenessProviderMemory';
import { persistCompletedGeneration } from '../generationPersistence';
import { parseProviderVideoOutput } from '../providerOutputParser';
import { serializeDiagnosticError } from '../schemaDiagnostics';
import { listSelfReferenceMatrixCandidates } from '../seedanceCanary';

const RUNWAY_API_BASE_URL = 'https://api.dev.runwayml.com';
const RUNWAY_API_VERSION = '2024-11-06';
const RUNWAY_CANARY_PROMPT =
  'The character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft cinematic storybook style.';

export type RunwayReadinessStatus =
  | 'not_configured'
  | 'configured_not_implemented'
  | 'configured_ready_for_canary'
  | 'canary_succeeded'
  | 'canary_failed';

type RunwayTask = {
  id: string;
  status?: string;
  output?: unknown;
  failure?: string | null;
  failureCode?: string | null;
  [key: string]: unknown;
};

export function getRunwayProviderReadiness(input: {
  canaryStatus?: 'canary_succeeded' | 'canary_failed' | 'not_tested' | null;
} = {}) {
  const referenceModel = env.RUNWAY_REFERENCE_MODEL ?? env.RUNWAY_MODEL ?? null;
  const configured = Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY && referenceModel);
  const canaryStatus = input.canaryStatus ?? 'not_tested';
  const status: RunwayReadinessStatus = !configured
    ? 'not_configured'
    : canaryStatus === 'canary_succeeded'
      ? 'canary_succeeded'
      : canaryStatus === 'canary_failed'
        ? 'canary_failed'
        : 'configured_ready_for_canary';

  return {
    provider: 'runway_gen4_reference',
    displayName: 'Runway Gen-4 reference route',
    configured,
    enabled: env.RUNWAY_ENABLED,
    apiKeyConfigured: Boolean(env.RUNWAY_API_KEY),
    model: env.RUNWAY_MODEL ?? null,
    referenceModel,
    status,
    implemented: true,
    canarySucceeded: status === 'canary_succeeded',
    canaryFailed: status === 'canary_failed',
    recommendedNextAction: !configured
      ? 'Set RUNWAY_ENABLED=true, RUNWAY_API_KEY, and RUNWAY_REFERENCE_MODEL to test Runway likeness.'
      : status === 'canary_succeeded'
        ? 'Runway canary succeeded; router may use it for exact likeness.'
        : status === 'canary_failed'
          ? 'Inspect the last Runway canary failure before production routing.'
          : 'Run the Runway likeness canary before production routing.',
  };
}

function redactRunwayError(value: unknown) {
  const text = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : String(value ?? '');
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 280);
}

function classifyRunwayFailure(input: {
  statusCode?: number | null;
  detail?: unknown;
}) {
  const detail = redactRunwayError(input.detail);
  const lower = detail.toLowerCase();
  if (input.statusCode === 401 || input.statusCode === 403 || lower.includes('permission') || lower.includes('unauthorized')) {
    return { category: 'runway_access_denied', detail };
  }
  if (lower.includes('safety') || lower.includes('moderation') || lower.includes('content')) {
    return { category: 'runway_moderation_block', detail };
  }
  if (input.statusCode === 400 || lower.includes('invalid') || lower.includes('schema')) {
    return { category: 'runway_input_schema', detail };
  }
  return { category: 'runway_provider_failed', detail };
}

async function runwayJson<T>(input: {
  path: string;
  method: string;
  body?: unknown;
}) {
  const response = await fetch(`${RUNWAY_API_BASE_URL}${input.path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${env.RUNWAY_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': RUNWAY_API_VERSION,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const failure = classifyRunwayFailure({
      statusCode: response.status,
      detail: payload,
    });
    throw Object.assign(new Error(failure.detail || 'Runway API request failed.'), {
      statusCode: response.status,
      failureCategory: failure.category,
      failureDetail: failure.detail,
    });
  }

  return payload as T;
}

async function createRunwayImageToVideoTask(input: {
  promptImage: string;
  promptText: string;
  model: string;
}) {
  return runwayJson<RunwayTask>({
    path: '/v1/image_to_video',
    method: 'POST',
    body: {
      promptImage: input.promptImage,
      promptText: input.promptText,
      model: input.model,
      ratio: '768:1280',
      duration: 5,
    },
  });
}

async function retrieveRunwayTask(taskId: string) {
  return runwayJson<RunwayTask>({
    path: `/v1/tasks/${encodeURIComponent(taskId)}`,
    method: 'GET',
  });
}

function terminalRunwayStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'SUCCEEDED' || normalized === 'FAILED' || normalized === 'CANCELED' || normalized === 'CANCELLED';
}

function succeededRunwayStatus(status: string | null | undefined) {
  return String(status ?? '').toUpperCase() === 'SUCCEEDED';
}

async function pollRunwayTask(taskId: string, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  let latest: RunwayTask = await retrieveRunwayTask(taskId);

  while (!terminalRunwayStatus(latest.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    latest = await retrieveRunwayTask(taskId);
  }

  return latest;
}

function outputShapeSummary(output: unknown) {
  if (Array.isArray(output)) return `array(${output.length})`;
  if (output && typeof output === 'object') return `object(${Object.keys(output as Record<string, unknown>).slice(0, 6).join(',')})`;
  return typeof output;
}

export async function startRunwaySelfLikenessCanary(input: {
  userId?: string | null;
  saveAsDraft?: boolean;
}) {
  const readiness = getRunwayProviderReadiness();
  if (!readiness.configured || !readiness.referenceModel) {
    return {
      ok: false,
      provider: 'runway',
      route: 'runway_reference',
      configured: readiness.configured,
      readinessStatus: readiness.status,
      canaryStatus: readiness.status,
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory: 'not_configured',
      recommendedNextAction: readiness.recommendedNextAction,
    };
  }

  const matrix = await listSelfReferenceMatrixCandidates({
    userId: input.userId ?? null,
    referenceRole: 'all',
  });
  const candidate = matrix.candidates[0] ?? null;
  if (!candidate) {
    return {
      ok: false,
      provider: 'runway',
      route: 'runway_reference',
      configured: true,
      readinessStatus: readiness.status,
      canaryStatus: 'canary_failed',
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory: 'no_saved_self_reference',
      sourcesChecked: matrix.sourcesChecked,
      sourceErrors: matrix.sourceErrors,
      recommendedNextAction: 'Open Create or Characters and re-save the self reference photos to Lumora storage, then rerun the Runway canary.',
    };
  }

  const taskIdFallback = randomUUID();
  try {
    const task = await createRunwayImageToVideoTask({
      promptImage: candidate.reference.url,
      promptText: RUNWAY_CANARY_PROMPT,
      model: readiness.referenceModel,
    });
    const taskId = task.id || taskIdFallback;
    const finalTask = await pollRunwayTask(taskId);
    const parsedOutput = parseProviderVideoOutput(finalTask.output);
    const failed = !succeededRunwayStatus(finalTask.status);

    if (failed || !parsedOutput.ok) {
      const failure = failed
        ? classifyRunwayFailure({ detail: finalTask.failureCode ?? finalTask.failure ?? finalTask })
        : { category: 'runway_output_missing', detail: `output shape ${outputShapeSummary(finalTask.output)}` };
      await persistAlternateExactLikenessCanaryResult({
        userId: candidate.userId,
        characterId: candidate.characterId,
        provider: 'runway_gen4_reference',
        providerModel: readiness.referenceModel,
        referenceRole: candidate.referenceRole,
        referenceLabel: candidate.referenceLabel,
        succeeded: false,
        failureCategory: failure.category,
        providerErrorCategory: failure.category,
        outputUrlPresent: false,
      });
      return {
        ok: false,
        provider: 'runway',
        route: 'runway_reference',
        configured: true,
        readinessStatus: 'canary_failed',
        canaryStatus: 'canary_failed',
        providerTaskIdPresent: Boolean(taskId),
        providerStatus: finalTask.status ?? null,
        selectedReferenceRole: candidate.referenceRole,
        selectedReferenceLabel: candidate.referenceLabel,
        outputUrlPresent: false,
        verifiedVideoPresent: false,
        outputShapeSummary: outputShapeSummary(finalTask.output),
        failureCategory: failure.category,
        providerErrorSummary: failure.detail,
        recommendedNextAction: 'Runway did not return a verified video for this reference. Keep using soft self guidance or test another exact provider.',
      };
    }

    let persisted = null as Awaited<ReturnType<typeof persistCompletedGeneration>> | null;
    if (input.saveAsDraft) {
      persisted = await persistCompletedGeneration({
        userId: candidate.userId ?? input.userId ?? null,
        id: `runway-canary-${taskId}`,
        title: 'Runway likeness canary',
        prompt: RUNWAY_CANARY_PROMPT,
        finalPrompt: RUNWAY_CANARY_PROMPT,
        provider: 'runway',
        engine: 'runway',
        videoUrl: parsedOutput.videoUrl,
        thumbnailUrl: null,
        characterId: candidate.characterId,
        characterName: null,
        characterAvatar: null,
        isDefaultSelfCharacter: true,
        durationSeconds: 5,
        aspectRatio: '9:16',
        privacy: 'private',
      });
    }

    await persistAlternateExactLikenessCanaryResult({
      userId: candidate.userId,
      characterId: candidate.characterId,
      provider: 'runway_gen4_reference',
      providerModel: readiness.referenceModel,
      referenceRole: candidate.referenceRole,
      referenceLabel: candidate.referenceLabel,
      succeeded: true,
      outputUrlPresent: true,
      notes: {
        persistedToDraft: Boolean(persisted),
      },
    });

    return {
      ok: true,
      provider: 'runway',
      route: 'runway_reference',
      configured: true,
      readinessStatus: 'canary_succeeded',
      canaryStatus: 'canary_succeeded',
      providerTaskIdPresent: Boolean(taskId),
      providerStatus: finalTask.status ?? null,
      selectedReferenceRole: candidate.referenceRole,
      selectedReferenceLabel: candidate.referenceLabel,
      outputUrlPresent: true,
      verifiedVideoPresent: true,
      outputShapeSummary: outputShapeSummary(finalTask.output),
      projectId: persisted?.projectId ?? null,
      storagePathPresent: Boolean(persisted?.storagePath),
      recommendedNextAction: 'Runway canary succeeded. Lumora can route exact likeness through Runway after production enablement.',
    };
  } catch (error) {
    const failureCategory = typeof (error as { failureCategory?: unknown }).failureCategory === 'string'
      ? String((error as { failureCategory: string }).failureCategory)
      : 'runway_provider_failed';
    await persistAlternateExactLikenessCanaryResult({
      userId: candidate.userId,
      characterId: candidate.characterId,
      provider: 'runway_gen4_reference',
      providerModel: readiness.referenceModel,
      referenceRole: candidate.referenceRole,
      referenceLabel: candidate.referenceLabel,
      succeeded: false,
      failureCategory,
      providerErrorCategory: failureCategory,
      outputUrlPresent: false,
    });
    return {
      ok: false,
      provider: 'runway',
      route: 'runway_reference',
      configured: true,
      readinessStatus: 'canary_failed',
      canaryStatus: 'canary_failed',
      selectedReferenceRole: candidate.referenceRole,
      selectedReferenceLabel: candidate.referenceLabel,
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory,
      providerErrorSummary: typeof (error as { failureDetail?: unknown }).failureDetail === 'string'
        ? (error as { failureDetail: string }).failureDetail
        : serializeDiagnosticError(error),
      recommendedNextAction: 'Runway canary failed. Keep using soft self guidance while reviewing provider diagnostics.',
    };
  }
}
