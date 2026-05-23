import assert from 'node:assert/strict';
import {
  buildDisabledSoraCharacterIdentityPatch,
  chooseSoraSelfCharacterCreateRoute,
  getOpenAISoraProviderReadiness,
  redactProviderCharacterId,
  validateSoraCharacterConsent,
  OpenAISoraProviderError,
} from '../src/services/providers/openaiSoraProvider';
import { env } from '../src/lib/env';

const readiness = getOpenAISoraProviderReadiness();

assert.equal(readiness.openaiVideoEnabled, false);
assert.equal(readiness.openaiCharacterEnabled, false);
assert.equal(readiness.routeReady, false);
assert.equal(readiness.status, 'disabled');

const originalEnv = {
  OPENAI_VIDEO_ENABLED: env.OPENAI_VIDEO_ENABLED,
  OPENAI_VIDEO_CHARACTER_ENABLED: env.OPENAI_VIDEO_CHARACTER_ENABLED,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
};
env.OPENAI_VIDEO_ENABLED = true;
env.OPENAI_VIDEO_CHARACTER_ENABLED = true;
env.OPENAI_API_KEY = 'sk-test';
const rawReadiness = getOpenAISoraProviderReadiness();
assert.equal(rawReadiness.openaiRawRestAvailable, true);
assert.equal(rawReadiness.openaiSdkVideosAvailable, false);
assert.equal(rawReadiness.characterCreationSupported, true);
assert.equal(rawReadiness.characterVideoUsageMapped, false);
assert.equal(rawReadiness.openaiVideosDeprecated, true);
assert.equal(rawReadiness.shutdownDate, '2026-09-24');
assert.equal(rawReadiness.status, 'character_creation_available_video_usage_unmapped');
assert.equal(rawReadiness.routeReady, false);
env.OPENAI_VIDEO_ENABLED = originalEnv.OPENAI_VIDEO_ENABLED;
env.OPENAI_VIDEO_CHARACTER_ENABLED = originalEnv.OPENAI_VIDEO_CHARACTER_ENABLED;
env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;

assert.throws(
  () => validateSoraCharacterConsent({ consentConfirmed: false }),
  (error) => error instanceof OpenAISoraProviderError && error.code === 'sora_character_consent_required',
);

const patch = buildDisabledSoraCharacterIdentityPatch({
  consentConfirmed: true,
  sourceUploadAssetId: 'lumora-assets/provider-identities/demo.mp4',
});

assert.equal(patch.providerIdentityProvider, 'openai_sora');
assert.equal(patch.providerCharacterId, null);
assert.equal(patch.providerCharacterStatus, 'disabled');
assert.equal(patch.likenessProviderStatus, 'disabled');
assert.ok(patch.likenessConsentAt);
assert.equal(patch.providerCharacterSourceAssetId, 'lumora-assets/provider-identities/demo.mp4');

assert.equal(redactProviderCharacterId('sora-character-abcdef123456'), 'sora...3456');
assert.equal(redactProviderCharacterId(null), null);

const disabledRoute = chooseSoraSelfCharacterCreateRoute({
  readiness,
  providerCharacterId: null,
  providerCharacterStatus: null,
});
assert.equal(disabledRoute.selectedCreateLikenessRoute, 'seedance_text_guidance');
assert.equal(disabledRoute.usingVerifiedSelfCharacter, false);

const untestedRoute = chooseSoraSelfCharacterCreateRoute({
  readiness: {
    ...readiness,
    openaiVideoEnabled: true,
    openaiCharacterEnabled: true,
    openaiApiKeyConfigured: true,
    openaiCharacterConfigured: true,
    routeReady: true,
    status: 'ready',
  },
  providerCharacterId: 'sora-character-123',
  providerCharacterStatus: 'ready',
  likenessProviderStatus: 'pending',
});
assert.equal(untestedRoute.selectedCreateLikenessRoute, 'seedance_text_guidance');
assert.match(untestedRoute.whyChosen, /needs a successful canary/i);

const readyRoute = chooseSoraSelfCharacterCreateRoute({
  readiness: {
    ...readiness,
    openaiVideoEnabled: true,
    openaiCharacterEnabled: true,
    openaiApiKeyConfigured: true,
    openaiCharacterConfigured: true,
    routeReady: true,
    status: 'ready',
  },
  providerCharacterId: 'sora-character-123',
  providerCharacterStatus: 'ready',
  likenessProviderStatus: 'canary_succeeded',
});
assert.equal(readyRoute.selectedCreateLikenessRoute, 'openai_sora_character');
assert.equal(readyRoute.usingVerifiedSelfCharacter, true);

console.log('openaiSoraProvider unit tests passed');
