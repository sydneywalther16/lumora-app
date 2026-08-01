import { createHash } from 'node:crypto';
import {
  buildNanoBananaPayload,
  buildOmniFlashPayload,
} from './adapters';
import {
  createDirectorCostTelemetry,
  type DirectorBudgetDecision,
  type DirectorCostTelemetry,
} from './budget';
import type { DirectorPlan, DirectorShot, UserOwnedFrontReference } from './contracts';
import {
  DirectorProviderExecutionError,
  type DirectorProviderFailureCategory,
  type DirectorProviderSafeFailureMetadata,
  type GoogleInteractionPayload,
  type GoogleInteractionStructuralSummary,
  type GoogleMediaExecutionContext,
} from './googleMedia';
import {
  directorMediaSafeTelemetry,
  DirectorMediaOutputError,
  extractDirectorMediaOutput,
  identifyDirectorMediaArtifact,
  type DirectorAnchorOutputFailureCategory,
  type DirectorMediaCandidate,
  type DirectorMediaOutput,
  type DirectorMediaSafeTelemetry,
} from './output';

export const DIRECTOR_CANARY_SCENE =
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.';
export const DIRECTOR_CANARY_MAXIMUM_COST_USD = 2;
export const DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD = 0.477;
export const DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD = 0.40;

export type DirectorCanaryFailureCategory =
  | DirectorProviderFailureCategory
  | 'authorization_missing'
  | 'authorization_invalid'
  | 'authorization_expired'
  | 'authorization_consumed'
  | 'idempotency_conflict'
  | 'budget_guard'
  | 'front_reference_missing'
  | 'front_reference_invalid'
  | 'invalid_anchor_output'
  | DirectorAnchorOutputFailureCategory
  | 'invalid_video_output'
  | 'persistence_failed';

export type DirectorCanaryAuthorization = {
  id: string;
  userId: string;
  sceneHash: string;
  status: 'running';
  maximumCostUsd: 2;
  maximumAnchorRequests: 1;
  maximumVideoRequests: 1;
  maximumRetryRequests: 0;
  maximumFallbackRequests: 0;
  maximumRepairRequests: 0;
  idempotencyKey: string;
  recordedAt: string;
  expiresAt: string;
  consumedAt: string;
};

type GoogleInteractionResult = {
  interaction: unknown;
  telemetry: DirectorCostTelemetry;
  interactionSummary?: GoogleInteractionStructuralSummary | null;
};

export type DirectorInteractionSummaries = {
  sceneAnchor?: DirectorMediaSafeTelemetry;
  primaryVideo?: DirectorMediaSafeTelemetry;
};

export type DirectorCanaryExecutionDependencies = {
  runAnchor(
    payload: GoogleInteractionPayload,
    context: GoogleMediaExecutionContext,
  ): Promise<GoogleInteractionResult>;
  runVideo(
    payload: GoogleInteractionPayload,
    context: GoogleMediaExecutionContext,
  ): Promise<GoogleInteractionResult>;
  resolveMediaBytes(output: DirectorMediaCandidate): Promise<Uint8Array>;
  persistAnchor?(input: {
    providerInteractionId: string | null;
    mediaArtifactId: string;
    mediaIdentitySource: DirectorMediaOutput['mediaIdentitySource'];
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<void>;
};

export type DirectorCanarySequenceResult =
  | {
      ok: true;
      anchorSuccess: true;
      videoSuccess: true;
      anchorProviderInteractionId: string | null;
      videoProviderInteractionId: string;
      anchorMediaArtifactId: string;
      videoMediaArtifactId: string;
      anchorBytes: Uint8Array;
      videoBytes: Uint8Array;
      anchorMimeType: string;
      videoMimeType: string;
      telemetry: DirectorCostTelemetry;
      estimatedCostUsd: number;
      actualCostUsd: number | null;
      publicCaption: string;
      syntheticDisclosure: 'Synthetic portrayal';
      interactionSummaries: DirectorInteractionSummaries;
    }
  | {
      ok: false;
      anchorSuccess: boolean;
      videoSuccess: false;
      failureCategory: DirectorCanaryFailureCategory;
      providerFailureMetadata: DirectorProviderSafeFailureMetadata | null;
      telemetry: DirectorCostTelemetry;
      estimatedCostUsd: number | null;
      actualCostUsd: number | null;
      publicCaption: string;
      syntheticDisclosure: 'Synthetic portrayal';
      interactionSummaries: DirectorInteractionSummaries;
    };

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function directorCanarySceneHash(scene = DIRECTOR_CANARY_SCENE) {
  return createHash('sha256').update(compact(scene), 'utf8').digest('hex');
}

export function assertDirectorCanaryAuthorization(
  authorization: DirectorCanaryAuthorization,
  now = new Date(),
) {
  if (authorization.status !== 'running' || !authorization.consumedAt) {
    throw new Error('The one-time Director authorization has not been atomically consumed.');
  }
  if (authorization.sceneHash !== directorCanarySceneHash()) {
    throw new Error('The Director authorization is not valid for this scene.');
  }
  if (
    authorization.maximumCostUsd !== DIRECTOR_CANARY_MAXIMUM_COST_USD ||
    authorization.maximumAnchorRequests !== 1 ||
    authorization.maximumVideoRequests !== 1 ||
    authorization.maximumRetryRequests !== 0 ||
    authorization.maximumFallbackRequests !== 0 ||
    authorization.maximumRepairRequests !== 0
  ) {
    throw new Error('The Director authorization does not match the approved budget.');
  }
  if (!authorization.idempotencyKey.trim()) {
    throw new Error('The Director authorization is missing its idempotency key.');
  }
  if (new Date(authorization.expiresAt).getTime() <= now.getTime()) {
    throw new Error('The one-time Director authorization has expired.');
  }
}

function decision(
  authorization: DirectorCanaryAuthorization,
  operation: 'scene_anchor' | 'primary_video',
): DirectorBudgetDecision {
  return {
    id: `${authorization.id}:${operation}`,
    operation,
    authorizedBy: 'user',
    maximumRequests: 1,
    recordedAt: authorization.recordedAt,
  };
}

function oneCandidateShot(plan: DirectorPlan): DirectorShot {
  return {
    id: 'director-canary-candidate',
    summary: plan.sceneSummary,
    action: plan.action,
    cameraPlan: plan.cameraPlan,
    durationSeconds: 4,
  };
}

type InteractionUsage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  output_tokens_by_modality?: Array<{ modality?: string; tokens?: number }>;
};

function interactionUsage(interaction: unknown): InteractionUsage | null {
  if (!interaction || typeof interaction !== 'object') return null;
  const usage = (interaction as Record<string, unknown>).usage;
  return usage && typeof usage === 'object' ? usage as InteractionUsage : null;
}

export function estimateDirectorInteractionCost(
  interaction: unknown,
  operation: 'scene_anchor' | 'primary_video',
): number | null {
  const usage = interactionUsage(interaction);
  if (!usage) return null;
  const inputTokens = Number(usage.total_input_tokens ?? 0);
  const outputTokens = Number(usage.total_output_tokens ?? 0);
  const pricedModality = operation === 'scene_anchor' ? 'image' : 'video';
  const pricedOutputTokens = (usage.output_tokens_by_modality ?? [])
    .filter((item) => item.modality?.toLowerCase() === pricedModality)
    .reduce((sum, item) => sum + Number(item.tokens ?? 0), 0);
  const otherOutputTokens = Math.max(0, outputTokens - pricedOutputTokens);
  const inputRate = operation === 'scene_anchor' ? 0.5 : 1.5;
  const mediaOutputRate = operation === 'scene_anchor' ? 60 : 17.5;
  const otherOutputRate = operation === 'scene_anchor' ? 3 : 9;
  return Number((
    inputTokens * inputRate / 1_000_000 +
    pricedOutputTokens * mediaOutputRate / 1_000_000 +
    otherOutputTokens * otherOutputRate / 1_000_000
  ).toFixed(5));
}

function failedResult(input: {
  plan: DirectorPlan;
  anchorSuccess: boolean;
  failureCategory: DirectorCanaryFailureCategory;
  telemetry: DirectorCostTelemetry;
  providerFailureMetadata?: DirectorProviderSafeFailureMetadata | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  interactionSummaries?: DirectorInteractionSummaries;
}): DirectorCanarySequenceResult {
  return {
    ok: false,
    anchorSuccess: input.anchorSuccess,
    videoSuccess: false,
    failureCategory: input.failureCategory,
    providerFailureMetadata: input.providerFailureMetadata ?? null,
    telemetry: input.telemetry,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    actualCostUsd: input.actualCostUsd ?? null,
    publicCaption: input.plan.publicCaption,
    syntheticDisclosure: input.plan.syntheticDisclosure,
    interactionSummaries: input.interactionSummaries ?? {},
  };
}

export async function runDirectorCanarySequence(input: {
  apiKey: string;
  authorization: DirectorCanaryAuthorization;
  plan: DirectorPlan;
  frontReference: UserOwnedFrontReference;
  dependencies: DirectorCanaryExecutionDependencies;
  projectedMaximumCostUsd?: number;
}): Promise<DirectorCanarySequenceResult> {
  assertDirectorCanaryAuthorization(input.authorization);
  let telemetry = createDirectorCostTelemetry();
  const interactionSummaries: DirectorInteractionSummaries = {};
  const projectedMaximumCostUsd =
    input.projectedMaximumCostUsd ?? DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD;

  if (
    projectedMaximumCostUsd > input.authorization.maximumCostUsd ||
    projectedMaximumCostUsd > DIRECTOR_CANARY_MAXIMUM_COST_USD
  ) {
    return failedResult({
      plan: input.plan,
      anchorSuccess: false,
      failureCategory: 'budget_guard',
      telemetry,
      estimatedCostUsd: projectedMaximumCostUsd,
      interactionSummaries,
    });
  }

  const anchorPayload = buildNanoBananaPayload({
    reference: input.frontReference,
    plan: input.plan,
    aspectRatio: '9:16',
  });

  let anchorInteraction: unknown;
  let anchorStructuralSummary: GoogleInteractionStructuralSummary | null = null;
  try {
    const anchorResult = await input.dependencies.runAnchor(anchorPayload, {
      apiKey: input.apiKey,
      operation: 'scene_anchor',
      decision: decision(input.authorization, 'scene_anchor'),
      telemetry,
    });
    anchorInteraction = anchorResult.interaction;
    telemetry = anchorResult.telemetry;
    if (anchorResult.interactionSummary) {
      anchorStructuralSummary = anchorResult.interactionSummary;
      interactionSummaries.sceneAnchor = directorMediaSafeTelemetry({
        structuralSummary: anchorStructuralSummary,
      });
    }
  } catch (error) {
    const providerError = error instanceof DirectorProviderExecutionError ? error : null;
    if (providerError?.interactionSummary) {
      interactionSummaries.sceneAnchor = directorMediaSafeTelemetry({
        structuralSummary: providerError.interactionSummary,
      });
    }
    return failedResult({
      plan: input.plan,
      anchorSuccess: false,
      failureCategory: providerError?.safeCategory ?? 'provider_request_failed',
      providerFailureMetadata: providerError?.safeMetadata ?? null,
      telemetry: providerError?.telemetry ?? telemetry,
      interactionSummaries,
    });
  }

  let anchorCandidate: DirectorMediaCandidate;
  try {
    anchorCandidate = extractDirectorMediaOutput(anchorInteraction, 'scene_anchor');
    interactionSummaries.sceneAnchor = directorMediaSafeTelemetry({
      structuralSummary: anchorStructuralSummary,
      candidate: anchorCandidate,
    });
  } catch (error) {
    return failedResult({
      plan: input.plan,
      anchorSuccess: false,
      failureCategory: error instanceof DirectorMediaOutputError
        ? error.category
        : 'anchor_output_unrecognized',
      telemetry,
      interactionSummaries,
    });
  }

  let anchorBytes: Uint8Array;
  let anchorOutput: DirectorMediaOutput;
  try {
    anchorBytes = await input.dependencies.resolveMediaBytes(anchorCandidate);
    if (!anchorBytes.byteLength) throw new Error('Missing anchor bytes.');
    anchorOutput = identifyDirectorMediaArtifact({
      candidate: anchorCandidate,
      bytes: anchorBytes,
      context: {
        authorizationId: input.authorization.id,
        idempotencyKey: input.authorization.idempotencyKey,
      },
    });
    interactionSummaries.sceneAnchor = directorMediaSafeTelemetry({
      structuralSummary: anchorStructuralSummary,
      output: anchorOutput,
    });
  } catch {
    return failedResult({
      plan: input.plan,
      anchorSuccess: false,
      failureCategory: 'anchor_media_missing',
      telemetry,
      interactionSummaries,
    });
  }

  const anchorCost = estimateDirectorInteractionCost(anchorInteraction, 'scene_anchor');
  try {
    await input.dependencies.persistAnchor?.({
      providerInteractionId: anchorOutput.providerInteractionId,
      mediaArtifactId: anchorOutput.mediaArtifactId,
      mediaIdentitySource: anchorOutput.mediaIdentitySource,
      bytes: anchorBytes,
      mimeType: anchorOutput.mimeType,
    });
    interactionSummaries.sceneAnchor = directorMediaSafeTelemetry({
      structuralSummary: anchorStructuralSummary,
      output: anchorOutput,
      storageSucceeded: Boolean(input.dependencies.persistAnchor),
    });
  } catch {
    return failedResult({
      plan: input.plan,
      anchorSuccess: true,
      failureCategory: 'persistence_failed',
      telemetry,
      actualCostUsd: anchorCost,
      interactionSummaries,
    });
  }

  const projectedTotalAfterAnchor = Number((
    (anchorCost ?? (DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD - DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD)) +
    DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD
  ).toFixed(5));
  if (projectedTotalAfterAnchor > input.authorization.maximumCostUsd) {
    return failedResult({
      plan: input.plan,
      anchorSuccess: true,
      failureCategory: 'budget_guard',
      telemetry,
      estimatedCostUsd: projectedTotalAfterAnchor,
      actualCostUsd: anchorCost,
      interactionSummaries,
    });
  }

  const videoPayload = buildOmniFlashPayload({
    anchor: {
      data: Buffer.from(anchorBytes).toString('base64'),
      mimeType: anchorOutput.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    },
    plan: input.plan,
    shot: oneCandidateShot(input.plan),
    durationSeconds: 4,
    aspectRatio: '9:16',
    store: false,
  });

  let videoInteraction: unknown;
  let videoStructuralSummary: GoogleInteractionStructuralSummary | null = null;
  try {
    const videoResult = await input.dependencies.runVideo(videoPayload, {
      apiKey: input.apiKey,
      operation: 'primary_video',
      decision: decision(input.authorization, 'primary_video'),
      telemetry,
    });
    videoInteraction = videoResult.interaction;
    telemetry = videoResult.telemetry;
    if (videoResult.interactionSummary) {
      videoStructuralSummary = videoResult.interactionSummary;
      interactionSummaries.primaryVideo = directorMediaSafeTelemetry({
        structuralSummary: videoStructuralSummary,
      });
    }
  } catch (error) {
    const providerError = error instanceof DirectorProviderExecutionError ? error : null;
    if (providerError?.interactionSummary) {
      interactionSummaries.primaryVideo = directorMediaSafeTelemetry({
        structuralSummary: providerError.interactionSummary,
      });
    }
    return failedResult({
      plan: input.plan,
      anchorSuccess: true,
      failureCategory: providerError?.safeCategory ?? 'provider_request_failed',
      providerFailureMetadata: providerError?.safeMetadata ?? null,
      telemetry: providerError?.telemetry ?? telemetry,
      estimatedCostUsd: projectedTotalAfterAnchor,
      actualCostUsd: anchorCost,
      interactionSummaries,
    });
  }

  let videoCandidate: DirectorMediaCandidate;
  let videoOutput: DirectorMediaOutput;
  let videoBytes: Uint8Array;
  try {
    videoCandidate = extractDirectorMediaOutput(videoInteraction, 'primary_video');
    videoBytes = await input.dependencies.resolveMediaBytes(videoCandidate);
    if (!videoCandidate.providerInteractionId || !videoBytes.byteLength) {
      throw new Error('Invalid video output.');
    }
    videoOutput = identifyDirectorMediaArtifact({
      candidate: videoCandidate,
      bytes: videoBytes,
      context: {
        authorizationId: input.authorization.id,
        idempotencyKey: input.authorization.idempotencyKey,
      },
    });
    interactionSummaries.primaryVideo = directorMediaSafeTelemetry({
      structuralSummary: videoStructuralSummary,
      output: videoOutput,
    });
  } catch {
    return failedResult({
      plan: input.plan,
      anchorSuccess: true,
      failureCategory: 'invalid_video_output',
      telemetry,
      estimatedCostUsd: projectedTotalAfterAnchor,
      actualCostUsd: anchorCost,
      interactionSummaries,
    });
  }

  const videoCost = estimateDirectorInteractionCost(videoInteraction, 'primary_video');
  const actualCostUsd = anchorCost !== null && videoCost !== null
    ? Number((anchorCost + videoCost).toFixed(5))
    : null;

  return {
    ok: true,
    anchorSuccess: true,
    videoSuccess: true,
    anchorProviderInteractionId: anchorOutput.providerInteractionId,
    videoProviderInteractionId: videoOutput.providerInteractionId,
    anchorMediaArtifactId: anchorOutput.mediaArtifactId,
    videoMediaArtifactId: videoOutput.mediaArtifactId,
    anchorBytes,
    videoBytes,
    anchorMimeType: anchorOutput.mimeType,
    videoMimeType: videoOutput.mimeType,
    telemetry,
    estimatedCostUsd: actualCostUsd ?? projectedTotalAfterAnchor,
    actualCostUsd,
    publicCaption: input.plan.publicCaption,
    syntheticDisclosure: input.plan.syntheticDisclosure,
    interactionSummaries,
  };
}
