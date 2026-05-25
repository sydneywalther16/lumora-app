import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import {
  RUNWAY_CANARY_PROMPT,
  buildRunwayImageToVideoPayload,
  classifyRunwayFailure,
  getRunwayProviderReadiness,
  startRunwaySelfLikenessCanary,
} from '../src/services/providers/runwayProvider';

const originalEnv = {
  RUNWAY_ENABLED: env.RUNWAY_ENABLED,
  RUNWAY_API_KEY: env.RUNWAY_API_KEY,
  RUNWAY_MODEL: env.RUNWAY_MODEL,
  RUNWAY_REFERENCE_MODEL: env.RUNWAY_REFERENCE_MODEL,
};
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

function restore() {
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
  const off = getRunwayProviderReadiness();
  assert.equal(off.status, 'not_configured');
  const offCanary = await startRunwaySelfLikenessCanary({});
  assert.equal(offCanary.failureCategory, 'not_configured');
  assert.equal(fetchCalls, 0);

  env.RUNWAY_ENABLED = true;
  env.RUNWAY_API_KEY = 'runway-secret';
  env.RUNWAY_REFERENCE_MODEL = 'gen4.5';
  const ready = getRunwayProviderReadiness();
  assert.equal(ready.status, 'configured_ready_for_canary');
  assert.equal(ready.implemented, true);
  assert.equal(JSON.stringify(ready).includes('runway-secret'), false);

  const payload = buildRunwayImageToVideoPayload({
    promptImage: 'https://assets.example/front.jpg',
    promptText: RUNWAY_CANARY_PROMPT,
    model: 'gen4.5',
  });
  assert.equal(payload.promptImage, 'https://assets.example/front.jpg');
  assert.equal(payload.promptText, RUNWAY_CANARY_PROMPT);
  assert.equal(payload.model, 'gen4.5');
  assert.equal(payload.ratio, '768:1280');
  assert.equal(payload.duration, 5);

  assert.equal(classifyRunwayFailure({ statusCode: 400, detail: 'invalid promptImage' }).category, 'runway_input_schema');
  assert.equal(classifyRunwayFailure({ statusCode: 503, detail: 'temporarily unavailable' }).category, 'runway_provider_unavailable');
  assert.equal(classifyRunwayFailure({ detail: 'blocked by safety filter' }).category, 'runway_moderation_block');
  assert.equal(classifyRunwayFailure({ statusCode: 403, detail: 'unauthorized' }).category, 'runway_access_denied');

  assert.equal(fetchCalls, 0);

  console.log('runwayProvider unit tests passed');
} finally {
  restore();
}
