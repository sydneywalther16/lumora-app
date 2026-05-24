import assert from 'node:assert/strict';
import {
  buildSeedanceCanaryPayload,
  buildReferenceRouteSummaryFromRows,
  buildReferenceImagePrompt,
  buildSeedanceVerificationVideoCanaryPayload,
  canaryRateLimitStatus,
  chooseCreateRouteFromReferenceSummary,
  classifyReferenceCanaryFailure,
  classifyVideoReferenceCanaryFailure,
  matrixCandidatesFromSelfCandidates,
  noSavedSelfReferencePayloadForTest,
  providerFailureDiagnostics,
  redactRenderPathCompareValue,
  resolveSelfReferenceCanarySourceForTest,
  selectStrongestCanaryReference,
  selectPrimaryCanaryReference,
  SEEDANCE_CANARY_PROMPT,
  SEEDANCE_REFERENCE_CANARY_PROMPT,
} from '../src/services/seedanceCanary';
import { parseProviderVideoOutput } from '../src/services/providerOutputParser';
import { validateSeedanceProviderPayload } from '../src/services/providers/seedanceProvider';
import {
  buildSelfVerificationVideoPatch,
  redactVerificationVideoUrl,
  SEEDANCE_VIDEO_REFERENCE_PROMPT,
  validateSelfVerificationVideoConsent,
} from '../src/services/selfVerificationVideo';

const textPayload = buildSeedanceCanaryPayload();

assert.equal(textPayload.prompt, SEEDANCE_CANARY_PROMPT);
assert.equal(textPayload.duration, 5);
assert.equal(textPayload.aspect_ratio, '9:16');
assert.equal(textPayload.resolution, '480p');
assert.equal(textPayload.generate_audio, false);
assert.equal('reference_images' in textPayload, false);
assert.equal(/Sydney|display name|Story Memory|Scene Flow/i.test(textPayload.prompt), false);
assert.equal(/photoshoot|influencer|superstar|public figure|glamour|seductive/i.test(textPayload.prompt), false);
assert.equal(SEEDANCE_VIDEO_REFERENCE_PROMPT.includes('[Video1]'), true);
assert.equal(/Sydney|photoshoot|model|glamour|influencer|celebrity|public figure/i.test(SEEDANCE_VIDEO_REFERENCE_PROMPT), false);
const verificationVideoPayload = buildSeedanceVerificationVideoCanaryPayload('https://signed.example.com/private-self.mp4?token=secret');
assert.equal(verificationVideoPayload.prompt, SEEDANCE_VIDEO_REFERENCE_PROMPT);
assert.deepEqual(verificationVideoPayload.reference_videos, ['https://signed.example.com/private-self.mp4?token=secret']);
assert.equal(verificationVideoPayload.prompt.includes('[Video1]'), true);
assert.equal(verificationVideoPayload.duration, 5);
assert.equal(verificationVideoPayload.aspect_ratio, '9:16');
assert.equal(verificationVideoPayload.resolution, '480p');
assert.equal(verificationVideoPayload.generate_audio, false);
assert.equal(validateSeedanceProviderPayload(verificationVideoPayload).ok, true);
assert.equal(JSON.stringify(verificationVideoPayload).includes('reference_images'), false);
assert.equal(/Sydney|photoshoot|model|glamour|influencer|celebrity|public figure/i.test(verificationVideoPayload.prompt), false);

assert.throws(
  () => validateSelfVerificationVideoConsent({ consentConfirmed: false }),
  /Consent is required/i,
);
const verificationPatch = buildSelfVerificationVideoPatch({
  sourceVideoUrl: 'https://demo.supabase.co/storage/v1/object/sign/lumora-assets/private/self.mp4?token=secret',
  sourceUploadAssetId: 'user/self-verification/self.mp4',
  verificationAudioPresent: true,
  now: '2026-05-23T00:00:00.000Z',
});
assert.equal(verificationPatch.verificationStatus, 'uploaded');
assert.equal(verificationPatch.videoReferenceRouteStatus, 'not_tested');
assert.equal(verificationPatch.verificationAudioPresent, true);
assert.equal(redactVerificationVideoUrl(verificationPatch.verificationVideoUrl), '[private-verification-video-present]');
assert.equal(redactVerificationVideoUrl(verificationPatch.verificationVideoUrl)?.includes('token=secret'), false);

const invalidDuration = validateSeedanceProviderPayload({
  ...textPayload,
  duration: 4,
});
assert.equal(invalidDuration.ok, false);
assert.equal(invalidDuration.ok ? '' : invalidDuration.issues[0].field, 'duration');

assert.equal(parseProviderVideoOutput('https://cdn.example.com/video.mp4').ok, true);
assert.equal(parseProviderVideoOutput(['https://cdn.example.com/video.mp4']).ok, true);
assert.equal(parseProviderVideoOutput({ output: { video: 'https://cdn.example.com/video.mp4' } }).ok, true);

assert.equal(canaryRateLimitStatus(), 'rate_limited');

const references = selectPrimaryCanaryReference([
  { url: 'https://assets.example.com/front.jpg', role: 'front_angle' },
  { url: 'https://assets.example.com/side.jpg', role: 'side_angle' },
]);
assert.equal(references.length, 1);
const referencePayload = buildSeedanceCanaryPayload({ referenceImages: references });
assert.deepEqual(referencePayload.reference_images, ['https://assets.example.com/front.jpg']);
assert.equal(referencePayload.prompt, SEEDANCE_REFERENCE_CANARY_PROMPT);
assert.equal(referencePayload.prompt.includes('[Image1]'), true);
assert.equal(referencePayload.duration, textPayload.duration);
assert.equal(referencePayload.aspect_ratio, textPayload.aspect_ratio);
assert.equal(referencePayload.resolution, textPayload.resolution);
assert.equal(referencePayload.generate_audio, textPayload.generate_audio);
assert.equal(/Sydney|photoshoot|model|glamour|influencer|celebrity|public figure/i.test(referencePayload.prompt), false);
const multipleReferencePrompt = buildReferenceImagePrompt([
  { url: 'https://assets.example.com/front.jpg', role: 'front_angle', label: 'Front', token: '[Image1]' },
  { url: 'https://assets.example.com/left.jpg', role: 'side_angle', label: 'Left', token: '[Image2]' },
]);
assert.equal(multipleReferencePrompt.includes('[Image1]'), true);
assert.equal(multipleReferencePrompt.includes('[Image2]'), true);

const strongest = selectStrongestCanaryReference({
  referenceImageUrls: {
    manualReferenceImageUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
    frontFaceUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
    leftAngleUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/left.jpg',
    frontFace: '',
    leftAngle: '',
    rightAngle: '',
  },
});
assert.equal(strongest.reference?.url, 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg');
assert.equal(strongest.diagnostics.role, 'front_angle');
assert.equal(strongest.diagnostics.savedToLumora, true);

const noExternal = selectStrongestCanaryReference({
  referenceImageUrls: {
    manualReferenceImageUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
    frontFaceUrl: 'https://cdninstagram.com/protected.jpg',
    leftAngleUrl: 'https://lh3.googleusercontent.com/photo.jpg',
    frontFace: '',
    leftAngle: '',
    rightAngle: '',
  },
});
assert.equal(noExternal.reference, null);
assert.equal(noExternal.diagnostics.selected, false);

const legacyProfileResolution = resolveSelfReferenceCanarySourceForTest({
  sourcesChecked: ['profiles.self_reference_image_urls', 'character_profiles.reference_image_urls'],
  candidates: [{
    id: 'profile-self',
    characterId: 'creator-self',
    ownerUserId: '10000000-1000-4000-8000-100000000001',
    name: 'Creator Self',
    displayName: 'Creator Self',
    isSelf: true,
    referenceImageUrls: {
      manualReferenceImageUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
      frontFace: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      frontFaceUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      leftAngle: '',
      rightAngle: '',
    },
    referenceImages: {},
    source: 'profiles.self_reference_image_urls',
    sourcePriority: 1,
    updatedAt: new Date().toISOString(),
  }],
});
assert.equal(legacyProfileResolution.selection.reference?.url, 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg');
assert.equal(legacyProfileResolution.selection.diagnostics.source, 'profiles.self_reference_image_urls');

const manualOnlyResolution = resolveSelfReferenceCanarySourceForTest({
  sourcesChecked: ['self_characters.reference_image_urls'],
  candidates: [{
    id: 'self-character',
    characterId: 'creator-self',
    ownerUserId: '10000000-1000-4000-8000-100000000001',
    name: 'Creator Self',
    displayName: 'Creator Self',
    isSelf: true,
    referenceImageUrls: {
      manualReferenceImageUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
      frontFace: '',
      leftAngle: '',
      rightAngle: '',
    },
    referenceImages: {},
    source: 'self_characters.reference_image_urls',
    sourcePriority: 0,
    updatedAt: new Date().toISOString(),
  }],
});
assert.equal(manualOnlyResolution.selection.reference, null);

const missingReferencePayload = noSavedSelfReferencePayloadForTest(manualOnlyResolution);
assert.equal(missingReferencePayload.error, 'no_saved_self_reference');
assert.equal(missingReferencePayload.message, 'No saved Lumora self reference found.');
assert.deepEqual(missingReferencePayload.sourcesChecked, ['self_characters.reference_image_urls']);
assert.equal(missingReferencePayload.recommendedNextAction.includes('re-save'), true);

assert.equal(classifyReferenceCanaryFailure('moderation safety policy blocked'), 'reference_moderation_block');
assert.equal(classifyReferenceCanaryFailure('E005: input or output was flagged as sensitive', 'failed'), 'reference_moderation_block');
assert.equal(classifyReferenceCanaryFailure('invalid input reference_images'), 'reference_input_schema');
assert.equal(classifyReferenceCanaryFailure('403 asset access denied'), 'reference_asset_access');
assert.equal(classifyReferenceCanaryFailure('Prediction failed.', 'failed'), 'reference_unknown_provider_failure');
assert.equal(classifyReferenceCanaryFailure('seedance backend failed with no video', 'failed'), 'reference_provider_failed');
assert.equal(classifyReferenceCanaryFailure('provider succeeded but output missing', 'succeeded'), 'reference_output_missing');
assert.equal(classifyVideoReferenceCanaryFailure('E005: input or output was flagged as sensitive', 'failed'), 'video_reference_moderation_block');
assert.equal(classifyVideoReferenceCanaryFailure('ModelError: Service is temporarily unavailable. Please try again later. (E004)', 'failed'), 'video_reference_provider_unavailable');
assert.equal(classifyVideoReferenceCanaryFailure('upstream unavailable, try again later', 'failed'), 'video_reference_provider_unavailable');
assert.equal(classifyVideoReferenceCanaryFailure('unknown field reference_videos'), 'video_reference_input_schema');
assert.equal(classifyVideoReferenceCanaryFailure('403 asset access denied'), 'verification_video_asset_access');
assert.equal(classifyVideoReferenceCanaryFailure('provider succeeded but output missing', 'succeeded'), 'video_reference_output_missing');
assert.equal(classifyVideoReferenceCanaryFailure('Prediction failed.', 'failed'), 'video_reference_provider_failed');

const providerFailure = providerFailureDiagnostics({
  category: 'reference_provider_failed',
  prediction: {
    id: 'pred_123',
    status: 'failed',
    error: 'provider failed while reading https://signed.example.com/private.jpg?token=secret',
    logs: 'download failed for https://signed.example.com/private.jpg?token=secret',
    urls: { get: 'https://api.replicate.com/v1/predictions/pred_123' },
    metrics: { predict_time: 1.23 },
  } as never,
});
assert.equal(providerFailure.providerErrorSummary?.includes('token=secret'), false);
assert.equal(providerFailure.providerLogsExcerpt?.includes('private.jpg'), false);
assert.equal(providerFailure.predictionGetUrlHost, 'api.replicate.com');

const matrixCandidates = matrixCandidatesFromSelfCandidates({
  sourcesChecked: ['self_characters.reference_image_urls'],
  candidates: [{
    id: 'self-character',
    characterId: 'creator-self',
    ownerUserId: '10000000-1000-4000-8000-100000000001',
    name: 'Creator Self',
    displayName: 'Creator Self',
    isSelf: true,
    referenceImageUrls: {
      manualReferenceImageUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
      frontFace: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      frontFaceUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      leftAngle: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/left.jpg',
      leftAngleUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/left.jpg',
      rightAngle: 'https://cdninstagram.com/protected.jpg',
      rightAngleUrl: 'https://cdninstagram.com/protected.jpg',
    },
    referenceImages: {},
    source: 'self_characters.reference_image_urls',
    sourcePriority: 0,
    updatedAt: new Date().toISOString(),
  }],
});
assert.deepEqual(matrixCandidates.map((candidate) => candidate.referenceRole), ['front_angle', 'side_angle_left']);
assert.equal(matrixCandidates.every((candidate) => candidate.reference.token === '[Image1]'), true);

const matrixFrontOnly = matrixCandidatesFromSelfCandidates({
  referenceRole: 'front_angle',
  candidates: [{
    id: 'self-character',
    characterId: 'creator-self',
    ownerUserId: '10000000-1000-4000-8000-100000000001',
    name: 'Creator Self',
    displayName: 'Creator Self',
    isSelf: true,
    referenceImageUrls: {
      frontFace: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      frontFaceUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      leftAngle: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/left.jpg',
      leftAngleUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/left.jpg',
    },
    referenceImages: {},
    source: 'self_characters.reference_image_urls',
    sourcePriority: 0,
    updatedAt: new Date().toISOString(),
  }],
});
assert.deepEqual(matrixFrontOnly.map((candidate) => candidate.referenceRole), ['front_angle']);

const blockedRouteSummary = buildReferenceRouteSummaryFromRows([
  { userId: null, characterId: 'creator-self', referenceRole: 'front_angle', referenceLabel: 'Primary front face', provider: 'seedance-fast', providerModel: 'fast', variant: 'reference_images', successCount: 0, failureCount: 1, failureCategory: 'reference_moderation_block', providerErrorCategory: 'reference_moderation_block', lastTestedAt: new Date().toISOString(), outputUrlPresent: false },
  { userId: null, characterId: 'creator-self', referenceRole: 'full_body', referenceLabel: 'Full body', provider: 'seedance-fast', providerModel: 'fast', variant: 'reference_images', successCount: 0, failureCount: 1, failureCategory: 'reference_moderation_block', providerErrorCategory: 'reference_moderation_block', lastTestedAt: new Date().toISOString(), outputUrlPresent: false },
  { userId: null, characterId: 'creator-self', referenceRole: 'side_angle_left', referenceLabel: 'Left angle', provider: 'seedance-fast', providerModel: 'fast', variant: 'reference_images', successCount: 0, failureCount: 1, failureCategory: 'reference_moderation_block', providerErrorCategory: 'reference_moderation_block', lastTestedAt: new Date().toISOString(), outputUrlPresent: false },
  { userId: null, characterId: 'creator-self', referenceRole: 'side_angle_right', referenceLabel: 'Right angle', provider: 'seedance-fast', providerModel: 'fast', variant: 'reference_images', successCount: 0, failureCount: 1, failureCategory: 'reference_moderation_block', providerErrorCategory: 'reference_moderation_block', lastTestedAt: new Date().toISOString(), outputUrlPresent: false },
]);
assert.equal(blockedRouteSummary.seedanceReferenceRoutesBlocked, true);
assert.equal(blockedRouteSummary.state, 'failed');
assert.deepEqual(
  chooseCreateRouteFromReferenceSummary({
    referenceCount: 0,
    seedanceReferenceRoutesBlocked: blockedRouteSummary.seedanceReferenceRoutesBlocked,
    hasSuccessfulReferenceRoute: blockedRouteSummary.knownSuccessfulReferenceRoutes.length > 0,
  }),
  {
    chosenCreateRoute: 'text_only_success_first',
    whyChosen: 'all Seedance self reference routes blocked',
  },
);

const successfulRouteSummary = buildReferenceRouteSummaryFromRows([
  { userId: null, characterId: 'creator-self', referenceRole: 'side_angle_left', referenceLabel: 'Left angle', provider: 'seedance-fast', providerModel: 'fast', variant: 'reference_images', successCount: 1, failureCount: 0, failureCategory: null, providerErrorCategory: null, lastTestedAt: new Date().toISOString(), outputUrlPresent: true },
]);
assert.equal(successfulRouteSummary.state, 'succeeded');
assert.equal(successfulRouteSummary.referenceRole, 'side_angle_left');

const redacted = redactRenderPathCompareValue({
  referenceUrl: 'https://signed.example.com/private.jpg?token=secret',
  nested: {
    videoUrl: 'https://signed.example.com/private.mp4?token=secret',
  },
  list: ['https://signed.example.com/other.jpg'],
});
assert.deepEqual(redacted, {
  referenceUrl: '[redacted-url]',
  nested: { videoUrl: '[redacted-url]' },
  list: ['[redacted-url]'],
});

console.log('seedanceCanary unit tests passed');
