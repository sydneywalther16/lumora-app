import { useEffect, useRef, useState } from 'react';
import {
  type GenerationMode,
  type LumoraIdentityFeedback,
  type LumoraIdentityFeedbackChoice,
  type LumoraIdentityProfile,
  type GenerationResponse,
  type ReferenceImageUrls,
  type VideoAspectRatio,
  type VideoEngine,
} from '../lib/api';
import { saveStudioProject, type StudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadSupabaseProfile, saveSupabaseDraft, saveSupabaseProject } from '../lib/supabaseAppData';
import { resolveRenderableReferenceUrl } from '../lib/selfCharacterReference';
import {
  SEEDANCE_ENGINE_ID,
  getSeedanceReferenceSet,
  hasSeedanceMinimumReferences,
  seedanceReferenceArray,
} from '../lib/providers/seedance';
import { useSession } from '../hooks/useSession';
import { useAppStore } from '../store/useAppStore';
import SelfReferencePreview, { normalizeReference } from './SelfReferencePreview';
import { STYLE_PRESETS, selectedStylePrompt } from '../lib/stylePresets';

type CreateVideoProps = {
  refreshKey?: number;
  characterId: string | null;
  characterName: string | null;
  characterAvatar: string | null;
  isDefaultSelfCharacter: boolean;
  characterDescription?: string;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[];
  referenceLoading?: boolean;
  referenceLabel?: string | null;
  forceSelfMode?: boolean;
  isHydrated?: boolean;
  identityProfile?: LumoraIdentityProfile | null;
  onLikenessFeedback?: (feedback: LumoraIdentityFeedback) => void | Promise<void>;
  onResaveReferencePhoto?: () => void;
};

const durations = [4, 8, 12, 16];
const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const engines: VideoEngine[] = ['seedance-2.0', 'replicate'];
const ENABLE_IDENTITY_KEYFRAME_FLOW = true;
const engineLabels: Record<VideoEngine, string> = {
  'seedance-2.0': 'Seedance 2.0 Identity',
  replicate: 'Kling image-to-video',
  'sora-2': 'Sora 2',
  'sora-2-pro': 'Sora 2 Pro',
  veo: 'Veo',
  runway: 'Runway',
  mock: 'Mock',
  openai: 'OpenAI',
};
const referenceImageLabels: Partial<Record<keyof ReferenceImageUrls, string>> = {
  manualReferenceImageUrl: 'Manual reference override',
  frontFace: 'Front face',
  fullBody: 'Full body',
  leftAngle: 'Left angle',
  rightAngle: 'Right angle',
  expressive: 'Expression',
};

type GenerateVideoApiResponse = {
  videoUrl?: unknown;
  video?: unknown;
  provider?: string;
  model?: string;
  finalPrompt?: string;
  rawOutput?: unknown;
  referenceImageNote?: string;
  referenceImageUrl?: unknown;
  additionalReferenceImageUrls?: unknown;
  keyframeUrl?: unknown;
  generationMode?: GenerationMode;
  displayEngine?: string;
  warnings?: unknown;
  error?: string;
  suggestion?: string;
  details?: unknown;
};

type KeyframeApiResponse = {
  keyframeUrl?: unknown;
  finalPrompt?: string;
  provider?: string;
  model?: string;
  warnings?: unknown;
  error?: string;
  details?: unknown;
};

const likenessFeedbackOptions: Array<{ value: LumoraIdentityFeedbackChoice; label: string }> = [
  { value: 'looks_like_me', label: 'looks like me' },
  { value: 'hair_wrong', label: 'hair wrong' },
  { value: 'face_shape_wrong', label: 'face shape wrong' },
  { value: 'skin_tone_wrong', label: 'skin tone wrong' },
  { value: 'makeup_wrong', label: 'makeup wrong' },
  { value: 'too_realistic', label: 'too realistic' },
  { value: 'not_realistic_enough', label: 'not realistic enough' },
  { value: 'wrong_age', label: 'wrong age' },
  { value: 'wrong_body_type', label: 'wrong body type' },
];

function createLocalGenerationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) =>
    (
      Number(character) ^
      (Math.random() * 16) >> (Number(character) / 4)
    ).toString(16),
  );
}

function saveLocalDraft(title: string, prompt: string) {
  const draft = {
    id: createLocalGenerationId(),
    title,
    prompt,
    createdAt: new Date().toISOString(),
  };
  const raw = localStorage.getItem('lumora_drafts');
  const parsed = raw ? JSON.parse(raw) : [];
  const existing = Array.isArray(parsed) ? parsed : [];
  localStorage.setItem('lumora_drafts', JSON.stringify([draft, ...existing]));
  return draft;
}

function buildCharacterDescription(input: {
  characterId: string | null;
  characterName: string | null;
  isDefaultSelfCharacter: boolean;
}) {
  if (!input.characterName) return '';
  return input.isDefaultSelfCharacter
    ? `Creator self character: ${input.characterName}`
    : `Featured character: ${input.characterName}${input.characterId ? ` (${input.characterId})` : ''}`;
}

function normalizeVideoUrl(video: unknown): string | null {
  if (typeof video === 'string') return video;
  if (video instanceof URL) return video.toString();
  if (Array.isArray(video)) {
    const firstUrl = video.find((item) => typeof item === 'string' || item instanceof URL);
    return normalizeVideoUrl(firstUrl);
  }
  return null;
}

function cleanReferenceUrl(value?: string | null): string | null {
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;
  const lowerValue = value.toLowerCase();
  if (lowerValue.includes('localhost') || lowerValue.includes('undefined')) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function renderableReferenceImageUrl(value?: string | null): string | null {
  return resolveRenderableReferenceUrl(value);
}

function pickReferenceImage(input: {
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
}): { url: string | null; label: string | null } {
  const explicitUrl = resolveRenderableReferenceUrl(input.referenceImageUrl);
  if (explicitUrl) return { url: explicitUrl, label: 'Selected reference' };

  const urls = input.referenceImageUrls;
  if (!urls) return { url: null, label: null };

  const orderedSlots: Array<keyof ReferenceImageUrls> = [
    'manualReferenceImageUrl',
    'frontFaceUrl',
    'frontFacePath',
    'frontFace',
    'fullBodyUrl',
    'fullBodyPath',
    'fullBody',
    'leftAngleUrl',
    'leftAnglePath',
    'leftAngle',
    'rightAngleUrl',
    'rightAnglePath',
    'rightAngle',
    'expressiveUrl',
    'expressivePath',
    'expressive',
  ];

  for (const slot of orderedSlots) {
    const url = resolveRenderableReferenceUrl(urls[slot]);
    if (url) {
      return {
        url,
        label: referenceImageLabels[slot] ?? 'Reference image',
      };
    }
  }

  return { url: null, label: null };
}

function referenceImagePayload(urls?: Partial<ReferenceImageUrls> | null) {
  if (!urls) return undefined;
  const optionalUrl = (value?: string | null) => resolveRenderableReferenceUrl(value) ?? undefined;

  return {
    manualReferenceImageUrl: optionalUrl(urls.manualReferenceImageUrl),
    front: optionalUrl(urls.frontFaceUrl ?? urls.frontFacePath ?? urls.frontFace),
    frontFace: optionalUrl(urls.frontFaceUrl ?? urls.frontFacePath ?? urls.frontFace),
    frontFaceUrl: optionalUrl(urls.frontFaceUrl ?? urls.frontFacePath ?? urls.frontFace),
    fullBody: optionalUrl(urls.fullBodyUrl ?? urls.fullBodyPath ?? urls.fullBody),
    fullBodyUrl: optionalUrl(urls.fullBodyUrl ?? urls.fullBodyPath ?? urls.fullBody),
    left: optionalUrl(urls.leftAngleUrl ?? urls.leftAnglePath ?? urls.leftAngle),
    leftAngle: optionalUrl(urls.leftAngleUrl ?? urls.leftAnglePath ?? urls.leftAngle),
    leftAngleUrl: optionalUrl(urls.leftAngleUrl ?? urls.leftAnglePath ?? urls.leftAngle),
    right: optionalUrl(urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle),
    rightAngle: optionalUrl(urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle),
    rightAngleUrl: optionalUrl(urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle),
    expressive: optionalUrl(urls.expressiveUrl ?? urls.expressivePath ?? urls.expressive),
  };
}

function formatWarnings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function formatUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? cleanReferenceUrl(item) : null))
    .filter((item): item is string => Boolean(item));
}

function formatUnknownDetail(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const providerSafetyFilterMessage =
  'Provider safety filter blocked this render. Try a safer, fully clothed editorial prompt.';
const providerQueueBusyMessage = 'Provider queue is busy. Retrying generation...';
const replicateThrottledMessage =
  'Replicate is temporarily throttling this account. Wait a minute and try again.';

function isProviderSafetyFilterError(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('provider safety filter') ||
    lower.includes('generation blocked by provider safety filter') ||
    lower.includes('flagged as sensitive') ||
    lower.includes('e005')
  );
}

function isProviderQueueBusyError(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('provider queue is busy') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('throttl') ||
    lower.includes('429')
  );
}

function isReplicateThrottledError(value: string): boolean {
  return value.toLowerCase().includes('replicate is temporarily throttling this account');
}

function parseGenerateResponse(text: string): {
  data: GenerateVideoApiResponse;
  parseError: string | null;
} {
  if (!text.trim()) {
    return {
      data: {},
      parseError: 'Generator returned an empty response.',
    };
  }

  try {
    return {
      data: JSON.parse(text) as GenerateVideoApiResponse,
      parseError: null,
    };
  } catch {
    return {
      data: { error: text },
      parseError: text,
    };
  }
}

export default function CreateVideo({
  refreshKey = 0,
  characterId,
  characterName,
  characterAvatar,
  isDefaultSelfCharacter,
  characterDescription,
  referenceImageUrl,
  referenceImageUrls,
  additionalReferenceImageUrls = [],
  referenceLoading = false,
  referenceLabel,
  forceSelfMode = false,
  isHydrated = true,
  identityProfile,
  onLikenessFeedback,
  onResaveReferencePhoto,
}: CreateVideoProps) {
  const { user, session, loading: sessionLoading, configured } = useSession();
  const authUser = session?.user ?? user;
  const {
    activePrompt,
    selectedStyles,
    draftTitle,
    setActivePrompt,
    toggleSelectedStyle,
    setDraftTitle,
  } = useAppStore();

  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('9:16');
  const [engine, setEngine] = useState<VideoEngine>('replicate');
  const [engineTouched, setEngineTouched] = useState(false);
  const [status, setStatus] = useState('');
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const [generatedDisplayEngine, setGeneratedDisplayEngine] = useState('');
  const [generatedReferenceImageUrl, setGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [generatedMode, setGeneratedMode] = useState<GenerationMode | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [generatedKeyframeUrl, setGeneratedKeyframeUrl] = useState<string | null>(null);
  const [selectedFeedbackChoices, setSelectedFeedbackChoices] = useState<LumoraIdentityFeedbackChoice[]>([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const generationInFlightRef = useRef(false);
  const primaryReferenceImage = pickReferenceImage({ referenceImageUrl, referenceImageUrls });
  const seedanceReferences = getSeedanceReferenceSet(referenceImageUrls);
  const seedanceReady = hasSeedanceMinimumReferences(seedanceReferences);
  const seedanceReferenceImages = seedanceReferenceArray(seedanceReferences);
  const hasSelfCharacter = forceSelfMode || isDefaultSelfCharacter;
  const selectedSelfReferenceImageUrl = hasSelfCharacter
    ? resolveRenderableReferenceUrl(referenceImageUrl) || resolveRenderableReferenceUrl(primaryReferenceImage.url)
    : resolveRenderableReferenceUrl(primaryReferenceImage.url) || resolveRenderableReferenceUrl(characterAvatar);
  const hasGenerationReference = Boolean(selectedSelfReferenceImageUrl);
  const selfReferenceMode = hasSelfCharacter;
  const selectedGenerationMode: GenerationMode = selfReferenceMode
    ? 'self-reference-video'
    : hasGenerationReference
      ? 'image-to-video'
      : 'text-to-video-fallback';
  const referencePayload = referenceImagePayload(referenceImageUrls);
  const isTextFallbackMode = !referenceLoading && !hasGenerationReference;
  const referenceThumbnailUrl = renderableReferenceImageUrl(primaryReferenceImage.url);
  const generatedReferenceThumbnailUrl = renderableReferenceImageUrl(generatedReferenceImageUrl);
  const identityStatusLabel = !identityProfile
    ? 'Needs references'
    : identityProfile.status === 'building'
      ? 'Building identity'
      : (identityProfile.feedbackIterations ?? 0) > 0
        ? 'Identity learning'
        : (identityProfile.keyframeUrl && identityProfile.keyframeUrl !== identityProfile.frontFaceUrl) || (identityProfile.identityStrength ?? 0) >= 70
          ? 'Identity stabilized'
          : identityProfile.status === 'ready'
            ? 'Identity ready'
            : 'Needs references';
  const identityReferenceCards = [
    {
      label: 'Front photo',
      required: true,
      reference: normalizeReference(
        {
          ...referenceImageUrls,
          frontFaceUrl: identityProfile?.frontFaceUrl ?? referenceImageUrls?.frontFaceUrl ?? referenceImageUrls?.frontFace,
        },
        'frontFaceUrl',
        'frontFacePath',
      ),
    },
    {
      label: 'Left angle',
      required: true,
      reference: normalizeReference(
        {
          ...referenceImageUrls,
          leftAngleUrl: identityProfile?.leftAngleUrl ?? referenceImageUrls?.leftAngleUrl ?? referenceImageUrls?.leftAngle,
        },
        'leftAngleUrl',
        'leftAnglePath',
      ),
    },
    {
      label: 'Right angle',
      required: true,
      reference: normalizeReference(
        {
          ...referenceImageUrls,
          rightAngleUrl: identityProfile?.rightAngleUrl ?? referenceImageUrls?.rightAngleUrl ?? referenceImageUrls?.rightAngle,
        },
        'rightAngleUrl',
        'rightAnglePath',
      ),
    },
    {
      label: 'Full body',
      required: false,
      reference: normalizeReference(
        {
          ...referenceImageUrls,
          fullBodyUrl: identityProfile?.fullBodyUrl ?? referenceImageUrls?.fullBodyUrl ?? referenceImageUrls?.fullBody,
        },
        'fullBodyUrl',
        'fullBodyPath',
      ),
    },
  ];
  const normalizedSelectedReference = normalizeReference(
    { url: referenceThumbnailUrl },
    'url',
    'path',
  );
  const normalizedGeneratedReference = normalizeReference(
    { url: generatedReferenceThumbnailUrl },
    'url',
    'path',
  );
  const isSoraEngine = engine === 'sora-2' || engine === 'sora-2-pro';
  const isSeedanceEngine = engine === SEEDANCE_ENGINE_ID;
  const canGenerate =
    isHydrated &&
    !referenceLoading &&
    hasGenerationReference &&
    (!isSeedanceEngine || seedanceReady);
  const generateBusy = !canGenerate || busy || generationLoading || referenceLoading;
  const saveBusy = busy || generationLoading;
  const engineRoutingMessage =
    isSeedanceEngine
      ? seedanceReady
        ? 'Seedance 2.0 runs through Replicate and uses front, left, and right identity references.'
        : 'Seedance 2.0 Identity needs front, left, and right references. Use Kling fallback for single-image animation.'
      : isSoraEngine
      ? 'Lumora Identity Character currently routes through Replicate image-to-video. Sora remains optional elsewhere.'
      : 'Kling runs through Replicate and uses your self-character reference image first.';

  useEffect(() => {
    if (seedanceReady && !engineTouched && engine !== SEEDANCE_ENGINE_ID) {
      setEngine(SEEDANCE_ENGINE_ID);
    } else if (!seedanceReady && engine === SEEDANCE_ENGINE_ID) {
      setEngine('replicate');
    }
  }, [engine, engineTouched, seedanceReady]);

  useEffect(() => {
    const savedPrompt = localStorage.getItem('remixPrompt');
    const savedTitle = localStorage.getItem('remixTitle');

    if (savedPrompt) {
      setActivePrompt(savedPrompt);
      localStorage.removeItem('remixPrompt');
    }

    if (savedTitle) {
      setDraftTitle(savedTitle);
      localStorage.removeItem('remixTitle');
    }
  }, [setActivePrompt, setDraftTitle]);

  async function handleGenerate() {
    if (generationInFlightRef.current) return;

    const releaseGenerateLock = () => {
      generationInFlightRef.current = false;
      setGenerationLoading(false);
    };

    generationInFlightRef.current = true;
    setGenerationLoading(true);

    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      releaseGenerateLock();
      return;
    }

    if (!isHydrated || referenceLoading) {
      setStatus('Checking saved reference photos. Try again in a moment.');
      releaseGenerateLock();
      return;
    }

    const currentPrompt = activePrompt;
    const selectedAspectRatio = aspectRatio;
    const selectedEngine = engine;
    const selectedSeedanceReferences = seedanceReferenceImages;
    const selectedReferenceImageUrl = resolveRenderableReferenceUrl(referenceImageUrl) || selectedSelfReferenceImageUrl;

    if (selectedEngine === SEEDANCE_ENGINE_ID && selectedSeedanceReferences.length < 3) {
      setGenerationError('Seedance identity generation needs saved front, left, and right reference photos.');
      releaseGenerateLock();
      return;
    }

    if (selectedEngine !== SEEDANCE_ENGINE_ID && !selectedReferenceImageUrl) {
      setGenerationError('Add or re-save a public reference photo before generating.');
      releaseGenerateLock();
      return;
    }

    const referenceImageForRequest = selectedEngine === SEEDANCE_ENGINE_ID
      ? selectedSeedanceReferences[0] ?? selectedReferenceImageUrl
      : selectedReferenceImageUrl;
    const selectedGenerationMode = selfReferenceMode
      ? 'self-reference-video'
      : referenceImageForRequest
        ? 'image-to-video'
        : 'text-to-video-fallback';
    const selectedCharacterDescription =
      characterDescription ||
      buildCharacterDescription({
        characterId,
        characterName,
        isDefaultSelfCharacter: hasSelfCharacter,
      });

    console.log('FORCED SELF MODE:', {
      hasSelfCharacter,
      referenceImageUrl: referenceImageForRequest,
    });
    console.log('FINAL IMAGE SENT:', referenceImageForRequest);

    setGenerationError('');
    setGeneratedVideoUrl(null);
    setFinalGeneratedPrompt('');
    setGeneratedModel('');
    setGeneratedDisplayEngine('');
    setGeneratedReferenceImageUrl(null);
    setGeneratedMode(null);
    setGenerationWarnings([]);
    setGeneratedKeyframeUrl(null);
    setGenerationResult(null);
    setStatus('');

    try {
      const generationStylePrompt = selectedStylePrompt(selectedStyles, currentPrompt);
      const savedIdentityKeyframeUrl = cleanReferenceUrl(identityProfile?.keyframeUrl ?? null);
      const identityFrontFaceUrl = cleanReferenceUrl(identityProfile?.frontFaceUrl ?? null);
      let keyframeUrl: string | null =
        savedIdentityKeyframeUrl && savedIdentityKeyframeUrl !== identityFrontFaceUrl
          ? savedIdentityKeyframeUrl
          : null;
      let keyframeFinalPrompt = '';
      let keyframeWarnings: string[] = [];
      let keyframeModel = '';
      let videoGenerationMode: GenerationMode = selfReferenceMode
        ? keyframeUrl ? 'identity-keyframe-to-video' : 'reference-photo-animation-fallback'
        : selectedGenerationMode;

      if (ENABLE_IDENTITY_KEYFRAME_FLOW && selfReferenceMode && !keyframeUrl && selectedReferenceImageUrl && identityProfile) {
        const keyframeRes = await fetch('/api/lumora/generate-identity-keyframe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: currentPrompt,
            identityId: identityProfile.identityId,
            frontFaceUrl: identityProfile.frontFaceUrl || selectedReferenceImageUrl,
            leftAngleUrl: identityProfile.leftAngleUrl,
            rightAngleUrl: identityProfile.rightAngleUrl,
            fullBodyUrl: identityProfile.fullBodyUrl,
            videoReferenceUrls: identityProfile.videoReferenceUrls,
            appearanceSummary: identityProfile.appearanceSummary,
            identityPrompt: identityProfile.identityPrompt,
            consistencyPrompt: identityProfile.generationConsistencyPrompt,
            canonicalReferenceSet: identityProfile.canonicalReferenceSet,
            preferences: identityProfile.userPreferences,
            dislikes: identityProfile.dislikedTraits,
            likenessNotes: identityProfile.likenessNotes,
            style: generationStylePrompt,
          }),
        });
        const keyframeText = await keyframeRes.text();
        const { data: keyframeData, parseError: keyframeParseError } = parseGenerateResponse(keyframeText) as {
          data: KeyframeApiResponse;
          parseError: string | null;
        };

        if (keyframeRes.ok && !keyframeParseError) {
          keyframeUrl = normalizeVideoUrl(keyframeData.keyframeUrl);
          keyframeFinalPrompt = keyframeData.finalPrompt || '';
          keyframeWarnings = formatWarnings(keyframeData.warnings);
          keyframeModel = keyframeData.model || '';

          if (keyframeUrl) {
            videoGenerationMode = 'identity-keyframe-to-video';
          }
        } else {
          const keyframeMessage = keyframeData.error || keyframeParseError || 'Keyframe identity renderer not configured yet.';
          keyframeWarnings = [
            keyframeMessage.includes('Keyframe identity renderer not configured yet')
              ? 'Keyframe identity renderer not configured yet. Using front-photo animation fallback.'
              : `${keyframeMessage} Using front-photo animation fallback.`,
          ];
          videoGenerationMode = 'reference-photo-animation-fallback';
        }
      }

      const res = await fetch('/api/lumora/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentPrompt,
          characterId,
          userId: authUser?.id ?? identityProfile?.userId ?? null,
          identityId: identityProfile?.identityId,
          characterDescription: selectedCharacterDescription,
          identityPrompt: identityProfile?.identityPrompt,
          consistencyPrompt: identityProfile?.generationConsistencyPrompt,
          keyframeUrl,
          referenceImageUrl: referenceImageForRequest,
          additionalReferenceImageUrls,
          canonicalReferenceSet: identityProfile?.canonicalReferenceSet,
          referenceImages: selectedEngine === SEEDANCE_ENGINE_ID
            ? selectedSeedanceReferences
            : additionalReferenceImageUrls,
          referenceImageUrls: referencePayload,
          aspectRatio: selectedAspectRatio,
          duration,
          style: generationStylePrompt,
          audio: true,
          provider: 'replicate',
          engine: selectedEngine,
          generationMode: videoGenerationMode,
        }),
      });

      const responseText = await res.text();
      const { data, parseError } = parseGenerateResponse(responseText);

      if (!res.ok) {
        const detail = formatUnknownDetail(data.details);
        const apiMessage = data.error || parseError || 'Generation failed.';
        if (isProviderSafetyFilterError([apiMessage, data.suggestion || '', detail].join(' '))) {
          throw new Error(providerSafetyFilterMessage);
        }
        if (isReplicateThrottledError([apiMessage, data.suggestion || '', detail].join(' '))) {
          throw new Error(replicateThrottledMessage);
        }
        if (isProviderQueueBusyError([apiMessage, detail].join(' '))) {
          throw new Error(providerQueueBusyMessage);
        }

        throw new Error(
          [apiMessage, detail]
            .filter(Boolean)
            .join(' Details: '),
        );
      }

      if (parseError) {
        throw new Error(parseError);
      }

      console.log('GENERATION RESPONSE:', data);

      const nextVideoUrl = normalizeVideoUrl(data.videoUrl ?? data.video);
      const generationProvider = data.provider === 'openai' ? 'openai' : 'replicate';
      const nextGenerationMode = data.generationMode || videoGenerationMode;
      const nextReferenceImageUrl = cleanReferenceUrl(normalizeVideoUrl(data.referenceImageUrl) || referenceImageForRequest);
      const nextKeyframeUrl = cleanReferenceUrl(normalizeVideoUrl(data.keyframeUrl) || keyframeUrl);
      const nextDisplayEngine = nextKeyframeUrl
        ? data.displayEngine || 'Lumora identity keyframe'
        : nextGenerationMode === 'reference-photo-animation-fallback'
          ? 'Reference photo animation fallback'
          : data.displayEngine || (nextGenerationMode === 'text-to-video-fallback' ? 'text fallback' : 'kling');
      const nextAdditionalReferenceImageUrls = formatUrlList(data.additionalReferenceImageUrls).length
        ? formatUrlList(data.additionalReferenceImageUrls)
        : additionalReferenceImageUrls;
      const nextThumbnailUrl = nextKeyframeUrl || nextReferenceImageUrl || nextVideoUrl;
      const nextWarnings = [
        ...keyframeWarnings,
        ...formatWarnings(data.warnings),
        ...(data.referenceImageNote ? [data.referenceImageNote] : []),
      ];

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('No usable video URL was returned from the generator.');
        return;
      }

      const nextFinalPrompt = data.finalPrompt || keyframeFinalPrompt || currentPrompt;
      let studioSaveStatus = 'Video generated and saved to Studio.';
      setGeneratedVideoUrl(nextVideoUrl);
      setFinalGeneratedPrompt(nextFinalPrompt);
      setGeneratedModel(data.model || keyframeModel || '');
      setGeneratedDisplayEngine(nextDisplayEngine);
      setGeneratedReferenceImageUrl(nextReferenceImageUrl);
      setGeneratedMode(nextGenerationMode);
      setGenerationWarnings(nextWarnings);
      setGeneratedKeyframeUrl(nextKeyframeUrl);

      const profile = authUser ? await loadSupabaseProfile(authUser.id) : loadLumoraProfile();
      const now = new Date().toISOString();
      const generationId = createLocalGenerationId();
      const result: GenerationResponse = {
        id: generationId,
        jobId: generationId,
        status: 'completed',
        engine: selectedEngine,
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        prompt: currentPrompt,
        outputUrl: nextVideoUrl,
        generationMode: nextGenerationMode,
        model: data.model || null,
        displayEngine: nextDisplayEngine,
        referenceImageUrl: nextReferenceImageUrl,
        message: nextGenerationMode === 'text-to-video-fallback'
          ? 'Text-only fallback render created. Likeness is not guaranteed.'
          : nextKeyframeUrl
            ? 'Lumora identity keyframe created from multiple references.'
          : nextGenerationMode === 'reference-photo-animation-fallback'
            ? 'Front reference animation fallback.'
          : 'Kling self-reference video render created.',
        createdAt: now,
      };
      setGenerationResult(result);

      if (result.status === 'completed' && result.outputUrl) {
        const studioProject: StudioProject = {
          id: result.jobId,
          title: draftTitle,
          caption: currentPrompt,
          prompt: result.prompt,
          finalPrompt: nextFinalPrompt,
          videoUrl: result.outputUrl,
          thumbnailUrl: nextThumbnailUrl,
          status: result.status,
          provider: generationProvider,
          engine: selectedEngine,
          aspectRatio: selectedAspectRatio,
          model: data.model || null,
          displayEngine: nextDisplayEngine,
          generationMode: nextGenerationMode,
          identityId: identityProfile?.identityId ?? null,
          identityPrompt: identityProfile?.identityPrompt ?? null,
          consistencyPrompt: identityProfile?.generationConsistencyPrompt ?? null,
          canonicalReferenceSet: identityProfile?.canonicalReferenceSet ?? null,
          keyframeUrl: nextKeyframeUrl,
          referenceImageUrl: nextReferenceImageUrl,
          referenceImageUrls: referencePayload,
          additionalReferenceImageUrls: nextAdditionalReferenceImageUrls,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          creatorName: profile.displayName || 'Lumora Creator',
          creatorUsername: profile.username || 'lumora.creator',
          creatorAvatar: profile.avatar || null,
          createdAt: result.createdAt,
          updatedAt: now,
        };

        console.log('SAVING COMPLETED STUDIO PROJECT:', studioProject);

        if (authUser) {
          try {
            const savedProject = await saveSupabaseProject(authUser.id, studioProject);
            console.log('SAVED COMPLETED STUDIO PROJECT:', savedProject);
          } catch (saveError) {
            console.error('Unable to save project to Supabase; saving local backup.', saveError);
            saveStudioProject(studioProject);
            console.log('SAVED COMPLETED STUDIO PROJECT:', {
              ...studioProject,
              storage: 'local-fallback',
            });
            studioSaveStatus = 'Video generated. Account save failed, so a local Studio backup was saved.';
            setGenerationWarnings((current) => [
              ...current,
              saveError instanceof Error
                ? `Account save failed: ${saveError.message}. A local Studio backup was saved.`
                : 'Account save failed. A local Studio backup was saved.',
            ]);
          }
        } else {
          saveStudioProject(studioProject);
          console.log('SAVED COMPLETED STUDIO PROJECT:', {
            ...studioProject,
            storage: 'local',
          });
        }
      }

      setStatus(studioSaveStatus);
    } catch (error) {
      console.error('Generation failed', error);
      const message = error instanceof Error ? error.message : 'Unable to create draft render';
      const displayMessage = isProviderSafetyFilterError(message)
        ? providerSafetyFilterMessage
        : isReplicateThrottledError(message)
          ? replicateThrottledMessage
        : isProviderQueueBusyError(message)
          ? providerQueueBusyMessage
        : message;
      setGenerationError(
        isSoraEngine && !isProviderSafetyFilterError(displayMessage)
          ? `${displayMessage} Self-character likeness is currently routed through Replicate.`
          : displayMessage,
      );
    } finally {
      releaseGenerateLock();
    }
  }

  async function handleSaveDraft() {
    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    setBusy(true);
    setStatus('Saving draft...');

    try {
      if (authUser) {
        await saveSupabaseDraft({
          userId: authUser.id,
          title: draftTitle,
          prompt: activePrompt,
          payload: {
            selectedStyles,
            duration,
            aspectRatio,
            engine,
            displayEngine: engine === SEEDANCE_ENGINE_ID ? 'seedance' : engine === 'replicate' ? 'kling' : engine,
            characterId,
            characterName,
            characterAvatar,
            isDefaultSelfCharacter,
            generationMode: selectedGenerationMode,
            referenceImageUrl: selectedSelfReferenceImageUrl,
            referenceImageUrls: referencePayload,
          },
        });
        setStatus('Draft saved to your account.');
      } else {
        saveLocalDraft(draftTitle, activePrompt);
        setStatus('Draft saved locally.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save draft.');
    } finally {
      setBusy(false);
    }
  }

  function toggleFeedbackChoice(choice: LumoraIdentityFeedbackChoice) {
    setSelectedFeedbackChoices((current) =>
      current.includes(choice)
        ? current.filter((item) => item !== choice)
        : [...current, choice],
    );
  }

  function handleRemixResult() {
    const remixPrompt = finalGeneratedPrompt || generationResult?.prompt || activePrompt;
    setActivePrompt(remixPrompt);
    setDraftTitle(`Remix of ${draftTitle || 'Lumora result'}`);
    setStatus('Result prompt loaded for remix.');
  }

  async function handleSubmitLikenessFeedback() {
    if (!onLikenessFeedback || (!selectedFeedbackChoices.length && !feedbackNote.trim())) return;

    setFeedbackStatus('Saving likeness feedback...');
    try {
      await onLikenessFeedback({
        choices: selectedFeedbackChoices,
        customNote: feedbackNote.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
      setFeedbackStatus('Feedback saved for future Lumora Identity Character prompts.');
      setSelectedFeedbackChoices([]);
      setFeedbackNote('');
    } catch (error) {
      setFeedbackStatus(error instanceof Error ? error.message : 'Unable to save likeness feedback.');
    }
  }

  return (
    <section className="create-video-stack">
      <section className="editor-card">
        <div>
          <span className="eyebrow">video</span>
          <h3>Create video</h3>
        </div>

        <label className="field-block">
          <span>Project title</span>
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Title" />
        </label>

        <label className="field-block">
          <span>Core prompt</span>
          <textarea value={activePrompt} onChange={(event) => setActivePrompt(event.target.value)} rows={6} />
        </label>

        <div className="field-block">
          <span>Style presets</span>
          <div className="chip-row wrap">
            {STYLE_PRESETS.map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={selectedStyles.includes(style)}
                className={`chip ${selectedStyles.includes(style) ? 'active' : ''}`}
                onClick={() => toggleSelectedStyle(style)}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="field-block">
          <span>Duration</span>
          <div className="chip-row wrap">
            {durations.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${duration === option ? 'active' : ''}`}
                onClick={() => setDuration(option)}
              >
                {option}s
              </button>
            ))}
          </div>
        </div>

        <div className="field-block">
          <span>Aspect ratio</span>
          <div className="chip-row wrap">
            {aspectRatios.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${aspectRatio === option ? 'active' : ''}`}
                onClick={() => setAspectRatio(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <label className="field-block">
          <span>Engine</span>
          <select
            value={engine}
            onChange={(event) => {
              setEngineTouched(true);
              setEngine(event.target.value as VideoEngine);
            }}
          >
            {engines.map((option) => (
              <option key={option} value={option}>
                {engineLabels[option] ?? option}
              </option>
            ))}
          </select>
          <small className="muted">{engineRoutingMessage}</small>
        </label>

        <div className="reference-mode-card">
          <div className="reference-mode-copy">
            <span className="eyebrow">
              {selfReferenceMode
                  ? 'Lumora Identity Character'
                : referenceLoading
                  ? 'Checking self reference'
                : isTextFallbackMode
                    ? 'Reference required'
                    : 'Image-to-video'}
            </span>
            <strong>
              {selfReferenceMode
                ? 'Generate new scenes from your reusable identity'
                : referenceLoading
                  ? 'Looking for saved self-character photos'
                : isTextFallbackMode
                  ? 'Save a reference image first'
                  : 'Using a reference image'}
            </strong>
            <span className="muted">
              {referenceLoading
                ? 'Lumora is checking front, full-body, angle, avatar, and media URL fields.'
                : selfReferenceMode
                ? primaryReferenceImage.url
                  ? 'Build a reusable photorealistic character from your reference photos and videos.'
                  : 'Lumora Identity Character references will be sent when available.'
                : isTextFallbackMode
                  ? 'Create needs a public saved reference image for the current generation path.'
                  : 'Kling will condition the video on the selected image.'}
            </span>
            {selfReferenceMode ? (
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                <span className="tiny-pill" style={{ width: 'fit-content' }}>{identityStatusLabel}</span>
                <span className="muted">
                  Lumora will use your feedback to improve future prompts and character consistency.
                </span>
              </div>
            ) : null}
            {selfReferenceMode && onResaveReferencePhoto ? (
              <button
                type="button"
                className="ghost-btn reference-resave-btn"
                onClick={onResaveReferencePhoto}
              >
                Re-save reference photo
              </button>
            ) : null}
          </div>
          {isHydrated ? (
            <div className="reference-mode-thumb">
              <SelfReferencePreview
                label="Selected reference"
                reference={normalizedSelectedReference}
                required={selfReferenceMode}
              />
            </div>
          ) : null}
          {primaryReferenceImage.label || selfReferenceMode ? (
            <span className="tiny-pill reference-mode-pill">
              {referenceLabel || primaryReferenceImage.label || 'Saved self character'}
            </span>
          ) : null}
        </div>

        {characterName ? (
          <div className="selected-character">
            <span className="eyebrow">selected</span>
            <strong>{isDefaultSelfCharacter ? 'Created as self' : characterName}</strong>
            {!isDefaultSelfCharacter ? null : (
              <span className="muted" style={{ display: 'block', marginTop: '6px' }}>
                Using your creator self by default.
              </span>
            )}
          </div>
        ) : null}

        {selfReferenceMode && isHydrated ? (
          <div className="field-block">
            <span>Lumora Identity Character</span>
            <div className="reference-grid" style={{ gap: '8px' }}>
              {identityReferenceCards.map((item) => (
                  <div key={item.label} className="reference-upload" style={{ padding: '8px', minHeight: 'unset' }}>
                    <span>{item.label}</span>
                    <SelfReferencePreview
                      label={item.label}
                      reference={item.reference}
                      required={item.required}
                    />
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        <div className="button-row">
          <button type="button" className="primary-btn" onClick={handleGenerate} disabled={generateBusy} aria-busy={generateBusy}>
            {generationLoading
              ? 'Rendering...'
              : referenceLoading
                  ? 'Checking self character...'
                : !canGenerate
                  ? 'Add reference before generating'
                  : selfReferenceMode
                    ? 'Generate new scene with my Lumora character'
                  : 'Generate video'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
            Save draft
          </button>
        </div>
        {generationLoading ? <p className="muted">Rendering your concept...</p> : null}
        {generationError ? <p style={{ color: 'var(--error-text)' }}>{generationError}</p> : null}
        {generationWarnings.length ? (
          <div className="generation-warning-list">
            {generationWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
        {status ? <p className="muted">{status}</p> : null}
        {generatedVideoUrl && !generationResult ? (
          <div style={{ display: 'grid', gap: '12px', marginTop: '14px' }}>
            <video
              src={generatedVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              style={{ width: '100%', borderRadius: 12 }}
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                window.location.href = '/studio';
              }}
              style={{ flex: 'unset', width: '100%' }}
            >
              View in Studio
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleRemixResult}
              style={{ flex: 'unset', width: '100%' }}
            >
              Remix result
            </button>
          </div>
        ) : null}
      </section>

      {generationResult ? (
        <section className="editor-card video-result-card">
          <div className="row-between">
            <div>
              <span className="eyebrow">result</span>
              <h3>Video generated</h3>
            </div>
            <span className="tiny-pill">
              {(generatedDisplayEngine || generatedModel || generationResult.engine).toUpperCase()}
            </span>
          </div>
          {isDefaultSelfCharacter ? (
            <p><strong>Created as self</strong></p>
          ) : generationResult.characterName ? (
            <p>Character: <strong>{generationResult.characterName}</strong></p>
          ) : null}
          {generationResult.message ? <p>{generationResult.message}</p> : null}
          <p>Prompt: {generationResult.prompt}</p>
          {finalGeneratedPrompt ? (
            <p className="muted">Final prompt: {finalGeneratedPrompt}</p>
          ) : null}
          {generatedMode ? (
            <p className="muted">Generation mode: {generatedMode}</p>
          ) : null}
          {generatedKeyframeUrl ? (
            <div className="reference-result-row">
              <img src={generatedKeyframeUrl} alt="" />
              <span className="muted">Lumora identity keyframe created from multiple references.</span>
            </div>
          ) : generatedMode === 'reference-photo-animation-fallback' ? (
            <p className="muted">Front reference animation fallback.</p>
          ) : null}
          {generatedReferenceThumbnailUrl ? (
            <div className="reference-result-row">
              <SelfReferencePreview
                label="Reference image used for likeness"
                reference={normalizedGeneratedReference}
              />
              <span className="muted">Reference image used for likeness</span>
            </div>
          ) : null}
          {generatedVideoUrl ? (
            <video
              src={generatedVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              style={{ width: '100%', borderRadius: 12 }}
            />
          ) : null}
          <div className="button-row">
            <button type="button" className="ghost-btn" onClick={() => { window.location.href = '/studio'; }}>
              Open in Studio
            </button>
            <button type="button" className="ghost-btn" onClick={handleRemixResult}>
              Remix result
            </button>
          </div>
          {selfReferenceMode && onLikenessFeedback ? (
            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
              <strong>Improve likeness</strong>
              <p className="muted" style={{ margin: 0 }}>
                Lumora will use your feedback to improve future prompts and character consistency.
              </p>
              <div className="chip-row wrap">
                {likenessFeedbackOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chip ${selectedFeedbackChoices.includes(option.value) ? 'active' : ''}`}
                    onClick={() => toggleFeedbackChoice(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="field-block">
                <span>Custom note</span>
                <textarea
                  value={feedbackNote}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  rows={3}
                  placeholder="Add a likeness note"
                />
              </label>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void handleSubmitLikenessFeedback()}
                disabled={!selectedFeedbackChoices.length && !feedbackNote.trim()}
              >
                {selectedFeedbackChoices.length || feedbackNote.trim() ? 'Save likeness feedback' : 'Add feedback first'}
              </button>
              {feedbackStatus ? <p className="muted">{feedbackStatus}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
