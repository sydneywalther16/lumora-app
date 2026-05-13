import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiRequestError,
  continuityMemoryFields,
  type ApiHealthDiagnostics,
  type CreativeBrainScenePlan,
  type ContinuityMemoryField,
  type ContinuityMemoryLocks,
  type ContinuityMemoryRecord,
  type ContinuityMemoryState,
  type CharacterProfile,
  type GenerationMode,
  type LumoraIdentityFeedback,
  type LumoraIdentityFeedbackChoice,
  type LumoraIdentityProfile,
  type GenerationResponse,
  type ReferenceImageUrls,
  type SceneExecutorResult,
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
  characterProfile?: CharacterProfile | null;
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

const continuityMemoryLabels: Record<ContinuityMemoryField, string> = {
  characterAppearance: 'Character appearance',
  wardrobe: 'Wardrobe',
  hairstyle: 'Hairstyle',
  emotionalTone: 'Emotional tone',
  environment: 'Environment',
  props: 'Props',
  weather: 'Weather',
  timeOfDay: 'Time of day',
  soundtrackMood: 'Soundtrack mood',
  cameraStyle: 'Camera style',
  previousSceneSummary: 'Previous scene',
};

const emptyContinuityMemoryState: ContinuityMemoryState = {
  characterAppearance: '',
  wardrobe: '',
  hairstyle: '',
  emotionalTone: '',
  environment: '',
  props: '',
  weather: '',
  timeOfDay: '',
  soundtrackMood: '',
  cameraStyle: '',
  previousSceneSummary: '',
};

function normalizeContinuityMemoryState(value?: Partial<ContinuityMemoryState> | null): ContinuityMemoryState {
  return continuityMemoryFields.reduce<ContinuityMemoryState>((state, field) => {
    state[field] = typeof value?.[field] === 'string' ? value[field].trim() : '';
    return state;
  }, { ...emptyContinuityMemoryState });
}

function continuityMemoryChanged(
  left: ContinuityMemoryState,
  right: ContinuityMemoryState,
  leftLocks: ContinuityMemoryLocks,
  rightLocks: ContinuityMemoryLocks,
) {
  return continuityMemoryFields.some((field) => (
    left[field] !== right[field] ||
    Boolean(leftLocks[field]) !== Boolean(rightLocks[field])
  ));
}

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
  moderation?: unknown;
  suggestedPrompt?: unknown;
  sanitizedPrompt?: unknown;
  moderationDiagnostics?: unknown;
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
const providerModerationMessage =
  'Seedance moderation paused this render. Lumora retried with a safer cinematic rewrite, but the provider still blocked it.';
const providerQueueBusyMessage = 'Provider queue is busy. Retrying generation...';
const replicateThrottledMessage =
  'Replicate is temporarily throttling this account. Wait a minute and try again.';

function isProviderSafetyFilterError(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('provider safety filter') ||
    lower.includes('generation blocked by provider safety filter') ||
    lower.includes('flagged as sensitive') ||
    lower.includes('e005') ||
    lower.includes('moderation')
  );
}

function isProviderModerationPayload(value: unknown): value is {
  moderation?: boolean;
  suggestedPrompt?: string;
  sanitizedPrompt?: string;
  suggestion?: string;
  moderationDiagnostics?: unknown;
} {
  return Boolean(value) && typeof value === 'object' && Boolean((value as { moderation?: unknown }).moderation);
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

function formatCreativePlan(plan: CreativeBrainScenePlan) {
  return JSON.stringify(plan, null, 2);
}

function parseCreativePlanDraft(value: string): CreativeBrainScenePlan | null {
  try {
    const parsed = JSON.parse(value) as CreativeBrainScenePlan;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.cinematicTone === 'string' &&
      Array.isArray(parsed.shotList)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

const characterProfilesMigrationWarning = 'Character Profiles need the latest database migration.';

function characterProfileSchemaWarning(diagnostics: ApiHealthDiagnostics) {
  const missingCharacterId = diagnostics.database?.schemaChecks?.some((check) => (
    check.name === 'column.generation_jobs.character_id' && !check.ok
  ));

  return missingCharacterId ? characterProfilesMigrationWarning : '';
}

function friendlyCharacterProfileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('generation_jobs') &&
    (lower.includes('character_id') || lower.includes('character profiles'))
  ) {
    return characterProfilesMigrationWarning;
  }

  return message;
}

export default function CreateVideo({
  refreshKey = 0,
  characterId,
  characterName,
  characterAvatar,
  isDefaultSelfCharacter,
  characterDescription,
  characterProfile,
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
  const [generationSafeRewrite, setGenerationSafeRewrite] = useState('');
  const [generationModerationDetail, setGenerationModerationDetail] = useState('');
  const [creativePlanLoading, setCreativePlanLoading] = useState(false);
  const [creativePlanError, setCreativePlanError] = useState('');
  const [creativePlanStatus, setCreativePlanStatus] = useState('');
  const [creativePlan, setCreativePlan] = useState<CreativeBrainScenePlan | null>(null);
  const [creativePlanDraft, setCreativePlanDraft] = useState('');
  const [continuityMemory, setContinuityMemory] = useState<ContinuityMemoryRecord | null>(null);
  const [continuityMemoryDraft, setContinuityMemoryDraft] = useState<ContinuityMemoryState>(emptyContinuityMemoryState);
  const [continuityMemoryLocks, setContinuityMemoryLocks] = useState<ContinuityMemoryLocks>({});
  const [continuityMemoryLoading, setContinuityMemoryLoading] = useState(false);
  const [continuityMemorySaving, setContinuityMemorySaving] = useState(false);
  const [continuityMemoryStatus, setContinuityMemoryStatus] = useState('');
  const [continuityMemoryError, setContinuityMemoryError] = useState('');
  const [sceneExecutionLoading, setSceneExecutionLoading] = useState(false);
  const [sceneExecutionError, setSceneExecutionError] = useState('');
  const [sceneExecutionStatus, setSceneExecutionStatus] = useState('');
  const [sceneExecutionPlan, setSceneExecutionPlan] = useState<CreativeBrainScenePlan | null>(null);
  const [sceneExecutionResult, setSceneExecutionResult] = useState<SceneExecutorResult | null>(null);
  const [schemaWarning, setSchemaWarning] = useState('');
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
  const sceneExecutorUserId = authUser?.id ?? identityProfile?.userId ?? null;
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
  const sceneExecuteDisabledReason = !creativePlan
    ? 'Build a Creative Brain plan first'
    : !sceneExecutorUserId
      ? 'Sign in to save clip jobs'
      : !isSeedanceEngine
        ? 'Select Seedance Fast or Seedance Quality'
        : sceneExecutionLoading
          ? 'Rendering shot clips...'
          : '';
  const sceneExecuteBusy = Boolean(sceneExecuteDisabledReason) || generationLoading || busy;
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
  const continuityMemoryDirty = continuityMemory
    ? continuityMemoryChanged(
        continuityMemoryDraft,
        continuityMemory.state,
        continuityMemoryLocks,
        continuityMemory.lockedFields,
      )
    : continuityMemoryFields.some((field) => continuityMemoryDraft[field].trim()) ||
      continuityMemoryFields.some((field) => Boolean(continuityMemoryLocks[field]));
  const continuityConfidencePercent = Math.round((continuityMemory?.continuityConfidence ?? 0.5) * 100);
  const recentDriftAlerts = continuityMemory?.driftAlerts.slice(0, 3) ?? [];
  const recentSceneMemorySummaries = continuityMemory?.sceneMemorySummaries.slice(0, 3) ?? [];

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
    let active = true;

    api.healthDiagnostics()
      .then((diagnostics) => {
        if (active) setSchemaWarning(characterProfileSchemaWarning(diagnostics));
      })
      .catch(() => {
        if (active) setSchemaWarning('');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sceneExecutorUserId) {
      setContinuityMemory(null);
      setContinuityMemoryDraft(emptyContinuityMemoryState);
      setContinuityMemoryLocks({});
      setContinuityMemoryStatus('');
      setContinuityMemoryError('');
      return;
    }

    let active = true;
    setContinuityMemoryLoading(true);
    setContinuityMemoryError('');

    api.getContinuityMemory({
      userId: sceneExecutorUserId,
      characterId,
    }).then(({ memory }) => {
      if (!active) return;
      setContinuityMemory(memory);
      setContinuityMemoryDraft(normalizeContinuityMemoryState(memory.state));
      setContinuityMemoryLocks(memory.lockedFields);
      setContinuityMemoryStatus(memory.id ? 'Continuity memory loaded.' : 'Continuity memory ready.');
    }).catch((error) => {
      if (!active) return;
      setContinuityMemory(null);
      setContinuityMemoryDraft(emptyContinuityMemoryState);
      setContinuityMemoryLocks({});
      setContinuityMemoryError(error instanceof Error ? error.message : 'Continuity Memory could not load.');
      setContinuityMemoryStatus('');
    }).finally(() => {
      if (active) setContinuityMemoryLoading(false);
    });

    return () => {
      active = false;
    };
  }, [sceneExecutorUserId, characterId]);

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

  function handleContinuityMemoryFieldChange(field: ContinuityMemoryField, value: string) {
    setContinuityMemoryDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setContinuityMemoryStatus('Continuity memory edited.');
    setContinuityMemoryError('');
  }

  function handleContinuityMemoryLockChange(field: ContinuityMemoryField, locked: boolean) {
    setContinuityMemoryLocks((current) => ({
      ...current,
      [field]: locked,
    }));
    setContinuityMemoryStatus(locked ? `${continuityMemoryLabels[field]} locked.` : `${continuityMemoryLabels[field]} unlocked.`);
    setContinuityMemoryError('');
  }

  async function saveContinuityMemory(options: { silent?: boolean } = {}) {
    if (!sceneExecutorUserId) {
      if (!options.silent) setContinuityMemoryError('Sign in before saving continuity memory.');
      return null;
    }

    setContinuityMemorySaving(true);
    if (!options.silent) {
      setContinuityMemoryStatus('Saving continuity memory...');
      setContinuityMemoryError('');
    }

    try {
      const { memory } = await api.updateContinuityMemory({
        userId: sceneExecutorUserId,
        characterId,
        state: continuityMemoryDraft,
        lockedFields: continuityMemoryLocks,
      });
      setContinuityMemory(memory);
      setContinuityMemoryDraft(normalizeContinuityMemoryState(memory.state));
      setContinuityMemoryLocks(memory.lockedFields);
      if (!options.silent) {
        setContinuityMemoryStatus('Continuity memory saved.');
        showToast({ type: 'success', message: 'Continuity memory saved.' });
      }
      return memory;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Continuity Memory could not save.';
      setContinuityMemoryError(message);
      if (!options.silent) showToast({ type: 'error', message });
      return null;
    } finally {
      setContinuityMemorySaving(false);
    }
  }

  async function handleBuildCreativePlan() {
    if (!activePrompt.trim()) {
      setCreativePlanError('Add a prompt before asking Creative Brain for a plan.');
      return;
    }

    setCreativePlanLoading(true);
    setCreativePlanError('');
    setCreativePlanStatus('Creative Brain is planning the scene...');

    try {
      const styleTheme = selectedStylePrompt(selectedStyles, activePrompt);
      const response = await api.createCreativeBrainPlan({
        prompt: activePrompt,
        userId: sceneExecutorUserId,
        characterId,
        styleTheme: styleTheme || null,
        characterMetadata: {
          characterId,
          characterName,
          characterProfile: characterProfile ? {
            id: characterProfile.id,
            characterId: characterProfile.characterId ?? characterProfile.id,
            displayName: characterProfile.displayName ?? characterProfile.name,
            appearanceSummary: characterProfile.appearanceSummary ?? characterDescription ?? '',
            wardrobeTendencies: characterProfile.wardrobeTendencies ?? '',
            emotionalTendencies: characterProfile.emotionalTendencies ?? '',
            soundtrackTendencies: characterProfile.soundtrackTendencies ?? '',
            cinematicStyle: characterProfile.cinematicStyle ?? '',
            continuityState: characterProfile.continuityState ?? {},
            relationshipMemory: characterProfile.relationshipMemory ?? {},
            memorySnapshots: characterProfile.memorySnapshots ?? [],
            appearanceDrift: characterProfile.appearanceDrift ?? [],
          } : null,
          isDefaultSelfCharacter,
          characterDescription,
          identityStatus: identityStatusLabel,
          identityAppearanceSummary: identityProfile?.appearanceSummary ?? null,
          continuityMemory: continuityMemoryDraft,
          continuityLocks: continuityMemoryLocks,
          continuityConfidence: continuityMemory?.continuityConfidence ?? null,
          referenceImageCount: seedanceReferenceCount,
          references: seedanceReferenceImages.map((reference) => ({
            token: reference.token,
            label: reference.label,
            role: reference.role,
          })),
        },
      });

      setCreativePlan(response.plan);
      setCreativePlanDraft(formatCreativePlan(response.plan));
      setSceneExecutionResult(null);
      setSceneExecutionPlan(null);
      setSceneExecutionError('');
      setCreativePlanStatus(`Creative Brain plan ready (${response.provider}, ${response.model}). Review or edit before rendering.`);
    } catch (error) {
      setCreativePlanError(error instanceof Error ? friendlyCharacterProfileError(error) : 'Creative Brain could not create a scene plan.');
      setCreativePlanStatus('');
    } finally {
      setCreativePlanLoading(false);
    }
  }

  function handleCreativePlanDraftChange(value: string) {
    setCreativePlanDraft(value);
    const nextPlan = parseCreativePlanDraft(value);
    if (nextPlan) {
      setCreativePlan(nextPlan);
      setCreativePlanError('');
      setCreativePlanStatus('Creative Brain plan edited.');
      setSceneExecutionResult(null);
      setSceneExecutionPlan(null);
      setSceneExecutionError('');
    } else {
      setCreativePlanError('Scene plan JSON is editable, but it needs valid JSON before Lumora can treat it as the active plan.');
    }
  }

  async function handleExecuteScenePlan() {
    if (sceneExecutionLoading) return;

    const activePlan = parseCreativePlanDraft(creativePlanDraft) ?? creativePlan;
    if (!activePlan) {
      setSceneExecutionError('Build or fix a Creative Brain plan before rendering shot clips.');
      return;
    }

    if (!sceneExecutorUserId) {
      setSceneExecutionError('Sign in before rendering a storyboard so Lumora can save each clip job.');
      return;
    }

    if (!isSeedanceEngine) {
      setSceneExecutionError('Scene Executor renders Seedance clips. Select Seedance Fast or Seedance Quality first.');
      return;
    }

    if (continuityMemoryDirty) {
      const savedMemory = await saveContinuityMemory({ silent: true });
      if (!savedMemory) {
        setSceneExecutionError('Save continuity memory before rendering storyboard clips.');
        return;
      }
    }

    setSceneExecutionLoading(true);
    setSceneExecutionError('');
    setSceneExecutionStatus('Scene Executor queued each storyboard shot and is rendering clips sequentially...');
    setSceneExecutionPlan(activePlan);
    setSceneExecutionResult(null);

    try {
      const result = await api.executeScenePlan({
        scenePlan: activePlan,
        userId: sceneExecutorUserId,
        characterId,
        referenceImages: seedanceReferenceImages,
        quality: engine === SEEDANCE_QUALITY_ENGINE_ID ? 'quality' : 'fast',
        privacy: 'private',
        characterMetadata: {
          characterId,
          characterName,
          characterProfile: characterProfile ? {
            id: characterProfile.id,
            characterId: characterProfile.characterId ?? characterProfile.id,
            displayName: characterProfile.displayName ?? characterProfile.name,
            appearanceSummary: characterProfile.appearanceSummary ?? characterDescription ?? '',
            wardrobeTendencies: characterProfile.wardrobeTendencies ?? '',
            emotionalTendencies: characterProfile.emotionalTendencies ?? '',
            soundtrackTendencies: characterProfile.soundtrackTendencies ?? '',
            cinematicStyle: characterProfile.cinematicStyle ?? '',
            continuityState: characterProfile.continuityState ?? {},
            relationshipMemory: characterProfile.relationshipMemory ?? {},
            memorySnapshots: characterProfile.memorySnapshots ?? [],
            appearanceDrift: characterProfile.appearanceDrift ?? [],
          } : null,
          isDefaultSelfCharacter,
          characterDescription,
          styleTheme: selectedStylePrompt(selectedStyles, activePrompt) || null,
          identityStatus: identityStatusLabel,
          identityAppearanceSummary: identityProfile?.appearanceSummary ?? null,
          continuityMemory: continuityMemoryDraft,
          continuityLocks: continuityMemoryLocks,
          continuityConfidence: continuityMemory?.continuityConfidence ?? null,
          referenceImageCount: seedanceReferenceCount,
          references: seedanceReferenceImages.map((reference) => ({
            token: reference.token,
            label: reference.label,
            role: reference.role,
          })),
        },
      });

      setSceneExecutionResult(result);
      if (result.continuityMemory) {
        setContinuityMemory(result.continuityMemory);
        setContinuityMemoryDraft(normalizeContinuityMemoryState(result.continuityMemory.state));
        setContinuityMemoryLocks(result.continuityMemory.lockedFields);
        setContinuityMemoryStatus('Continuity memory updated from completed clips.');
      }
      setSceneExecutionStatus(
        result.status === 'completed'
          ? `Scene Executor completed ${result.clips.length} Seedance clip${result.clips.length === 1 ? '' : 's'}.`
          : 'Scene Executor stopped after a clip failed. Completed clips remain saved in generation jobs.',
      );
      if (result.status === 'completed') {
        showToast({ type: 'success', message: 'Storyboard clips generated and saved.' });
      } else {
        showToast({ type: 'error', message: result.failedClip?.error || 'A storyboard clip failed to render.' });
      }
    } catch (error) {
      const message = error instanceof ApiRequestError || error instanceof Error
        ? friendlyCharacterProfileError(error)
        : 'Scene Executor could not render the storyboard.';
      setSceneExecutionError(message);
      setSceneExecutionStatus('');
      showToast({ type: 'error', message });
    } finally {
      setSceneExecutionLoading(false);
    }
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
    setGenerationSafeRewrite('');
    setGenerationModerationDetail('');
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
          suggestedPrompt: seedanceResult.suggestedPrompt ?? undefined,
          sanitizedPrompt: seedanceResult.sanitizedPrompt ?? undefined,
          moderationDiagnostics: seedanceResult.moderationDiagnostics ?? undefined,
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
      const apiPayload = error instanceof ApiRequestError ? error.payload : null;
      const moderationPayload = isProviderModerationPayload(apiPayload) ? apiPayload : null;
      const suggestedRewrite =
        moderationPayload?.suggestedPrompt ||
        moderationPayload?.sanitizedPrompt ||
        '';
      const displayMessage = moderationPayload
        ? providerModerationMessage
        : isProviderSafetyFilterError(message)
        ? providerSafetyFilterMessage
        : isReplicateThrottledError(message)
          ? replicateThrottledMessage
        : isProviderQueueBusyError(message)
          ? providerQueueBusyMessage
        : message;
      setGenerationSafeRewrite(suggestedRewrite);
      setGenerationModerationDetail(
        moderationPayload?.suggestion ||
        (moderationPayload
          ? 'Lumora preserved your references and prepared a safer cinematic prompt you can try next.'
          : ''),
      );
      setGenerationError(
        isSoraEngine && !isProviderSafetyFilterError(displayMessage) && !moderationPayload
          ? `${displayMessage} Self-character likeness is currently routed through Replicate.`
          : displayMessage,
      );
      finishGenerationProgress('failed');
      showToast({
        type: 'error',
        message: moderationPayload
          ? 'Seedance moderation paused this render. A safer rewrite is ready.'
          : 'Generation failed. You can retry when ready.',
      });
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

        {schemaWarning ? (
          <div className="generation-warning-list" role="status">
            <p>{schemaWarning}</p>
          </div>
        ) : null}

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

        <div className="continuity-memory-panel">
          <div className="row-between">
            <div>
              <span className="eyebrow">Continuity Memory</span>
              <strong>Cinematic state</strong>
            </div>
            <span className="tiny-pill">{continuityConfidencePercent}%</span>
          </div>
          {continuityMemoryLoading ? <p className="muted">Loading continuity memory...</p> : null}
          {continuityMemoryStatus ? <p className="muted">{continuityMemoryStatus}</p> : null}
          {continuityMemoryError ? <p className="creative-plan-error">{continuityMemoryError}</p> : null}
          <div className="continuity-memory-grid">
            {continuityMemoryFields.map((field) => (
              <label key={field} className="continuity-memory-field">
                <span className="continuity-memory-label">
                  <strong>{continuityMemoryLabels[field]}</strong>
                  <span className="continuity-lock-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(continuityMemoryLocks[field])}
                      onChange={(event) => handleContinuityMemoryLockChange(field, event.target.checked)}
                    />
                    Lock
                  </span>
                </span>
                <textarea
                  value={continuityMemoryDraft[field]}
                  onChange={(event) => handleContinuityMemoryFieldChange(field, event.target.value)}
                  rows={field === 'previousSceneSummary' ? 3 : 2}
                />
              </label>
            ))}
          </div>
          {recentDriftAlerts.length ? (
            <div className="continuity-drift-list">
              <span className="eyebrow">Drift</span>
              {recentDriftAlerts.map((alert) => (
                <p key={`${alert.field}-${alert.detectedAt}-${alert.clipOrder}`}>
                  <strong>{continuityMemoryLabels[alert.field]}</strong> {alert.reason}
                </p>
              ))}
            </div>
          ) : null}
          {recentSceneMemorySummaries.length ? (
            <div className="scene-memory-summary-list">
              <span className="eyebrow">Scene Memory</span>
              {recentSceneMemorySummaries.map((summary) => (
                <p key={`${summary.sceneExecutionId}-${summary.sceneId}-${summary.clipOrder}`}>
                  <strong>{summary.title}</strong> {summary.summary}
                </p>
              ))}
            </div>
          ) : null}
          <div className="scene-executor-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void saveContinuityMemory()}
              disabled={!sceneExecutorUserId || continuityMemorySaving || !continuityMemoryDirty}
            >
              {continuityMemorySaving ? 'Saving...' : continuityMemoryDirty ? 'Save memory' : 'Memory saved'}
            </button>
            <small className="muted">
              {sceneExecutorUserId ? (continuityMemoryDirty ? 'Unsaved changes' : 'Ready') : 'Sign in to persist memory'}
            </small>
          </div>
        </div>

        <div className="creative-brain-panel">
          <div className="row-between">
            <div>
              <span className="eyebrow">Creative Brain Plan</span>
              <strong>Storyboard before rendering</strong>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void handleBuildCreativePlan()}
              disabled={creativePlanLoading || !hasPrompt}
            >
              {creativePlanLoading ? 'Planning...' : creativePlan ? 'Refresh plan' : 'Build plan'}
            </button>
          </div>
          <p className="muted">
            Generate an editable cinematic orchestration plan. This does not start video rendering.
          </p>
          {creativePlanStatus ? <p className="muted">{creativePlanStatus}</p> : null}
          {creativePlanError ? <p className="creative-plan-error">{creativePlanError}</p> : null}
          {creativePlan ? (
            <div className="creative-plan-preview">
              <div className="creative-plan-summary">
                <span><strong>Tone</strong>{creativePlan.cinematicTone}</span>
                <span><strong>Style</strong>{creativePlan.visualStyle}</span>
                <span><strong>Sound</strong>{creativePlan.soundtrackMood}</span>
              </div>
              <p><strong>Environment:</strong> {creativePlan.environmentDescription}</p>
              <p><strong>Pacing:</strong> {creativePlan.emotionalPacing}</p>
              <ol className="creative-shot-list">
                {creativePlan.shotList.map((shot) => (
                  <li key={shot.id}>
                    <strong>{shot.title}</strong>
                    <span>{shot.description}</span>
                    <small>{shot.cameraFraming} / {shot.cameraMovement} / {shot.transition}</small>
                  </li>
                ))}
              </ol>
              <label className="field-block creative-plan-editor">
                <span>Edit scene plan JSON</span>
                <textarea
                  value={creativePlanDraft}
                  onChange={(event) => handleCreativePlanDraftChange(event.target.value)}
                  rows={12}
                />
              </label>
              <div className="scene-executor-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleExecuteScenePlan()}
                  disabled={sceneExecuteBusy}
                  aria-busy={sceneExecutionLoading}
                  title={sceneExecuteDisabledReason || undefined}
                >
                  {sceneExecutionLoading ? 'Rendering shot clips...' : 'Render storyboard clips'}
                </button>
                <small className="muted">
                  {sceneExecuteDisabledReason || 'Creates one Seedance clip per shot, saves clip jobs, and keeps clips separate.'}
                </small>
              </div>
              {sceneExecutionStatus ? <p className="muted">{sceneExecutionStatus}</p> : null}
              {sceneExecutionError ? <p className="creative-plan-error">{sceneExecutionError}</p> : null}
              {sceneExecutionPlan || sceneExecutionResult ? (
                <div className="scene-progress-panel" aria-live="polite">
                  <div className="row-between">
                    <div>
                      <span className="eyebrow">Scene Progress</span>
                      <strong>Sequential clip render</strong>
                    </div>
                    <span className="tiny-pill">
                      {sceneExecutionLoading
                        ? 'Processing'
                        : sceneExecutionResult?.status === 'completed'
                          ? 'Completed'
                          : sceneExecutionResult?.status === 'failed'
                            ? 'Failed'
                            : 'Queued'}
                    </span>
                  </div>
                  <ol className="scene-progress-list">
                    {sceneExecutionResult
                      ? sceneExecutionResult.clips.map((clip) => (
                          <li key={clip.id} className={`scene-progress-item ${clip.status}`}>
                            <span className="scene-progress-index">{clip.clipOrder}</span>
                            <span>
                              <strong>{clip.title}</strong>
                              <small>{clip.metadata.cameraFraming} / {clip.metadata.cameraMovement}</small>
                              {clip.error ? <small className="creative-plan-error">{clip.error}</small> : null}
                            </span>
                            <span className="tiny-pill">{clip.status}</span>
                          </li>
                        ))
                      : sceneExecutionPlan?.shotList.map((shot, index) => (
                          <li
                            key={shot.id}
                            className={`scene-progress-item ${sceneExecutionLoading && index === 0 ? 'processing' : 'queued'}`}
                          >
                            <span className="scene-progress-index">{index + 1}</span>
                            <span>
                              <strong>{shot.title}</strong>
                              <small>{shot.cameraFraming} / {shot.cameraMovement}</small>
                            </span>
                            <span className="tiny-pill">
                              {sceneExecutionLoading && index === 0 ? 'processing' : 'queued'}
                            </span>
                          </li>
                        ))}
                  </ol>
                  {sceneExecutionResult?.clips.some((clip) => Boolean(clip.videoUrl)) ? (
                    <div className="scene-clip-timeline">
                      {sceneExecutionResult.clips
                        .filter((clip) => Boolean(clip.videoUrl))
                        .map((clip) => (
                          <article key={`${clip.id}-video`} className="scene-clip-card">
                            <div className="row-between">
                              <span className="eyebrow">Clip {clip.clipOrder}</span>
                              <span className="tiny-pill">{clip.model || sceneExecutionResult.engine}</span>
                            </div>
                            <strong>{clip.title}</strong>
                            {clip.videoUrl ? (
                              <video src={clip.videoUrl} controls playsInline preload="metadata" />
                            ) : null}
                          </article>
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
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
            {generationModerationDetail ? <p>{generationModerationDetail}</p> : null}
            {generationSafeRewrite ? (
              <div className="safe-rewrite-card">
                <span className="eyebrow">safe cinematic rewrite</span>
                <p>{generationSafeRewrite}</p>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setActivePrompt(generationSafeRewrite);
                    setGenerationError('');
                    setGenerationModerationDetail('');
                    setGenerationSafeRewrite('');
                    setStatus('Safe rewrite loaded. References are unchanged.');
                  }}
                >
                  Use safe rewrite
                </button>
              </div>
            ) : null}
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
