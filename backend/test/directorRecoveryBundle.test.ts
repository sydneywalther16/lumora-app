import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const bundlePath = join(repositoryRoot, 'api/generations/index.js');
const bundleSource = readFileSync(bundlePath, 'utf8');

assert.match(
  bundleSource,
  /var DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD = projectedDirectorPrimaryVideoCostUsd\(\);/,
);
assert.ok(
  bundleSource.indexOf('var DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD =') <
    bundleSource.indexOf('async function executeProductionDirectorVideoRecoveryCanary'),
);
assert.doesNotMatch(
  bundleSource,
  /projectedVideoCostUsd:\s*\(\)\s*=>\s*DIRECTOR_CANARY_PROJECTED_VIDEO_COST_USD2\b/,
);

const telemetry = {
  providerRequestCount: 0,
  providerRetryCount: 0,
  providerFallbackCount: 0,
  repairRequestCount: 0,
  requestsByOperation: {
    scene_anchor: 0,
    primary_video: 0,
    fallback_video: 0,
    repair_edit: 0,
  },
  budgetDecisionIds: [],
  events: [],
};
const now = Date.now();
const row = {
  id: '00000000-0000-4000-8000-000000000007',
  user_id: '00000000-0000-4000-8000-000000000001',
  scene_hash: 'bundle-fixture-scene',
  status: 'running',
  authorization_mode: 'director_video_recovery_canary',
  maximum_cost_usd: 1,
  maximum_anchor_requests: 0,
  maximum_video_requests: 1,
  maximum_retry_requests: 0,
  maximum_fallback_requests: 0,
  maximum_repair_requests: 0,
  idempotency_key: 'bundle-fixture-idempotency',
  expires_at: new Date(now + 25 * 60_000).toISOString(),
  consumed_at: new Date(now - 10_000).toISOString(),
  started_at: new Date(now - 10_000).toISOString(),
  completed_at: null,
  created_at: new Date(now - 20_000).toISOString(),
  source_authorization_id: '00000000-0000-4000-8000-000000000006',
  anchor_media_artifact_id: 'bundle-fixture-artifact',
  anchor_storage_bucket: 'lumora-assets',
  anchor_storage_object:
    '00000000-0000-4000-8000-000000000001/director/00000000-0000-4000-8000-000000000006/bundle.jpg',
  anchor_content_sha256: 'a'.repeat(64),
  anchor_mime_type: 'image/jpeg',
  anchor_byte_length: 483_270,
};

const checkpoints: string[] = [];
const terminalFailures: Array<Record<string, unknown>> = [];
let mockedAnchorLoads = 0;
let mockedDatabaseWrites = 0;
let mockedAuthorizationStatus = 'running';
let mockedProviderRequests = 0;
let externalRequestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  externalRequestCount += 1;
  throw new Error('No external request is permitted in the generated-bundle recovery test.');
};

try {
  const bundle = await import(`../../api/generations/index.js?recovery-bundle-test=${now}`);
  assert.equal(typeof bundle.executeProductionDirectorVideoRecoveryCanary, 'function');
  const result = await bundle.executeProductionDirectorVideoRecoveryCanary({
    userId: row.user_id,
    authorizationId: row.id,
    idempotencyKey: row.idempotency_key,
    authorizationStore: {
      async claim() { return row; },
      async find() { return row; },
    },
    runtime: {
      projectedVideoCostUsd: () => 0.4,
      async createExecutionJob() { mockedDatabaseWrites += 1; },
      async persistCheckpoint({ checkpoint }: { checkpoint: string }) {
        mockedDatabaseWrites += 1;
        checkpoints.push(checkpoint);
      },
      async runSequence() {
        mockedAnchorLoads += 1;
        throw new TypeError('mocked boundary failure');
      },
      async terminalizeFailure(failure: Record<string, unknown>) {
        mockedDatabaseWrites += 1;
        mockedAuthorizationStatus = 'failed';
        terminalFailures.push(failure);
      },
    },
  });
  assert.equal(result.internalDiagnostics.failureCategory, 'internal_execution_failed');
  assert.equal(result.internalDiagnostics.providerRequestCount, 0);
  assert.equal(mockedAnchorLoads, 1);
  assert.ok(mockedDatabaseWrites >= 5);
  assert.equal(mockedAuthorizationStatus, 'failed');
  assert.equal(mockedProviderRequests, 0);
  assert.equal(externalRequestCount, 0);
  assert.deepEqual(checkpoints, ['job_created', 'budget_validated', 'anchor_loading']);
  assert.equal(terminalFailures.length, 1);
  assert.equal(terminalFailures[0].checkpoint, 'anchor_loading');
  assert.deepEqual(terminalFailures[0].safeFailure, {
    errorClass: 'TypeError',
    reason: 'unexpected_execution_failure',
  });
  assert.doesNotMatch(JSON.stringify(terminalFailures), /mocked boundary failure/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Generated recovery bundle reached anchor loading with zero provider requests.');
