import type { DirectorPlan, DirectorShot } from '../director/contracts';

export const XAI_IMAGINE_IMAGE_QUALITY_MODEL = 'grok-imagine-image-quality';
export const XAI_IMAGINE_VIDEO_MODEL = 'grok-imagine-video';
export const XAI_IMAGINE_VIDEO_15_MODEL = 'grok-imagine-video-1.5';

export const XAI_IMAGE_EDIT_MAX_REFERENCES = 3;
export const XAI_VIDEO_REFERENCE_MAX_REFERENCES = 7;
export const XAI_VIDEO_REFERENCE_MAX_DURATION_SECONDS = 10;
export const XAI_VIDEO_GENERATION_MAX_DURATION_SECONDS = 15;
export const XAI_VIDEO_EDIT_MAX_SOURCE_DURATION_SECONDS = 8.7;
export const XAI_VIDEO_EXTENSION_MIN_SOURCE_DURATION_SECONDS = 2;
export const XAI_VIDEO_EXTENSION_MAX_SOURCE_DURATION_SECONDS = 15;
export const XAI_VIDEO_EXTENSION_MIN_DURATION_SECONDS = 2;
export const XAI_VIDEO_EXTENSION_MAX_DURATION_SECONDS = 10;

export type XaiImageAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '2:1'
  | '1:2'
  | '19.5:9'
  | '9:19.5'
  | '20:9'
  | '9:20'
  | 'auto';

export type XaiImageResolution = '1K' | '2K';
export type XaiStandardVideoResolution = '480p' | '720p';
export type XaiHeroVideoResolution = XaiStandardVideoResolution | '1080p';

export type XaiPrivateMediaReference = {
  fileId: string;
  ownerUserId: string;
  mediaType: 'image' | 'video';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  durationSeconds?: number;
  humanSubject: boolean;
  identityId: string | null;
  ownershipConfirmed: true;
  consentConfirmed: true;
  adultConfirmed: true;
  childLike: false;
  celebrityOrPublicFigure: false;
  scrapedSource: false;
  nonConsensualSexualized: false;
  thirdPartyWatermark: false;
};

export type XaiOwnedProviderFile = {
  fileId: string;
  ownerUserId: string;
  purpose: 'ai_cast_input' | 'character_plate' | 'generated_video';
};

type XaiPrivateFileInput = { file_id: string };

export type XaiPreparedImagineRequest<TBody extends Record<string, unknown>> = {
  method: 'POST';
  endpoint:
    | '/v1/images/edits'
    | '/v1/videos/generations'
    | '/v1/videos/edits'
    | '/v1/videos/extensions';
  body: TBody;
  execution: 'disabled';
  providerRequestsMade: 0;
  safeDiagnostics: {
    operation:
      | 'character_plate'
      | 'reference_to_video'
      | 'image_to_video_hero'
      | 'video_edit'
      | 'video_extension';
    inputCount: number;
    privateFileInputs: true;
    publicUrlsCreated: false;
    audioRequested: false;
  };
};

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function assertPrompt(value: string) {
  const prompt = compact(value);
  if (!prompt) throw new Error('An internal scene instruction is required.');
  return prompt;
}

function assertFileId(fileId: string) {
  if (!/^file_[A-Za-z0-9][A-Za-z0-9_-]{5,}$/.test(fileId)) {
    throw new Error('A valid private provider file identifier is required.');
  }
}

function assertSafeReference(reference: XaiPrivateMediaReference, userId: string) {
  assertFileId(reference.fileId);
  if (reference.ownerUserId !== userId || !reference.ownershipConfirmed || !reference.consentConfirmed) {
    throw new Error('AI Cast references must be owned by or explicitly licensed to the authenticated user.');
  }
  if (!reference.adultConfirmed || reference.childLike) {
    throw new Error('Child or child-like identity references are not eligible for this route.');
  }
  if (reference.celebrityOrPublicFigure || reference.scrapedSource) {
    throw new Error('Celebrity, public-figure, or scraped identity references are not eligible.');
  }
  if (reference.nonConsensualSexualized) {
    throw new Error('Non-consensual sexualized identity use is not eligible.');
  }
  if (reference.thirdPartyWatermark) {
    throw new Error('Watermarked third-party references are not eligible.');
  }
  if (reference.humanSubject && !reference.identityId) {
    throw new Error('Human references require a private identity binding.');
  }
}

function assertReferenceSet(input: {
  references: XaiPrivateMediaReference[];
  userId: string;
  mediaType: 'image' | 'video';
  minimum: number;
  maximum: number;
}) {
  if (input.references.length < input.minimum || input.references.length > input.maximum) {
    throw new Error(`This route requires ${input.minimum}-${input.maximum} private ${input.mediaType} reference(s).`);
  }
  for (const reference of input.references) {
    assertSafeReference(reference, input.userId);
    if (reference.mediaType !== input.mediaType) {
      throw new Error(`This route accepts ${input.mediaType} references only.`);
    }
  }
  const identities = new Set(
    input.references
      .filter((reference) => reference.humanSubject)
      .map((reference) => reference.identityId),
  );
  if (identities.size > 1) {
    throw new Error('Mixed human identities cannot be combined into one AI Cast request.');
  }
}

function privateFile(reference: XaiPrivateMediaReference): XaiPrivateFileInput {
  return { file_id: reference.fileId };
}

function privateStorage(filename: string) {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  if (!safeName || !/\.(?:jpe?g|png|webp|mp4)$/i.test(safeName)) {
    throw new Error('A private output filename with a supported media extension is required.');
  }
  return {
    filename: safeName,
    expires_after: 7 * 24 * 60 * 60,
  };
}

function shotFromPlan(plan: DirectorPlan, shot?: DirectorShot) {
  const selected = shot ?? plan.shots[0];
  if (!selected) throw new Error('The AI Cast route requires one planned shot.');
  return selected;
}

function characterPlatePrompt(plan: DirectorPlan) {
  return assertPrompt([
    'Create one canonical cinematic character plate for a clearly synthetic portrayal.',
    'Use only the supplied, user-owned adult references for identity and approved appearance guidance.',
    'Do not add another person, merge identities, imitate a public figure, or reproduce watermarks.',
    `Cast: ${plan.castDescription}`,
    `Wardrobe: ${plan.wardrobe}`,
    `Environment: ${plan.environment}`,
    `Lighting: ${plan.lighting}`,
    `Continuity: ${plan.continuityLocks.join('; ')}`,
    `Disclosure: ${plan.syntheticDisclosure}`,
  ].join('\n'));
}

function videoPrompt(plan: DirectorPlan, shot?: DirectorShot) {
  const selected = shotFromPlan(plan, shot);
  return assertPrompt([
    'Create one continuous, clearly synthetic cinematic shot.',
    `Scene: ${plan.sceneSummary}`,
    `Shot: ${selected.summary}`,
    `Action: ${selected.action}`,
    `Camera: ${selected.cameraPlan}`,
    `Wardrobe: ${plan.wardrobe}`,
    `Environment: ${plan.environment}`,
    `Lighting: ${plan.lighting}`,
    `Continuity: ${plan.continuityLocks.join('; ')}`,
    'Keep identity, anatomy, movement, wardrobe, lighting direction, and environment stable.',
    `Disclosure: ${plan.syntheticDisclosure}`,
  ].join('\n'));
}

export function buildXaiCharacterPlatePayload(input: {
  userId: string;
  references: XaiPrivateMediaReference[];
  plan: DirectorPlan;
  aspectRatio?: XaiImageAspectRatio;
  resolution?: XaiImageResolution;
  filename?: string;
}): XaiPreparedImagineRequest<Record<string, unknown>> {
  assertReferenceSet({
    references: input.references,
    userId: input.userId,
    mediaType: 'image',
    minimum: 1,
    maximum: XAI_IMAGE_EDIT_MAX_REFERENCES,
  });
  return {
    method: 'POST',
    endpoint: '/v1/images/edits',
    body: {
      model: XAI_IMAGINE_IMAGE_QUALITY_MODEL,
      prompt: characterPlatePrompt(input.plan),
      images: input.references.map(privateFile),
      aspect_ratio: input.aspectRatio ?? '9:16',
      resolution: input.resolution ?? '1K',
      response_format: 'url',
      storage_options: privateStorage(input.filename ?? 'lumora-character-plate.jpg'),
    },
    execution: 'disabled',
    providerRequestsMade: 0,
    safeDiagnostics: {
      operation: 'character_plate',
      inputCount: input.references.length,
      privateFileInputs: true,
      publicUrlsCreated: false,
      audioRequested: false,
    },
  };
}

export function buildXaiReferenceToVideoPayload(input: {
  userId: string;
  references: XaiPrivateMediaReference[];
  plan: DirectorPlan;
  shot?: DirectorShot;
  durationSeconds: number;
  aspectRatio?: Exclude<XaiImageAspectRatio, 'auto'>;
  resolution?: XaiStandardVideoResolution;
  filename?: string;
}): XaiPreparedImagineRequest<Record<string, unknown>> {
  assertReferenceSet({
    references: input.references,
    userId: input.userId,
    mediaType: 'image',
    minimum: 1,
    maximum: XAI_VIDEO_REFERENCE_MAX_REFERENCES,
  });
  if (input.durationSeconds < 1 || input.durationSeconds > XAI_VIDEO_REFERENCE_MAX_DURATION_SECONDS) {
    throw new Error('Reference-to-video duration must be between 1 and 10 seconds.');
  }
  return {
    method: 'POST',
    endpoint: '/v1/videos/generations',
    body: {
      model: XAI_IMAGINE_VIDEO_MODEL,
      prompt: videoPrompt(input.plan, input.shot),
      reference_images: input.references.map(privateFile),
      duration: input.durationSeconds,
      aspect_ratio: input.aspectRatio ?? '9:16',
      resolution: input.resolution ?? '720p',
      storage_options: privateStorage(input.filename ?? 'lumora-reference-shot.mp4'),
    },
    execution: 'disabled',
    providerRequestsMade: 0,
    safeDiagnostics: {
      operation: 'reference_to_video',
      inputCount: input.references.length,
      privateFileInputs: true,
      publicUrlsCreated: false,
      audioRequested: false,
    },
  };
}

export function buildXaiImageToVideoHeroPayload(input: {
  userId: string;
  source: XaiPrivateMediaReference;
  plan: DirectorPlan;
  shot?: DirectorShot;
  durationSeconds: number;
  aspectRatio?: Exclude<XaiImageAspectRatio, 'auto'>;
  resolution?: XaiHeroVideoResolution;
  filename?: string;
}): XaiPreparedImagineRequest<Record<string, unknown>> {
  assertReferenceSet({
    references: [input.source],
    userId: input.userId,
    mediaType: 'image',
    minimum: 1,
    maximum: 1,
  });
  if (input.durationSeconds < 1 || input.durationSeconds > XAI_VIDEO_GENERATION_MAX_DURATION_SECONDS) {
    throw new Error('Image-to-video duration must be between 1 and 15 seconds.');
  }
  return {
    method: 'POST',
    endpoint: '/v1/videos/generations',
    body: {
      model: XAI_IMAGINE_VIDEO_15_MODEL,
      prompt: videoPrompt(input.plan, input.shot),
      image: privateFile(input.source),
      duration: input.durationSeconds,
      aspect_ratio: input.aspectRatio ?? '9:16',
      resolution: input.resolution ?? '1080p',
      storage_options: privateStorage(input.filename ?? 'lumora-premium-hero.mp4'),
    },
    execution: 'disabled',
    providerRequestsMade: 0,
    safeDiagnostics: {
      operation: 'image_to_video_hero',
      inputCount: 1,
      privateFileInputs: true,
      publicUrlsCreated: false,
      audioRequested: false,
    },
  };
}

export function buildXaiVideoEditPayload(input: {
  userId: string;
  source: XaiPrivateMediaReference;
  instruction: string;
  filename?: string;
}): XaiPreparedImagineRequest<Record<string, unknown>> {
  assertReferenceSet({
    references: [input.source],
    userId: input.userId,
    mediaType: 'video',
    minimum: 1,
    maximum: 1,
  });
  const sourceDuration = input.source.durationSeconds ?? Number.POSITIVE_INFINITY;
  if (sourceDuration <= 0 || sourceDuration > XAI_VIDEO_EDIT_MAX_SOURCE_DURATION_SECONDS) {
    throw new Error('Video edits require a source no longer than 8.7 seconds.');
  }
  return {
    method: 'POST',
    endpoint: '/v1/videos/edits',
    body: {
      model: XAI_IMAGINE_VIDEO_MODEL,
      prompt: assertPrompt(input.instruction),
      video: privateFile(input.source),
      storage_options: privateStorage(input.filename ?? 'lumora-video-edit.mp4'),
    },
    execution: 'disabled',
    providerRequestsMade: 0,
    safeDiagnostics: {
      operation: 'video_edit',
      inputCount: 1,
      privateFileInputs: true,
      publicUrlsCreated: false,
      audioRequested: false,
    },
  };
}

export function buildXaiVideoExtensionPayload(input: {
  userId: string;
  source: XaiPrivateMediaReference;
  instruction: string;
  extensionDurationSeconds: number;
  filename?: string;
}): XaiPreparedImagineRequest<Record<string, unknown>> {
  assertReferenceSet({
    references: [input.source],
    userId: input.userId,
    mediaType: 'video',
    minimum: 1,
    maximum: 1,
  });
  const sourceDuration = input.source.durationSeconds ?? Number.POSITIVE_INFINITY;
  if (
    sourceDuration < XAI_VIDEO_EXTENSION_MIN_SOURCE_DURATION_SECONDS ||
    sourceDuration > XAI_VIDEO_EXTENSION_MAX_SOURCE_DURATION_SECONDS
  ) {
    throw new Error('Video extension requires a 2-15 second source.');
  }
  if (
    input.extensionDurationSeconds < XAI_VIDEO_EXTENSION_MIN_DURATION_SECONDS ||
    input.extensionDurationSeconds > XAI_VIDEO_EXTENSION_MAX_DURATION_SECONDS
  ) {
    throw new Error('Video extension duration must be between 2 and 10 seconds.');
  }
  return {
    method: 'POST',
    endpoint: '/v1/videos/extensions',
    body: {
      model: XAI_IMAGINE_VIDEO_MODEL,
      prompt: assertPrompt(input.instruction),
      video: privateFile(input.source),
      duration: input.extensionDurationSeconds,
      storage_options: privateStorage(input.filename ?? 'lumora-video-extension.mp4'),
    },
    execution: 'disabled',
    providerRequestsMade: 0,
    safeDiagnostics: {
      operation: 'video_extension',
      inputCount: 1,
      privateFileInputs: true,
      publicUrlsCreated: false,
      audioRequested: false,
    },
  };
}

export function redactXaiImagineRequest(
  request: XaiPreparedImagineRequest<Record<string, unknown>>,
) {
  return {
    operation: request.safeDiagnostics.operation,
    inputCount: request.safeDiagnostics.inputCount,
    privateFileInputs: true as const,
    publicUrlsCreated: false as const,
    audioRequested: false as const,
    execution: request.execution,
    providerRequestsMade: request.providerRequestsMade,
    payload: '[redacted]',
  };
}

export function buildXaiFileCleanupPlan(input: {
  authenticatedUserId: string;
  file: XaiOwnedProviderFile;
}) {
  assertFileId(input.file.fileId);
  if (input.file.ownerUserId !== input.authenticatedUserId) {
    throw new Error('Provider files can only be revoked or deleted by their owning Lumora user.');
  }
  return {
    execution: 'disabled' as const,
    providerRequestsMade: 0 as const,
    steps: [
      {
        method: 'POST' as const,
        endpoint: `/v1/files/${input.file.fileId}/public-url/revoke` as const,
        purpose: 'revoke_public_access_if_present' as const,
      },
      {
        method: 'DELETE' as const,
        endpoint: `/v1/files/${input.file.fileId}` as const,
        purpose: 'delete_private_provider_file' as const,
      },
    ],
    safeDiagnostics: {
      owned: true as const,
      fileId: '[redacted]' as const,
      purpose: input.file.purpose,
    },
  };
}
