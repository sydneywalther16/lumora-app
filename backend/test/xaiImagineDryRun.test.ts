import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DirectorPlan } from '../src/services/director/contracts';
import {
  buildXaiComparisonHarness,
  estimateXaiAiCastRoute,
  prepareXaiAiCastDryRun,
  selectXaiAiCastRoute,
  XAI_IMAGINE_PRICING_USD,
} from '../src/services/director/xaiRouting';
import {
  buildXaiCharacterPlatePayload,
  buildXaiFileCleanupPlan,
  buildXaiImageToVideoHeroPayload,
  buildXaiReferenceToVideoPayload,
  buildXaiVideoEditPayload,
  buildXaiVideoExtensionPayload,
  redactXaiImagineRequest,
  type XaiPrivateMediaReference,
} from '../src/services/providers/xaiImagine';
import { isProviderNeutralProgressState } from '../src/services/director/progress';

const userId = 'user-fixture';
const scene = 'She walks through a candlelit mansion and pauses after hearing a sound behind her.';
const plan: DirectorPlan = {
  sceneSummary: scene,
  castDescription: 'One consenting adult synthetic cast member.',
  wardrobe: 'A dark tailored coat.',
  environment: 'A candlelit mansion hall.',
  lighting: 'Warm candlelight with soft shadows.',
  action: 'Walk, pause, and look back.',
  cameraPlan: 'Stable portrait tracking shot.',
  continuityLocks: ['Keep one adult identity stable.', 'Keep wardrobe and candle direction stable.'],
  publicCaption: scene,
  syntheticDisclosure: 'Synthetic portrayal',
  shots: [{
    id: 'shot-1',
    summary: scene,
    action: 'Walk, pause, and look back.',
    cameraPlan: 'Stable portrait tracking shot.',
    durationSeconds: 4,
  }],
};

function imageReference(index: number, identityId = 'identity-sydney'): XaiPrivateMediaReference {
  return {
    fileId: `file_fixture-image-${index}`,
    ownerUserId: userId,
    mediaType: 'image',
    mimeType: 'image/jpeg',
    humanSubject: true,
    identityId,
    ownershipConfirmed: true,
    consentConfirmed: true,
    adultConfirmed: true,
    childLike: false,
    celebrityOrPublicFigure: false,
    scrapedSource: false,
    nonConsensualSexualized: false,
    thirdPartyWatermark: false,
  };
}

function videoReference(durationSeconds: number): XaiPrivateMediaReference {
  return {
    ...imageReference(90),
    fileId: 'file_fixture-video-90',
    mediaType: 'video',
    mimeType: 'video/mp4',
    durationSeconds,
  };
}

const references = [1, 2, 3].map((index) => imageReference(index));

const plate = buildXaiCharacterPlatePayload({ userId, references, plan });
assert.equal(plate.execution, 'disabled');
assert.equal(plate.providerRequestsMade, 0);
assert.equal(plate.endpoint, '/v1/images/edits');
assert.equal((plate.body.images as unknown[]).length, 3);
assert.equal((plate.body.storage_options as Record<string, unknown>).public_url, undefined);

assert.throws(
  () => buildXaiCharacterPlatePayload({
    userId,
    references: [1, 2, 3, 4].map((index) => imageReference(index)),
    plan,
  }),
  /1-3 private image reference/,
);

const direct = buildXaiReferenceToVideoPayload({
  userId,
  references: [1, 2, 3, 4, 5, 6, 7].map((index) => imageReference(index)),
  plan,
  durationSeconds: 10,
});
assert.equal(direct.providerRequestsMade, 0);
assert.equal((direct.body.reference_images as unknown[]).length, 7);
assert.equal(direct.body.image, undefined);
assert.equal(direct.body.audio, undefined);
assert.throws(
  () => buildXaiReferenceToVideoPayload({
    userId,
    references: [1, 2, 3, 4, 5, 6, 7, 8].map((index) => imageReference(index)),
    plan,
    durationSeconds: 4,
  }),
  /1-7 private image reference/,
);

const hero = buildXaiImageToVideoHeroPayload({
  userId,
  source: imageReference(1),
  plan,
  durationSeconds: 4,
});
assert.equal(hero.body.model, 'grok-imagine-video-1.5');
assert.equal(hero.body.reference_images, undefined);
assert.deepEqual(hero.body.image, { file_id: 'file_fixture-image-1' });
assert.equal(hero.body.resolution, '1080p');

const edit = buildXaiVideoEditPayload({
  userId,
  source: videoReference(8.7),
  instruction: 'Stabilize one brief hand movement.',
});
assert.equal(edit.body.duration, undefined);
assert.equal(edit.body.resolution, undefined);
assert.throws(
  () => buildXaiVideoEditPayload({
    userId,
    source: videoReference(8.71),
    instruction: 'Stabilize one brief hand movement.',
  }),
  /no longer than 8.7 seconds/,
);

const extension = buildXaiVideoExtensionPayload({
  userId,
  source: videoReference(15),
  instruction: 'Continue the camera move.',
  extensionDurationSeconds: 10,
});
assert.equal(extension.body.duration, 10);
assert.equal(extension.body.resolution, undefined);
assert.throws(
  () => buildXaiVideoExtensionPayload({
    userId,
    source: videoReference(1.9),
    instruction: 'Continue the camera move.',
    extensionDurationSeconds: 4,
  }),
  /2-15 second source/,
);

const wrongOwner = { ...imageReference(1), ownerUserId: 'another-user' };
assert.throws(
  () => buildXaiCharacterPlatePayload({ userId, references: [wrongOwner], plan }),
  /owned by or explicitly licensed/,
);
assert.throws(
  () => buildXaiCharacterPlatePayload({
    userId,
    references: [imageReference(1, 'identity-one'), imageReference(2, 'identity-two')],
    plan,
  }),
  /Mixed human identities/,
);

for (const unsafePatch of [
  { adultConfirmed: false },
  { childLike: true },
  { celebrityOrPublicFigure: true },
  { scrapedSource: true },
  { nonConsensualSexualized: true },
  { thirdPartyWatermark: true },
]) {
  const unsafe = { ...imageReference(1), ...unsafePatch } as XaiPrivateMediaReference;
  assert.throws(() => buildXaiCharacterPlatePayload({ userId, references: [unsafe], plan }));
}

const cleanup = buildXaiFileCleanupPlan({
  authenticatedUserId: userId,
  file: { fileId: 'file_fixture-output-1', ownerUserId: userId, purpose: 'generated_video' },
});
assert.equal(cleanup.execution, 'disabled');
assert.equal(cleanup.providerRequestsMade, 0);
assert.deepEqual(cleanup.steps.map((step) => step.method), ['POST', 'DELETE']);
assert.equal(JSON.stringify(cleanup.safeDiagnostics).includes('file_fixture-output-1'), false);
assert.throws(() => buildXaiFileCleanupPlan({
  authenticatedUserId: 'wrong-user',
  file: { fileId: 'file_fixture-output-1', ownerUserId: userId, purpose: 'generated_video' },
}), /owning Lumora user/);

assert.equal(selectXaiAiCastRoute({ tier: 'test', explicitlySelected: true, referenceCount: 7 }), 'direct_reference');
assert.equal(selectXaiAiCastRoute({ tier: 'standard', explicitlySelected: true, referenceCount: 3 }), 'character_plate');
assert.equal(selectXaiAiCastRoute({ tier: 'premium', explicitlySelected: true, referenceCount: 1 }), 'premium_hero');
assert.throws(
  () => selectXaiAiCastRoute({ tier: 'test', explicitlySelected: false, referenceCount: 1 }),
  /automatic paid fallback is disabled/,
);

assert.equal(estimateXaiAiCastRoute({
  route: 'direct_reference', referenceCount: 3, durationSeconds: 4, standardResolution: '480p',
}).projectedCostUsd, 0.206);
assert.equal(estimateXaiAiCastRoute({
  route: 'character_plate', referenceCount: 3, durationSeconds: 4, standardResolution: '720p', plateResolution: '1K',
}).projectedCostUsd, 0.362);
assert.equal(estimateXaiAiCastRoute({
  route: 'premium_hero', referenceCount: 1, durationSeconds: 4, heroResolution: '1080p',
}).projectedCostUsd, 1.01);
assert.equal(XAI_IMAGINE_PRICING_USD.auditedAt, '2026-08-01');

const dryRun = prepareXaiAiCastDryRun({
  tier: 'standard',
  explicitlySelected: true,
  userId,
  references,
  plan,
});
assert.equal(dryRun.mode, 'dry_run');
assert.equal(dryRun.paidExecutionEnabled, false);
assert.equal(dryRun.providerRequestsMade, 0);
assert.equal(dryRun.preparedRequests.length, 2);
assert.equal(dryRun.automaticRetryRequests, 0);
assert.equal(dryRun.automaticFallbackRequests, 0);
assert.equal(dryRun.automaticRepairRequests, 0);
assert.equal(dryRun.publicCaption, scene);
assert.equal(dryRun.syntheticDisclosure, 'Synthetic portrayal');
assert.equal(dryRun.progressStates.every(isProviderNeutralProgressState), true);
const safeDiagnosticsJson = JSON.stringify(dryRun.safeDiagnostics);
assert.doesNotMatch(safeDiagnosticsJson, /file_fixture|candlelit mansion|api[_-]?key|token|authorization/i);

const comparison = buildXaiComparisonHarness({ referenceCount: 1, durationSeconds: 4, currentGoogleProjectedCostUsd: 0.477 });
assert.equal(comparison.mode, 'comparison_only');
assert.equal(comparison.providerRequestsMade, 0);
assert.equal(comparison.automaticPaidFallback, false);
assert.equal(comparison.rows.filter((row) => row.eligible).length, 3);

const redacted = redactXaiImagineRequest(hero);
assert.equal(redacted.payload, '[redacted]');
assert.equal(JSON.stringify(redacted).includes('file_fixture-image-1'), false);

function endpointFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return endpointFiles(fullPath);
    return /\.(?:ts|js)$/.test(entry.name) ? [fullPath] : [];
  });
}
assert.equal(endpointFiles(join(process.cwd(), 'api')).length, 12);

const adapterSource = readFileSync(join(process.cwd(), 'backend/src/services/providers/xaiImagine.ts'), 'utf8');
assert.doesNotMatch(adapterSource, /fetch\s*\(|axios|XAI_API_KEY|console\.(?:log|error|warn)/);

console.log('xAI Imagine dry-run routing tests passed');
