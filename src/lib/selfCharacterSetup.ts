export const SELF_VERIFICATION_VIDEO_MAX_SIZE_BYTES = 100 * 1024 * 1024;

const supportedVideoExtensions = ['.mp4', '.webm', '.mov'];

type VerificationFileLike = {
  name?: string;
  type?: string;
  size?: number;
};

export type SelfCharacterSetupState = {
  verificationVideoPresent?: boolean | null;
  verificationConsentPresent?: boolean | null;
  verificationConsentAt?: string | null;
  sourceCaptureVideoUrl?: string | null;
  consentConfirmed?: boolean | null;
  stylePreferences?: Record<string, unknown> | null;
  videoReferenceRouteStatus?: string | null;
  providerCharacterStatus?: string | null;
  likenessProviderStatus?: string | null;
};

function fileExtensionIsSupported(name: string) {
  const lower = name.toLowerCase();
  return supportedVideoExtensions.some((extension) => lower.endsWith(extension));
}

export function validateSelfVerificationVideoFile(file: VerificationFileLike | null | undefined): string | null {
  if (!file) return 'Upload a short self verification video first.';

  const contentType = (file.type ?? '').trim().toLowerCase();
  const fileName = (file.name ?? '').trim();

  if (typeof file.size === 'number' && file.size > SELF_VERIFICATION_VIDEO_MAX_SIZE_BYTES) {
    return 'Self verification video is too large. Upload a video under 100 MB.';
  }

  if (contentType.startsWith('image/') || contentType.startsWith('audio/')) {
    return 'Upload a video file for self verification, not an image or audio-only file.';
  }

  const genericUploadType = !contentType || contentType === 'application/octet-stream';
  if (!contentType.startsWith('video/') && !(genericUploadType && fileExtensionIsSupported(fileName))) {
    return 'Use an mp4, webm, or mov video for self verification.';
  }

  if (fileName && !fileExtensionIsSupported(fileName) && genericUploadType) {
    return 'Use an mp4, webm, or mov video for self verification.';
  }

  return null;
}

function booleanRecordValue(record: Record<string, unknown> | null | undefined, key: string) {
  return record?.[key] === true;
}

export function hasLegacySelfCaptureVideo(character: SelfCharacterSetupState | null | undefined) {
  if (!character?.sourceCaptureVideoUrl) return false;
  const stylePreferences = character.stylePreferences ?? null;
  return Boolean(
    character.verificationConsentPresent ||
    character.verificationConsentAt ||
    booleanRecordValue(stylePreferences, 'selfCaptureConsent') ||
    booleanRecordValue(stylePreferences, 'selfCaptureCompleted') ||
    character.consentConfirmed,
  );
}

export function hasEffectiveSelfVerificationVideo(character: SelfCharacterSetupState | null | undefined) {
  return Boolean(character?.verificationVideoPresent || hasLegacySelfCaptureVideo(character));
}

export function hasEffectiveSelfVerificationConsent(character: SelfCharacterSetupState | null | undefined) {
  return Boolean(character?.verificationConsentPresent || character?.verificationConsentAt || hasLegacySelfCaptureVideo(character));
}

export function selfVerificationVideoStatusLabel(character: SelfCharacterSetupState | null | undefined) {
  if (!hasEffectiveSelfVerificationVideo(character)) return 'Missing';
  const routeStatus = character?.videoReferenceRouteStatus;
  if (routeStatus === 'canary_succeeded') return 'Tested';
  if (routeStatus === 'blocked' || routeStatus === 'reference_moderation_block') {
    return 'Blocked';
  }
  if (routeStatus === 'configured_not_implemented') return 'Ready for canary';
  if (routeStatus === 'failed') return 'Needs replacement';
  return 'Uploaded';
}

export function exactLikenessRouteStatusLabel(character: SelfCharacterSetupState | null | undefined, exactReady = false) {
  if (exactReady) return 'Ready';
  if (character?.providerCharacterStatus === 'failed') return 'Blocked';
  if (character?.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_needs_canary') {
    return 'Needs canary';
  }
  if (character?.providerCharacterStatus === 'ready' || hasEffectiveSelfVerificationVideo(character)) return 'Needs canary';
  return 'Not ready';
}

export function createSelfCharacterStatusCopy(input: {
  character: SelfCharacterSetupState | null | undefined;
  exactRouteReady: boolean;
}) {
  if (input.exactRouteReady) return 'Verified self character ready.';

  const character = input.character;
  if (character?.videoReferenceRouteStatus === 'blocked' || character?.videoReferenceRouteStatus === 'reference_moderation_block') {
    return 'Video likeness route blocked. Using soft self guidance.';
  }

  if (hasEffectiveSelfVerificationVideo(character)) {
    return 'Self Verification Video saved. Exact likeness route still needs a canary.';
  }

  return 'Soft self guidance is active. Add a self verification video in Your AI Cast to test stronger likeness later.';
}
