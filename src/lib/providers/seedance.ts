import type { LumoraIdentityProfile, ReferenceImageUrls, SeedanceReferenceImage } from '../api';
import { resolveRenderableReferenceUrl } from '../selfCharacterReference';

export const SEEDANCE_ENGINE_ID = 'seedance-2.0' as const;
export const SEEDANCE_QUALITY_ENGINE_ID = 'seedance-quality' as const;
export const SEEDANCE_MODEL = 'bytedance/seedance-2.0-fast';
export const SEEDANCE_QUALITY_MODEL = 'bytedance/seedance-2.0';
export const SEEDANCE_IDENTITY_PROMPT =
  'Use the provided reference images only as identity references. Do not animate or copy any single source image. Generate a new photorealistic person matching the same identity in the requested scene.';

export type SeedanceReferenceSet = {
  frontFaceUrl: string | null;
  leftAngleUrl: string | null;
  rightAngleUrl: string | null;
  fullBodyUrl: string | null;
};

type SeedanceReferenceCandidate = Omit<SeedanceReferenceImage, 'token' | 'url'> & {
  url?: string | null;
};
type SeedanceReferenceDraft = Omit<SeedanceReferenceImage, 'token'> & {
  url: string;
};

type BuildSeedanceReferenceImagesInput = {
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[];
  identityProfile?: LumoraIdentityProfile | null;
  characterAvatar?: string | null;
};

function firstRenderableReference(...values: Array<string | null | undefined>): string | null {
  return values.map(resolveRenderableReferenceUrl).find(Boolean) ?? null;
}

export function getSeedanceReferenceSet(
  referenceImageUrls?: Partial<ReferenceImageUrls> | null,
): SeedanceReferenceSet {
  return {
    frontFaceUrl: firstRenderableReference(
      referenceImageUrls?.frontFaceUrl,
      referenceImageUrls?.frontFacePath,
      referenceImageUrls?.frontFace,
    ),
    leftAngleUrl: firstRenderableReference(
      referenceImageUrls?.leftAngleUrl,
      referenceImageUrls?.leftAnglePath,
      referenceImageUrls?.leftAngle,
    ),
    rightAngleUrl: firstRenderableReference(
      referenceImageUrls?.rightAngleUrl,
      referenceImageUrls?.rightAnglePath,
      referenceImageUrls?.rightAngle,
    ),
    fullBodyUrl: firstRenderableReference(
      referenceImageUrls?.fullBodyUrl,
      referenceImageUrls?.fullBodyPath,
      referenceImageUrls?.fullBody,
    ),
  };
}

export function hasSeedanceMinimumReferences(references: SeedanceReferenceSet): boolean {
  return Boolean(references.frontFaceUrl && references.leftAngleUrl && references.rightAngleUrl);
}

export function seedanceReferenceArray(references: SeedanceReferenceSet): string[] {
  return [
    references.frontFaceUrl,
    references.leftAngleUrl,
    references.rightAngleUrl,
    references.fullBodyUrl,
  ].filter((url): url is string => Boolean(url));
}

function pushReference(
  references: SeedanceReferenceDraft[],
  input: SeedanceReferenceCandidate,
) {
  const url = resolveRenderableReferenceUrl(input.url);
  if (!url) return;
  if (references.some((reference) => reference.url === url)) return;

  references.push({
    ...input,
    url,
  });
}

export function buildSeedanceReferenceImages(
  input: BuildSeedanceReferenceImagesInput,
): SeedanceReferenceImage[] {
  const references: SeedanceReferenceDraft[] = [];
  const urls = input.referenceImageUrls;

  pushReference(references, {
    url: input.identityProfile?.frontFaceUrl ??
      urls?.frontFaceUrl ??
      urls?.frontFacePath ??
      urls?.frontFace ??
      urls?.manualReferenceImageUrl ??
      input.referenceImageUrl ??
      input.characterAvatar ??
      null,
    label: 'Front angle',
    role: 'front_angle',
  });
  pushReference(references, {
    url: urls?.manualReferenceImageUrl ?? null,
    label: 'Manual reference override',
    role: 'identity_reference',
  });
  pushReference(references, {
    url: input.identityProfile?.leftAngleUrl ??
      urls?.leftAngleUrl ??
      urls?.leftAnglePath ??
      urls?.leftAngle ??
      null,
    label: 'Side angle left',
    role: 'side_angle',
  });
  pushReference(references, {
    url: input.identityProfile?.rightAngleUrl ??
      urls?.rightAngleUrl ??
      urls?.rightAnglePath ??
      urls?.rightAngle ??
      null,
    label: 'Side angle right',
    role: 'side_angle',
  });
  pushReference(references, {
    url: input.identityProfile?.fullBodyUrl ??
      urls?.fullBodyUrl ??
      urls?.fullBodyPath ??
      urls?.fullBody ??
      null,
    label: 'Full body',
    role: 'full_body',
  });
  pushReference(references, {
    url: urls?.expressiveUrl ??
      urls?.expressivePath ??
      urls?.expressive ??
      null,
    label: 'Expression reference',
    role: 'expression',
  });

  for (const [index, url] of (input.additionalReferenceImageUrls ?? []).entries()) {
    pushReference(references, {
      url,
      label: `Outfit reference ${index + 1}`,
      role: 'outfit',
    });
  }

  for (const [index, url] of (input.identityProfile?.canonicalReferenceSet ?? []).entries()) {
    pushReference(references, {
      url,
      label: `Identity reference ${index + 1}`,
      role: 'identity_reference',
    });
  }

  return references.map((reference, index) => ({
    ...reference,
    token: `[Image${index + 1}]`,
  }));
}
