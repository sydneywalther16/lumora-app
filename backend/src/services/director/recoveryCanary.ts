import { createHash } from 'node:crypto';
import { buildOmniFlashPayload } from './adapters';
import {
  createDirectorCostTelemetry,
  type DirectorBudgetDecision,
  type DirectorCostTelemetry,
} from './budget';
import {
  DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD,
  directorCanarySceneHash,
  estimateDirectorInteractionCost,
  type DirectorCanaryFailureCategory,
  type DirectorInteractionSummaries,
} from './canary';
import type { DirectorPlan, DirectorShot } from './contracts';
import {
  DirectorProviderExecutionError,
  type DirectorProviderSafeFailureMetadata,
  type GoogleInteractionPayload,
  type GoogleInteractionStructuralSummary,
  type GoogleMediaExecutionContext,
} from './googleMedia';
import {
  directorMediaSafeTelemetry,
  extractDirectorMediaOutput,
  identifyDirectorMediaArtifact,
  type DirectorMediaCandidate,
} from './output';

export const DIRECTOR_VIDEO_RECOVERY_MODE = 'director_video_recovery_canary';
export const DIRECTOR_VIDEO_RECOVERY_MAXIMUM_COST_USD = 1;

export type DirectorVideoRecoveryFailureCategory =
  | DirectorCanaryFailureCategory
  | 'stored_anchor_missing'
  | 'stored_anchor_not_owned'
  | 'stored_anchor_invalid'
  | 'stored_anchor_hash_mismatch'
  | 'stored_anchor_artifact_mismatch';

export type DirectorVideoRecoveryAuthorization = {
  id: string;
  userId: string;
  sceneHash: string;
  mode: typeof DIRECTOR_VIDEO_RECOVERY_MODE;
  status: 'running';
  maximumCostUsd: 1;
  maximumAnchorRequests: 0;
  maximumVideoRequests: 1;
  maximumRetryRequests: 0;
  maximumFallbackRequests: 0;
  maximumRepairRequests: 0;
  idempotencyKey: string;
  recordedAt: string;
  expiresAt: string;
  consumedAt: string;
  sourceAuthorizationId: string;
  anchorMediaArtifactId: string;
  anchorStorageBucket: string;
  anchorStorageObject: string;
  anchorContentSha256: string;
  anchorMimeType: string;
  anchorByteLength: number;
};

export type StoredDirectorAnchor = {
  ownerUserId: string;
  sourceAuthorizationId: string;
  sourceIdempotencyKey: string;
  mediaArtifactId: string;
  storageBucket: string;
  storageObject: string;
  contentSha256: string;
  mimeType: string;
  byteLength: number;
  bytes: Uint8Array;
};

type GoogleInteractionResult = {
  interaction: unknown;
  telemetry: DirectorCostTelemetry;
  interactionSummary?: GoogleInteractionStructuralSummary | null;
};

export type DirectorVideoRecoveryDependencies = {
  loadStoredAnchor(): Promise<StoredDirectorAnchor>;
  runVideo(
    payload: GoogleInteractionPayload,
    context: GoogleMediaExecutionContext,
  ): Promise<GoogleInteractionResult>;
  resolveMediaBytes(output: DirectorMediaCandidate): Promise<Uint8Array>;
};

export type DirectorVideoRecoveryResult =
  | {
      ok: true;
      anchorSuccess: true;
      videoSuccess: true;
      storedAnchor: StoredDirectorAnchor;
      videoProviderInteractionId: string;
      videoMediaArtifactId: string;
      videoBytes: Uint8Array;
      videoMimeType: string;
      telemetry: DirectorCostTelemetry;
      estimatedCostUsd: number;
      actualCostUsd: number | null;
      interactionSummaries: DirectorInteractionSummaries;
    }
  | {
      ok: false;
      anchorSuccess: boolean;
      videoSuccess: false;
      failureCategory: DirectorVideoRecoveryFailureCategory;
      providerFailureMetadata: DirectorProviderSafeFailureMetadata | null;
      telemetry: DirectorCostTelemetry;
      estimatedCostUsd: number | null;
      actualCostUsd: number | null;
      interactionSummaries: DirectorInteractionSummaries;
    };

export class StoredDirectorAnchorError extends Error {
  readonly category: DirectorVideoRecoveryFailureCategory;

  constructor(category: DirectorVideoRecoveryFailureCategory) {
    super('The stored Director scene anchor is unavailable for recovery.');
    this.name = 'StoredDirectorAnchorError';
    this.category = category;
  }
}

export function assertDirectorVideoRecoveryAuthorization(
  authorization: DirectorVideoRecoveryAuthorization,
  now = new Date(),
) {
  if (authorization.mode !== DIRECTOR_VIDEO_RECOVERY_MODE) {
    throw new Error('The Director authorization has the wrong internal mode.');
  }
  if (authorization.status !== 'running' || !authorization.consumedAt) {
    throw new Error('The Director recovery authorization was not atomically consumed.');
  }
  if (authorization.sceneHash !== directorCanarySceneHash()) {
    throw new Error('The Director recovery authorization has the wrong scene.');
  }
  if (
    authorization.maximumCostUsd !== DIRECTOR_VIDEO_RECOVERY_MAXIMUM_COST_USD ||
    authorization.maximumAnchorRequests !== 0 ||
    authorization.maximumVideoRequests !== 1 ||
    authorization.maximumRetryRequests !== 0 ||
    authorization.maximumFallbackRequests !== 0 ||
    authorization.maximumRepairRequests !== 0
  ) {
    throw new Error('The Director recovery authorization has invalid limits.');
  }
  if (
    !authorization.idempotencyKey.trim() ||
    !authorization.sourceAuthorizationId.trim() ||
    !authorization.anchorMediaArtifactId.trim() ||
    !authorization.anchorStorageObject.trim() ||
    !/^[a-f0-9]{64}$/i.test(authorization.anchorContentSha256) ||
    authorization.anchorByteLength <= 0
  ) {
    throw new Error('The Director recovery authorization is incomplete.');
  }
  if (new Date(authorization.expiresAt).getTime() <= now.getTime()) {
    throw new Error('The Director recovery authorization has expired.');
  }
}

export function verifyStoredDirectorAnchor(input: {
  authorization: DirectorVideoRecoveryAuthorization;
  stored: StoredDirectorAnchor;
}) {
  const { authorization, stored } = input;
  if (stored.ownerUserId !== authorization.userId) {
    throw new StoredDirectorAnchorError('stored_anchor_not_owned');
  }
  if (
    stored.sourceAuthorizationId !== authorization.sourceAuthorizationId ||
    stored.storageBucket !== authorization.anchorStorageBucket ||
    stored.storageObject !== authorization.anchorStorageObject ||
    stored.mediaArtifactId !== authorization.anchorMediaArtifactId
  ) {
    throw new StoredDirectorAnchorError('stored_anchor_artifact_mismatch');
  }
  if (
    !stored.bytes.byteLength ||
    stored.bytes.byteLength !== stored.byteLength ||
    stored.byteLength !== authorization.anchorByteLength ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(stored.mimeType) ||
    stored.mimeType !== authorization.anchorMimeType ||
    stored.storageBucket !== 'lumora-assets' ||
    !stored.storageObject.startsWith(
      `${authorization.userId}/director/${authorization.sourceAuthorizationId}/`,
    )
  ) {
    throw new StoredDirectorAnchorError('stored_anchor_invalid');
  }
  const contentHash = createHash('sha256').update(stored.bytes).digest('hex');
  if (
    contentHash !== stored.contentSha256 ||
    contentHash !== authorization.anchorContentSha256
  ) {
    throw new StoredDirectorAnchorError('stored_anchor_hash_mismatch');
  }
  const identified = identifyDirectorMediaArtifact({
    candidate: {
      providerInteractionId: null,
      kind: 'scene_anchor',
      mimeType: stored.mimeType,
      data: Buffer.from(stored.bytes).toString('base64'),
      uri: null,
      status: 'completed',
      safeSummary: {
        outputCount: 1,
        outputTypes: ['image'],
        selectedSource: 'output_image',
        selectedMimeType: stored.mimeType,
        selectedHasData: true,
        selectedInlineDataCharacterLength: null,
        selectedHasUri: false,
      },
    },
    bytes: stored.bytes,
    context: {
      authorizationId: stored.sourceAuthorizationId,
      idempotencyKey: stored.sourceIdempotencyKey,
    },
  });
  if (identified.mediaArtifactId !== authorization.anchorMediaArtifactId) {
    throw new StoredDirectorAnchorError('stored_anchor_artifact_mismatch');
  }
  return stored;
}

function oneCandidateShot(plan: DirectorPlan): DirectorShot {
  return {
    id: 'director-recovery-candidate',
    summary: plan.sceneSummary,
    action: plan.action,
    cameraPlan: plan.cameraPlan,
    durationSeconds: 4,
  };
}

function videoDecision(authorization: DirectorVideoRecoveryAuthorization): DirectorBudgetDecision {
  return {
    id: `${authorization.id}:primary_video`,
    operation: 'primary_video',
    authorizedBy: 'user',
    maximumRequests: 1,
    recordedAt: authorization.recordedAt,
  };
}

function failed(input: {
  category: DirectorVideoRecoveryFailureCategory;
  telemetry: DirectorCostTelemetry;
  anchorSuccess?: boolean;
  providerFailureMetadata?: DirectorProviderSafeFailureMetadata | null;
  interactionSummaries?: DirectorInteractionSummaries;
}): DirectorVideoRecoveryResult {
  return {
    ok: false,
    anchorSuccess: Boolean(input.anchorSuccess),
    videoSuccess: false,
    failureCategory: input.category,
    providerFailureMetadata: input.providerFailureMetadata ?? null,
    telemetry: input.telemetry,
    estimatedCostUsd: input.anchorSuccess ? DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD : null,
    actualCostUsd: null,
    interactionSummaries: input.interactionSummaries ?? {},
  };
}

export async function runDirectorVideoRecoverySequence(input: {
  apiKey: string;
  authorization: DirectorVideoRecoveryAuthorization;
  plan: DirectorPlan;
  dependencies: DirectorVideoRecoveryDependencies;
}): Promise<DirectorVideoRecoveryResult> {
  assertDirectorVideoRecoveryAuthorization(input.authorization);
  let telemetry = createDirectorCostTelemetry();
  const interactionSummaries: DirectorInteractionSummaries = {};
  if (DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD > input.authorization.maximumCostUsd) {
    return failed({ category: 'budget_guard', telemetry });
  }

  let storedAnchor: StoredDirectorAnchor;
  try {
    storedAnchor = verifyStoredDirectorAnchor({
      authorization: input.authorization,
      stored: await input.dependencies.loadStoredAnchor(),
    });
    interactionSummaries.sceneAnchor = {
      hasProviderInteractionId: false,
      acceptedCompletedResponseWithoutId: true,
      mediaIdentitySource: 'content_hash',
      normalizedStatus: 'completed',
      selectedOutputShape: 'output_image',
      mimeType: storedAnchor.mimeType,
      inlineDataPresent: false,
      inlineDataCharacterLength: null,
      uriPresent: false,
      storageSucceeded: true,
    };
  } catch (error) {
    return failed({
      category: error instanceof StoredDirectorAnchorError
        ? error.category
        : 'stored_anchor_missing',
      telemetry,
      interactionSummaries,
    });
  }

  const payload = buildOmniFlashPayload({
    anchor: {
      data: Buffer.from(storedAnchor.bytes).toString('base64'),
      mimeType: storedAnchor.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    },
    plan: input.plan,
    shot: oneCandidateShot(input.plan),
    durationSeconds: 4,
    aspectRatio: '9:16',
    store: false,
  });

  let interaction: unknown;
  let structuralSummary: GoogleInteractionStructuralSummary | null = null;
  try {
    const result = await input.dependencies.runVideo(payload, {
      apiKey: input.apiKey,
      operation: 'primary_video',
      decision: videoDecision(input.authorization),
      telemetry,
    });
    interaction = result.interaction;
    telemetry = result.telemetry;
    structuralSummary = result.interactionSummary ?? null;
  } catch (error) {
    const providerError = error instanceof DirectorProviderExecutionError ? error : null;
    if (providerError?.interactionSummary) {
      interactionSummaries.primaryVideo = directorMediaSafeTelemetry({
        structuralSummary: providerError.interactionSummary,
      });
    }
    return failed({
      category: providerError?.safeCategory ?? 'provider_request_failed',
      telemetry: providerError?.telemetry ?? telemetry,
      anchorSuccess: true,
      providerFailureMetadata: providerError?.safeMetadata ?? null,
      interactionSummaries,
    });
  }

  try {
    const candidate = extractDirectorMediaOutput(interaction, 'primary_video');
    const bytes = await input.dependencies.resolveMediaBytes(candidate);
    if (!candidate.providerInteractionId || !bytes.byteLength) throw new Error('invalid video');
    const output = identifyDirectorMediaArtifact({
      candidate,
      bytes,
      context: {
        authorizationId: input.authorization.id,
        idempotencyKey: input.authorization.idempotencyKey,
      },
    });
    interactionSummaries.primaryVideo = directorMediaSafeTelemetry({
      structuralSummary,
      output,
    });
    const cost = estimateDirectorInteractionCost(interaction, 'primary_video');
    return {
      ok: true,
      anchorSuccess: true,
      videoSuccess: true,
      storedAnchor,
      videoProviderInteractionId: output.providerInteractionId as string,
      videoMediaArtifactId: output.mediaArtifactId,
      videoBytes: bytes,
      videoMimeType: output.mimeType,
      telemetry,
      estimatedCostUsd: cost ?? DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD,
      actualCostUsd: cost,
      interactionSummaries,
    };
  } catch {
    return failed({
      category: 'invalid_video_output',
      telemetry,
      anchorSuccess: true,
      interactionSummaries,
    });
  }
}
