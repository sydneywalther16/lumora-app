import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSeedanceCanaryPayload,
  buildSeedanceInputSchemaDiagnostics,
  buildReferenceRouteSummaryFromRows,
  buildReferenceImagePrompt,
  buildSeedanceVerificationVideoCanaryPayload,
  buildSeedanceVideoReferencePrompt,
  canaryRateLimitStatus,
  chooseCreateRouteFromReferenceSummary,
  classifyReferenceCanaryFailure,
  classifyVideoReferenceCanaryFailure,
  matrixCandidatesFromSelfCandidates,
  noSavedSelfReferencePayloadForTest,
  providerFailureDiagnostics,
  redactRenderPathCompareValue,
  resolveSelfReferenceCanarySourceForTest,
  isSeedanceVideoReferenceBlockedStatus,
  seedanceVideoReferenceBlockedRetestPayload,
  selectStrongestCanaryReference,
  selectPrimaryCanaryReference,
  SEEDANCE_CANARY_PROMPT,
  SEEDANCE_REFERENCE_CANARY_PROMPT,
  videoReferenceRouteStatusForFailure,
} from '../src/services/seedanceCanary';
import { parseProviderVideoOutput } from '../src/services/providerOutputParser';
import { validateSeedanceProviderPayload } from '../src/services/providers/seedanceProvider';
import {
  buildSelfVerificationVideoPatch,
  redactVerificationVideoUrl,
  SEEDANCE_VIDEO_REFERENCE_PROMPT,
  validateSelfVerificationVideoConsent,
} from '../src/services/selfVerificationVideo';
import {
  buildVerificationVideoFfmpegArgs,
  classifyFfmpegNormalizationFailure,
  chooseVerificationVideoNormalizationAction,
  validateVerificationVideoMetadata,
  verificationVideoInputExtension,
  VERIFICATION_VIDEO_NORMALIZATION_TARGET,
} from '../src/services/verificationVideoNormalizer';
import { env } from '../src/lib/env';

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
const atTokenPayload = buildSeedanceVerificationVideoCanaryPayload('https://signed.example.com/private-self.mp4?token=secret', 'reference_videos_at');
assert.equal(atTokenPayload.prompt, buildSeedanceVideoReferencePrompt('reference_videos_at'));
assert.equal(atTokenPayload.prompt.includes('@Video1'), true);
assert.deepEqual(atTokenPayload.reference_videos, ['https://signed.example.com/private-self.mp4?token=secret']);
assert.equal('video_urls' in atTokenPayload, false);
const videoUrlsPayload = buildSeedanceVerificationVideoCanaryPayload('https://signed.example.com/private-self.mp4?token=secret', 'video_urls_at');
assert.equal(videoUrlsPayload.prompt.includes('@Video1'), true);
assert.deepEqual(videoUrlsPayload.video_urls, ['https://signed.example.com/private-self.mp4?token=secret']);
assert.equal('reference_videos' in videoUrlsPayload, false);
assert.equal(validateSeedanceProviderPayload(videoUrlsPayload).ok, true);

const validVideoMetadata = validateVerificationVideoMetadata({
  durationSeconds: 8,
  width: 720,
  height: 1280,
  container: 'mov',
  videoCodec: 'h264',
  audioCodec: 'aac',
  fileSizeBytes: 8 * 1024 * 1024,
  hasVideoStream: true,
  hasAudioStream: true,
  ffprobeAvailable: true,
});
assert.equal(validVideoMetadata.preflightOk, true);
assert.equal(validVideoMetadata.needsNormalization, false);
const nonVideoMetadata = validateVerificationVideoMetadata({
  ...validVideoMetadata,
  hasVideoStream: false,
});
assert.equal(nonVideoMetadata.preflightOk, false);
assert.equal(nonVideoMetadata.preflightFailureReason, 'no_readable_video_stream');
const tooShortMetadata = validateVerificationVideoMetadata({
  ...validVideoMetadata,
  durationSeconds: 1.5,
});
assert.equal(tooShortMetadata.preflightOk, false);
assert.equal(tooShortMetadata.preflightFailureReason, 'duration_too_short');
const tooLongMetadata = validateVerificationVideoMetadata({
  ...validVideoMetadata,
  durationSeconds: 22,
});
assert.equal(tooLongMetadata.preflightOk, false);
assert.equal(tooLongMetadata.needsNormalization, true);
assert.equal(tooLongMetadata.preflightFailureReason, 'duration_too_long');
const webmMetadata = validateVerificationVideoMetadata({
  ...validVideoMetadata,
  container: 'matroska',
  videoCodec: 'vp9',
});
assert.equal(webmMetadata.preflightOk, false);
assert.equal(webmMetadata.needsNormalization, true);
assert.equal(webmMetadata.preflightFailureReason, 'provider_unsafe_container');
assert.deepEqual(
  chooseVerificationVideoNormalizationAction({
    storedNormalizedAssetPresent: false,
    storedNormalizedAssetValid: false,
  }),
  {
    useStoredNormalizedAsset: false,
    normalizationTriggered: true,
    normalizationReason: 'missing_normalized_asset',
  },
);
assert.deepEqual(
  chooseVerificationVideoNormalizationAction({
    storedNormalizedAssetPresent: true,
    storedNormalizedAssetValid: false,
  }),
  {
    useStoredNormalizedAsset: false,
    normalizationTriggered: true,
    normalizationReason: 'stale_asset',
  },
);
assert.deepEqual(
  chooseVerificationVideoNormalizationAction({
    storedNormalizedAssetPresent: true,
    storedNormalizedAssetValid: true,
  }),
  {
    useStoredNormalizedAsset: true,
    normalizationTriggered: false,
    normalizationReason: 'skipped_existing_valid_asset',
  },
);
assert.deepEqual(
  chooseVerificationVideoNormalizationAction({
    storedNormalizedAssetPresent: true,
    storedNormalizedAssetValid: true,
    forceNormalize: true,
  }),
  {
    useStoredNormalizedAsset: false,
    normalizationTriggered: true,
    normalizationReason: 'force_refresh',
  },
);
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.container, 'mp4');
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.videoCodec, 'h264');
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.audioCodec, null);
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.audioIncluded, false);
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.pixelFormat, 'yuv420p');
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.videoProfile, 'high');
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.width, 720);
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.height, 1280);
assert.equal(VERIFICATION_VIDEO_NORMALIZATION_TARGET.maxFileSizeBytes <= 50 * 1024 * 1024, true);
assert.equal(verificationVideoInputExtension({ contentType: 'video/quicktime', objectPath: 'self.mov' }), 'mov');
assert.equal(verificationVideoInputExtension({ contentType: 'video/mp4', objectPath: 'self.mov' }), 'mp4');
assert.equal(verificationVideoInputExtension({ contentType: '', objectPath: 'private/self.webm' }), 'webm');
const ffmpegArgs = buildVerificationVideoFfmpegArgs('/tmp/private/input.mov', '/tmp/private/output.mp4');
assert.equal(Array.isArray(ffmpegArgs), true);
assert.equal(ffmpegArgs.includes('/tmp/private/input.mov'), true);
assert.equal(ffmpegArgs[ffmpegArgs.length - 1], '/tmp/private/output.mp4');
assert.equal(ffmpegArgs.includes('-ignore_unknown'), true);
assert.equal(ffmpegArgs.includes('-an'), true);
assert.equal(ffmpegArgs.includes('-dn'), true);
assert.equal(ffmpegArgs.includes('-sn'), true);
assert.equal(ffmpegArgs.includes('0:a?'), false);
assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1], 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1');
assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-c:v') + 1], 'libx264');
assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-pix_fmt') + 1], 'yuv420p');
assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-movflags') + 1], '+faststart');
const audioArgs = buildVerificationVideoFfmpegArgs('/tmp/private/input.mov', '/tmp/private/output.mp4', 'libx264', {
  includeAudio: true,
  audioStreamIndex: 1,
});
assert.equal(audioArgs.includes('-an'), false);
assert.equal(audioArgs[audioArgs.indexOf('-map', audioArgs.indexOf('0:v:0') + 1) + 1], '0:1?');
assert.equal(audioArgs[audioArgs.indexOf('-c:a') + 1], 'aac');
const fallbackResolutionArgs = buildVerificationVideoFfmpegArgs('/tmp/private/input.mov', '/tmp/private/output.mp4', 'libx264', {
  width: 480,
  height: 854,
});
assert.equal(fallbackResolutionArgs[fallbackResolutionArgs.indexOf('-vf') + 1], 'scale=480:854:force_original_aspect_ratio=decrease,pad=480:854:(ow-iw)/2:(oh-ih)/2,setsar=1');
const normalizedSilentMetadata = validateVerificationVideoMetadata({
  durationSeconds: 8,
  width: 720,
  height: 1280,
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: null,
  audioIncluded: false,
  skippedAudioReason: 'provider_reference_video_uses_silent_normalized_asset',
  skippedUnknownStreams: true,
  unknownStreamCodecs: ['audio:none'],
  fileSizeBytes: 8 * 1024 * 1024,
  hasVideoStream: true,
  hasAudioStream: false,
  ffprobeAvailable: true,
});
assert.equal(normalizedSilentMetadata.preflightOk, true);
assert.equal(normalizedSilentMetadata.audioIncluded, false);
assert.equal(normalizedSilentMetadata.skippedAudioReason, 'provider_reference_video_uses_silent_normalized_asset');
assert.equal(normalizedSilentMetadata.skippedUnknownStreams, true);
assert.equal(classifyFfmpegNormalizationFailure({ stderr: 'Unknown encoder libx264' }), 'ffmpeg_encoder_unavailable');
assert.equal(classifyFfmpegNormalizationFailure({ stderr: 'Syntax error: unexpected token (' }), 'ffmpeg_shell_parse');
assert.equal(classifyFfmpegNormalizationFailure({ stderr: 'moov atom not found' }), 'ffmpeg_input_decode_failed');

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

const fourSecondDuration = validateSeedanceProviderPayload({
  ...textPayload,
  duration: 4,
});
assert.equal(fourSecondDuration.ok, true);

const invalidDuration = validateSeedanceProviderPayload({
  ...textPayload,
  duration: 16,
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
assert.equal(videoReferenceRouteStatusForFailure('video_reference_moderation_block'), 'failed_blocked');
assert.equal(isSeedanceVideoReferenceBlockedStatus({ status: 'failed_blocked' }), true);
assert.equal(isSeedanceVideoReferenceBlockedStatus({ failureCategory: 'video_reference_moderation_block' }), true);
assert.equal(isSeedanceVideoReferenceBlockedStatus({ status: 'input_needs_repair' }), false);
const blockedRetest = seedanceVideoReferenceBlockedRetestPayload({
  status: 'failed_blocked',
  failureCategory: 'video_reference_moderation_block',
});
assert.equal(blockedRetest.ok, false);
assert.equal(blockedRetest.canaryStatus, 'failed_blocked');
assert.equal(blockedRetest.providerPredictionCreated, false);
assert.match(blockedRetest.message, /already blocked/i);
assert.match(blockedRetest.message, /ForceRetest/i);
assert.equal(classifyVideoReferenceCanaryFailure('ModelError: Service is temporarily unavailable. Please try again later. (E004)', 'failed'), 'video_reference_provider_unavailable');
assert.equal(classifyVideoReferenceCanaryFailure('upstream unavailable, try again later', 'failed'), 'video_reference_provider_unavailable');
assert.equal(classifyVideoReferenceCanaryFailure('unknown field reference_videos'), 'video_reference_input_schema');
assert.equal(classifyVideoReferenceCanaryFailure('ModelError: The input was invalid. Please try again with different inputs. (E006)', 'failed'), 'video_reference_input_invalid');
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

const originalReplicateToken = env.REPLICATE_API_TOKEN;
env.REPLICATE_API_TOKEN = undefined;
const schemaDiagnostics = await buildSeedanceInputSchemaDiagnostics();
env.REPLICATE_API_TOKEN = originalReplicateToken;
assert.equal(schemaDiagnostics.privateUrlsExposed, false);
assert.equal(schemaDiagnostics.fields.reference_videos, true);
assert.equal(schemaDiagnostics.fields.video_urls, true);
assert.equal(schemaDiagnostics.variants.some((variant) => variant.id === 'reference_videos_bracket'), true);
assert.equal(schemaDiagnostics.variants.some((variant) => variant.id === 'reference_videos_at'), true);
assert.equal(schemaDiagnostics.variants.some((variant) => variant.id === 'video_urls_at'), true);

const videoCanaryScript = readFileSync(new URL('../../scripts/seedance-video-reference-canary.ps1', import.meta.url), 'utf8');
assert.match(videoCanaryScript, /ForceNormalize/);
assert.match(videoCanaryScript, /ForceRetest/);
assert.match(videoCanaryScript, /normalized asset used/);
assert.match(videoCanaryScript, /normalization reason/);
assert.match(videoCanaryScript, /normalization error category/);
assert.match(videoCanaryScript, /audio included/);
assert.match(videoCanaryScript, /skipped audio reason/);
const normalizeScript = readFileSync(new URL('../../scripts/normalize-verification-video.ps1', import.meta.url), 'utf8');
assert.match(normalizeScript, /normalize-verification-video\/self/);
assert.match(normalizeScript, /No provider prediction will be created/);
assert.match(normalizeScript, /Force/);
assert.match(normalizeScript, /audio included/);
assert.match(normalizeScript, /unknown input streams detected/);
const repairVideoReferenceScript = readFileSync(new URL('../../scripts/repair-seedance-video-reference-status.ps1', import.meta.url), 'utf8');
assert.match(repairVideoReferenceScript, /repair-seedance-video-reference-status/);
assert.match(repairVideoReferenceScript, /Provider call: False/);
assert.match(repairVideoReferenceScript, /failed_blocked|Canary status/);

console.log('seedanceCanary unit tests passed');
