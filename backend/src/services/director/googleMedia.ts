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
  | 'interaction_envelope_unrecognized'
  | 'provider_request_failed';

export type GoogleInteractionStatus =
  | 'queued'
  | 'in_progress'
  | 'running'
  | 'requires_action'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'budget_exceeded';

export type GoogleInteractionStructuralSummary = {
  runtimeConstructor: string | null;
  rootFields: string[];
  wrapperPath: string[];
  normalizedFields: string[];
  hasInteractionId: boolean;
  status: GoogleInteractionStatus | null;
  stepCount: number;
  stepTypes: string[];
  modelOutputContentTypes: string[];
  outputsCount: number;
  outputsTypes: string[];
  outputImagePresent: boolean;
  outputVideoPresent: boolean;
  imageMimeType: string | null;
  imageDataPresent: boolean;
  imageDataCharacterLength: number | null;
  imageUriPresent: boolean;
  imageUriScheme: string | null;
  usagePresent: boolean;
};

export type NormalizedGoogleInteractionEnvelope = {
  interaction: Record<string, unknown> | null;
  interactionId: string | null;
  status: GoogleInteractionStatus | null;
  valid: boolean;
  partial: boolean;
  wrapperPath: string[];
  structuralSummary: GoogleInteractionStructuralSummary;
};

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
  readonly interactionSummary: GoogleInteractionStructuralSummary | null;

  constructor(
    telemetry: DirectorCostTelemetry,
    safeCategory: DirectorProviderFailureCategory,
    safeMetadata: DirectorProviderSafeFailureMetadata = emptySafeFailureMetadata(),
    interactionSummary: GoogleInteractionStructuralSummary | null = null,
  ) {
    super('The Director provider request did not complete.');
    this.name = 'DirectorProviderExecutionError';
    this.telemetry = telemetry;
    this.safeCategory = safeCategory;
    this.safeMetadata = safeMetadata;
    this.interactionSummary = interactionSummary;
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
  if (error instanceof GoogleInteractionEnvelopeError) {
    return 'interaction_envelope_unrecognized';
  }
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
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const GOOGLE_INTERACTION_STATUSES = new Set<GoogleInteractionStatus>([
  'queued',
  'in_progress',
  'running',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'budget_exceeded',
]);

const GOOGLE_INTERACTION_WRAPPER_KEYS = [
  'interaction',
  'data',
  'result',
  'value',
  'response',
] as const;
const GOOGLE_INTERACTION_MAXIMUM_WRAPPER_DEPTH = 3;

function interactionStatus(value: unknown): GoogleInteractionStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as GoogleInteractionStatus;
  return GOOGLE_INTERACTION_STATUSES.has(normalized) ? normalized : null;
}

function interactionId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeFieldNames(record: Record<string, unknown> | null) {
  if (!record) return [];
  return [...new Set(Object.keys(record)
    .filter((field) => !/(?:authorization|idempotency|session|token|secret|password|api.?key|prompt)/i.test(field))
    .map((field) => /^[a-z_][a-z0-9_.-]{0,79}$/i.test(field) ? field : 'unrecognized_field'))]
    .sort()
    .slice(0, 80);
}

function safeType(value: unknown) {
  const record = interactionRecord(value);
  const type = typeof record?.type === 'string' ? record.type.trim() : '';
  return /^[a-z_][a-z0-9_.-]{0,79}$/i.test(type) ? type : 'unknown';
}

function imageCandidate(record: Record<string, unknown> | null) {
  if (!record) return null;
  const direct = interactionRecord(record.output_image) ?? interactionRecord(record.outputImage);
  if (direct) return direct;

  const outputs = Array.isArray(record.outputs) ? record.outputs : [];
  const outputImage = outputs
    .filter((item) => interactionRecord(item)?.type === 'image' && interactionRecord(item)?.thought !== true)
    .at(-1);
  if (outputImage) return interactionRecord(outputImage);

  const steps = Array.isArray(record.steps) ? record.steps : [];
  const stepContent = steps.flatMap((step) => {
    const stepRecord = interactionRecord(step);
    return stepRecord?.type === 'model_output' && Array.isArray(stepRecord.content)
      ? stepRecord.content
      : [];
  });
  const stepImage = stepContent
    .filter((item) => interactionRecord(item)?.type === 'image' && interactionRecord(item)?.thought !== true)
    .at(-1);
  return interactionRecord(stepImage);
}

function structuralSummary(input: {
  root: Record<string, unknown> | null;
  normalized: Record<string, unknown> | null;
  wrapperPath: string[];
  runtimeConstructor: string | null;
}): GoogleInteractionStructuralSummary {
  const steps = Array.isArray(input.normalized?.steps) ? input.normalized.steps : [];
  const outputs = Array.isArray(input.normalized?.outputs) ? input.normalized.outputs : [];
  const modelOutputContent = steps.flatMap((step) => {
    const stepRecord = interactionRecord(step);
    return stepRecord?.type === 'model_output' && Array.isArray(stepRecord.content)
      ? stepRecord.content
      : [];
  });
  const image = imageCandidate(input.normalized);
  const mimeType = typeof image?.mime_type === 'string'
    ? image.mime_type
    : typeof image?.mimeType === 'string'
      ? image.mimeType
      : null;
  const data = typeof image?.data === 'string' ? image.data : null;
  const uri = typeof image?.uri === 'string' ? image.uri : null;
  const uriScheme = uri?.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? null;
  const status = interactionStatus(input.normalized?.status);
  return {
    runtimeConstructor: input.runtimeConstructor,
    rootFields: safeFieldNames(input.root),
    wrapperPath: [...input.wrapperPath],
    normalizedFields: safeFieldNames(input.normalized),
    hasInteractionId: Boolean(interactionId(input.normalized?.id)),
    status,
    stepCount: steps.length,
    stepTypes: steps.map(safeType).slice(0, 80),
    modelOutputContentTypes: modelOutputContent.map(safeType).slice(0, 80),
    outputsCount: outputs.length,
    outputsTypes: outputs.map(safeType).slice(0, 80),
    outputImagePresent: Boolean(
      interactionRecord(input.normalized?.output_image) ??
      interactionRecord(input.normalized?.outputImage),
    ),
    outputVideoPresent: Boolean(
      interactionRecord(input.normalized?.output_video) ??
      interactionRecord(input.normalized?.outputVideo),
    ),
    imageMimeType: mimeType && /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : null,
    imageDataPresent: Boolean(data),
    imageDataCharacterLength: data ? data.length : null,
    imageUriPresent: Boolean(uri),
    imageUriScheme: uriScheme,
    usagePresent: Boolean(interactionRecord(input.normalized?.usage)),
  };
}

function runtimeConstructorName(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' && /^[a-z_$][a-z0-9_$]{0,79}$/i.test(name)
    ? name
    : null;
}

export function normalizeGoogleInteractionEnvelope(
  value: unknown,
): NormalizedGoogleInteractionEnvelope {
  const root = interactionRecord(value);
  const runtimeConstructor = runtimeConstructorName(value);
  let current = root;
  const wrapperPath: string[] = [];

  for (let depth = 0; current && depth <= GOOGLE_INTERACTION_MAXIMUM_WRAPPER_DEPTH; depth += 1) {
    const id = interactionId(current.id);
    const status = interactionStatus(current.status);
    if (id || status || Array.isArray(current.steps)) {
      const valid = Boolean(id && status);
      return {
        interaction: valid ? current : null,
        interactionId: id,
        status,
        valid,
        partial: Boolean(id && !status),
        wrapperPath,
        structuralSummary: structuralSummary({
          root,
          normalized: current,
          wrapperPath,
          runtimeConstructor,
        }),
      };
    }
    if (depth === GOOGLE_INTERACTION_MAXIMUM_WRAPPER_DEPTH) break;
    const wrapperKey = GOOGLE_INTERACTION_WRAPPER_KEYS.find((key) => interactionRecord(current?.[key]));
    if (!wrapperKey) break;
    current = interactionRecord(current[wrapperKey]);
    wrapperPath.push(wrapperKey);
  }

  return {
    interaction: null,
    interactionId: null,
    status: null,
    valid: false,
    partial: false,
    wrapperPath,
    structuralSummary: structuralSummary({
      root,
      normalized: current,
      wrapperPath,
      runtimeConstructor,
    }),
  };
}

export class GoogleInteractionEnvelopeError extends Error {
  readonly structuralSummary: GoogleInteractionStructuralSummary;

  constructor(structuralSummary: GoogleInteractionStructuralSummary) {
    super('The Director provider interaction envelope was not recognized.');
    this.name = 'GoogleInteractionEnvelopeError';
    this.structuralSummary = structuralSummary;
  }
}

function terminalInteractionFailure(status: GoogleInteractionStatus) {
  return status === 'failed' ||
    status === 'cancelled' ||
    status === 'incomplete' ||
    status === 'budget_exceeded';
}

export async function waitForGoogleInteraction(input: {
  initialInteraction: unknown;
  getInteraction: (id: string) => Promise<unknown>;
  maximumPolls?: number;
  intervalMs?: number;
  onStructuralSummary?: (summary: GoogleInteractionStructuralSummary) => void;
}) {
  let envelope = normalizeGoogleInteractionEnvelope(input.initialInteraction);
  input.onStructuralSummary?.(envelope.structuralSummary);
  const maximumPolls = Math.max(1, Math.min(input.maximumPolls ?? 52, 60));
  const intervalMs = input.intervalMs === 0
    ? 0
    : Math.max(250, Math.min(input.intervalMs ?? 5_000, 10_000));
  for (let poll = 0; poll < maximumPolls; poll += 1) {
    if (envelope.valid && envelope.status === 'completed' && envelope.interaction) {
      return envelope.interaction;
    }
    if (envelope.valid && envelope.status && terminalInteractionFailure(envelope.status)) {
      const safeFailure = /\b(?:safety|moderation|blocked|policy|prohibited|responsible ai)\b/i
        .test(JSON.stringify(envelope.interaction))
        ? 'The Director provider interaction was blocked by safety moderation.'
        : 'The Director provider interaction did not complete.';
      const error = new Error(safeFailure);
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    if (!envelope.interactionId) {
      throw new GoogleInteractionEnvelopeError(envelope.structuralSummary);
    }
    if (poll + 1 < maximumPolls) {
      if (!envelope.partial && intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      const polled = await input.getInteraction(envelope.interactionId);
      envelope = normalizeGoogleInteractionEnvelope(polled);
      input.onStructuralSummary?.(envelope.structuralSummary);
    }
  }
  if (!envelope.valid) {
    throw new GoogleInteractionEnvelopeError(envelope.structuralSummary);
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
  let interactionSummary: GoogleInteractionStructuralSummary | null = null;
  try {
    const initialInteraction = await client.interactions.create(payload, {
      maxRetries: 0,
    });
    const interaction = await waitForGoogleInteraction({
      initialInteraction,
      getInteraction: (id) => client.interactions.get(id, undefined, { maxRetries: 0 }),
      onStructuralSummary: (summary) => {
        interactionSummary = summary;
      },
    });
    return {
      interaction,
      interactionSummary,
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
      error instanceof GoogleInteractionEnvelopeError
        ? error.structuralSummary
        : interactionSummary,
    );
  }
}
