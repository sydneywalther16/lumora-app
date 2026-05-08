import type {
  CharacterProfile,
  LumoraIdentityFeedback,
  LumoraIdentityFeedbackChoice,
  LumoraIdentityProfile,
  ReferenceImageUrls,
} from './api';
import type { LumoraProfile } from './profileStorage';

type IdentityBuildInput = {
  userId: string | null;
  selfCharacter: CharacterProfile | null;
  profile?: LumoraProfile | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  primaryReferenceImageUrl?: string | null;
  additionalReferenceImageUrls?: string[];
};

export const identityFeedbackLabels: Record<LumoraIdentityFeedbackChoice, string> = {
  looks_like_me: 'looks like me',
  hair_wrong: 'hair wrong',
  face_shape_wrong: 'face shape wrong',
  skin_tone_wrong: 'skin tone wrong',
  makeup_wrong: 'makeup wrong',
  too_realistic: 'too realistic',
  not_realistic_enough: 'not realistic enough',
  wrong_age: 'wrong age',
  wrong_body_type: 'wrong body type',
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordValue(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function compactRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, typeof entry === 'string' ? entry.trim() : ''])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function cleanHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  if (/^(?:blob|data|file):/i.test(value)) return null;
  if (value.includes('localhost') || value.includes('undefined')) return null;
  return value.split('?')[0];
}

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const url = cleanHttpUrl(value);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function identityIdFor(userId: string | null, selfCharacter: CharacterProfile | null) {
  const owner = userId || selfCharacter?.ownerUserId || 'local';
  return `lumora-identity-${owner}`;
}

export function getIdentityProfileFromCharacter(
  selfCharacter: CharacterProfile | null | undefined,
): LumoraIdentityProfile | null {
  const direct = recordValue(selfCharacter?.identityProfile);
  const nested = recordValue(recordValue(selfCharacter?.stylePreferences).identityProfile);
  const source = Object.keys(direct).length ? direct : nested;
  if (!source.identityId || typeof source.identityId !== 'string') return null;

  return {
    identityId: source.identityId,
    userId: typeof source.userId === 'string' ? source.userId : selfCharacter?.ownerUserId || 'local',
    frontFaceUrl: cleanHttpUrl(typeof source.frontFaceUrl === 'string' ? source.frontFaceUrl : null),
    leftAngleUrl: cleanHttpUrl(typeof source.leftAngleUrl === 'string' ? source.leftAngleUrl : null),
    rightAngleUrl: cleanHttpUrl(typeof source.rightAngleUrl === 'string' ? source.rightAngleUrl : null),
    fullBodyUrl: cleanHttpUrl(typeof source.fullBodyUrl === 'string' ? source.fullBodyUrl : null),
    videoReferenceUrls: Array.isArray(source.videoReferenceUrls)
      ? uniqueUrls(source.videoReferenceUrls as Array<string | null>)
      : [],
    appearanceSummary: typeof source.appearanceSummary === 'string' ? source.appearanceSummary : '',
    userPreferences: stringRecord(source.userPreferences),
    dislikedTraits: Array.isArray(source.dislikedTraits)
      ? source.dislikedTraits.filter((item): item is string => typeof item === 'string')
      : [],
    likenessNotes: Array.isArray(source.likenessNotes)
      ? source.likenessNotes.filter((item): item is string => typeof item === 'string')
      : [],
    preferredTraits: Array.isArray(source.preferredTraits)
      ? source.preferredTraits.filter((item): item is string => typeof item === 'string')
      : [],
    version: typeof source.version === 'number' ? source.version : 1,
    status: source.status === 'building' || source.status === 'needs_refs' ? source.status : 'ready',
  };
}

export function buildAppearanceSummary(input: {
  selfCharacter: CharacterProfile | null;
  profile?: LumoraProfile | null;
}) {
  const stylePreferences = recordValue(input.selfCharacter?.stylePreferences);
  const features = {
    ...stringRecord(stylePreferences.creatorSelfFeatures),
    ...stringRecord(input.selfCharacter?.creatorSelfFeatures),
    ...stringRecord(input.profile?.creatorSelfFeatures),
  };
  const style = {
    ...stringRecord(stylePreferences.creatorSelfStylePreferences),
    ...stringRecord(input.selfCharacter?.creatorSelfStylePreferences),
    ...stringRecord(input.profile?.creatorSelfStylePreferences),
  };

  const parts = [
    features.hairColorStyle ? `Hair: ${features.hairColorStyle}.` : '',
    features.eyeColor ? `Eyes: ${features.eyeColor}.` : '',
    features.skinTone ? `Skin tone: ${features.skinTone}.` : '',
    features.bodyBuild ? `Body/build: ${features.bodyBuild}.` : '',
    features.signatureMakeup ? `Signature makeup: ${features.signatureMakeup}.` : '',
    features.distinctiveFeatures ? `Distinctive features: ${features.distinctiveFeatures}.` : '',
    style.everydayStyle ? `Everyday style: ${style.everydayStyle}.` : '',
    style.glamStyle ? `Glam style: ${style.glamStyle}.` : '',
    style.videoWardrobe ? `Wardrobe preference: ${style.videoWardrobe}.` : '',
    style.colorsToFavor ? `Colors to favor: ${style.colorsToFavor}.` : '',
    style.colorsToAvoid ? `Avoid: ${style.colorsToAvoid}.` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

export function buildLumoraIdentityProfile(input: IdentityBuildInput): LumoraIdentityProfile {
  const referenceImageUrls = input.referenceImageUrls ?? input.selfCharacter?.referenceImageUrls ?? {};
  const existing = getIdentityProfileFromCharacter(input.selfCharacter);
  const frontFaceUrl = cleanHttpUrl(
    input.primaryReferenceImageUrl ||
      referenceImageUrls.frontFaceUrl ||
      referenceImageUrls.frontFace,
  );
  const leftAngleUrl = cleanHttpUrl(referenceImageUrls.leftAngleUrl || referenceImageUrls.leftAngle);
  const rightAngleUrl = cleanHttpUrl(referenceImageUrls.rightAngleUrl || referenceImageUrls.rightAngle);
  const fullBodyUrl = cleanHttpUrl(referenceImageUrls.fullBodyUrl || referenceImageUrls.fullBody);
  const stylePreferences = recordValue(input.selfCharacter?.stylePreferences);
  const videoReferenceUrls = uniqueUrls([
    input.selfCharacter?.sourceCaptureVideoUrl,
    typeof stylePreferences.selfCaptureVideo2Url === 'string' ? stylePreferences.selfCaptureVideo2Url : null,
  ]);
  const userPreferences = compactRecord({
    ...stringRecord(stylePreferences.creatorSelfStylePreferences),
    ...stringRecord(input.selfCharacter?.creatorSelfStylePreferences),
  });
  const dislikedTraits = [
    userPreferences.colorsToAvoid,
    ...((existing?.dislikedTraits ?? []) as string[]),
  ]
    .flatMap((value) => value ? value.split(',').map((item) => item.trim()) : [])
    .filter(Boolean);

  return {
    identityId: existing?.identityId || identityIdFor(input.userId, input.selfCharacter),
    userId: input.userId || input.selfCharacter?.ownerUserId || 'local',
    frontFaceUrl,
    leftAngleUrl,
    rightAngleUrl,
    fullBodyUrl,
    videoReferenceUrls,
    appearanceSummary: buildAppearanceSummary(input),
    userPreferences,
    dislikedTraits: Array.from(new Set(dislikedTraits)),
    likenessNotes: existing?.likenessNotes ?? [],
    preferredTraits: existing?.preferredTraits ?? [],
    version: existing?.version ?? 1,
    status: frontFaceUrl && leftAngleUrl && rightAngleUrl ? 'ready' : 'needs_refs',
  };
}

export function mergeIdentityFeedback(
  identityProfile: LumoraIdentityProfile,
  feedback: LumoraIdentityFeedback,
): LumoraIdentityProfile {
  const choiceNotes = feedback.choices.map((choice) => identityFeedbackLabels[choice]);
  const notes = [
    ...identityProfile.likenessNotes,
    ...choiceNotes,
    feedback.customNote?.trim() ?? '',
  ].filter(Boolean);

  return {
    ...identityProfile,
    likenessNotes: Array.from(new Set(notes)).slice(-24),
    dislikedTraits: Array.from(
      new Set([
        ...identityProfile.dislikedTraits,
        ...choiceNotes.filter((choice) => choice !== identityFeedbackLabels.looks_like_me),
      ]),
    ).slice(-24),
    preferredTraits: feedback.choices.includes('looks_like_me')
      ? Array.from(new Set([...(identityProfile.preferredTraits ?? []), 'current likeness direction']))
      : identityProfile.preferredTraits,
    version: identityProfile.version + 1,
    status: 'ready',
  };
}

export function identityProfileToStylePreferences(
  stylePreferences: Record<string, unknown>,
  identityProfile: LumoraIdentityProfile,
) {
  return {
    ...stylePreferences,
    identityProfile,
  };
}
