import type { ReferenceImageUrls } from '../api';
import { resolveRenderableReferenceUrl } from '../selfCharacterReference';

export const SEEDANCE_ENGINE_ID = 'seedance-2.0' as const;
export const SEEDANCE_MODEL = 'bytedance/seedance-2.0';
export const SEEDANCE_IDENTITY_PROMPT =
  'Use the provided reference images only as identity references. Do not animate or copy any single source image. Generate a new photorealistic person matching the same identity in the requested scene.';

export type SeedanceReferenceSet = {
  frontFaceUrl: string | null;
  leftAngleUrl: string | null;
  rightAngleUrl: string | null;
  fullBodyUrl: string | null;
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
