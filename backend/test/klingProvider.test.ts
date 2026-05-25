import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import {
  buildKlingReferenceToVideoPayload,
  classifyKlingFailure,
  getKlingProviderReadiness,
  startKlingSelfLikenessCanary,
} from '../src/services/providers/klingProvider';

const originalEnv = {
  KLING_ENABLED: env.KLING_ENABLED,
  KLING_PROVIDER: env.KLING_PROVIDER,
  KLING_API_KEY: env.KLING_API_KEY,
  KLING_MODEL: env.KLING_MODEL,
  KLING_REFERENCE_MODEL: env.KLING_REFERENCE_MODEL,
  KLING_ELEMENTS_MODEL: env.KLING_ELEMENTS_MODEL,
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
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Tests must not make live provider calls.');
  }) as typeof fetch;

  env.KLING_ENABLED = false;
  env.KLING_PROVIDER = 'fal';
  env.KLING_API_KEY = undefined;
  env.KLING_REFERENCE_MODEL = undefined;
  env.KLING_ELEMENTS_MODEL = undefined;
  const off = getKlingProviderReadiness();
  assert.equal(off.status, 'not_configured');
  const offCanary = await startKlingSelfLikenessCanary();
  assert.equal(offCanary.failureCategory, 'not_configured');
  assert.equal(fetchCalls, 0);

  env.KLING_ENABLED = true;
  env.KLING_PROVIDER = 'fal';
  env.KLING_API_KEY = 'kling-secret';
  env.KLING_REFERENCE_MODEL = 'fal-ai/kling-video/o1/standard/reference-to-video';
  const ready = getKlingProviderReadiness();
  assert.equal(ready.status, 'configured_ready_for_canary');
  assert.equal(ready.implemented, true);
  assert.equal(JSON.stringify(ready).includes('kling-secret'), false);

  const payload = buildKlingReferenceToVideoPayload({
    frontalImageUrl: 'https://assets.example/front.jpg',
    referenceImageUrls: [
      'https://assets.example/left.jpg',
      'https://assets.example/right.jpg',
    ],
  });
  assert.deepEqual(payload.image_urls, ['https://assets.example/front.jpg']);
  assert.equal(payload.elements[0].frontal_image_url, 'https://assets.example/front.jpg');
  assert.deepEqual(payload.elements[0].reference_image_urls, [
    'https://assets.example/left.jpg',
    'https://assets.example/right.jpg',
  ]);
  assert.match(payload.prompt, /@Element1/);
  assert.equal(payload.aspect_ratio, '9:16');

  assert.equal(classifyKlingFailure({ statusCode: 400, detail: 'unknown field image_urls' }).category, 'kling_input_schema');
  assert.equal(classifyKlingFailure({ statusCode: 503, detail: 'temporarily unavailable' }).category, 'kling_provider_unavailable');
  assert.equal(classifyKlingFailure({ detail: 'content flagged by safety policy' }).category, 'kling_moderation_block');
  assert.equal(classifyKlingFailure({ detail: 'could not download image url' }).category, 'kling_asset_access');

  env.KLING_PROVIDER = 'other';
  assert.equal(getKlingProviderReadiness().status, 'configured_not_implemented');
  assert.equal(fetchCalls, 0);

  console.log('klingProvider unit tests passed');
} finally {
  restore();
}
