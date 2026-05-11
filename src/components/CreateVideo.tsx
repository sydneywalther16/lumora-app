import { useEffect, useRef, useState } from 'react';
import {
  api,
  type GenerationMode,
  type LumoraIdentityFeedback,
  type LumoraIdentityFeedbackChoice,
  type LumoraIdentityProfile,
  type GenerationResponse,
  type ReferenceImageUrls,
  type SeedanceReferenceImage,
  type VideoAspectRatio,
  type VideoEngine,
} from '../lib/api';
import { saveStudioProject, type StudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadSupabaseProfile, saveSupabaseDraft, saveSupabaseProject } from '../lib/supabaseAppData';
import { resolveRenderableReferenceUrl } from '../lib/selfCharacterReference';
import {
  buildSeedanceReferenceImages,
  SEEDANCE_ENGINE_ID,
  SEEDANCE_QUALITY_ENGINE_ID,
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
const providerOptions: Array<{
  engine: VideoEngine;
  label: string;
  speed: string;
  quality: string;
  description: string;
}> = [
  {
    engine: SEEDANCE_ENGINE_ID,
    label: 'Seedance Fast',
    speed: '~1-3 min',
    quality: 'High',
    description: 'Fast Replicate multimodal reference generation.',
  },
  {
    engine: SEEDANCE_QUALITY_ENGINE_ID,
    label: 'Seedance Quality',
    speed: '~3-6 min',
    quality: 'Higher',
    description: 'Slower Seedance pass for stronger identity and motion detail.',
  },
  {
    engine: 'veo',
    label: 'Veo Experimental',
    speed: 'Variable',
    quality: 'Experimental',
    description: 'Placeholder-safe Veo path for future Google video support.',
  },
  {
    engine: 'mock',
    label: 'Demo Mode',
    speed: 'Instant',
    quality: 'Demo',
    description: 'Always-available local preview without provider usage.',
  },
  {
    engine: 'replicate',
    label: 'Kling Reference',
    speed: '~1-3 min',
    quality: 'Reference',
    description: 'Existing image-to-video route for self-character reference animation.',
  },
];
const engineLabels: Record<VideoEngine, string> = {
  'seedance-2.0': 'Seedance Fast',
  'seedance-quality': 'Seedance Quality',
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
  outputUrl?: unknown;
  provider?: string;
  model?: string;
  finalPrompt?: string;
  rawOutput?: unknown;
  referenceImageNote?: string;
  referenceImageUrl?: unknown;
  additionalReferenceImageUrls?: unknown;
  generationMode?: GenerationMode;
  aspectRatio?: unknown;
  durationSeconds?: unknown;
  resolution?: unknown;
  displayEngine?: string;
  referenceImages?: unknown;
  referenceImageCount?: unknown;
  multimodalReferenceMode?: unknown;
  warnings?: unknown;
  error?: string;
  suggestion?: string;
  details?: unknown;
};

type GenerationStatusState = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
type ToastState = {
  type: 'success' | 'error';
  message: string;
} | null;

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

function formatSeedanceReferenceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === 'string') return cleanReferenceUrl(item);
      if (item && typeof item === 'object') {
        return cleanReferenceUrl((item as { url?: unknown }).url as string | null);
      }
      return null;
    })
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
  const [status, setStatus] = useState('');
  const [generationStatusState, setGenerationStatusState] = useState<GenerationStatusState>('idle');
  const [toast, setToast] = useState<ToastState>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const [generatedDisplayEngine, setGeneratedDisplayEngine] = useState('');
  const [generatedReferenceImageUrl, setGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [generatedMode, setGeneratedMode] = useState<GenerationMode | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [selectedFeedbackChoices, setSelectedFeedbackChoices] = useState<LumoraIdentityFeedbackChoice[]>([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const generationInFlightRef = useRef(false);
  const progressTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const primaryReferenceImage = pickReferenceImage({ referenceImageUrl, referenceImageUrls });
  const hasSelfCharacter = forceSelfMode || isDefaultSelfCharacter;
  const selectedSelfReferenceImageUrl = hasSelfCharacter
    ? resolveRenderableReferenceUrl(referenceImageUrl) || resolveRenderableReferenceUrl(primaryReferenceImage.url)
    : resolveRenderableReferenceUrl(primaryReferenceImage.url) || resolveRenderableReferenceUrl(characterAvatar);
  const hasGenerationReference = Boolean(selectedSelfReferenceImageUrl);
  const selfReferenceMode = hasSelfCharacter;
  const isSoraEngine = engine === 'sora-2' || engine === 'sora-2-pro';
  const isSeedanceEngine = engine === SEEDANCE_ENGINE_ID || engine === SEEDANCE_QUALITY_ENGINE_ID;
  const isBackendProviderEngine = isSeedanceEngine || engine === 'veo' || engine === 'mock';
  const requiresReferenceImage = engine === 'replicate';
  const selectedProviderOption = providerOptions.find((option) => option.engine === engine) ?? providerOptions[0];
  const hasPrompt = activePrompt.trim().length > 0;
  const seedanceReferenceImages = buildSeedanceReferenceImages({
    referenceImageUrl,
    referenceImageUrls,
    additionalReferenceImageUrls,
    identityProfile,
    characterAvatar,
  });
  const seedanceReferenceCount = seedanceReferenceImages.length;
  const seedanceMultimodalActive = isSeedanceEngine && seedanceReferenceCount > 1;
  const seedanceSingleReferenceWarning = isSeedanceEngine && seedanceReferenceCount === 1;
  const selectedGenerationMode: GenerationMode = isSeedanceEngine
    ? (seedanceReferenceCount > 0 ? 'seedance-multimodal-reference' : 'seedance-text-to-video')
    : engine !== 'replicate'
      ? 'text-to-video-fallback'
      : selfReferenceMode
        ? 'self-reference-video'
        : hasGenerationReference
          ? 'image-to-video'
          : 'text-to-video-fallback';
  const referencePayload = referenceImagePayload(referenceImageUrls);
  const isTextFallbackMode = !isSeedanceEngine && !referenceLoading && !hasGenerationReference;
  const referenceThumbnailUrl = renderableReferenceImageUrl(primaryReferenceImage.url);
  const generatedReferenceThumbnailUrl = renderableReferenceImageUrl(generatedReferenceImageUrl);
  const identityStatusLabel = !identityProfile
    ? 'Needs references'
    : identityProfile.status === 'building'
      ? 'Building identity'
      : (identityProfile.feedbackIterations ?? 0) > 0
        ? 'Identity learning'
        : (identityProfile.identityStrength ?? 0) >= 70
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
  const canGenerate =
    isHydrated &&
    !referenceLoading &&
    hasPrompt &&
    (!requiresReferenceImage || hasGenerationReference);
  const generateBusy = !canGenerate || busy || generationLoading || referenceLoading;
  const saveBusy = busy || generationLoading;
  const engineRoutingMessage =
    isSeedanceEngine
      ? `${selectedProviderOption.label} sends ${seedanceReferenceCount} reference image${seedanceReferenceCount === 1 ? '' : 's'} to Seedance without forcing a first frame.`
    : engine === 'veo'
      ? 'Veo Experimental keeps the placeholder-safe architecture while provider credentials evolve.'
    : engine === 'mock'
      ? 'Demo Mode returns an instant preview and never spends provider credits.'
      : isSoraEngine
      ? 'Lumora Identity Character currently routes through Replicate image-to-video. Sora remains optional elsewhere.'
      : 'Kling runs through Replicate and uses your self-character reference image first.';

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

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(nextToast: NonNullable<ToastState>) {
    setToast(nextToast);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 5200);
  }

  function beginGenerationProgress() {
    setGenerationStatusState('queued');
    setStatus('Queued with provider...');
    if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      setGenerationStatusState('processing');
      setStatus('Provider is processing your render...');
      progressTimerRef.current = null;
    }, 1400);
  }

  function finishGenerationProgress(state: Extract<GenerationStatusState, 'completed' | 'failed'>) {
    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setGenerationStatusState(state);
  }

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
    const selectedReferenceImageUrl = resolveRenderableReferenceUrl(referenceImageUrl) || selectedSelfReferenceImageUrl;

    if (!currentPrompt.trim()) {
      setGenerationError('Add a prompt before generating.');
      setGenerationStatusState('failed');
      releaseGenerateLock();
      return;
    }

    if (selectedEngine === 'replicate' && !selectedReferenceImageUrl) {
      setGenerationError('Add or re-save a public reference photo before generating.');
      setGenerationStatusState('failed');
      releaseGenerateLock();
      return;
    }

    const selectedIsSeedanceEngine = selectedEngine === SEEDANCE_ENGINE_ID || selectedEngine === SEEDANCE_QUALITY_ENGINE_ID;
    const selectedIsBackendProviderEngine = selectedIsSeedanceEngine || selectedEngine === 'veo' || selectedEngine === 'mock';
    const selectedSeedanceReferences: SeedanceReferenceImage[] = selectedIsSeedanceEngine
      ? seedanceReferenceImages
      : [];
    const referenceImageForRequest = selectedIsSeedanceEngine
      ? null
      : selectedReferenceImageUrl;
    const selectedGenerationMode: GenerationMode = selectedIsSeedanceEngine
      ? (selectedSeedanceReferences.length > 0 ? 'seedance-multimodal-reference' : 'seedance-text-to-video')
      : selectedEngine !== 'replicate'
        ? 'text-to-video-fallback'
      : selfReferenceMode
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
    if (selectedIsSeedanceEngine) {
      console.info('SEEDANCE MULTIMODAL REFERENCES SENT:', selectedSeedanceReferences.map((reference) => ({
        token: reference.token,
        label: reference.label,
        role: reference.role,
        url: reference.url,
      })));
    }

    setGenerationError('');
    setGeneratedVideoUrl(null);
    setFinalGeneratedPrompt('');
    setGeneratedModel('');
    setGeneratedDisplayEngine('');
    setGeneratedReferenceImageUrl(null);
    setGeneratedMode(null);
    setGenerationWarnings([]);
    setGenerationResult(null);
    setStatus('');
    beginGenerationProgress();

    try {
      const generationStylePrompt = selectedStylePrompt(selectedStyles, currentPrompt);
      const videoGenerationMode: GenerationMode = selectedGenerationMode;

      let data: GenerateVideoApiResponse;
      if (selectedIsSeedanceEngine) {
        const seedanceResult = await api.createSeedanceGeneration({
          title: draftTitle,
          prompt: currentPrompt,
          stylePreset: selectedStyles,
          userId: authUser?.id ?? identityProfile?.userId ?? null,
          engine: selectedEngine,
          quality: selectedEngine === SEEDANCE_QUALITY_ENGINE_ID ? 'quality' : 'fast',
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          referenceImages: selectedSeedanceReferences,
          referenceImageUrls: referencePayload,
          additionalReferenceImageUrls,
        });

        data = {
          videoUrl: seedanceResult.videoUrl ?? seedanceResult.outputUrl,
          outputUrl: seedanceResult.outputUrl,
          provider: seedanceResult.provider ?? 'replicate',
          model: seedanceResult.model ?? (selectedEngine === SEEDANCE_QUALITY_ENGINE_ID ? 'bytedance/seedance-2.0' : 'bytedance/seedance-2.0-fast'),
          finalPrompt: seedanceResult.finalPrompt ?? seedanceResult.prompt,
          generationMode: seedanceResult.generationMode ?? videoGenerationMode,
          aspectRatio: seedanceResult.aspectRatio,
          durationSeconds: seedanceResult.durationSeconds,
          displayEngine: seedanceResult.displayEngine ?? (selectedEngine === SEEDANCE_QUALITY_ENGINE_ID ? 'Seedance Quality' : 'Seedance Fast'),
          referenceImages: seedanceResult.referenceImages ?? selectedSeedanceReferences,
          referenceImageCount: seedanceResult.referenceImageCount ?? selectedSeedanceReferences.length,
          multimodalReferenceMode: seedanceResult.multimodalReferenceMode ?? selectedSeedanceReferences.length > 1,
          warnings: seedanceResult.warnings ?? undefined,
        };
      } else if (selectedIsBackendProviderEngine) {
        const providerResult = await api.createGeneration({
          title: draftTitle,
          prompt: currentPrompt,
          stylePreset: selectedStyles,
          userId: authUser?.id ?? identityProfile?.userId ?? null,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          duration,
          aspectRatio: selectedAspectRatio,
          engine: selectedEngine,
        });

        if (providerResult.status === 'failed') {
          throw new Error(providerResult.error || providerResult.message || 'Generation failed.');
        }

        data = {
          videoUrl: providerResult.videoUrl ?? providerResult.outputUrl,
          outputUrl: providerResult.outputUrl,
          provider: providerResult.provider ?? selectedEngine,
          model: providerResult.model ?? undefined,
          finalPrompt: providerResult.prompt,
          generationMode: providerResult.generationMode ?? videoGenerationMode,
          aspectRatio: providerResult.aspectRatio,
          durationSeconds: providerResult.durationSeconds,
          displayEngine: providerResult.displayEngine ?? engineLabels[selectedEngine],
          warnings: providerResult.warnings ?? undefined,
        };
      } else {
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
            referenceImageUrl: referenceImageForRequest,
            additionalReferenceImageUrls,
            canonicalReferenceSet: identityProfile?.canonicalReferenceSet,
            referenceImages: additionalReferenceImageUrls,
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
        const { data: parsedData, parseError } = parseGenerateResponse(responseText);

        if (!res.ok) {
          const detail = formatUnknownDetail(parsedData.details);
          const apiMessage = parsedData.error || parseError || 'Generation failed.';
          if (isProviderSafetyFilterError([apiMessage, parsedData.suggestion || '', detail].join(' '))) {
            throw new Error(providerSafetyFilterMessage);
          }
          if (isReplicateThrottledError([apiMessage, parsedData.suggestion || '', detail].join(' '))) {
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

        data = parsedData;
      }

      console.log('GENERATION RESPONSE:', data);

      const nextVideoUrl = normalizeVideoUrl(data.videoUrl ?? data.outputUrl ?? data.video);
      const generationProvider = (typeof data.provider === 'string' && data.provider
        ? data.provider
        : selectedEngine) as VideoEngine;
      const nextGenerationMode = data.generationMode || videoGenerationMode;
      const nextAspectRatio = typeof data.aspectRatio === 'string' ? data.aspectRatio : selectedAspectRatio;
      const nextReferenceImageUrl = cleanReferenceUrl(normalizeVideoUrl(data.referenceImageUrl) || referenceImageForRequest);
      const nextDisplayEngine = nextGenerationMode === 'seedance-multimodal-reference'
        ? data.displayEngine || 'Seedance multimodal reference'
        : nextGenerationMode === 'seedance-text-to-video'
          ? data.displayEngine || 'Seedance 2.0 Fast'
          : data.displayEngine || (nextGenerationMode === 'text-to-video-fallback' ? 'text fallback' : 'kling');
      const responseSeedanceReferenceUrls = formatSeedanceReferenceUrls(data.referenceImages);
      const nextAdditionalReferenceImageUrls = selectedIsSeedanceEngine
        ? (responseSeedanceReferenceUrls.length
            ? responseSeedanceReferenceUrls
            : selectedSeedanceReferences.map((reference) => reference.url))
        : formatUrlList(data.additionalReferenceImageUrls).length
          ? formatUrlList(data.additionalReferenceImageUrls)
          : additionalReferenceImageUrls;
      const nextThumbnailUrl = nextReferenceImageUrl || nextVideoUrl;
      const nextWarnings = Array.from(new Set([
        ...formatWarnings(data.warnings),
        ...(data.referenceImageNote ? [data.referenceImageNote] : []),
        ...(selectedIsSeedanceEngine && selectedSeedanceReferences.length === 1
          ? ['Only one image is uploaded. Add side, full-body, expression, or outfit references for stronger Seedance identity consistency.']
          : []),
      ]));

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('No usable video URL was returned from the generator.');
        finishGenerationProgress('failed');
        showToast({ type: 'error', message: 'Generation failed. No video URL was returned.' });
        return;
      }

      const nextFinalPrompt = data.finalPrompt || currentPrompt;
      let studioSaveStatus = 'Video generated and saved to Studio.';
      setGeneratedVideoUrl(nextVideoUrl);
      setFinalGeneratedPrompt(nextFinalPrompt);
      setGeneratedModel(data.model || '');
      setGeneratedDisplayEngine(nextDisplayEngine);
      setGeneratedReferenceImageUrl(nextReferenceImageUrl);
      setGeneratedMode(nextGenerationMode);
      setGenerationWarnings(nextWarnings);

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
        finalPrompt: nextFinalPrompt,
        model: data.model || null,
        displayEngine: nextDisplayEngine,
        referenceImageUrl: nextReferenceImageUrl,
        referenceImages: selectedIsSeedanceEngine
          ? selectedSeedanceReferences
          : null,
        referenceImageCount: selectedIsSeedanceEngine
          ? selectedSeedanceReferences.length
          : null,
        multimodalReferenceMode: selectedIsSeedanceEngine
          ? selectedSeedanceReferences.length > 1
          : null,
        message: nextGenerationMode === 'seedance-multimodal-reference'
          ? 'Seedance multimodal reference render created.'
          : nextGenerationMode === 'seedance-text-to-video'
          ? 'Seedance 2.0 Fast video render created.'
          : nextGenerationMode === 'text-to-video-fallback'
          ? 'Text-only fallback render created. Likeness is not guaranteed.'
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
          aspectRatio: nextAspectRatio,
          model: data.model || null,
          displayEngine: nextDisplayEngine,
          generationMode: nextGenerationMode,
          identityId: identityProfile?.identityId ?? null,
          identityPrompt: identityProfile?.identityPrompt ?? null,
          consistencyPrompt: identityProfile?.generationConsistencyPrompt ?? null,
          canonicalReferenceSet: identityProfile?.canonicalReferenceSet ?? null,
          keyframeUrl: null,
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
            console.info('ACCOUNT PROJECT SAVE SESSION CONTEXT:', {
              authUserId: authUser.id,
              sessionUserId: session?.user?.id ?? null,
              sessionMatchesAuthUser: session?.user?.id === authUser.id,
              hasSession: Boolean(session),
              supabaseConfigured: configured,
            });
            const savedProject = await saveSupabaseProject(authUser.id, studioProject);
            console.log('SAVED COMPLETED STUDIO PROJECT:', savedProject);
          } catch (saveError) {
            console.error('ACCOUNT PROJECT SAVE FAILED EXACT ERROR:', {
              authUserId: authUser.id,
              sessionUserId: session?.user?.id ?? null,
              sessionMatchesAuthUser: session?.user?.id === authUser.id,
              supabaseConfigured: configured,
              projectId: studioProject.id,
              projectStatus: studioProject.status,
              provider: studioProject.provider,
              engine: studioProject.engine,
              saveError,
            });
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

      finishGenerationProgress('completed');
      setStatus(studioSaveStatus);
      showToast({ type: 'success', message: 'Generation completed and saved to Studio.' });
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
      finishGenerationProgress('failed');
      showToast({ type: 'error', message: 'Generation failed. You can retry when ready.' });
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
            displayEngine: engine === SEEDANCE_ENGINE_ID
              ? 'Seedance Fast'
              : engine === SEEDANCE_QUALITY_ENGINE_ID
                ? 'Seedance Quality'
                : engine === 'replicate'
                  ? 'kling'
                  : engineLabels[engine] ?? engine,
            characterId,
            characterName,
            characterAvatar,
            isDefaultSelfCharacter,
            generationMode: selectedGenerationMode,
            referenceImageUrl: selectedSelfReferenceImageUrl,
            referenceImageUrls: referencePayload,
            referenceImages: isSeedanceEngine ? seedanceReferenceImages : undefined,
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
      {toast ? (
        <div className={`toast-notice ${toast.type}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
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

        <div className="field-block">
          <span>Provider</span>
          <div className="provider-grid" role="radiogroup" aria-label="Generation provider">
            {providerOptions.map((option) => (
              <button
                key={option.engine}
                type="button"
                role="radio"
                aria-checked={engine === option.engine}
                className={`provider-option ${engine === option.engine ? 'active' : ''}`}
                onClick={() => setEngine(option.engine)}
              >
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="provider-meta">
                  <span>Speed {option.speed}</span>
                  <span>Quality {option.quality}</span>
                </span>
              </button>
            ))}
          </div>
          <small className="muted">{engineRoutingMessage}</small>
        </div>

        <div className="reference-mode-card">
          <div className="reference-mode-copy">
            <span className="eyebrow">
              {isSeedanceEngine
                ? 'Seedance 2.0'
                : engine === 'replicate' && selfReferenceMode
                  ? 'Lumora Identity Character'
                : referenceLoading
                  ? 'Checking self reference'
                : isTextFallbackMode
                    ? 'Reference required'
                    : 'Image-to-video'}
            </span>
            <strong>
              {isSeedanceEngine
                ? 'Generate a new Seedance scene from all reference images'
                : engine === 'replicate' && selfReferenceMode
                  ? 'Generate new scenes from your reusable identity'
                : engine === 'veo'
                  ? 'Generate through the Veo placeholder path'
                : engine === 'mock'
                  ? 'Preview instantly with demo output'
                : referenceLoading
                  ? 'Looking for saved self-character photos'
                : isTextFallbackMode
                  ? 'Save a reference image first'
                  : 'Using a reference image'}
            </strong>
            <span className="muted">
              {referenceLoading
                ? 'Lumora is checking front, full-body, angle, avatar, and media URL fields.'
                : isSeedanceEngine
                ? 'Seedance receives every saved reference as identity guidance and does not force any image as the first frame.'
                : engine === 'veo'
                ? 'Veo Experimental currently fails over safely when production credentials are not available.'
                : engine === 'mock'
                ? 'Demo Mode returns a known video so you can test Studio save and playback.'
                : selfReferenceMode
                ? primaryReferenceImage.url
                  ? 'Build a reusable photorealistic character from your reference photos and videos.'
                  : 'Lumora Identity Character references will be sent when available.'
                : isTextFallbackMode
                  ? 'Create needs a public saved reference image for the current generation path.'
                  : 'Kling will condition the video on the selected image.'}
            </span>
            {seedanceMultimodalActive ? (
              <span className="tiny-pill multimodal-reference-badge">Multimodal Reference Mode</span>
            ) : null}
            {seedanceSingleReferenceWarning ? (
              <span className="seedance-reference-warning">
                Only one image uploaded. Add side, full-body, expression, or outfit references for stronger identity consistency.
              </span>
            ) : null}
            {isSeedanceEngine && seedanceReferenceCount > 0 ? (
              <div className="seedance-reference-list" aria-label="Seedance references">
                {seedanceReferenceImages.map((reference) => (
                  <span key={`${reference.token}-${reference.url}`}>
                    {reference.token} {reference.label || 'Reference image'}
                  </span>
                ))}
              </div>
            ) : null}
            {selfReferenceMode && engine === 'replicate' ? (
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                <span className="tiny-pill" style={{ width: 'fit-content' }}>{identityStatusLabel}</span>
                <span className="muted">
                  Lumora will use your feedback to improve future prompts and character consistency.
                </span>
              </div>
            ) : null}
            {selfReferenceMode && engine === 'replicate' && onResaveReferencePhoto ? (
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
                required={engine === 'replicate' && selfReferenceMode}
              />
            </div>
          ) : null}
          {primaryReferenceImage.label || selfReferenceMode || isSeedanceEngine ? (
            <span className="tiny-pill reference-mode-pill">
              {isSeedanceEngine
                ? `${seedanceReferenceCount} Seedance reference${seedanceReferenceCount === 1 ? '' : 's'}`
                : referenceLabel || primaryReferenceImage.label || 'Saved self character'}
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

        {selfReferenceMode && engine === 'replicate' && isHydrated ? (
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
                : !hasPrompt
                  ? 'Add prompt before generating'
                : !canGenerate
                  ? 'Add reference before generating'
                : isSeedanceEngine
                  ? `Generate with ${selectedProviderOption.label}`
                : engine === 'mock'
                  ? 'Generate demo preview'
                : engine === 'veo'
                  ? 'Generate with Veo Experimental'
                  : engine === 'replicate' && selfReferenceMode
                    ? 'Generate new scene with my Lumora character'
                  : 'Generate video'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
            Save draft
          </button>
        </div>
        {generationStatusState !== 'idle' ? (
          <div className="generation-progress" aria-live="polite">
            {(['queued', 'processing', 'completed', 'failed'] as const).map((phase) => (
              <span key={phase} className={generationStatusState === phase ? 'active' : ''}>
                {phase}
              </span>
            ))}
          </div>
        ) : null}
        {generationLoading ? <p className="muted">Rendering your concept...</p> : null}
        {generationError ? (
          <div className="generation-error-card">
            <p>{generationError}</p>
            <button type="button" className="ghost-btn" onClick={handleGenerate} disabled={generateBusy}>
              Retry generation
            </button>
          </div>
        ) : null}
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
          {generatedMode === 'seedance-multimodal-reference' ? (
            <div className="reference-result-row">
              <span className="tiny-pill multimodal-reference-badge">Multimodal Reference Mode</span>
              <span className="muted">
                Seedance used {generationResult.referenceImageCount ?? seedanceReferenceCount} identity references for a fresh cinematic scene.
              </span>
            </div>
          ) : null}
          {generatedReferenceThumbnailUrl && generatedMode !== 'seedance-multimodal-reference' ? (
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
