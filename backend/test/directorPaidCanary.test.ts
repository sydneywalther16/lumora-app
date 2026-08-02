import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIRECTOR_CANARY_MAXIMUM_COST_USD,
  DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD,
  DIRECTOR_CANARY_SCENE,
  assertDirectorCanaryAuthorization,
  directorCanarySceneHash,
  runDirectorCanarySequence,
  type DirectorCanaryAuthorization,
} from '../src/services/director/canary';
import { recordPaidRequest } from '../src/services/director/budget';
import { buildDirectorProductionDryRun } from '../src/services/director/dryRunDiagnostics';
import {
  canStartDirectorCanary,
  formatDirectorCanaryCountdown,
  remainingDirectorCanarySeconds,
  synchronizedDirectorCanaryRunState,
} from '../../src/lib/directorCanaryStatus';
import {
  classifyDirectorProviderFailure,
  DirectorProviderExecutionError,
  extractDirectorProviderSafeFailureMetadata,
  normalizeGoogleInteractionEnvelope,
} from '../src/services/director/googleMedia';
import {
  directorOperationalTelemetry,
  mergeDirectorCanaryJobInteractionTelemetry,
  isIdempotentStorageObjectAlreadyExists,
  resolveDirectorCanaryAuthorizationClaim,
  resolveDirectorCanaryAuthorizationStatus,
  resolveDirectorCanaryStoredAuthorization,
  type DirectorAuthorizationClaimStore,
  type DirectorAuthorizationLookupStore,
  type DirectorAuthorizationRow,
  type DirectorAuthorizationStatusStore,
} from '../src/services/director/productionCanary';
import { directorMediaSafeTelemetry } from '../src/services/director/output';

const repositoryRoot = process.cwd();
const now = new Date();
const authorization: DirectorCanaryAuthorization = {
  id: '8f8d5d45-11a1-4f74-a7a0-75bea0013a5d',
  userId: '7fd6a630-2898-433c-a698-f1edfdcc25d7',
  sceneHash: directorCanarySceneHash(),
  status: 'running',
  maximumCostUsd: 2,
  maximumAnchorRequests: 1,
  maximumVideoRequests: 1,
  maximumRetryRequests: 0,
  maximumFallbackRequests: 0,
  maximumRepairRequests: 0,
  idempotencyKey: 'director-canary-test-key',
  recordedAt: new Date(now.getTime() - 60_000).toISOString(),
  expiresAt: new Date(now.getTime() + 29 * 60_000).toISOString(),
  consumedAt: now.toISOString(),
};

assert.equal(DIRECTOR_CANARY_SCENE, 'She walks through a candlelit mansion and pauses after hearing a sound behind her.');
assert.equal(directorCanarySceneHash().length, 64);
assert.equal(DIRECTOR_CANARY_MAXIMUM_COST_USD, 2);
assert.equal(DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD, 0.477);
assert.doesNotThrow(() => assertDirectorCanaryAuthorization(authorization, now));
assert.throws(
  () => assertDirectorCanaryAuthorization({
    ...authorization,
    maximumRetryRequests: 1 as 0,
  }, now),
  /approved budget/,
);

function authorizationRow(
  status: DirectorAuthorizationRow['status'],
  expiresAt = authorization.expiresAt,
): DirectorAuthorizationRow {
  return {
    id: authorization.id,
    user_id: authorization.userId,
    scene_hash: authorization.sceneHash,
    status,
    maximum_cost_usd: 2,
    maximum_anchor_requests: 1,
    maximum_video_requests: 1,
    maximum_retry_requests: 0,
    maximum_fallback_requests: 0,
    maximum_repair_requests: 0,
    idempotency_key: authorization.idempotencyKey,
    expires_at: expiresAt,
    consumed_at: status === 'authorized' ? null : now.toISOString(),
    started_at: status === 'authorized' ? null : now.toISOString(),
    completed_at: null,
    created_at: authorization.recordedAt,
  };
}

let atomicRow: DirectorAuthorizationRow | null = authorizationRow('authorized');
const atomicStore: DirectorAuthorizationClaimStore = {
  async claim(input) {
    if (
      !atomicRow ||
      atomicRow.status !== 'authorized' ||
      atomicRow.id !== input.authorizationId ||
      atomicRow.user_id !== input.userId ||
      atomicRow.scene_hash !== input.sceneHash ||
      atomicRow.idempotency_key !== input.idempotencyKey ||
      new Date(atomicRow.expires_at).getTime() <= now.getTime()
    ) {
      return null;
    }
    atomicRow = {
      ...atomicRow,
      status: 'running',
      consumed_at: now.toISOString(),
      started_at: now.toISOString(),
    };
    return atomicRow;
  },
  async find(input) {
    if (
      atomicRow?.id === input.authorizationId &&
      atomicRow.user_id === input.userId &&
      atomicRow.scene_hash === input.sceneHash &&
      atomicRow.idempotency_key === input.idempotencyKey
    ) {
      return atomicRow;
    }
    return null;
  },
};
const claimInput = {
  authorizationId: authorization.id,
  userId: authorization.userId,
  sceneHash: authorization.sceneHash,
  idempotencyKey: authorization.idempotencyKey,
};
assert.equal((await resolveDirectorCanaryAuthorizationClaim(atomicStore, claimInput, now)).kind, 'claimed');
assert.equal(
  (await resolveDirectorCanaryAuthorizationClaim(atomicStore, claimInput, now)).kind,
  'idempotent_running',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationClaim(
    atomicStore,
    { ...claimInput, userId: 'd512cc83-025c-436c-b198-6342020cd248' },
    now,
  )).kind,
  'missing',
);

const expiredRow = authorizationRow(
  'authorized',
  new Date(now.getTime() - 1_000).toISOString(),
);
const expiredStore: DirectorAuthorizationClaimStore = {
  async claim() {
    return null;
  },
  async find() {
    return expiredRow;
  },
};
assert.equal(
  (await resolveDirectorCanaryAuthorizationClaim(expiredStore, claimInput, now)).kind,
  'expired',
);

function lookupStore(rows: DirectorAuthorizationRow[]): DirectorAuthorizationLookupStore {
  return {
    async findEligible(input) {
      assert.equal(input.userId, authorization.userId);
      assert.equal(input.sceneHash, authorization.sceneHash);
      assert.equal(input.now, now);
      return rows;
    },
  };
}

const eligibleRow = authorizationRow('authorized');
const lookupInput = {
  userId: authorization.userId,
  sceneHash: authorization.sceneHash,
};
assert.equal(
  (await resolveDirectorCanaryStoredAuthorization(lookupStore([]), lookupInput, now)).kind,
  'missing',
);
assert.equal(
  (await resolveDirectorCanaryStoredAuthorization(
    lookupStore([{ ...eligibleRow, user_id: 'd512cc83-025c-436c-b198-6342020cd248' }]),
    lookupInput,
    now,
  )).kind,
  'invalid',
);
assert.equal(
  (await resolveDirectorCanaryStoredAuthorization(
    lookupStore([
      eligibleRow,
      {
        ...eligibleRow,
        id: '64900f04-09cf-478f-ae89-e167b7177f12',
        idempotency_key: 'second-test-key',
      },
    ]),
    lookupInput,
    now,
  )).kind,
  'multiple',
);
assert.equal(
  (await resolveDirectorCanaryStoredAuthorization(
    lookupStore([expiredRow]),
    lookupInput,
    now,
  )).kind,
  'expired',
);
const storedAuthorization = await resolveDirectorCanaryStoredAuthorization(
  lookupStore([eligibleRow]),
  lookupInput,
  now,
);
assert.equal(storedAuthorization.kind, 'resolved');
assert.equal(storedAuthorization.row?.id, authorization.id);
assert.equal(storedAuthorization.row?.idempotency_key, authorization.idempotencyKey);

let statusReadCount = 0;
function statusStore(rows: DirectorAuthorizationRow[] | null): DirectorAuthorizationStatusStore {
  return {
    async findRecent(input) {
      statusReadCount += 1;
      assert.equal(input.userId, authorization.userId);
      assert.equal(input.sceneHash, authorization.sceneHash);
      return rows;
    },
  };
}

const safeStatusKeys = [
  'anchorRequestLimit',
  'expiresInSeconds',
  'maximumBudget',
  'recovery',
  'retriesAllowed',
  'state',
  'videoRequestLimit',
];
const readyStatus = await resolveDirectorCanaryAuthorizationStatus(
  statusStore([eligibleRow]),
  lookupInput,
  now,
);
assert.equal(readyStatus.state, 'ready');
assert.ok(readyStatus.expiresInSeconds > 0);
assert.equal(readyStatus.maximumBudget, 2);
assert.equal(readyStatus.anchorRequestLimit, 1);
assert.equal(readyStatus.videoRequestLimit, 1);
assert.equal(readyStatus.retriesAllowed, 0);
assert.equal(readyStatus.recovery, false);
assert.deepEqual(Object.keys(readyStatus).sort(), safeStatusKeys);
assert.equal(synchronizedDirectorCanaryRunState('failed', readyStatus), 'ready');
assert.equal(canStartDirectorCanary('ready', readyStatus.expiresInSeconds), true);
assert.equal(canStartDirectorCanary('missing', readyStatus.expiresInSeconds), false);
assert.equal(canStartDirectorCanary('expired', readyStatus.expiresInSeconds), false);
assert.equal(remainingDirectorCanarySeconds(now.getTime(), now.getTime()), 0);
assert.equal(remainingDirectorCanarySeconds(now.getTime() + 1_001, now.getTime()), 2);
assert.equal(formatDirectorCanaryCountdown(1_602), '26:42');
assert.equal(formatDirectorCanaryCountdown(-1), '0:00');
assert.doesNotMatch(
  JSON.stringify(readyStatus),
  /authorizationId|idempotencyKey|userId|access_token|bearer|https?:\/\//i,
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(statusStore([]), lookupInput, now)).state,
  'missing',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(statusStore([expiredRow]), lookupInput, now)).state,
  'expired',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(
    statusStore([authorizationRow('running')]),
    lookupInput,
    now,
  )).state,
  'running',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(
    statusStore([authorizationRow('completed')]),
    lookupInput,
    now,
  )).state,
  'completed',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(
    statusStore([authorizationRow('failed')]),
    lookupInput,
    now,
  )).state,
  'failed',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(
    statusStore([
      eligibleRow,
      {
        ...eligibleRow,
        id: '64900f04-09cf-478f-ae89-e167b7177f12',
        idempotency_key: 'second-test-key',
      },
    ]),
    lookupInput,
    now,
  )).state,
  'blocked_multiple',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(
    statusStore([{ ...eligibleRow, maximum_retry_requests: 1 }]),
    lookupInput,
    now,
  )).state,
  'failed',
);
assert.equal(
  (await resolveDirectorCanaryAuthorizationStatus(statusStore(null), lookupInput, now)).state,
  'failed',
);
assert.equal(statusReadCount, 9);

const plan = buildDirectorProductionDryRun(DIRECTOR_CANARY_SCENE).plan;
const reference = {
  data: Buffer.from('owned-front-reference').toString('base64'),
  mimeType: 'image/jpeg' as const,
  ownershipConfirmed: true as const,
  role: 'front_face' as const,
  hashPrefix: '68ce04d1584e',
};
const anchorInteraction = {
  id: 'anchor-interaction',
  status: 'completed',
  output_image: {
    mime_type: 'image/jpeg',
    data: Buffer.from('anchor').toString('base64'),
  },
  usage: {
    total_input_tokens: 100,
    total_output_tokens: 1_000,
    output_tokens_by_modality: [{ modality: 'image', tokens: 1_000 }],
  },
};
const videoInteraction = {
  id: 'video-interaction',
  status: 'completed',
  output_video: {
    mime_type: 'video/mp4',
    data: Buffer.from('video').toString('base64'),
  },
  usage: {
    total_input_tokens: 100,
    total_output_tokens: 20_000,
    output_tokens_by_modality: [{ modality: 'video', tokens: 20_000 }],
  },
};

let anchorCalls = 0;
let videoCalls = 0;
let anchorPersistenceCalls = 0;
const success = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  dependencies: {
    async runAnchor(_payload, context) {
      anchorCalls += 1;
      return {
        interaction: anchorInteraction,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async runVideo(payload, context) {
      videoCalls += 1;
      assert.equal(payload.model, 'gemini-omni-flash-preview');
      assert.equal(payload.store, false);
      assert.deepEqual(payload.generation_config, {
        video_config: { task: 'image_to_video' },
      });
      assert.match(JSON.stringify(payload), /4-second 720p/);
      return {
        interaction: videoInteraction,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async resolveMediaBytes(output) {
      return Buffer.from(output.data ?? '', 'base64');
    },
    async persistAnchor() {
      anchorPersistenceCalls += 1;
    },
  },
});
assert.equal(success.ok, true);
assert.equal(anchorCalls, 1);
assert.equal(videoCalls, 1);
assert.equal(anchorPersistenceCalls, 1);
assert.equal(success.telemetry.providerRequestCount, 2);
assert.equal(success.telemetry.providerRetryCount, 0);
assert.equal(success.telemetry.providerFallbackCount, 0);
assert.equal(success.telemetry.repairRequestCount, 0);
assert.equal(success.telemetry.requestsByOperation.scene_anchor, 1);
assert.equal(success.telemetry.requestsByOperation.primary_video, 1);
assert.equal(success.publicCaption, DIRECTOR_CANARY_SCENE);
assert.equal(success.syntheticDisclosure, 'Synthetic portrayal');
if (success.ok) {
  assert.equal(success.anchorProviderInteractionId, 'anchor-interaction');
  assert.equal(success.anchorMediaArtifactId, 'anchor-interaction');
  assert.equal(success.videoProviderInteractionId, 'video-interaction');
  assert.equal(success.videoMediaArtifactId, 'video-interaction');
}

const idlessAnchorBytes = Buffer.from('idless-anchor');
const idlessAnchorInteraction = {
  status: 'completed',
  output_image: {
    type: 'image',
    mime_type: 'image/jpeg',
    data: idlessAnchorBytes.toString('base64'),
  },
};
let idlessPersistedArtifactId = '';
let idlessVideoCalls = 0;
const idlessAnchorSuccess = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  dependencies: {
    async runAnchor(_payload, context) {
      return {
        interaction: idlessAnchorInteraction,
        interactionSummary: normalizeGoogleInteractionEnvelope(idlessAnchorInteraction).structuralSummary,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async runVideo(_payload, context) {
      idlessVideoCalls += 1;
      return {
        interaction: videoInteraction,
        interactionSummary: normalizeGoogleInteractionEnvelope(videoInteraction).structuralSummary,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async resolveMediaBytes(output) {
      return Buffer.from(output.data ?? '', 'base64');
    },
    async persistAnchor(input) {
      assert.equal(input.providerInteractionId, null);
      assert.equal(input.mediaIdentitySource, 'content_hash');
      idlessPersistedArtifactId = input.mediaArtifactId;
    },
  },
});
assert.equal(idlessAnchorSuccess.ok, true);
assert.equal(idlessVideoCalls, 1);
assert.match(idlessPersistedArtifactId, /^scene_anchor-content-[a-f0-9]{32}$/);
assert.equal(idlessAnchorSuccess.telemetry.providerRequestCount, 2);
assert.equal(idlessAnchorSuccess.telemetry.providerRetryCount, 0);
assert.equal(idlessAnchorSuccess.telemetry.providerFallbackCount, 0);
assert.equal(idlessAnchorSuccess.telemetry.repairRequestCount, 0);
if (idlessAnchorSuccess.ok) {
  assert.equal(idlessAnchorSuccess.anchorProviderInteractionId, null);
  assert.equal(idlessAnchorSuccess.anchorMediaArtifactId, idlessPersistedArtifactId);
  assert.equal(
    idlessAnchorSuccess.interactionSummaries.sceneAnchor?.acceptedCompletedResponseWithoutId,
    true,
  );
  assert.equal(idlessAnchorSuccess.interactionSummaries.sceneAnchor?.storageSucceeded, true);
}

let budgetGuardCalls = 0;
const budgetGuard = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  projectedMaximumCostUsd: 2.01,
  dependencies: {
    async runAnchor() {
      budgetGuardCalls += 1;
      throw new Error('must not run');
    },
    async runVideo() {
      budgetGuardCalls += 1;
      throw new Error('must not run');
    },
    async resolveMediaBytes() {
      return new Uint8Array();
    },
  },
});
assert.equal(budgetGuard.ok, false);
assert.equal(budgetGuard.failureCategory, 'budget_guard');
assert.equal(budgetGuardCalls, 0);

let anchorFailureVideoCalls = 0;
const anchorFailure = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  dependencies: {
    async runAnchor(_payload, context) {
      const telemetry = recordPaidRequest(context.telemetry, context.decision, context.operation);
      throw new DirectorProviderExecutionError(telemetry, 'provider_rate_limit');
    },
    async runVideo() {
      anchorFailureVideoCalls += 1;
      throw new Error('must not run');
    },
    async resolveMediaBytes() {
      return new Uint8Array();
    },
  },
});
assert.equal(anchorFailure.ok, false);
assert.equal(anchorFailure.failureCategory, 'provider_rate_limit');
assert.equal(anchorFailure.telemetry.providerRequestCount, 1);
assert.equal(anchorFailureVideoCalls, 0);

let textOnlyVideoCalls = 0;
const textOnlyInteraction = {
  id: 'text-only-anchor-interaction',
  status: 'completed',
  outputs: [{ type: 'text', text: 'Created the scene.' }],
};
const textOnlyInteractionSummary = normalizeGoogleInteractionEnvelope(
  textOnlyInteraction,
).structuralSummary;
const textOnlyAnchor = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  dependencies: {
    async runAnchor(_payload, context) {
      return {
        interaction: textOnlyInteraction,
        interactionSummary: textOnlyInteractionSummary,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async runVideo() {
      textOnlyVideoCalls += 1;
      throw new Error('must not run');
    },
    async resolveMediaBytes() {
      throw new Error('must not run');
    },
  },
});
assert.equal(textOnlyAnchor.ok, false);
assert.equal(textOnlyAnchor.failureCategory, 'anchor_text_only');
assert.equal(textOnlyAnchor.telemetry.providerRequestCount, 1);
assert.equal(textOnlyVideoCalls, 0);
const textOnlySafeSummary = directorMediaSafeTelemetry({
  structuralSummary: textOnlyInteractionSummary,
});
assert.deepEqual(textOnlyAnchor.interactionSummaries.sceneAnchor, textOnlySafeSummary);
const persistedAuthorizationTelemetry = directorOperationalTelemetry(
  textOnlyAnchor.telemetry,
  null,
  textOnlyAnchor.interactionSummaries,
);
const persistedJobTelemetry = mergeDirectorCanaryJobInteractionTelemetry(
  { directorPlan: { private: true } },
  textOnlyAnchor.interactionSummaries,
);
assert.deepEqual(
  persistedAuthorizationTelemetry.interactionResponses.sceneAnchor,
  textOnlySafeSummary,
);
assert.deepEqual(
  persistedJobTelemetry.interactionResponses.sceneAnchor,
  textOnlySafeSummary,
);
assert.deepEqual(persistedJobTelemetry.directorPlan, { private: true });

assert.equal(isIdempotentStorageObjectAlreadyExists({ statusCode: 409 }), true);
assert.equal(isIdempotentStorageObjectAlreadyExists({ message: 'The resource already exists' }), true);
assert.equal(isIdempotentStorageObjectAlreadyExists({ message: 'Permission denied' }), false);

let failedVideoCalls = 0;
const videoFailure = await runDirectorCanarySequence({
  apiKey: 'test-only-placeholder',
  authorization,
  plan,
  frontReference: reference,
  dependencies: {
    async runAnchor(_payload, context) {
      return {
        interaction: anchorInteraction,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async runVideo(_payload, context) {
      failedVideoCalls += 1;
      const telemetry = recordPaidRequest(context.telemetry, context.decision, context.operation);
      throw new DirectorProviderExecutionError(telemetry, 'provider_request_failed');
    },
    async resolveMediaBytes(output) {
      return Buffer.from(output.data ?? '', 'base64');
    },
  },
});
assert.equal(videoFailure.ok, false);
assert.equal(videoFailure.anchorSuccess, true);
assert.equal(failedVideoCalls, 1);
assert.equal(videoFailure.telemetry.providerRequestCount, 2);
assert.equal(videoFailure.telemetry.providerRetryCount, 0);
assert.equal(videoFailure.telemetry.providerFallbackCount, 0);
assert.equal(videoFailure.telemetry.repairRequestCount, 0);

const moderationError = Object.assign(
  new Error('Request blocked by safety policy.'),
  { status: 400 },
);
assert.equal(classifyDirectorProviderFailure(moderationError), 'provider_moderation');
assert.equal(
  classifyDirectorProviderFailure(Object.assign(new Error('Quota exceeded.'), { status: 429 })),
  'provider_rate_limit',
);
const safeFailureMetadata = extractDirectorProviderSafeFailureMetadata({
  status: 429,
  headers: { 'retry-after': '12' },
  error: { status: 'RESOURCE_EXHAUSTED' },
});
assert.deepEqual(safeFailureMetadata, {
  httpStatus: 429,
  providerCode: null,
  providerStatusName: 'RESOURCE_EXHAUSTED',
  message: null,
  fieldViolationPaths: [],
  reason: 'RESOURCE_EXHAUSTED',
  retryAfterSeconds: 12,
  retryInfoSeconds: null,
  quotaMetric: null,
  quotaLimitName: null,
  modelName: null,
  request: null,
});
assert.doesNotMatch(JSON.stringify(safeFailureMetadata), /https?:\/\/|bearer\s|api[_ -]?key/i);

const dryRun = buildDirectorProductionDryRun(DIRECTOR_CANARY_SCENE);
assert.equal(dryRun.paidExecutionEnabled, false);
assert.equal(dryRun.providerSdkCallAllowed, false);
assert.equal(dryRun.actualTelemetry.providerRequestCount, 0);
assert.deepEqual(dryRun.progressStates, [
  'Planning your scene',
  'Building the cast and setting',
  'Creating the shot',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
]);
assert.doesNotMatch(JSON.stringify(dryRun), /https?:\/\/|bearer\s|api[_ -]?key/i);

const migrationSource = readFileSync(
  join(
    repositoryRoot,
    'backend/supabase/migrations/20260731025615_guard_director_paid_canary.sql',
  ),
  'utf8',
);
assert.match(migrationSource, /maximum_cost_usd = 2/);
assert.match(migrationSource, /maximum_anchor_requests = 1/);
assert.match(migrationSource, /maximum_video_requests = 1/);
assert.match(migrationSource, /maximum_retry_requests = 0/);
assert.match(migrationSource, /maximum_fallback_requests = 0/);
assert.match(migrationSource, /maximum_repair_requests = 0/);
assert.match(migrationSource, /expires_at <= created_at \+ interval '30 minutes'/);
assert.match(migrationSource, /create unique index if not exists[\s\S]*idempotency_key/);
assert.match(migrationSource, /update public\.director_canary_authorizations[\s\S]*status = 'running'/);
assert.match(migrationSource, /revoke execute[\s\S]*from public, anon, authenticated/);
assert.match(migrationSource, /grant execute[\s\S]*to service_role/);
assert.doesNotMatch(migrationSource, /candlelit mansion|google_api_key/i);

const endpointSource = readFileSync(
  join(repositoryRoot, 'serverless/entries/generations-index.ts'),
  'utf8',
);
assert.match(endpointSource, /lumora-director-v1-canary/);
assert.match(endpointSource, /authenticatedUserId/);
assert.match(endpointSource, /body\.action === 'status'/);
assert.match(endpointSource, /resolveProductionDirectorCanaryStatus\(\{ userId \}\)/);
assert.match(endpointSource, /Cache-Control', 'no-store'/);
assert.match(endpointSource, /resolveProductionDirectorCanaryAuthorization\(\{ userId \}\)/);
assert.match(endpointSource, /storedAuthorization\.row\.idempotency_key/);
assert.match(endpointSource, /idempotency-key/);
assert.match(endpointSource, /x-lumora-director-authorization/);
assert.ok(
  endpointSource.indexOf("body.action === 'status'") <
    endpointSource.indexOf('resolveProductionDirectorCanaryAuthorization({ userId })'),
);
assert.doesNotMatch(endpointSource, /service[_ -]?role[_ -]?key\s*[:=]\s*['"`][^'"`]+/i);
const endpointBundleSource = readFileSync(
  join(repositoryRoot, 'api/generations/index.js'),
  'utf8',
);
assert.match(endpointBundleSource, /function checkRateLimit/);
assert.doesNotMatch(
  endpointBundleSource,
  /from\s+['"][^'"]*serverless\/_lib\/rateLimit['"]/,
);

const internalPageSource = readFileSync(
  join(repositoryRoot, 'src/pages/DirectorCanaryPage.tsx'),
  'utf8',
);
assert.match(internalPageSource, /Run one Director canary/);
assert.match(internalPageSource, /Capacitor\.isNativePlatform\(\)/);
assert.match(internalPageSource, /startedRef\.current = true/);
assert.match(internalPageSource, /startedRef\.current = false/);
assert.match(internalPageSource, /disabled=\{!canRun\}/);
assert.match(internalPageSource, /useState<DirectorCanaryRunState>\('checking'\)/);
assert.match(internalPageSource, /Checking one-time authorization…/);
assert.match(internalPageSource, /Ready for one signed-in, one-time Director canary\./);
assert.match(internalPageSource, /No active one-time authorization\./);
assert.match(internalPageSource, /This one-time authorization expired\./);
assert.match(internalPageSource, /Authorization expires in \{formatDirectorCanaryCountdown\(remainingSeconds\)\}/);
assert.match(internalPageSource, /window\.addEventListener\('focus', refreshIfIdle\)/);
assert.match(internalPageSource, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/);
assert.match(internalPageSource, /window\.setInterval\(refreshIfIdle, 10_000\)/);
assert.match(internalPageSource, /if \(nextRemaining === 0\)[\s\S]*updateRunState\('expired'\)/);
assert.match(
  internalPageSource,
  /startedRef\.current = true;[\s\S]*requestAuthorizationStatus\(true\)[\s\S]*api\.runDirectorCanary\(\)/,
);
assert.equal((internalPageSource.match(/<button/g) ?? []).length, 1);
assert.doesNotMatch(
  internalPageSource,
  /access_token|authorizationId|idempotencyKey|Bearer|console\.|localStorage|sessionStorage|indexedDB|Web Inspector|Safari/i,
);
assert.doesNotMatch(internalPageSource, /https?:\/\//);
assert.doesNotMatch(internalPageSource, /gemini|nano banana|provider|model[_ -]?id/i);

const clientApiSource = readFileSync(join(repositoryRoot, 'src/lib/api.ts'), 'utf8');
const canaryStatusClientMethod = clientApiSource.match(
  /getDirectorCanaryStatus:[\s\S]*?timeoutMs: 15_000,[\s\S]*?\}\),/,
)?.[0] ?? '';
assert.match(canaryStatusClientMethod, /action: 'status'/);
assert.match(canaryStatusClientMethod, /cache: 'no-store'/);
assert.match(canaryStatusClientMethod, /lumora-director-v1-canary/);
assert.doesNotMatch(
  canaryStatusClientMethod,
  /authorizationId|idempotencyKey|access_token|Bearer|[?&](?:authorization|idempotency|token)=/i,
);
const canaryClientMethod = clientApiSource.match(
  /runDirectorCanary:[\s\S]*?timeoutMs: 300_000,[\s\S]*?\}\),/,
)?.[0] ?? '';
assert.match(canaryClientMethod, /lumora-director-v1-canary/);
assert.match(canaryClientMethod, /action: 'execute'/);
assert.match(canaryClientMethod, /She walks through a candlelit mansion/);
assert.doesNotMatch(canaryClientMethod, /authorizationId|idempotencyKey|access_token|Bearer|[?&](?:authorization|idempotency|token)=/i);
assert.doesNotMatch(clientApiSource, /console\.log\([^\n]*(?:accessToken|Authorization)/i);

for (const hiddenNavigationSource of [
  'src/components/BottomNav.tsx',
  'src/pages/HomePage.tsx',
  'src/pages/TrendsPage.tsx',
  'src/pages/ProfilePage.tsx',
  'src/pages/SupportPage.tsx',
]) {
  assert.doesNotMatch(
    readFileSync(join(repositoryRoot, hiddenNavigationSource), 'utf8'),
    /internal\/director-canary/,
  );
}

const googleMediaSource = readFileSync(
  join(repositoryRoot, 'backend/src/services/director/googleMedia.ts'),
  'utf8',
);
assert.match(googleMediaSource, /interactions\.create\(payload,[\s\S]*maxRetries: 0/);
assert.match(googleMediaSource, /interactions\.get\(id, undefined, \{ maxRetries: 0 \}\)/);
assert.doesNotMatch(googleMediaSource, /current\?\.status === 'string' \? current\.status : 'completed'/);

const adminRunnerSource = readFileSync(
  join(repositoryRoot, 'scripts/run-director-paid-canary.mjs'),
  'utf8',
);
assert.match(adminRunnerSource, /I AUTHORIZE EXACTLY ONE GUARDED PAID CANARY/);
assert.match(adminRunnerSource, /'idempotency-key': idempotencyKey/);
assert.match(adminRunnerSource, /'x-lumora-director-authorization': authorizationId/);
assert.match(adminRunnerSource, /authorization: `Bearer \$\{accessToken\}`/);
assert.match(adminRunnerSource, /clearSensitiveEnvironment\(\)/);
assert.doesNotMatch(adminRunnerSource, /[?&](?:authorization|idempotency|token)=/i);
assert.doesNotMatch(adminRunnerSource, /console\.log\([^\n]*(?:accessToken|privateProviderUri|videoUrl)/i);

const creatorExperienceSource = readFileSync(
  join(repositoryRoot, 'src/lib/createExperience.ts'),
  'utf8',
);
for (const copy of [
  'Lumora is directing your scene',
  'Planning your scene',
  'Building the cast and setting',
  'Creating the shot',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
]) {
  assert.match(creatorExperienceSource, new RegExp(copy));
}

const apiFiles = readdirSync(join(repositoryRoot, 'api'), { recursive: true })
  .map(String)
  .filter((file) => /\.(?:ts|js)$/.test(file));
assert.equal(apiFiles.length, 12);

const originalFetch = globalThis.fetch;
let externalRequestCount = 0;
globalThis.fetch = async () => {
  externalRequestCount += 1;
  throw new Error('Unexpected external request during unauthorized-route test.');
};
try {
  const { default: generationHandler } = await import('../../api/generations/index.js');
  let statusCode = 0;
  let responseBody = '';
  await generationHandler(
    {
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      body: {
        engine: 'lumora-director-v1-canary',
        prompt: DIRECTOR_CANARY_SCENE,
      },
    } as never,
    {
      set statusCode(value: number) {
        statusCode = value;
      },
      get statusCode() {
        return statusCode;
      },
      setHeader() {},
      end(value: string) {
        responseBody = value;
      },
    } as never,
  );
  assert.equal(statusCode, 401);
  assert.equal(JSON.parse(responseBody).error, 'Sign in to continue.');
  assert.equal(externalRequestCount, 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Director paid-canary guard tests passed without a provider request.');
