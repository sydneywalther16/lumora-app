import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import {
  classifyFalAccountStatus,
  getFalAccountStatus,
} from '../src/services/providers/falAccountDiagnostics';
import {
  buildKlingReferenceToVideoPayload,
  classifyKlingFailure,
  getKlingProviderReadiness,
  startKlingSelfLikenessCanary,
} from '../src/services/providers/klingProvider';

const originalEnv = {
  KLING_ENABLED: env.KLING_ENABLED,
  FAL_KEY: env.FAL_KEY,
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
  env.FAL_KEY = originalEnv.FAL_KEY;
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
  env.FAL_KEY = undefined;
  env.KLING_PROVIDER = 'fal';
  env.KLING_API_KEY = undefined;
  env.KLING_REFERENCE_MODEL = undefined;
  env.KLING_ELEMENTS_MODEL = undefined;
  const off = getKlingProviderReadiness();
  assert.equal(off.status, 'not_configured');
  const offCanary = await startKlingSelfLikenessCanary();
  assert.equal(offCanary.failureCategory, 'not_configured');
  assert.equal(fetchCalls, 0);
  const missingAccount = await getFalAccountStatus();
  assert.equal(missingAccount.errorCategory, 'fal_key_missing');
  assert.equal(missingAccount.falKeyPresent, false);
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
  assert.equal(classifyKlingFailure({ statusCode: 403, detail: 'User is locked. Reason: Exhausted balance. Top up your balance.' }).category, 'kling_billing_required');

  assert.equal(classifyFalAccountStatus({ statusCode: 401, payload: { detail: 'invalid key' } }).errorCategory, 'fal_auth_failed');
  assert.equal(classifyFalAccountStatus({ statusCode: 403, payload: { detail: 'User is locked. Reason: Exhausted balance.' } }).errorCategory, 'fal_account_locked');
  assert.equal(classifyFalAccountStatus({ statusCode: 200, payload: { username: 'workspace', credits: { current_balance: 0, currency: 'USD' } }, balanceAmount: 0 }).errorCategory, 'fal_billing_required');

  const lockedAccount = {
    ok: false,
    falKeyPresent: true,
    falKeySource: 'KLING_API_KEY' as const,
    authOk: true,
    workspaceRedacted: 'wor...ce',
    userRedacted: null,
    balancePresent: true,
    balanceAmount: 0,
    balanceCurrency: 'USD',
    locked: true,
    billingRequired: true,
    errorCategory: 'fal_account_locked' as const,
    errorSummary: 'locked',
    recommendedNextAction: 'add credits',
  };
  assert.equal(getKlingProviderReadiness({ falAccountStatus: lockedAccount }).status, 'billing_required');

  const okAccount = {
    ...lockedAccount,
    ok: true,
    authOk: true,
    balanceAmount: 25,
    locked: false,
    billingRequired: false,
    errorCategory: 'fal_ok' as const,
    errorSummary: null,
  };
  assert.equal(getKlingProviderReadiness({
    falAccountStatus: okAccount,
    statuses: [{
      provider: 'kling_reference',
      status: 'canary_failed',
      lastFailureCategory: 'kling_billing_required',
      providerModel: 'fal-ai/kling-video/o1/standard/reference-to-video',
    }],
  }).status, 'configured_ready_for_canary');

  globalThis.fetch = (async () => new Response(JSON.stringify({
    username: 'team-workspace',
    credits: { current_balance: 12.5, currency: 'USD' },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const accountOk = await getFalAccountStatus();
  assert.equal(accountOk.errorCategory, 'fal_ok');
  assert.equal(accountOk.falKeyPresent, true);
  assert.equal(accountOk.authOk, true);
  assert.equal(accountOk.balanceAmount, 12.5);
  assert.equal(JSON.stringify(accountOk).includes('kling-secret'), false);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    detail: 'invalid key',
  }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const accountInvalid = await getFalAccountStatus();
  assert.equal(accountInvalid.errorCategory, 'fal_auth_failed');
  assert.equal(accountInvalid.authOk, false);
  assert.equal(JSON.stringify(accountInvalid).includes('kling-secret'), false);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    username: 'team-workspace',
    credits: { current_balance: 0, currency: 'USD' },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const accountExhausted = await getFalAccountStatus();
  assert.equal(accountExhausted.errorCategory, 'fal_billing_required');
  assert.equal(accountExhausted.billingRequired, true);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    detail: 'User is locked. Reason: Exhausted balance. Top up your balance.',
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const accountLocked = await getFalAccountStatus();
  assert.equal(accountLocked.errorCategory, 'fal_account_locked');
  assert.equal(accountLocked.billingRequired, true);
  assert.equal(accountLocked.locked, true);

  env.KLING_PROVIDER = 'other';
  assert.equal(getKlingProviderReadiness().status, 'configured_not_implemented');
  assert.equal(fetchCalls, 0);

  console.log('klingProvider unit tests passed');
} finally {
  restore();
}
