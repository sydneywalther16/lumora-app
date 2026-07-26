import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSeedanceRequestInput,
  createSeedanceExecutionTelemetry,
  stripRiskyPromptWording,
  validateSeedanceProviderPayload,
  type SeedanceSettings,
} from '../src/services/providers/seedanceProvider';
import {
  buildPublicCaptionFromPrompt,
  decideAutoStage,
  isSeedanceFirstFrameCanaryEligible,
} from '../../src/lib/aiCastExperience';

const scene =
  'She smiles gently, turns toward the sunlight, and gives a small wave. Natural movement, steady camera, soft daylight.';
const image = 'https://assets.example.com/user/front-4ebc1b72b0fe.jpg';
const settings: SeedanceSettings = {
  duration: 4,
  aspect_ratio: '9:16',
  resolution: '480p',
  generate_audio: false,
};

const payload = buildSeedanceRequestInput(scene, [], settings, {
  inputMode: 'image_to_video_first_frame',
  firstFrameImage: {
    url: image,
    role: 'front_angle',
    label: 'Front face',
  },
});

assert.equal(payload.image, image);
assert.equal('reference_images' in payload, false);
assert.equal('last_frame_image' in payload, false);
assert.equal('reference_videos' in payload, false);
assert.equal('reference_audios' in payload, false);
assert.equal(payload.prompt, scene);
assert.equal(payload.prompt.includes('[Image1]'), false);
assert.equal(payload.prompt.includes('visual continuity references'), false);
assert.equal(payload.prompt.includes('outfit details'), false);
assert.equal(payload.duration, 4);
assert.equal(payload.aspect_ratio, '9:16');
assert.equal(payload.resolution, '480p');
assert.equal(payload.generate_audio, false);
assert.equal(validateSeedanceProviderPayload(payload).ok, true);

const telemetry = createSeedanceExecutionTelemetry('image_to_video_first_frame');
telemetry.promptAdaptationApplied = true;
assert.equal(telemetry.promptAdaptationApplied, true);
assert.equal(telemetry.providerRequestCount, 0);
assert.equal(telemetry.providerRetryCount, 0);
assert.equal(telemetry.providerFallbackCount, 0);
assert.equal(telemetry.inputMode, 'image_to_video_first_frame');

const eligible = {
  activeFrontFaceReferenceCount: 1,
  activeOtherReferenceCount: 0,
  referenceLedRouteModerated: true,
};
assert.equal(isSeedanceFirstFrameCanaryEligible(eligible), false);
assert.equal(isSeedanceFirstFrameCanaryEligible({
  ...eligible,
  activeOtherReferenceCount: 1,
}), false);

const authorizedDecision = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: false,
  selfCharacterReady: true,
  userPrompt: scene,
  ...eligible,
  explicitFirstFrameCanaryAuthorized: true,
});
assert.equal(authorizedDecision.route, 'director_primary');
assert.match(authorizedDecision.reason, /Lumora Director/);
assert.equal(authorizedDecision.fallbackEngine, null);

const unapprovedDecision = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: false,
  selfCharacterReady: true,
  userPrompt: scene,
  ...eligible,
  explicitFirstFrameCanaryAuthorized: false,
});
assert.equal(unapprovedDecision.route, 'director_primary');

assert.equal(
  buildPublicCaptionFromPrompt(scene),
  'She smiles gently, turns toward the sunlight, and gives a small wave.',
);
assert.equal(stripRiskyPromptWording('A nude public scene').changed, true);

const seedanceProviderSource = readFileSync(
  join(process.cwd(), 'backend/src/services/providers/seedanceProvider.ts'),
  'utf8',
);
assert.match(seedanceProviderSource, /inputMode: 'image_to_video_first_frame'/);
assert.match(seedanceProviderSource, /allowPaidCreateRetry: false/);
assert.match(seedanceProviderSource, /providerFallbackStage: 'first_frame'/);
assert.doesNotMatch(
  seedanceProviderSource.match(
    /async function generateSeedanceFirstFrameVideo[\s\S]*?\n}\n\nexport async function generateSeedanceVideo/,
  )?.[0] ?? '',
  /buildMultimodalSeedancePrompt/,
);

const fallbackSource = readFileSync(
  join(process.cwd(), 'backend/src/services/providerFallbackOrchestrator.ts'),
  'utf8',
);
const firstFrameBranch = fallbackSource.match(
  /if \(input\.inputMode === 'image_to_video_first_frame'\) \{([\s\S]*?)\n  }\n\n  const providerAttempted/,
)?.[1] ?? '';
assert.match(firstFrameBranch, /maxProviderAttempts: 1/);
assert.match(firstFrameBranch, /referenceImages: \[\]/);
assert.doesNotMatch(firstFrameBranch, /buildReliableRenderAttemptPlan/);

const createSource = readFileSync(
  join(process.cwd(), 'src/components/CreateVideo.tsx'),
  'utf8',
);
assert.doesNotMatch(createSource, /Prepare first-frame route/);
assert.match(createSource, /No retry or fallback was attempted\. Save Draft remains available\./);
assert.match(createSource, /firstFrameImage: selectedFirstFrameImage/);
assert.match(createSource, /maxProviderRequests: 1/);

console.log('Seedance first-frame canary tests passed');
