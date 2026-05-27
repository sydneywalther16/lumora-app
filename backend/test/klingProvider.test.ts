import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import { normalizeAlternateProviderFailureCategory, type AlternateExactLikenessProviderStatus } from '../src/services/alternateLikenessProviderMemory';
import {
  classifyFalAccountStatus,
  getFalAccountStatus,
} from '../src/services/providers/falAccountDiagnostics';
import {
  buildKlingPollFailurePayload,
  buildKlingPreJobFailureDiagnostics,
  buildKlingReferenceToVideoPayload,
  buildKlingSubmittedJobNotesForTest,
  buildKlingStageFailurePayload,
  classifyKlingFailure,
  createKlingCanaryAttemptMarker,
  getKlingProviderReadiness,
  klingPayloadShapeSummary,
  modelForVariant,
  parseKlingQueueVideoOutput,
  resolveKlingPollUrls,
  shouldReturnStoredKlingCanaryStatus,
  startKlingSelfLikenessCanary,
} from '../src/services/providers/klingProvider';

const originalEnv = {
  KLING_ENABLED: env.KLING_ENABLED,
  FAL_ADMIN_KEY: env.FAL_ADMIN_KEY,
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
  env.FAL_ADMIN_KEY = originalEnv.FAL_ADMIN_KEY;
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
  env.FAL_ADMIN_KEY = undefined;
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
  assert.equal(classifyKlingFailure({ statusCode: 422, detail: 'validation failed' }).category, 'kling_input_schema');
  assert.equal(classifyKlingFailure({ statusCode: 404, detail: 'model not found' }).category, 'kling_model_not_found');
  assert.equal(classifyKlingFailure({ statusCode: 401, detail: 'invalid key' }).category, 'kling_auth_or_scope_failed');
  assert.equal(classifyKlingFailure({ statusCode: 403, detail: 'This API key not permitted to perform this action.' }).category, 'kling_auth_or_scope_failed');
  assert.equal(classifyKlingFailure({ statusCode: 429, detail: 'too many requests' }).category, 'kling_rate_limited');
  assert.equal(classifyKlingFailure({ statusCode: 503, detail: 'temporarily unavailable' }).category, 'kling_provider_unavailable');
  assert.equal(classifyKlingFailure({ detail: 'content flagged by safety policy' }).category, 'kling_moderation_block');
  assert.equal(classifyKlingFailure({ detail: 'could not download image url' }).category, 'kling_asset_access');
  assert.equal(classifyKlingFailure({ statusCode: 403, detail: 'User is locked. Reason: Exhausted balance. Top up your balance.' }).category, 'kling_billing_required');
  assert.equal(modelForVariant('o1_reference_to_video', 'configured-model'), 'fal-ai/kling-video/o1/reference-to-video');
  assert.equal(modelForVariant('o1_standard_reference_to_video', 'configured-model'), 'fal-ai/kling-video/o1/standard/reference-to-video');
  assert.equal(modelForVariant('configured', 'configured-model'), 'configured-model');

  const shape = klingPayloadShapeSummary(payload);
  assert.equal(shape.imageUrlsCount, 1);
  assert.equal(shape.elementsCount, 1);
  assert.equal(shape.hasPrompt, true);
  assert.equal(shape.promptTokenStyle, '@Element1');
  assert.equal(shape.privateUrlsRedacted, true);
  assert.equal(JSON.stringify(shape).includes('assets.example'), false);

  const preJobDiagnostics = buildKlingPreJobFailureDiagnostics({
    selectedModel: 'fal-ai/kling-video/o1/reference-to-video',
    payload,
    error: Object.assign(new Error('fal failed'), {
      failureCategory: 'kling_input_schema',
      falHttpStatus: 400,
      falErrorType: 'validation_error',
      falErrorMessage: 'invalid image url [redacted-url]',
      falErrorBodyRedacted: '{"detail":"invalid [redacted-url]"}',
      endpointUsed: 'https://queue.fal.run/fal-ai/kling-video/o1/reference-to-video',
      modelSlug: 'fal-ai/kling-video/o1/reference-to-video',
    }),
  });
  assert.equal(preJobDiagnostics.failureCategory, 'kling_input_schema');
  assert.equal(preJobDiagnostics.falHttpStatus, 400);
  assert.equal(preJobDiagnostics.falErrorType, 'validation_error');
  assert.equal(preJobDiagnostics.modelSlug, 'fal-ai/kling-video/o1/reference-to-video');
  assert.equal(preJobDiagnostics.payloadShapeSummary.privateUrlsRedacted, true);
  assert.equal(JSON.stringify(preJobDiagnostics).includes('kling-secret'), false);
  assert.equal(JSON.stringify(preJobDiagnostics).includes('assets.example'), false);

  const clientExceptionDiagnostics = buildKlingPreJobFailureDiagnostics({
    selectedModel: 'fal-ai/kling-video/o1/reference-to-video',
    payload,
    error: new TypeError('fetch failed for https://private.example/signed?token=secret'),
  });
  assert.equal(clientExceptionDiagnostics.failureCategory, 'kling_client_exception');
  assert.equal(clientExceptionDiagnostics.falHttpStatus, null);
  assert.equal(clientExceptionDiagnostics.providerErrorSummary.includes('token=secret'), false);
  assert.notEqual(clientExceptionDiagnostics.providerErrorSummary.trim(), '');

  const attempt = createKlingCanaryAttemptMarker({
    selectedModel: 'fal-ai/kling-video/o1/reference-to-video',
    variant: 'o1_reference_to_video',
  });
  assert.match(attempt.attemptId, /^kling-canary-/);
  assert.equal(attempt.variant, 'o1_reference_to_video');

  const noReferencesPayload = buildKlingStageFailurePayload({
    readiness: ready,
    selectedModel: ready.selectedModel,
    failureCategory: 'kling_no_references',
    skipStage: 'load_references',
    skipReason: 'no_saved_self_reference',
    completedStages: ['auth_probe_gate', 'resolve_self_character'],
    forceRetest: true,
    storedIgnored: true,
    providerErrorSummary: '',
    recommendedNextAction: 'repair references',
  });
  assert.equal(noReferencesPayload.skipStage, 'load_references');
  assert.equal(noReferencesPayload.failureCategory, 'kling_no_references');
  assert.equal(noReferencesPayload.providerErrorSummary, 'Kling canary stopped before fal submission at load_references: no_saved_self_reference.');
  assert.equal(noReferencesPayload.freshCanaryAttemptCreated, false);
  assert.equal(noReferencesPayload.stageStatus.load_references, 'failed');

  const attemptFailurePayload = buildKlingStageFailurePayload({
    readiness: ready,
    selectedModel: ready.selectedModel,
    failureCategory: 'kling_attempt_record_failed',
    skipStage: 'create_attempt_record',
    skipReason: 'local_attempt_record_failed',
    completedStages: ['auth_probe_gate', 'resolve_self_character', 'load_references', 'select_references', 'sign_reference_urls', 'build_payload'],
    forceRetest: true,
    storedIgnored: true,
    providerErrorSummary: 'db insert failed',
    recommendedNextAction: 'check backend diagnostics',
  });
  assert.equal(attemptFailurePayload.skipStage, 'create_attempt_record');
  assert.equal(attemptFailurePayload.providerErrorSummary, 'db insert failed');
  assert.equal(attemptFailurePayload.freshCanaryAttemptCreated, false);

  const submittedNotes = buildKlingSubmittedJobNotesForTest({
    attemptId: attempt.attemptId,
    jobId: 'req_123',
    submitted: {
      request_id: 'req_123',
      status_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status',
      response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req_123',
      cancel_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/cancel',
      status: 'IN_QUEUE',
    },
    payload,
  });
  assert.equal(submittedNotes.providerJobCreated, true);
  assert.equal(submittedNotes.providerJobId, 'req_123');
  assert.equal(submittedNotes.providerStatusUrl, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status');
  assert.equal(submittedNotes.providerResponseUrl, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123');

  const providerReturnedUrls = resolveKlingPollUrls({
    model: 'fal-ai/kling-video/o1/reference-to-video',
    requestId: 'req_123',
    statusUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status',
    responseUrl: 'https://queue.fal.run/fal-ai/kling-video/requests/req_123',
    preferGenericFallback: true,
  });
  assert.equal(providerReturnedUrls.statusUrlSource, 'provider_returned');
  assert.equal(providerReturnedUrls.responseUrlSource, 'provider_returned');
  assert.equal(providerReturnedUrls.statusUrl, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status');

  const oldAttemptUrls = resolveKlingPollUrls({
    model: 'fal-ai/kling-video/o1/reference-to-video',
    requestId: 'req_123',
    preferGenericFallback: true,
  });
  assert.equal(oldAttemptUrls.statusUrlSource, 'generic_kling_fallback');
  assert.equal(oldAttemptUrls.responseUrlSource, 'generic_kling_fallback');
  assert.equal(oldAttemptUrls.statusUrl, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status');
  assert.equal(oldAttemptUrls.responseUrl, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123');
  assert.equal(oldAttemptUrls.statusUrl.includes('/o1/reference-to-video/'), false);

  const modelSlugFallbackUrls = resolveKlingPollUrls({
    model: 'fal-ai/kling-video/o1/reference-to-video',
    requestId: 'req_123',
  });
  assert.equal(modelSlugFallbackUrls.statusUrlSource, 'model_slug_fallback');

  const pollFailure = buildKlingPollFailurePayload({
    readiness: ready,
    selectedModel: 'fal-ai/kling-video/o1/reference-to-video',
    attemptId: attempt.attemptId,
    providerJobId: 'req_123',
    pollEndpointUsed: oldAttemptUrls.statusUrl,
    responseEndpointUsed: oldAttemptUrls.responseUrl,
    statusUrlSource: oldAttemptUrls.statusUrlSource,
    responseUrlSource: oldAttemptUrls.responseUrlSource,
    error: new Error('status fetch exploded'),
    completedStages: ['auth_probe_gate', 'resolve_self_character', 'load_references', 'select_references', 'sign_reference_urls', 'build_payload', 'create_attempt_record', 'submit_fal_job'],
  });
  assert.equal(pollFailure.failureCategory, 'kling_poll_failed');
  assert.equal(pollFailure.providerJobCreated, true);
  assert.equal(pollFailure.skipStage, 'poll_fal_job');
  assert.equal(pollFailure.pollEndpointUsed, 'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status');
  assert.equal(pollFailure.statusUrlSource, 'generic_kling_fallback');
  assert.equal(pollFailure.providerErrorSummary.includes('stopped before fal submission'), false);
  assert.match(pollFailure.providerErrorSummary, /polling fal job status|status fetch exploded/i);

  const pollHttpFailure = buildKlingPollFailurePayload({
    readiness: ready,
    selectedModel: 'fal-ai/kling-video/o1/reference-to-video',
    providerJobId: 'req_404',
    error: Object.assign(new Error('fal poll returned 404'), {
      falHttpStatus: 404,
      falErrorType: 'not_found',
      falErrorMessage: 'request not found',
      falErrorBodyRedacted: { detail: 'request not found' },
      endpointUsed: 'https://queue.fal.run/fal-ai/kling-video/o1/reference-to-video/requests/req_404/status?token=secret',
      modelSlug: 'fal-ai/kling-video/o1/reference-to-video',
    }),
  });
  assert.equal(pollHttpFailure.falHttpStatus, 404);
  assert.equal(pollHttpFailure.falErrorType, 'not_found');
  assert.equal(pollHttpFailure.falErrorMessage, 'request not found');
  assert.equal(pollHttpFailure.endpointUsed, 'https://queue.fal.run/fal-ai/kling-video/o1/reference-to-video/requests/req_404/status');
  assert.equal(JSON.stringify(pollHttpFailure).includes('token=secret'), false);

  assert.equal(parseKlingQueueVideoOutput({
    completed: true,
    data: { video: { url: 'https://cdn.example.com/final.mp4' } },
  }).ok, true);
  assert.equal(parseKlingQueueVideoOutput({
    status: 'COMPLETED',
    result: { video_url: 'https://cdn.example.com/final.webm' },
  }).ok, true);

  assert.equal(classifyFalAccountStatus({ statusCode: 401, payload: { detail: 'invalid key' } }).errorCategory, 'fal_auth_failed');
  assert.equal(classifyFalAccountStatus({ statusCode: 403, payload: { detail: 'This API key not permitted to perform this action.' } }).errorCategory, 'fal_key_scope_not_permitted');
  assert.equal(classifyFalAccountStatus({ statusCode: 403, payload: { detail: 'User is locked. Reason: Exhausted balance.' } }).errorCategory, 'fal_account_locked');
  assert.equal(classifyFalAccountStatus({ statusCode: 200, payload: { username: 'workspace', credits: { current_balance: 0, currency: 'USD' } }, balanceAmount: 0 }).errorCategory, 'fal_billing_required');
  assert.equal(normalizeAlternateProviderFailureCategory({
    provider: 'kling_reference',
    failureCategory: 'kling_provider_failed',
    notes: {
      providerJobCreated: false,
      providerErrorSummary: 'User is locked. Reason: Exhausted balance. Top up your balance.',
    },
  }), 'kling_billing_required');
  assert.equal(normalizeAlternateProviderFailureCategory({
    provider: 'kling_reference',
    failureCategory: 'kling_provider_failed',
    notes: {
      outputUrlPresent: false,
      referenceCount: 2,
      verificationVideoUsed: false,
    },
  }), 'kling_billing_required');

  const lockedAccount = {
    ok: false,
    falKeyPresent: true,
    falKeySource: 'KLING_API_KEY' as const,
    falAdminKeyPresent: false,
    billingKeySource: 'KLING_API_KEY' as const,
    authOk: true,
    inferenceKeyScopeOk: true,
    inferenceKeyValidationStatus: 'ok' as const,
    inferenceKeyValidationModel: 'fal-ai/kling-video/o1/standard/reference-to-video',
    inferenceKeyValidationErrorSummary: null,
    billingCheckAvailable: true,
    billingCheckStatus: 'account_locked' as const,
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
    billingCheckStatus: 'ok' as const,
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

  let scopedFetchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    scopedFetchCalls += 1;
    const url = String(input);
    if (url.includes('/models/pricing')) {
      return new Response(JSON.stringify({
        prices: [{ endpoint_id: 'fal-ai/kling-video/o1/standard/reference-to-video', unit_price: 0.05, unit: 'video', currency: 'USD' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      detail: 'This API key not permitted to perform this action.',
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const accountScopeLimited = await getFalAccountStatus();
  assert.equal(scopedFetchCalls, 2);
  assert.equal(accountScopeLimited.ok, true);
  assert.equal(accountScopeLimited.errorCategory, 'fal_key_scope_not_permitted');
  assert.equal(accountScopeLimited.authOk, true);
  assert.equal(accountScopeLimited.inferenceKeyScopeOk, true);
  assert.equal(accountScopeLimited.inferenceKeyValidationStatus, 'ok');
  assert.equal(accountScopeLimited.billingCheckAvailable, false);
  assert.equal(accountScopeLimited.billingCheckStatus, 'scope_not_permitted');
  assert.match(accountScopeLimited.recommendedNextAction, /FAL_ADMIN_KEY|dashboard/i);
  assert.equal(getKlingProviderReadiness({ falAccountStatus: accountScopeLimited }).status, 'configured_ready_for_canary');
  assert.equal(getKlingProviderReadiness({
    falAccountStatus: accountScopeLimited,
    statuses: [{
      provider: 'kling_reference',
      status: 'canary_failed',
      lastFailureCategory: 'kling_billing_required',
      providerModel: 'fal-ai/kling-video/o1/standard/reference-to-video',
      referenceRole: 'front_angle',
      referenceLabel: 'Primary front face',
      lastSuccessAt: null,
      lastFailureAt: '2026-05-25T00:00:00.000Z',
      outputUrlPresent: false,
      providerJobCreated: false,
    }],
  }).status, 'configured_ready_for_canary');
  assert.equal(getKlingProviderReadiness({
    falAccountStatus: accountScopeLimited,
    statuses: [{
      provider: 'kling_reference',
      status: 'canary_failed',
      lastFailureCategory: 'kling_provider_failed',
      providerModel: 'fal-ai/kling-video/o1/standard/reference-to-video',
      referenceRole: 'front_angle',
      referenceLabel: 'Primary front face',
      lastSuccessAt: null,
      lastFailureAt: '2026-05-25T00:00:00.000Z',
      outputUrlPresent: false,
      providerJobCreated: false,
    }],
  }).status, 'configured_ready_for_canary');
  assert.equal(JSON.stringify(accountScopeLimited).includes('kling-secret'), false);

  const storedRealFailure: AlternateExactLikenessProviderStatus = {
    provider: 'kling_reference',
    providerModel: 'fal-ai/kling-video/o1/standard/reference-to-video',
    status: 'canary_failed',
    referenceRole: 'front_angle',
    referenceLabel: 'Primary front face',
    lastSuccessAt: null,
    lastFailureAt: '2026-05-25T00:00:00.000Z',
    lastFailureCategory: 'kling_provider_failed',
    outputUrlPresent: false,
    providerJobCreated: true,
  };
  assert.equal(shouldReturnStoredKlingCanaryStatus({ stored: storedRealFailure }), true);
  assert.equal(shouldReturnStoredKlingCanaryStatus({ stored: storedRealFailure, forceRetest: true }), false);
  assert.equal(shouldReturnStoredKlingCanaryStatus({
    stored: { ...storedRealFailure, providerJobCreated: null },
  }), false);
  assert.equal(shouldReturnStoredKlingCanaryStatus({
    stored: { ...storedRealFailure, providerJobCreated: false },
  }), false);
  assert.equal(shouldReturnStoredKlingCanaryStatus({
    stored: { ...storedRealFailure, lastFailureCategory: 'kling_billing_required', providerJobCreated: false },
  }), false);
  assert.equal(shouldReturnStoredKlingCanaryStatus({
    stored: {
      ...storedRealFailure,
      lastFailureCategory: 'kling_poll_failed',
      providerJobCreated: true,
      attemptId: 'kling-canary-existing',
      providerJobId: 'req_existing',
    },
    forceRetest: true,
  }), true);

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
