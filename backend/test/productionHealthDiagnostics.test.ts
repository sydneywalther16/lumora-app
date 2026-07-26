import assert from 'node:assert/strict';
import {
  buildSafeReferenceRouteReadiness,
  fetchSafeReferenceRouteRowsFromSupabase,
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

const requestedUrls: string[] = [];
const supabaseRows = await fetchSafeReferenceRouteRowsFromSupabase({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'test-only-key',
  fetchImpl: async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requestedUrls.push(url.toString());
    assert.equal(init?.method, 'GET');
    assert.equal((init?.headers as Record<string, string>).apikey, 'test-only-key');
    return new Response(JSON.stringify([
      {
        provider: 'seedance-fast',
        reference_strategy: 'front_angle',
        notes: { variant: 'reference_images' },
        success_count: 0,
        failure_count: 1,
        last_failure_category: 'reference_moderation_block',
      },
    ]));
  },
});

assert.equal(requestedUrls.length, 1);
assert.match(requestedUrls[0] ?? '', /render_mode=eq\.reference_route_canary/);
assert.deepEqual(supabaseRows, [blockedRow('front_angle')]);

console.log('production health diagnostics regression tests passed');
