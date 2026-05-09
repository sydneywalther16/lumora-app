import type { LumoraDetectedIdentityFeatures, LumoraIdentityFeedback, LumoraIdentityProfile } from './api';

export type BuildIdentityProfileInput = {
  identityId?: string | null;
  userId?: string | null;
  frontFaceUrl?: string | null;
  leftAngleUrl?: string | null;
  rightAngleUrl?: string | null;
  fullBodyUrl?: string | null;
  selfieVideoUrl?: string | null;
  selfieVideo2Url?: string | null;
  appearanceSummary?: string | null;
  userPreferences?: Record<string, string>;
  dislikedTraits?: string[];
  likenessNotes?: string[];
  identityFeedback?: LumoraIdentityProfile['identityFeedback'];
  keyframeUrl?: string | null;
  successfulGenerations?: number;
  feedbackIterations?: number;
  version?: number;
  createdAt?: string;
};

function cleanHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (/^(?:blob|data|file):/i.test(trimmed)) return null;
  if (trimmed.includes('localhost') || trimmed.includes('undefined')) return null;
  return trimmed.split('?')[0];
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

function createIdentityId(userId?: string | null) {
  const owner = userId?.trim() || 'local';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `lumora-identity-${owner}-${crypto.randomUUID()}`;
  }
  return `lumora-identity-${owner}-${Date.now().toString(36)}`;
}

function promptFromAppearance(appearanceSummary?: string | null) {
  const summary = appearanceSummary?.trim();
  if (summary) {
    return `Photorealistic identity character. ${summary} Realistic proportions, natural skin texture, cinematic detail.`;
  }

  return [
    'Photorealistic identity character based on the provided multi-angle references.',
    'Preserve the same face shape, hair, skin tone, eye area, proportions, and personal styling.',
    'Realistic proportions, natural skin texture, cinematic detail.',
  ].join(' ');
}

function consistencyPrompt(referenceCount: number) {
  return [
    'Use the Lumora Identity Character as the persistent base person.',
    'Preserve the exact same identity across all generations.',
    'Maintain facial structure, skin tone, hair color, hairstyle, eye area, body proportions, makeup style, and overall likeness.',
    'Use reference images and canonical keyframes only as identity guidance; do not simply animate or copy an uploaded source photo.',
    referenceCount > 1 ? `Use all ${referenceCount} canonical references together for consistency.` : '',
  ].filter(Boolean).join(' ');
}

function detectedFeatures(referenceCount: number, hasVideo: boolean, appearanceSummary?: string | null): LumoraDetectedIdentityFeatures {
  const summary = appearanceSummary?.toLowerCase() ?? '';
  return {
    hairColor: summary.includes('hair') ? 'described in appearance summary' : 'unspecified',
    eyeColor: summary.includes('eye') ? 'described in appearance summary' : 'unspecified',
    skinTone: summary.includes('skin') ? 'described in appearance summary' : 'unspecified',
    faceShape: summary.includes('face') ? 'described in appearance summary' : 'unspecified',
    bodyFrame: summary.includes('body') || summary.includes('build') ? 'described in appearance summary' : 'unspecified',
    estimatedAgeRange: 'unspecified',
    genderPresentation: 'unspecified',
    styleTags: [
      'photorealistic',
      referenceCount >= 3 ? 'multi-angle' : 'limited-reference',
      hasVideo ? 'video-reference' : 'photo-reference',
    ],
  };
}

function identityStrength(input: {
  frontFaceUrl: string | null;
  leftAngleUrl: string | null;
  rightAngleUrl: string | null;
  fullBodyUrl: string | null;
  videoCount: number;
  keyframeUrl: string | null;
  successfulGenerations: number;
  feedbackIterations: number;
}) {
  const score =
    (input.frontFaceUrl ? 30 : 0) +
    (input.leftAngleUrl ? 15 : 0) +
    (input.rightAngleUrl ? 15 : 0) +
    (input.fullBodyUrl ? 10 : 0) +
    Math.min(input.videoCount * 10, 20) +
    (input.keyframeUrl ? 10 : 0) +
    Math.min(input.successfulGenerations * 2, 6) +
    Math.min(input.feedbackIterations * 2, 4);

  return Math.max(0, Math.min(100, score));
}

export function buildIdentityProfile(input: BuildIdentityProfileInput): LumoraIdentityProfile {
  const frontFaceUrl = cleanHttpUrl(input.frontFaceUrl);
  const leftAngleUrl = cleanHttpUrl(input.leftAngleUrl);
  const rightAngleUrl = cleanHttpUrl(input.rightAngleUrl);
  const fullBodyUrl = cleanHttpUrl(input.fullBodyUrl);
  const selfieVideoUrl = cleanHttpUrl(input.selfieVideoUrl);
  const selfieVideo2Url = cleanHttpUrl(input.selfieVideo2Url);
  const keyframeUrl = cleanHttpUrl(input.keyframeUrl);
  const videoReferenceUrls = uniqueUrls([selfieVideoUrl, selfieVideo2Url]);
  const canonicalReferenceSet = uniqueUrls([
    keyframeUrl,
    frontFaceUrl,
    leftAngleUrl,
    rightAngleUrl,
    fullBodyUrl,
    ...videoReferenceUrls,
  ]);
  const primaryIdentityImageUrl = keyframeUrl || frontFaceUrl || fullBodyUrl || canonicalReferenceSet[0] || null;
  const feedbackIterations = input.feedbackIterations ?? input.identityFeedback?.length ?? 0;
  const successfulGenerations = input.successfulGenerations ?? 0;
  const identityPrompt = promptFromAppearance(input.appearanceSummary);
  const generationConsistencyPrompt = consistencyPrompt(canonicalReferenceSet.length);

  return {
    identityId: input.identityId?.trim() || createIdentityId(input.userId),
    userId: input.userId || 'local',
    createdAt: input.createdAt || new Date().toISOString(),
    frontFaceUrl,
    leftAngleUrl,
    rightAngleUrl,
    fullBodyUrl,
    videoReferenceUrls,
    references: {
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      fullBodyUrl,
      selfieVideoUrl,
      selfieVideo2Url,
    },
    detectedFeatures: detectedFeatures(canonicalReferenceSet.length, videoReferenceUrls.length > 0, input.appearanceSummary),
    canonicalReferenceSet,
    primaryIdentityImageUrl,
    identityPrompt,
    generationConsistencyPrompt,
    keyframeUrl,
    appearanceSummary: input.appearanceSummary?.trim() || identityPrompt,
    userPreferences: input.userPreferences ?? {},
    dislikedTraits: input.dislikedTraits ?? [],
    likenessNotes: input.likenessNotes ?? [],
    identityFeedback: input.identityFeedback ?? [],
    preferredTraits: [],
    identityStrength: identityStrength({
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      fullBodyUrl,
      videoCount: videoReferenceUrls.length,
      keyframeUrl,
      successfulGenerations,
      feedbackIterations,
    }),
    successfulGenerations,
    feedbackIterations,
    version: input.version ?? 1,
    status: primaryIdentityImageUrl ? 'ready' : 'needs_refs',
  };
}

export function mergeIdentityFeedbackIntoProfile(
  identityProfile: LumoraIdentityProfile,
  feedback: LumoraIdentityFeedback,
): LumoraIdentityProfile {
  const identityFeedback = [
    ...(identityProfile.identityFeedback ?? []),
    {
      ...feedback,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sentiment: feedback.choices.includes('looks_like_me') ? 'positive' as const : 'negative' as const,
    },
  ];

  return buildIdentityProfile({
    ...identityProfile,
    identityId: identityProfile.identityId,
    userId: identityProfile.userId,
    frontFaceUrl: identityProfile.frontFaceUrl,
    leftAngleUrl: identityProfile.leftAngleUrl,
    rightAngleUrl: identityProfile.rightAngleUrl,
    fullBodyUrl: identityProfile.fullBodyUrl,
    selfieVideoUrl: identityProfile.videoReferenceUrls[0],
    selfieVideo2Url: identityProfile.videoReferenceUrls[1],
    appearanceSummary: identityProfile.appearanceSummary,
    userPreferences: identityProfile.userPreferences,
    dislikedTraits: identityProfile.dislikedTraits,
    likenessNotes: identityProfile.likenessNotes,
    keyframeUrl: identityProfile.keyframeUrl,
    successfulGenerations: identityProfile.successfulGenerations,
    feedbackIterations: identityFeedback.length,
    identityFeedback,
    version: identityProfile.version + 1,
    createdAt: identityProfile.createdAt,
  });
}
