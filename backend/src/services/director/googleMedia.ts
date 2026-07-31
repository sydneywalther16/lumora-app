import { GoogleGenAI, type Interactions } from '@google/genai';
import type { DirectorBudgetDecision, DirectorCostTelemetry, DirectorPaidOperation } from './budget';
import {
  assertPaidOperationAuthorized,
  recordDirectorCostOutcome,
  recordPaidRequest,
} from './budget';

export type GoogleInteractionPayload = Interactions.CreateModelInteractionParamsNonStreaming;

export type GoogleMediaExecutionContext = {
  apiKey: string;
  operation: DirectorPaidOperation;
  decision: DirectorBudgetDecision;
  telemetry: DirectorCostTelemetry;
};

export type DirectorProviderFailureCategory =
  | 'provider_moderation'
  | 'provider_authentication'
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_configuration'
  | 'provider_request_failed';

export type DirectorProviderSafeFailureMetadata = {
  httpStatus: number | null;
  reason: string | null;
  retryAfterSeconds: number | null;
  retryInfoSeconds: number | null;
  quotaMetric: string | null;
  quotaLimitName: string | null;
  modelName: string | null;
};

export function createGoogleMediaClient(apiKey: string) {
  if (!apiKey.trim()) throw new Error('Google media generation is not configured.');
  return new GoogleGenAI({ apiKey });
}

export class DirectorProviderExecutionError extends Error {
  readonly telemetry: DirectorCostTelemetry;
  readonly safeCategory: DirectorProviderFailureCategory;
  readonly safeMetadata: DirectorProviderSafeFailureMetadata;

  constructor(
    telemetry: DirectorCostTelemetry,
    safeCategory: DirectorProviderFailureCategory,
    safeMetadata: DirectorProviderSafeFailureMetadata = emptySafeFailureMetadata(),
  ) {
    super('The Director provider request did not complete.');
    this.name = 'DirectorProviderExecutionError';
    this.telemetry = telemetry;
    this.safeCategory = safeCategory;
    this.safeMetadata = safeMetadata;
  }
}

function emptySafeFailureMetadata(): DirectorProviderSafeFailureMetadata {
  return {
    httpStatus: null,
    reason: null,
    retryAfterSeconds: null,
    retryInfoSeconds: null,
    quotaMetric: null,
    quotaLimitName: null,
    modelName: null,
  };
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null;
}

function safeNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function durationSeconds(value: unknown) {
  const numeric = safeNumber(value);
  if (numeric !== null) return numeric;
  const match = safeString(value)?.match(/^(\d+(?:\.\d+)?)s$/i);
  return match ? Number(match[1]) : null;
}

function readHeader(headers: unknown, name: string) {
  if (!headers || typeof headers !== 'object') return null;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    return safeString(getter.call(headers, name));
  }
  const record = headers as Record<string, unknown>;
  return safeString(record[name] ?? record[name.toLowerCase()]);
}

function nestedRecord(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function safeDetails(error: unknown) {
  const record = nestedRecord(error);
  const nestedError = nestedRecord(record?.error);
  const candidates = [
    record?.details,
    nestedError?.details,
    nestedRecord(record?.response)?.data,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const candidateRecord = nestedRecord(candidate);
    if (Array.isArray(candidateRecord?.details)) return candidateRecord.details;
  }
  return [] as unknown[];
}

export function extractDirectorProviderSafeFailureMetadata(
  error: unknown,
  fallbackModelName?: string,
): DirectorProviderSafeFailureMetadata {
  const record = nestedRecord(error);
  const nestedError = nestedRecord(record?.error);
  const response = nestedRecord(record?.response);
  const responseData = nestedRecord(response?.data);
  const metadata = emptySafeFailureMetadata();
  metadata.httpStatus = safeNumber(
    record?.statusCode ??
    record?.status ??
    record?.code ??
    nestedError?.code ??
    response?.status,
  );
  metadata.reason = safeString(
    nestedError?.status ??
    responseData?.status ??
    record?.reason,
  );
  metadata.retryAfterSeconds = durationSeconds(
    readHeader(record?.headers ?? response?.headers, 'retry-after'),
  );
  metadata.modelName = safeString(fallbackModelName);

  for (const detail of safeDetails(error)) {
    const detailRecord = nestedRecord(detail);
    if (!detailRecord) continue;
    const type = safeString(detailRecord['@type'])?.toLowerCase() ?? '';
    if (type.includes('retryinfo')) {
      metadata.retryInfoSeconds = durationSeconds(
        detailRecord.retryDelay ?? nestedRecord(detailRecord.retry_delay)?.seconds,
      );
    }
    const errorMetadata = nestedRecord(detailRecord.metadata);
    const violation = Array.isArray(detailRecord.violations)
      ? nestedRecord(detailRecord.violations[0])
      : null;
    const quotaDimensions = nestedRecord(violation?.quotaDimensions ?? violation?.quota_dimensions);
    metadata.reason ??= safeString(detailRecord.reason);
    metadata.quotaMetric ??= safeString(
      violation?.quotaMetric ??
      violation?.quota_metric ??
      errorMetadata?.quotaMetric ??
      errorMetadata?.quota_metric,
    );
    metadata.quotaLimitName ??= safeString(
      violation?.quotaId ??
      violation?.quota_id ??
      errorMetadata?.quotaLimit ??
      errorMetadata?.quota_limit,
    );
    metadata.modelName ??= safeString(
      quotaDimensions?.model ??
      errorMetadata?.model,
    );
  }

  return metadata;
}

export function classifyDirectorProviderFailure(error: unknown): DirectorProviderFailureCategory {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = typeof record.status === 'number'
    ? record.status
    : typeof record.statusCode === 'number'
      ? record.statusCode
      : null;
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (
    status === 400 &&
    /\b(?:safety|moderation|blocked|policy|prohibited|responsible ai)\b/.test(message)
  ) {
    return 'provider_moderation';
  }
  if (status === 401 || status === 403) return 'provider_authentication';
  if (status === 429 || /\brate.?limit|quota\b/.test(message)) return 'provider_rate_limit';
  if (status === 408 || /\btimeout|timed out|deadline\b/.test(message)) return 'provider_timeout';
  if (status === 404 || /\bmodel\b.*\bnot found\b/.test(message)) return 'provider_configuration';
  return 'provider_request_failed';
}

function interactionRecord(value: unknown) {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

export async function waitForGoogleInteraction(input: {
  initialInteraction: unknown;
  getInteraction: (id: string) => Promise<unknown>;
  maximumPolls?: number;
  intervalMs?: number;
}) {
  let interaction = input.initialInteraction;
  const maximumPolls = Math.max(1, Math.min(input.maximumPolls ?? 52, 60));
  const intervalMs = Math.max(250, Math.min(input.intervalMs ?? 5_000, 10_000));
  for (let poll = 0; poll < maximumPolls; poll += 1) {
    const current = interactionRecord(interaction);
    const status = typeof current?.status === 'string' ? current.status : 'completed';
    if (status === 'completed') return interaction;
    if (status === 'failed' || status === 'cancelled') {
      const safeFailure = /\b(?:safety|moderation|blocked|policy|prohibited|responsible ai)\b/i
        .test(JSON.stringify(current))
        ? 'The Director provider interaction was blocked by safety moderation.'
        : 'The Director provider interaction did not complete.';
      const error = new Error(safeFailure);
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const interactionId = typeof current?.id === 'string' ? current.id : '';
    if (!interactionId) throw new Error('The Director provider interaction has no identifier.');
    if (poll + 1 < maximumPolls) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      interaction = await input.getInteraction(interactionId);
    }
  }
  const timeout = new Error('The Director provider interaction timed out.');
  (timeout as Error & { status?: number }).status = 408;
  throw timeout;
}

export async function executeGoogleMediaInteraction(
  payload: GoogleInteractionPayload,
  context: GoogleMediaExecutionContext,
) {
  const decision = assertPaidOperationAuthorized({
    operation: context.operation,
    decision: context.decision,
    requestsAlreadyMade: context.telemetry.requestsByOperation[context.operation],
  });
  const client = createGoogleMediaClient(context.apiKey);
  const requestTelemetry = recordPaidRequest(context.telemetry, decision, context.operation);
  try {
    const initialInteraction = await client.interactions.create(payload, {
      maxRetries: 0,
    });
    const interaction = await waitForGoogleInteraction({
      initialInteraction,
      getInteraction: (id) => client.interactions.get(id),
    });
    return {
      interaction,
      telemetry: recordDirectorCostOutcome(requestTelemetry, {
        operation: context.operation,
        status: 'completed',
      }),
    };
  } catch (error) {
    throw new DirectorProviderExecutionError(
      recordDirectorCostOutcome(requestTelemetry, {
        operation: context.operation,
        status: 'failed',
      }),
      classifyDirectorProviderFailure(error),
      extractDirectorProviderSafeFailureMetadata(error, String(payload.model ?? '')),
    );
  }
}
