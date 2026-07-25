import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSafeHealthFallback,
  PRODUCTION_APP_ORIGIN,
  resolveApiUrl,
  SAFE_NATIVE_STATUS_PATH,
} from '../../src/lib/apiOrigin';
import {
  shouldShowInstallAction,
  shouldShowNativeRouteHeader,
  shouldShowSimulatedDeviceStatus,
} from '../../src/lib/nativeUi';

assert.equal(
  resolveApiUrl('/api/health/diagnostics', true),
  `${PRODUCTION_APP_ORIGIN}/api/health/diagnostics`,
);
assert.equal(resolveApiUrl('api/health/diagnostics', false), '/api/health/diagnostics');
assert.equal(SAFE_NATIVE_STATUS_PATH, '/api/lumora/scene-anchor-runtime-status');
const fallbackHealth = buildSafeHealthFallback({
  ok: true,
  sceneAnchorConfigured: false,
  generationProviders: [
    { id: 'seedance-2.0', ready: true, status: 'ready' },
    { id: 'demo-mode', ready: true, status: 'ready' },
  ],
});
assert.equal(fallbackHealth.ok, true);
assert.equal(fallbackHealth.mode, 'production-fallback');
assert.deepEqual(fallbackHealth.generationProviders, [
  { id: 'seedance-2.0', ready: true, status: 'ready' },
  { id: 'demo-mode', ready: true, status: 'ready' },
]);
assert.equal(shouldShowInstallAction(true), false);
assert.equal(shouldShowInstallAction(false), true);
assert.equal(shouldShowSimulatedDeviceStatus(true), false);
assert.equal(shouldShowSimulatedDeviceStatus(false), true);
assert.equal(shouldShowNativeRouteHeader(true, 'Lumora'), false);
assert.equal(shouldShowNativeRouteHeader(true, 'Drafts'), true);

const repoRoot = process.cwd();
const apiSource = readFileSync(join(repoRoot, 'src/lib/api.ts'), 'utf8');
const createSource = readFileSync(join(repoRoot, 'src/components/CreateVideo.tsx'), 'utf8');
const profileSource = readFileSync(join(repoRoot, 'src/pages/ProfilePage.tsx'), 'utf8');
const homeSource = readFileSync(join(repoRoot, 'src/pages/HomePage.tsx'), 'utf8');
const statusSource = readFileSync(join(repoRoot, 'src/components/StatusBar.tsx'), 'utf8');

assert.doesNotMatch(createSource, /Start the API server|VITE_API_BASE_URL/);
assert.match(apiSource, /CapacitorHttp\.request/);
assert.match(apiSource, /SAFE_NATIVE_STATUS_PATH/);
assert.match(createSource, /Lumora Stage is temporarily unavailable\. Your scene can still be saved as a draft\./);
assert.match(createSource, /Real rendering needs the server-side REPLICATE_API_TOKEN setting\./);
assert.match(createSource, /Preview Demo/);
assert.doesNotMatch(createSource, /Setup needed/);
assert.match(createSource, /fetchApiResponse\('\/api\/lumora\/generate-video'/);
assert.match(profileSource, /fetchApiResponse\('\/api\/lumora\/build-identity'/);
assert.match(homeSource, /shouldShowInstallAction/);
assert.match(homeSource, /buildPortrayalDisclosure/);
assert.match(statusSource, /shouldShowSimulatedDeviceStatus/);

console.log('nativeProductionReadiness unit tests passed');
