import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import { chooseExactLikenessRoute, exactLikenessCanaryCandidate } from '../src/services/exactLikenessRouter';
import { buildLikenessProviderRegistry } from '../src/services/likenessProviderRegistry';
import { getOpenAISoraProviderReadiness, type SelfProviderCharacterDiagnostics } from '../src/services/providers/openaiSoraProvider';

const originalEnv = {
  OPENAI_VIDEO_ENABLED: env.OPENAI_VIDEO_ENABLED,
  OPENAI_VIDEO_CHARACTER_ENABLED: env.OPENAI_VIDEO_CHARACTER_ENABLED,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  REPLICATE_API_TOKEN: env.REPLICATE_API_TOKEN,
  KLING_ENABLED: env.KLING_ENABLED,
  KLING_API_KEY: env.KLING_API_KEY,
  KLING_MODEL: env.KLING_MODEL,
  KLING_REFERENCE_MODEL: env.KLING_REFERENCE_MODEL,
  RUNWAY_ENABLED: env.RUNWAY_ENABLED,
  RUNWAY_API_KEY: env.RUNWAY_API_KEY,
  RUNWAY_MODEL: env.RUNWAY_MODEL,
  RUNWAY_REFERENCE_MODEL: env.RUNWAY_REFERENCE_MODEL,
};

function restoreEnv() {
  env.OPENAI_VIDEO_ENABLED = originalEnv.OPENAI_VIDEO_ENABLED;
  env.OPENAI_VIDEO_CHARACTER_ENABLED = originalEnv.OPENAI_VIDEO_CHARACTER_ENABLED;
  env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  env.REPLICATE_API_TOKEN = originalEnv.REPLICATE_API_TOKEN;
  env.KLING_ENABLED = originalEnv.KLING_ENABLED;
  env.KLING_API_KEY = originalEnv.KLING_API_KEY;
  env.KLING_MODEL = originalEnv.KLING_MODEL;
  env.KLING_REFERENCE_MODEL = originalEnv.KLING_REFERENCE_MODEL;
  env.RUNWAY_ENABLED = originalEnv.RUNWAY_ENABLED;
  env.RUNWAY_API_KEY = originalEnv.RUNWAY_API_KEY;
  env.RUNWAY_MODEL = originalEnv.RUNWAY_MODEL;
  env.RUNWAY_REFERENCE_MODEL = originalEnv.RUNWAY_REFERENCE_MODEL;
}

const identity: SelfProviderCharacterDiagnostics = {
  schemaReady: true,
  selfProviderCharacterIdPresent: true,
  selfProviderCharacterStatus: 'ready',
  selfProviderIdentityProvider: 'openai_sora',
  selfProviderCharacterIdRedacted: 'sora...1234',
  providerCharacterLastVerifiedAt: '2026-05-23T00:00:00.000Z',
  likenessProviderStatus: 'canary_succeeded',
  soraCharacterCanaryStatus: 'succeeded',
};

const noIdentity: SelfProviderCharacterDiagnostics = {
  schemaReady: true,
  selfProviderCharacterIdPresent: false,
  selfProviderCharacterStatus: null,
  selfProviderIdentityProvider: null,
  selfProviderCharacterIdRedacted: null,
  providerCharacterLastVerifiedAt: null,
  likenessProviderStatus: null,
  soraCharacterCanaryStatus: null,
};

const blockedReferenceSummary = {
  state: 'failed' as const,
  referenceRole: null,
  variant: null,
  failureCategory: 'reference_moderation_block',
  seedanceReferenceRoutesBlocked: true,
  blockedReferenceRoles: ['front_angle', 'full_body', 'side_angle_left', 'side_angle_right'],
  requiredReferenceRoles: ['front_angle', 'full_body', 'side_angle_left', 'side_angle_right'],
  knownSuccessfulReferenceRoutes: [],
  knownBlockedReferenceRoutes: [
    { provider: 'seedance-fast', referenceRole: 'front_angle', failureCategory: 'reference_moderation_block' },
  ],
  allReferenceRouteResults: [],
};

const successfulReferenceSummary = {
  ...blockedReferenceSummary,
  state: 'succeeded' as const,
  failureCategory: null,
  seedanceReferenceRoutesBlocked: false,
  blockedReferenceRoles: [],
  knownSuccessfulReferenceRoutes: [
    { provider: 'seedance-fast', referenceRole: 'side_angle_left', variant: 'reference_images', lastTestedAt: '2026-05-23T00:00:00.000Z' },
  ],
  knownBlockedReferenceRoutes: [],
};

try {
  env.OPENAI_VIDEO_ENABLED = true;
  env.OPENAI_VIDEO_CHARACTER_ENABLED = true;
  env.OPENAI_API_KEY = 'sk-test-secret';
  env.REPLICATE_API_TOKEN = 'replicate-secret';
  env.KLING_ENABLED = false;
  env.KLING_API_KEY = undefined;
  env.KLING_MODEL = undefined;
  env.KLING_REFERENCE_MODEL = undefined;
  env.RUNWAY_ENABLED = false;
  env.RUNWAY_API_KEY = undefined;
  env.RUNWAY_MODEL = undefined;
  env.RUNWAY_REFERENCE_MODEL = undefined;

  const readiness = getOpenAISoraProviderReadiness();
  const openAIFallback = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: identity,
    referenceRouteSummary: blockedReferenceSummary,
  });
  assert.equal(openAIFallback.route, 'seedance_text_guidance');
  assert.equal(openAIFallback.exactLikeness, false);
  assert.match(openAIFallback.reason, /Seedance reference routes are blocked/i);
  assert.ok(openAIFallback.requiredSetup.includes('map documented character video usage field'));

  const mappedReadiness = {
    ...readiness,
    openaiCharacterConfigured: true,
    characterVideoUsageMapped: true,
    routeReady: true,
    status: 'ready' as const,
  };
  const openAIExact = chooseExactLikenessRoute({
    openAISoraReadiness: mappedReadiness,
    selfProviderCharacter: identity,
    referenceRouteSummary: blockedReferenceSummary,
  });
  assert.equal(openAIExact.route, 'openai_sora_character');
  assert.equal(openAIExact.exactLikeness, true);
  assert.equal(openAIExact.confidence, 'high');

  const noExact = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
  });
  assert.equal(noExact.route, 'seedance_text_guidance');
  assert.equal(noExact.exactLikeness, false);
  assert.equal(noExact.provider, 'seedance');

  const seedanceExact = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: successfulReferenceSummary,
  });
  assert.equal(seedanceExact.route, 'seedance_reference');
  assert.equal(seedanceExact.exactLikeness, true);

  const blockedSeedance = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
  });
  assert.notEqual(blockedSeedance.route, 'seedance_reference');

  env.KLING_ENABLED = true;
  env.KLING_API_KEY = 'kling-secret';
  env.KLING_MODEL = 'kling-video';
  env.KLING_REFERENCE_MODEL = 'kling-reference-model';
  env.RUNWAY_ENABLED = true;
  env.RUNWAY_API_KEY = 'runway-secret';
  env.RUNWAY_MODEL = 'gen4';
  env.RUNWAY_REFERENCE_MODEL = 'gen4.5';
  const registry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
  });
  assert.equal(registry.find((provider) => provider.id === 'openai_sora_character')?.deprecated, true);
  assert.equal(registry.find((provider) => provider.id === 'openai_sora_character')?.shutdownDate, '2026-09-24');
  assert.equal(registry.find((provider) => provider.id === 'seedance_video_reference')?.implementationStatus, 'not_configured');
  assert.equal(registry.find((provider) => provider.id === 'kling_reference')?.implementationStatus, 'configured_ready_for_canary');
  assert.equal(registry.find((provider) => provider.id === 'runway_gen4_reference')?.implementationStatus, 'configured_ready_for_canary');
  assert.equal(registry.find((provider) => provider.id === 'lumora_identity_pack')?.implementationStatus, 'research_only');
  const registryText = JSON.stringify(registry);
  assert.equal(registryText.includes('sk-test-secret'), false);
  assert.equal(registryText.includes('kling-secret'), false);
  assert.equal(registryText.includes('runway-secret'), false);

  const configuredButUntested = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: registry,
  });
  assert.equal(configuredButUntested.route, 'seedance_text_guidance');
  assert.equal(configuredButUntested.exactLikeness, false);

  const klingSucceededRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    alternateProviderStatuses: [
      {
        provider: 'kling_reference',
        providerModel: 'kling-reference-model',
        status: 'canary_succeeded',
        referenceRole: 'front_angle',
        referenceLabel: 'Primary front face',
        lastSuccessAt: '2026-05-23T00:00:00.000Z',
        lastFailureAt: null,
        lastFailureCategory: null,
        outputUrlPresent: true,
      },
      {
        provider: 'runway_gen4_reference',
        providerModel: 'gen4.5',
        status: 'canary_succeeded',
        referenceRole: 'front_angle',
        referenceLabel: 'Primary front face',
        lastSuccessAt: '2026-05-23T00:00:00.000Z',
        lastFailureAt: null,
        lastFailureCategory: null,
        outputUrlPresent: true,
      },
    ],
  });
  const klingExact = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: klingSucceededRegistry,
  });
  assert.equal(klingExact.route, 'kling_reference');
  assert.equal(klingExact.exactLikeness, true);

  const runwaySucceededRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    alternateProviderStatuses: [{
      provider: 'runway_gen4_reference',
      providerModel: 'gen4.5',
      status: 'canary_succeeded',
      referenceRole: 'front_angle',
      referenceLabel: 'Primary front face',
      lastSuccessAt: '2026-05-23T00:00:00.000Z',
      lastFailureAt: null,
      lastFailureCategory: null,
      outputUrlPresent: true,
    }],
  });
  const runwayExact = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: runwaySucceededRegistry,
  });
  assert.equal(runwayExact.route, 'runway_reference');
  assert.equal(runwayExact.exactLikeness, true);

  const videoReferenceRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    selfVerificationVideo: {
      schemaReady: true,
      selfVerificationVideoPresent: true,
      selfVerificationConsentPresent: true,
      verificationAudioPresent: true,
      verificationStatus: 'uploaded',
      verificationPrompt: 'Look forward and turn.',
      verificationLastTestedAt: '2026-05-23T00:00:00.000Z',
      seedanceVideoReferenceCanaryStatus: 'canary_succeeded',
      seedanceVideoReferenceLastFailureCategory: null,
      seedanceVideoReferenceProviderStatus: 'canary_succeeded',
      videoReferenceProvider: 'seedance',
      verificationVideoUrlRedacted: '[private-verification-video-present]',
      recommendedNextAction: 'Use Seedance video reference route.',
    },
  });
  const videoReferenceExact = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: videoReferenceRegistry,
  });
  assert.equal(videoReferenceExact.route, 'seedance_video_reference');
  assert.equal(videoReferenceExact.exactLikeness, true);

  const videoReferenceRetryLaterRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    selfVerificationVideo: {
      schemaReady: true,
      oldSelfCapturePresent: false,
      selfVerificationVideoPresent: true,
      selfVerificationConsentPresent: true,
      verificationAudioPresent: true,
      verificationStatus: 'uploaded',
      verificationPrompt: 'Look forward and turn.',
      verificationLastTestedAt: '2026-05-23T00:00:00.000Z',
      seedanceVideoReferenceCanaryStatus: 'retry_later',
      seedanceVideoReferenceLastFailureCategory: 'video_reference_provider_unavailable',
      seedanceVideoReferenceProviderStatus: 'retry_later',
      videoReferenceProvider: 'seedance',
      verificationVideoUrlRedacted: '[private-verification-video-present]',
      migratedFromOldSelfCapture: false,
      recommendedNextAction: 'Retry Seedance video reference canary later.',
    },
  });
  const videoReferenceRetryLater = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: videoReferenceRetryLaterRegistry,
  });
  assert.equal(videoReferenceRetryLater.route, 'seedance_text_guidance');
  assert.equal(videoReferenceRetryLater.exactLikeness, false);
  assert.equal(videoReferenceRetryLater.recommendedNextAction, 'Retry Seedance video reference canary later.');

  const videoReferenceInputNeedsRepairRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    selfVerificationVideo: {
      schemaReady: true,
      oldSelfCapturePresent: false,
      selfVerificationVideoPresent: true,
      selfVerificationConsentPresent: true,
      verificationAudioPresent: true,
      verificationStatus: 'uploaded',
      verificationPrompt: 'Look forward and turn.',
      verificationLastTestedAt: '2026-05-23T00:00:00.000Z',
      seedanceVideoReferenceCanaryStatus: 'input_needs_repair',
      seedanceVideoReferenceLastFailureCategory: 'video_reference_input_invalid',
      seedanceVideoReferenceProviderStatus: 'input_needs_repair',
      videoReferenceProvider: 'seedance',
      verificationVideoUrlRedacted: '[private-verification-video-present]',
      migratedFromOldSelfCapture: false,
      recommendedNextAction: 'Normalize verification video or try a schema variant.',
    },
  });
  const videoReferenceInputNeedsRepair = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: videoReferenceInputNeedsRepairRegistry,
  });
  assert.equal(videoReferenceInputNeedsRepair.route, 'seedance_text_guidance');
  assert.equal(videoReferenceInputNeedsRepair.exactLikeness, false);
  assert.equal(videoReferenceInputNeedsRepair.recommendedNextAction, 'Normalize verification video or try a schema variant.');

  const videoReferenceBlockedRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    selfVerificationVideo: {
      schemaReady: true,
      oldSelfCapturePresent: false,
      selfVerificationVideoPresent: true,
      selfVerificationConsentPresent: true,
      verificationAudioPresent: true,
      verificationStatus: 'uploaded',
      verificationPrompt: 'Look forward and turn.',
      verificationLastTestedAt: '2026-05-24T00:00:00.000Z',
      seedanceVideoReferenceCanaryStatus: 'failed_blocked',
      seedanceVideoReferenceLastFailureCategory: 'video_reference_moderation_block',
      seedanceVideoReferenceProviderStatus: 'failed_blocked',
      videoReferenceProvider: 'seedance',
      verificationVideoUrlRedacted: '[private-verification-video-present]',
      migratedFromOldSelfCapture: false,
      recommendedNextAction: 'Configure Runway/Kling likeness canary or use soft self guidance.',
    },
  });
  const blockedVideoEntry = videoReferenceBlockedRegistry.find((provider) => provider.id === 'seedance_video_reference');
  assert.equal(blockedVideoEntry?.implementationStatus, 'blocked');
  assert.equal(blockedVideoEntry?.readinessStatus, 'blocked');
  assert.equal(blockedVideoEntry?.canaryStatus, 'failed_blocked');
  assert.equal(blockedVideoEntry?.lastFailureCategory, 'video_reference_moderation_block');
  const videoReferenceBlocked = chooseExactLikenessRoute({
    openAISoraReadiness: readiness,
    selfProviderCharacter: noIdentity,
    referenceRouteSummary: blockedReferenceSummary,
    providerRegistry: videoReferenceBlockedRegistry,
  });
  assert.equal(videoReferenceBlocked.route, 'seedance_text_guidance');
  assert.equal(videoReferenceBlocked.exactLikeness, false);
  assert.equal(videoReferenceBlocked.reason, 'Seedance photo and video reference routes are blocked by provider safety; Lumora is using soft self guidance.');
  assert.equal(videoReferenceBlocked.recommendedNextAction, 'Configure Runway/Kling likeness canary or use soft self guidance.');
  assert.notEqual(exactLikenessCanaryCandidate(videoReferenceBlocked)?.route, 'seedance_video_reference');

  console.log('exactLikenessRouter unit tests passed');
} finally {
  restoreEnv();
}
