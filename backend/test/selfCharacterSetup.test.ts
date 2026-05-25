import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildClearedSelfVerificationVideoPatch,
  buildSelfVerificationVideoPatch,
  redactVerificationVideoUrl,
  validateSelfVerificationVideoUpload,
} from '../src/services/selfVerificationVideo';
import {
  createSelfCharacterStatusCopy,
  hasEffectiveSelfVerificationVideo,
  hasLegacySelfCaptureVideo,
  selfVerificationVideoStatusLabel,
  validateSelfVerificationVideoFile,
} from '../../src/lib/selfCharacterSetup';
import { cleanupReferenceImageUrls } from '../src/services/referenceCleanup';
import { ownershipMismatchResponse, redactOwnerId } from '../src/services/selfCharacterOwnership';

assert.throws(
  () => validateSelfVerificationVideoUpload({
    consentConfirmed: false,
    contentType: 'video/mp4',
    fileName: 'self.mp4',
    sizeBytes: 1024,
  }),
  /Consent is required/i,
);

assert.throws(
  () => validateSelfVerificationVideoUpload({
    consentConfirmed: true,
    contentType: 'image/jpeg',
    fileName: 'self.jpg',
    sizeBytes: 1024,
  }),
  /not an image or audio-only/i,
);

assert.doesNotThrow(() => validateSelfVerificationVideoUpload({
  consentConfirmed: true,
  contentType: 'video/webm',
  fileName: 'self.webm',
  sizeBytes: 2_000_000,
}));

assert.equal(validateSelfVerificationVideoFile({
  name: 'portrait.jpg',
  type: 'image/jpeg',
  size: 1024,
}), 'Upload a video file for self verification, not an image or audio-only file.');
assert.equal(validateSelfVerificationVideoFile({
  name: 'verification.mov',
  type: 'video/quicktime',
  size: 3_000_000,
}), null);

const patch = buildSelfVerificationVideoPatch({
  sourceVideoUrl: 'https://demo.supabase.co/storage/v1/object/sign/lumora-assets/private/self.mp4?token=secret',
  sourceUploadAssetId: 'user/self-verification/self.mp4',
  verificationAudioPresent: true,
  now: '2026-05-23T00:00:00.000Z',
});
assert.equal(redactVerificationVideoUrl(patch.verificationVideoUrl), '[private-verification-video-present]');
assert.equal(JSON.stringify({ verificationVideoUrlRedacted: redactVerificationVideoUrl(patch.verificationVideoUrl) }).includes('token=secret'), false);

const cleared = buildClearedSelfVerificationVideoPatch();
assert.equal(cleared.verificationVideoUrl, null);
assert.equal(cleared.verificationVideoAssetId, null);
assert.equal(cleared.verificationConsentAt, null);
assert.equal(cleared.verificationStatus, 'missing');

const referenceCleanup = cleanupReferenceImageUrls({
  manualReferenceImageUrl: 'https://external.example.com/manual.jpg',
  frontFace: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/front.jpg',
  frontFaceUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/front.jpg',
  leftAngle: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/left.jpg',
  leftAngleUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/left.jpg',
  rightAngle: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/right.jpg',
  rightAngleUrl: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/right.jpg',
});
const referencesAfterManualRemoval = referenceCleanup.referenceImageUrls;
assert.equal(referenceCleanup.removedCount, 1);
assert.equal(referencesAfterManualRemoval.manualReferenceImageUrl, null);
assert.equal(referencesAfterManualRemoval.frontFaceUrl, 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/front.jpg');
assert.equal(referencesAfterManualRemoval.leftAngleUrl, 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/left.jpg');
assert.equal(referencesAfterManualRemoval.rightAngleUrl, 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/right.jpg');

assert.equal(selfVerificationVideoStatusLabel({ verificationVideoPresent: false }), 'Missing');
assert.equal(selfVerificationVideoStatusLabel({ verificationVideoPresent: true }), 'Uploaded');
assert.equal(selfVerificationVideoStatusLabel({ verificationVideoPresent: true, videoReferenceRouteStatus: 'canary_succeeded' }), 'Tested');
assert.equal(selfVerificationVideoStatusLabel({ verificationVideoPresent: true, videoReferenceRouteStatus: 'failed_blocked' }), 'Blocked');
const oldSelfCaptureCharacter = {
  verificationVideoPresent: false,
  sourceCaptureVideoUrl: 'https://demo.supabase.co/storage/v1/object/sign/self-capture-videos/private/self.mp4?token=secret',
  stylePreferences: {
    selfCaptureConsent: true,
    selfCaptureCompleted: true,
  },
};
assert.equal(hasLegacySelfCaptureVideo(oldSelfCaptureCharacter), true);
assert.equal(hasEffectiveSelfVerificationVideo(oldSelfCaptureCharacter), true);
assert.equal(selfVerificationVideoStatusLabel(oldSelfCaptureCharacter), 'Uploaded');

assert.equal(
  createSelfCharacterStatusCopy({ character: null, exactRouteReady: false }),
  'Soft self guidance is active. Add a self verification video in Your AI Cast to test stronger likeness later.',
);
assert.equal(
  createSelfCharacterStatusCopy({ character: { verificationVideoPresent: true }, exactRouteReady: false }),
  'Self Verification Video saved. Exact likeness route still needs a canary.',
);
assert.equal(
  createSelfCharacterStatusCopy({ character: oldSelfCaptureCharacter, exactRouteReady: false }),
  'Self Verification Video saved. Exact likeness route still needs a canary.',
);
assert.equal(
  createSelfCharacterStatusCopy({ character: { verificationVideoPresent: true, videoReferenceRouteStatus: 'input_needs_repair' }, exactRouteReady: false }),
  'Verification video needs a provider-safe format or schema variant.',
);
assert.equal(
  createSelfCharacterStatusCopy({ character: { verificationVideoPresent: true, videoReferenceRouteStatus: 'failed_blocked' }, exactRouteReady: false }),
  'Using soft self guidance. Exact likeness provider not ready.',
);
assert.equal(
  createSelfCharacterStatusCopy({ character: { verificationVideoPresent: true }, exactRouteReady: true }),
  'Verified self character ready.',
);

const characterHubSource = readFileSync(new URL('../../src/components/CharacterHub.tsx', import.meta.url), 'utf8');
assert.match(characterHubSource, /Upload self verification video/);
assert.match(characterHubSource, /id="self-verification-video-panel"/);
assert.equal(characterHubSource.includes('View status'), false);
assert.match(characterHubSource, /Repair account link/);

const migrationSource = readFileSync(new URL('../supabase/migrations/20260523_unify_self_capture_verification_video.sql', import.meta.url), 'utf8');
assert.match(migrationSource, /source_capture_video_url/);
assert.match(migrationSource, /verification_video_url = source_capture_video_url/);

const apiSource = readFileSync(new URL('../../src/lib/api.ts', import.meta.url), 'utf8');
assert.match(apiSource, /Authorization/);
assert.match(apiSource, /supabase\.auth\.getSession/);

const authMiddlewareSource = readFileSync(new URL('../src/middleware/auth.ts', import.meta.url), 'utf8');
assert.match(authMiddlewareSource, /supabaseAdmin\.auth\.getUser/);
assert.match(authMiddlewareSource, /auth_required/);

const charactersRouteSource = readFileSync(new URL('../src/routes/characters.ts', import.meta.url), 'utf8');
assert.match(charactersRouteSource, /resolveSelfCharacterForAuthenticatedUser\(ownerUserId/);
assert.match(charactersRouteSource, /const characterId = ownership\.writableTarget\.characterId;/);

assert.equal(redactOwnerId('12345678-1234-4000-8000-123456789abc'), '12345678...');
assert.deepEqual(
  ownershipMismatchResponse({
    authUserId: '12345678-1234-4000-8000-123456789abc',
    sourceTable: 'character_profiles',
    sourceId: '87654321-1234-4000-8000-123456789abc',
    ownerVerified: false,
    profileRowPresent: true,
    selfCharactersRowPresent: false,
    characterProfilesSelfRowPresent: true,
    legacyCreatorSelfPresent: true,
    writableTargetFound: false,
    mismatchDetected: true,
    writableTarget: null,
    recommendedNextAction: 'Repair self character ownership.',
  }).message,
  'This self character is not linked to the current signed-in user.',
);

console.log('self character setup unit tests passed');
