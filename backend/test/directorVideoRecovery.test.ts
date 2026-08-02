import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordPaidRequest } from '../src/services/director/budget';
import { DIRECTOR_CANARY_SCENE, directorCanarySceneHash } from '../src/services/director/canary';
import { buildDirectorProductionDryRun } from '../src/services/director/dryRunDiagnostics';
import {
  DirectorProviderExecutionError,
  extractDirectorProviderSafeFailureMetadata,
  summarizeGoogleInteractionRequest,
} from '../src/services/director/googleMedia';
import { identifyDirectorMediaArtifact } from '../src/services/director/output';
import {
  resolveDirectorCanaryAuthorizationClaim,
  resolveDirectorCanaryAuthorizationStatus,
  resolveDirectorCanaryStoredAuthorization,
  type DirectorAuthorizationClaimStore,
  type DirectorAuthorizationLookupStore,
  type DirectorAuthorizationRow,
  type DirectorAuthorizationStatusStore,
} from '../src/services/director/productionCanary';
import {
  DIRECTOR_VIDEO_RECOVERY_MODE,
  assertDirectorVideoRecoveryAuthorization,
  runDirectorVideoRecoverySequence,
  verifyStoredDirectorAnchor,
  type DirectorVideoRecoveryAuthorization,
  type StoredDirectorAnchor,
} from '../src/services/director/recoveryCanary';

const now = new Date();
const userId = 'user-fixture';
const sourceAuthorizationId = 'source-authorization-fixture';
const sourceIdempotencyKey = 'source-idempotency-fixture';
const recoveryAuthorizationId = 'recovery-authorization-fixture';
const recoveryIdempotencyKey = 'recovery-idempotency-fixture';
const anchorBytes = Buffer.from('exact-persisted-anchor-fixture');
const anchorContentSha256 = createHash('sha256').update(anchorBytes).digest('hex');
const candidate = {
  providerInteractionId: null,
  kind: 'scene_anchor' as const,
  mimeType: 'image/jpeg',
  data: anchorBytes.toString('base64'),
  uri: null,
  status: 'completed',
  safeSummary: {
    outputCount: 1,
    outputTypes: ['image'],
    selectedSource: 'output_image' as const,
    selectedMimeType: 'image/jpeg',
    selectedHasData: true,
    selectedInlineDataCharacterLength: anchorBytes.toString('base64').length,
    selectedHasUri: false,
  },
};
const anchorMediaArtifactId = identifyDirectorMediaArtifact({
  candidate,
  bytes: anchorBytes,
  context: {
    authorizationId: sourceAuthorizationId,
    idempotencyKey: sourceIdempotencyKey,
  },
}).mediaArtifactId;
const anchorStorageObject = `${userId}/director/${sourceAuthorizationId}/${anchorMediaArtifactId}.jpg`;

const authorization: DirectorVideoRecoveryAuthorization = {
  id: recoveryAuthorizationId,
  userId,
  sceneHash: directorCanarySceneHash(),
  mode: DIRECTOR_VIDEO_RECOVERY_MODE,
  status: 'running',
  maximumCostUsd: 1,
  maximumAnchorRequests: 0,
  maximumVideoRequests: 1,
  maximumRetryRequests: 0,
  maximumFallbackRequests: 0,
  maximumRepairRequests: 0,
  idempotencyKey: recoveryIdempotencyKey,
  recordedAt: new Date(now.getTime() - 30_000).toISOString(),
  expiresAt: new Date(now.getTime() + 29 * 60_000).toISOString(),
  consumedAt: now.toISOString(),
  sourceAuthorizationId,
  anchorMediaArtifactId,
  anchorStorageBucket: 'lumora-assets',
  anchorStorageObject,
  anchorContentSha256,
  anchorMimeType: 'image/jpeg',
  anchorByteLength: anchorBytes.byteLength,
};
const storedAnchor: StoredDirectorAnchor = {
  ownerUserId: userId,
  sourceAuthorizationId,
  sourceIdempotencyKey,
  mediaArtifactId: anchorMediaArtifactId,
  storageBucket: 'lumora-assets',
  storageObject: anchorStorageObject,
  contentSha256: anchorContentSha256,
  mimeType: 'image/jpeg',
  byteLength: anchorBytes.byteLength,
  bytes: anchorBytes,
};

assert.doesNotThrow(() => assertDirectorVideoRecoveryAuthorization(authorization, now));
assert.throws(
  () => assertDirectorVideoRecoveryAuthorization({ ...authorization, maximumAnchorRequests: 1 as 0 }, now),
  /invalid limits/,
);
assert.throws(
  () => assertDirectorVideoRecoveryAuthorization({
    ...authorization,
    expiresAt: new Date(now.getTime() - 1).toISOString(),
  }, now),
  /expired/,
);
assert.equal(verifyStoredDirectorAnchor({ authorization, stored: storedAnchor }), storedAnchor);
assert.throws(
  () => verifyStoredDirectorAnchor({
    authorization,
    stored: { ...storedAnchor, ownerUserId: 'different-user' },
  }),
  (error: unknown) => (error as { category?: string }).category === 'stored_anchor_not_owned',
);
assert.throws(
  () => verifyStoredDirectorAnchor({
    authorization,
    stored: { ...storedAnchor, bytes: Buffer.from('tampered-anchor') },
  }),
  (error: unknown) => (error as { category?: string }).category === 'stored_anchor_invalid',
);
const modifiedSameLengthAnchor = Buffer.from(anchorBytes);
modifiedSameLengthAnchor[0] = modifiedSameLengthAnchor[0] ^ 1;
assert.throws(
  () => verifyStoredDirectorAnchor({
    authorization,
    stored: { ...storedAnchor, bytes: modifiedSameLengthAnchor },
  }),
  (error: unknown) => (error as { category?: string }).category === 'stored_anchor_hash_mismatch',
);
assert.throws(
  () => verifyStoredDirectorAnchor({
    authorization,
    stored: { ...storedAnchor, mediaArtifactId: 'different-artifact' },
  }),
  (error: unknown) => (error as { category?: string }).category === 'stored_anchor_artifact_mismatch',
);

const plan = buildDirectorProductionDryRun(DIRECTOR_CANARY_SCENE).plan;
const videoInteraction = {
  id: 'video-interaction-fixture',
  status: 'completed',
  output_video: {
    mime_type: 'video/mp4',
    data: Buffer.from('video-output-fixture').toString('base64'),
  },
  usage: {
    total_input_tokens: 10,
    total_output_tokens: 100,
    output_tokens_by_modality: [{ modality: 'video', tokens: 100 }],
  },
};
let storedAnchorLoads = 0;
let videoCalls = 0;
const success = await runDirectorVideoRecoverySequence({
  apiKey: 'local-test-placeholder',
  authorization,
  plan,
  dependencies: {
    async loadStoredAnchor() {
      storedAnchorLoads += 1;
      return storedAnchor;
    },
    async runVideo(payload, context) {
      videoCalls += 1;
      const safeRequest = summarizeGoogleInteractionRequest(payload);
      assert.equal(safeRequest.imageByteLength, anchorBytes.byteLength);
      assert.equal(safeRequest.videoTask, 'image_to_video');
      assert.equal(safeRequest.aspectRatio, '9:16');
      assert.equal(context.operation, 'primary_video');
      return {
        interaction: videoInteraction,
        telemetry: recordPaidRequest(context.telemetry, context.decision, context.operation),
      };
    },
    async resolveMediaBytes(output) {
      return Buffer.from(output.data ?? '', 'base64');
    },
  },
});
assert.equal(success.ok, true);
assert.equal(storedAnchorLoads, 1);
assert.equal(videoCalls, 1);
assert.equal(success.telemetry.providerRequestCount, 1);
assert.equal(success.telemetry.requestsByOperation.scene_anchor, 0);
assert.equal(success.telemetry.requestsByOperation.primary_video, 1);
assert.equal(success.telemetry.providerRetryCount, 0);
assert.equal(success.telemetry.providerFallbackCount, 0);
assert.equal(success.telemetry.repairRequestCount, 0);

let missingVideoCalls = 0;
const missing = await runDirectorVideoRecoverySequence({
  apiKey: 'local-test-placeholder',
  authorization,
  plan,
  dependencies: {
    async loadStoredAnchor() {
      throw new Error('missing');
    },
    async runVideo() {
      missingVideoCalls += 1;
      throw new Error('must not run');
    },
    async resolveMediaBytes() {
      throw new Error('must not run');
    },
  },
});
assert.equal(missing.ok, false);
assert.equal(missing.failureCategory, 'stored_anchor_missing');
assert.equal(missingVideoCalls, 0);
assert.equal(missing.telemetry.providerRequestCount, 0);

let failedVideoCalls = 0;
const requestMetadata = summarizeGoogleInteractionRequest(
  (await (async () => {
    let captured: Parameters<NonNullable<Parameters<typeof runDirectorVideoRecoverySequence>[0]['dependencies']['runVideo']>>[0] | null = null;
    await runDirectorVideoRecoverySequence({
      apiKey: 'local-test-placeholder',
      authorization,
      plan,
      dependencies: {
        async loadStoredAnchor() { return storedAnchor; },
        async runVideo(payload, context) {
          captured = payload;
          return { interaction: videoInteraction, telemetry: context.telemetry };
        },
        async resolveMediaBytes(output) { return Buffer.from(output.data ?? '', 'base64'); },
      },
    });
    return captured as NonNullable<typeof captured>;
  })()),
);
const safeFailure = extractDirectorProviderSafeFailureMetadata({
  status: 400,
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: 'Invalid request field.',
    details: [{ fieldViolations: [{ field: 'generation_config.video_config.task' }] }],
  },
}, 'gemini-omni-flash-preview', requestMetadata);
const videoFailure = await runDirectorVideoRecoverySequence({
  apiKey: 'local-test-placeholder',
  authorization,
  plan,
  dependencies: {
    async loadStoredAnchor() { return storedAnchor; },
    async runVideo(_payload, context) {
      failedVideoCalls += 1;
      const telemetry = recordPaidRequest(context.telemetry, context.decision, context.operation);
      throw new DirectorProviderExecutionError(telemetry, 'provider_request_failed', safeFailure);
    },
    async resolveMediaBytes() { throw new Error('must not run'); },
  },
});
assert.equal(videoFailure.ok, false);
assert.equal(videoFailure.anchorSuccess, true);
assert.equal(videoFailure.providerFailureMetadata?.httpStatus, 400);
assert.deepEqual(
  videoFailure.providerFailureMetadata?.fieldViolationPaths,
  ['generation_config.video_config.task'],
);
assert.equal(failedVideoCalls, 1);
assert.equal(videoFailure.telemetry.providerRequestCount, 1);

function recoveryRow(status: DirectorAuthorizationRow['status']): DirectorAuthorizationRow {
  return {
    id: authorization.id,
    user_id: authorization.userId,
    scene_hash: authorization.sceneHash,
    status,
    authorization_mode: DIRECTOR_VIDEO_RECOVERY_MODE,
    maximum_cost_usd: 1,
    maximum_anchor_requests: 0,
    maximum_video_requests: 1,
    maximum_retry_requests: 0,
    maximum_fallback_requests: 0,
    maximum_repair_requests: 0,
    idempotency_key: authorization.idempotencyKey,
    expires_at: authorization.expiresAt,
    consumed_at: status === 'authorized' ? null : now.toISOString(),
    started_at: status === 'authorized' ? null : now.toISOString(),
    completed_at: null,
    created_at: authorization.recordedAt,
    source_authorization_id: sourceAuthorizationId,
    anchor_media_artifact_id: anchorMediaArtifactId,
    anchor_storage_bucket: 'lumora-assets',
    anchor_storage_object: anchorStorageObject,
    anchor_content_sha256: anchorContentSha256,
    anchor_mime_type: 'image/jpeg',
    anchor_byte_length: anchorBytes.byteLength,
  };
}

let row: DirectorAuthorizationRow | null = recoveryRow('authorized');
const atomicStore: DirectorAuthorizationClaimStore = {
  async claim() {
    if (!row || row.status !== 'authorized') return null;
    row = { ...row, status: 'running', consumed_at: now.toISOString(), started_at: now.toISOString() };
    return row;
  },
  async find() { return row; },
};
const claimInput = {
  authorizationId: authorization.id,
  userId: authorization.userId,
  sceneHash: authorization.sceneHash,
  idempotencyKey: authorization.idempotencyKey,
};
assert.equal((await resolveDirectorCanaryAuthorizationClaim(atomicStore, claimInput, now)).kind, 'claimed');
assert.equal((await resolveDirectorCanaryAuthorizationClaim(atomicStore, claimInput, now)).kind, 'idempotent_running');

const lookupStore: DirectorAuthorizationLookupStore = {
  async findEligible() { return [recoveryRow('authorized')]; },
};
assert.equal(
  (await resolveDirectorCanaryStoredAuthorization(
    lookupStore,
    { userId, sceneHash: directorCanarySceneHash() },
    now,
  )).kind,
  'resolved',
);
const statusStore: DirectorAuthorizationStatusStore = {
  async findRecent() { return [recoveryRow('authorized')]; },
};
const readyStatus = await resolveDirectorCanaryAuthorizationStatus(
  statusStore,
  { userId, sceneHash: directorCanarySceneHash() },
  now,
);
assert.equal(readyStatus.state, 'ready');
assert.equal(readyStatus.recovery, true);
assert.equal(readyStatus.maximumBudget, 1);
assert.equal(readyStatus.anchorRequestLimit, 0);
assert.equal(readyStatus.videoRequestLimit, 1);
assert.doesNotMatch(JSON.stringify(readyStatus), /authorization|idempotency|artifact|storage|user-fixture/i);

const productionSource = readFileSync(
  join(process.cwd(), 'backend/src/services/director/productionCanary.ts'),
  'utf8',
);
const recoveryExecutor = productionSource.slice(
  productionSource.indexOf('export async function executeProductionDirectorVideoRecoveryCanary'),
);
assert.match(recoveryExecutor, /runDirectorVideoRecoverySequence/);
assert.match(recoveryExecutor, /runVideo: omniFlashAdapter\.execute/);
assert.doesNotMatch(recoveryExecutor, /runAnchor|nanoBananaAdapter/);
assert.match(recoveryExecutor, /uploadBytes/);
assert.match(recoveryExecutor, /persistProject/);
assert.match(recoveryExecutor, /providerFailureMetadata: sequence\.providerFailureMetadata/);

const migration = readFileSync(
  join(process.cwd(), 'backend/supabase/migrations/20260802005118_director_video_recovery_canary.sql'),
  'utf8',
);
assert.match(migration, /director_video_recovery_canary/);
assert.match(migration, /maximum_anchor_requests = 0/);
assert.match(migration, /maximum_video_requests = 1/);
assert.match(migration, /maximum_cost_usd = 1/);
assert.match(migration, /not exists/);
assert.match(migration, /claim_director_video_recovery_authorization/);
assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);

const internalPage = readFileSync(join(process.cwd(), 'src/pages/DirectorCanaryPage.tsx'), 'utf8');
assert.match(internalPage, /Ready to continue the stored scene\./);
assert.match(internalPage, /videoRecovery \? '1\.00' : '2\.00'/);
assert.match(internalPage, /startedRef\.current = true/);
assert.match(internalPage, /disabled=\{!canRun\}/);
assert.doesNotMatch(internalPage, /authorizationId|idempotencyKey|artifactId|storageObject|provider|gemini/i);

const apiFiles = readdirSync(join(process.cwd(), 'api'), { recursive: true })
  .map(String)
  .filter((file) => /\.(?:ts|js)$/.test(file));
assert.equal(apiFiles.length, 12);

const iosProject = readFileSync(join(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
assert.match(iosProject, /CURRENT_PROJECT_VERSION = 7;/);

console.log('Director video recovery guards passed with zero external provider calls.');
