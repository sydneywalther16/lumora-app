export const SELF_VERIFICATION_VIDEO_MAX_SIZE_BYTES = 100 * 1024 * 1024;

const supportedVideoExtensions = ['.mp4', '.webm', '.mov'];

type VerificationFileLike = {
  name?: string;
  type?: string;
  size?: number;
};

export type SelfCharacterSetupState = {
  verificationVideoPresent?: boolean | null;
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

export function selfVerificationVideoStatusLabel(character: SelfCharacterSetupState | null | undefined) {
  if (!character?.verificationVideoPresent) return 'Missing';
  if (character.videoReferenceRouteStatus === 'canary_succeeded') return 'Tested';
  if (character.videoReferenceRouteStatus === 'blocked' || character.videoReferenceRouteStatus === 'reference_moderation_block') {
    return 'Blocked';
  }
  if (character.videoReferenceRouteStatus === 'configured_not_implemented') return 'Ready for canary';
  if (character.videoReferenceRouteStatus === 'failed') return 'Needs replacement';
  return 'Uploaded';
}

export function exactLikenessRouteStatusLabel(character: SelfCharacterSetupState | null | undefined, exactReady = false) {
  if (exactReady) return 'Ready';
  if (character?.providerCharacterStatus === 'failed') return 'Blocked';
  if (character?.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_needs_canary') {
    return 'Needs canary';
  }
  if (character?.providerCharacterStatus === 'ready' || character?.verificationVideoPresent) return 'Needs canary';
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

  if (character?.verificationVideoPresent) {
    return 'Self verification video saved. Exact likeness route still needs a provider canary.';
  }

  return 'Soft self guidance is active. Add a self verification video in Your AI Cast to test stronger likeness later.';
}
