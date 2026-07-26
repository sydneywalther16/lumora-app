import assert from 'node:assert/strict';
import {
  buildSafeReferenceRouteReadiness,
  type ReferenceRouteReadinessRow,
} from '../src/services/productionHealthDiagnostics';

function blockedRow(referenceRole: string): ReferenceRouteReadinessRow {
  return {
    provider: 'seedance-fast',
    referenceRole,
    variant: 'reference_images',
    successCount: 0,
    failureCount: 1,
    failureCategory: 'reference_moderation_block',
  };
}

const partialModeration = buildSafeReferenceRouteReadiness([
  blockedRow('full_body'),
  blockedRow('side_angle_left'),
  blockedRow('side_angle_right'),
]);

assert.equal(partialModeration.referenceRouteStatus.state, 'failed');
assert.equal(partialModeration.referenceRouteStatus.seedanceReferenceRoutesBlocked, false);
assert.equal(partialModeration.seedanceImageReferenceBlocked, true);
assert.deepEqual(partialModeration.referenceRouteStatus.blockedReferenceRoles, [
  'full_body',
  'side_angle_left',
  'side_angle_right',
]);

const allRolesModerated = buildSafeReferenceRouteReadiness([
  blockedRow('front_angle'),
  blockedRow('full_body'),
  blockedRow('side_angle_left'),
  blockedRow('side_angle_right'),
]);

assert.equal(allRolesModerated.referenceRouteStatus.seedanceReferenceRoutesBlocked, true);
assert.equal(allRolesModerated.seedanceImageReferenceBlocked, true);

const successfulRouteExists = buildSafeReferenceRouteReadiness([
  blockedRow('full_body'),
  {
    provider: 'seedance-fast',
    referenceRole: 'front_angle',
    variant: 'reference_images',
    successCount: 1,
    failureCount: 0,
    failureCategory: null,
  },
]);

assert.equal(successfulRouteExists.referenceRouteStatus.state, 'succeeded');
assert.equal(successfulRouteExists.referenceRouteStatus.seedanceReferenceRoutesBlocked, false);
assert.equal(successfulRouteExists.seedanceImageReferenceBlocked, false);

for (const route of partialModeration.referenceRouteStatus.allReferenceRouteResults) {
  assert.deepEqual(Object.keys(route).sort(), [
    'failureCategory',
    'provider',
    'referenceRole',
    'succeeded',
    'variant',
  ]);
}

console.log('production health diagnostics regression tests passed');
