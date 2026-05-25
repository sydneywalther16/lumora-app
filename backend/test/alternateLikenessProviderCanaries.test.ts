import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import { getKlingProviderReadiness, startKlingSelfLikenessCanary } from '../src/services/providers/klingProvider';
import { getRunwayProviderReadiness, startRunwaySelfLikenessCanary } from '../src/services/providers/runwayProvider';

const originalEnv = {
  KLING_ENABLED: env.KLING_ENABLED,
  KLING_PROVIDER: env.KLING_PROVIDER,
  KLING_API_KEY: env.KLING_API_KEY,
  KLING_MODEL: env.KLING_MODEL,
  KLING_REFERENCE_MODEL: env.KLING_REFERENCE_MODEL,
  KLING_ELEMENTS_MODEL: env.KLING_ELEMENTS_MODEL,
  RUNWAY_ENABLED: env.RUNWAY_ENABLED,
  RUNWAY_API_KEY: env.RUNWAY_API_KEY,
  RUNWAY_MODEL: env.RUNWAY_MODEL,
  RUNWAY_REFERENCE_MODEL: env.RUNWAY_REFERENCE_MODEL,
};
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

function restore() {
  env.KLING_ENABLED = originalEnv.KLING_ENABLED;
  env.KLING_PROVIDER = originalEnv.KLING_PROVIDER;
  env.KLING_API_KEY = originalEnv.KLING_API_KEY;
  env.KLING_MODEL = originalEnv.KLING_MODEL;
  env.KLING_REFERENCE_MODEL = originalEnv.KLING_REFERENCE_MODEL;
  env.KLING_ELEMENTS_MODEL = originalEnv.KLING_ELEMENTS_MODEL;
  env.RUNWAY_ENABLED = originalEnv.RUNWAY_ENABLED;
  env.RUNWAY_API_KEY = originalEnv.RUNWAY_API_KEY;
  env.RUNWAY_MODEL = originalEnv.RUNWAY_MODEL;
  env.RUNWAY_REFERENCE_MODEL = originalEnv.RUNWAY_REFERENCE_MODEL;
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Tests must not make live provider calls.');
  }) as typeof fetch;

  env.RUNWAY_ENABLED = false;
  env.RUNWAY_API_KEY = undefined;
  env.RUNWAY_MODEL = undefined;
  env.RUNWAY_REFERENCE_MODEL = undefined;
  const runwayOff = getRunwayProviderReadiness();
  assert.equal(runwayOff.status, 'not_configured');
  const runwayOffCanary = await startRunwaySelfLikenessCanary({});
  assert.equal(runwayOffCanary.failureCategory, 'not_configured');
  assert.equal(fetchCalls, 0);

  env.RUNWAY_ENABLED = true;
  env.RUNWAY_API_KEY = 'runway-secret';
  env.RUNWAY_REFERENCE_MODEL = 'gen4.5';
  const runwayReady = getRunwayProviderReadiness();
  assert.equal(runwayReady.status, 'configured_ready_for_canary');
  assert.equal(JSON.stringify(runwayReady).includes('runway-secret'), false);

  env.KLING_ENABLED = false;
  env.KLING_PROVIDER = 'fal';
  env.KLING_API_KEY = undefined;
  env.KLING_REFERENCE_MODEL = undefined;
  const klingOff = getKlingProviderReadiness();
  assert.equal(klingOff.status, 'not_configured');
  const klingOffCanary = await startKlingSelfLikenessCanary();
  assert.equal(klingOffCanary.failureCategory, 'not_configured');
  assert.equal(fetchCalls, 0);

  env.KLING_ENABLED = true;
  env.KLING_PROVIDER = 'fal';
  env.KLING_API_KEY = 'kling-secret';
  env.KLING_REFERENCE_MODEL = 'kling-reference';
  const klingReady = getKlingProviderReadiness();
  assert.equal(klingReady.status, 'configured_ready_for_canary');
  assert.equal(JSON.stringify(klingReady).includes('kling-secret'), false);
  assert.equal(fetchCalls, 0);

  console.log('alternateLikenessProviderCanaries unit tests passed');
} finally {
  restore();
}
