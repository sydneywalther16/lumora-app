import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiRequestError,
  fetchApiResponse,
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
  type ProviderModerationDiagnostics,
  type ProviderFallbackDiagnostics,
  type ReferenceImageUrls,
  type RenderSuccessMode,
  type SceneExecutorResult,
  type SceneOptimizationDiagnostics,
  type SelfLikenessIntensity,
  type SeedanceInputMode,
  type SeedanceReferenceImage,
  type VideoAspectRatio,
  type VideoEngine,
} from '../lib/api';
import { updateLocalCharacterProfile } from '../lib/characterStorage';
import { saveStudioProject, type StudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import {
  loadSupabaseProfile,
  saveSupabaseProject,
  updateSupabaseCharacterReferenceImageUrls,
  updateSupabaseCharacterProfile,
  uploadLumoraMedia,
} from '../lib/supabaseAppData';
import { resolveRenderableReferenceUrl } from '../lib/selfCharacterReference';
import {
  buildSeedanceReferenceImages,
  SEEDANCE_ENGINE_ID,
  SEEDANCE_QUALITY_ENGINE_ID,
} from '../lib/providers/seedance';
import { resolveGeneratedVideoMedia } from '../lib/mediaThumbnail';
import { useSession } from '../hooks/useSession';
import { useAppStore } from '../store/useAppStore';
import SelfReferencePreview, { normalizeReference } from './SelfReferencePreview';
import GeneratedVideoPreview from './GeneratedVideoPreview';
import ContentSafetyActions from './ContentSafetyActions';
import { STYLE_PRESETS, selectedStylePrompt } from '../lib/stylePresets';
import { trackCreatorEvent } from '../lib/creatorEvents';
import {
  normalizeReferenceRepairIssue,
  filterObsoleteSeedanceReferences,
  isReferenceRepairIssueRemovable,
  patchReferenceImageUrls,
  removeReferenceImageUrl,
  referenceSlotForSeedanceReference,
  referenceStatus,
  type ReferenceRepairIssue,
} from '../lib/referenceRepair';
import {
  buildSafeTakePreview,
  buildSafeTakePrompt,
  creatorRenderStateCopy,
  sanitizeCreatorErrorMessage,
  successFirstOverrides,
  ULTRA_SAFE_SCENE_PROMPT,
  type CreatorRenderStatus,
} from '../lib/renderStateCopy';
import {
  getVerifiedVideoOutputUrl,
  normalizeVerifiedVideoOutputUrl,
} from '../lib/renderCompletion';
import { createSelfCharacterStatusCopy, hasEffectiveSelfVerificationVideo } from '../lib/selfCharacterSetup';
import {
  applyViralScenePreset,
  buildPublicCaptionFromPrompt,
  buildAiCastReadiness,
  buildSceneAnchorCreateGuidance,
  buildViralCaptionSuggestions,
  decideAutoStage,
  isSeedanceFirstFrameCanaryEligible,
  isDemoModeEngine,
  looksLikeInternalRenderPrompt,
  polishKlingCinematicPrompt,
  shouldShowCreatePreparingState,
  viralScenePresets,
  type ViralScenePreset,
} from '../lib/aiCastExperience';

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
  onOpenSelfVerificationSetup?: () => void;
  onCharacterUpdated?: (character: CharacterProfile) => void;
};

const durations = [4, 8, 12, 16];
const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const renderPreferenceOptions: Array<{
  value: RenderSuccessMode;
  label: string;
  description: string;
}> = [
  {
    value: 'cinematic_quality',
    label: 'Cinematic Quality',
    description: 'Richer motion and identity detail.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'A calm mix of beauty and reliability.',
  },
  {
    value: 'success_first',
    label: 'Success First',
    description: 'Shorter, gentler scenes with stronger render odds.',
  },
];
const selfLikenessOptions: Array<{
  value: SelfLikenessIntensity;
  label: string;
  description: string;
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Minimal saved-look guidance for the highest render odds.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Short saved-look guidance while keeping the proven text route.',
  },
  {
    value: 'strong',
    label: 'Strong',
    description: 'More textual appearance detail without photo references.',
  },
];
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
    description: 'Safest first real render for creator testing.',
  },
  {
    engine: SEEDANCE_QUALITY_ENGINE_ID,
    label: 'Seedance Quality',
    speed: '~3-6 min',
    quality: 'Higher',
    description: 'Slower polished pass after a draft works.',
  },
  {
    engine: 'veo',
    label: 'Veo Experimental',
    speed: 'Variable',
    quality: 'Experimental',
    description: 'Experimental cinematic video route.',
  },
  {
    engine: 'mock',
    label: 'Demo Mode',
    speed: 'Instant',
    quality: 'Demo',
    description: 'Use Demo Mode to preview without credits.',
  },
  {
    engine: 'replicate',
    label: 'Kling Reference',
    speed: '~1-3 min',
    quality: 'Beta',
    description: 'Experimental exact-likeness testing for your AI Cast.',
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
const apiOfflineVideoEngineMessage =
  'Lumora Stage is temporarily unavailable. Your scene can still be saved as a draft.';
const providerConfigVideoEngineMessage =
  'Real rendering needs the server-side REPLICATE_API_TOKEN setting. Demo Mode and draft saving remain available.';
const identityOnlyKlingFallbackMessage =
  'Using identity-only Kling fallback. This uses your saved identity references without staging a scene anchor.';
const sceneAnchorStartFailureMessage =
  'Scene-anchor mode could not start this render. Try identity-only Kling fallback or save this draft.';
const storyMemoryLocalPreviewMessage =
  'Story Memory sync is not connected in this local preview. You can still draft scenes.';
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
  id?: unknown;
  jobId?: unknown;
  status?: unknown;
  videoUrl?: unknown;
  video?: unknown;
  outputUrl?: unknown;
  thumbnailUrl?: unknown;
  posterUrl?: unknown;
  previewImageUrl?: unknown;
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
  referenceStrategy?: string | null;
  referenceRolesUsed?: unknown;
  referenceCount?: number | null;
  exactLikenessRoute?: string | null;
  exactLikenessAvailable?: boolean | null;
  exactLikenessReason?: string | null;
  exactLikenessProvider?: string | null;
  exactLikenessCanaryStatus?: string | null;
  sceneAnchorStrategy?: string | null;
  sceneAnchorEnabled?: boolean | null;
  sceneAnchorModel?: string | null;
  sceneAnchorGenerated?: boolean | null;
  sceneAnchorPersisted?: boolean | null;
  sceneAnchorProvider?: string | null;
  sceneAnchorReason?: string | null;
  sceneAnchorFailureCategory?: string | null;
  sceneAnchorHttpStatus?: number | null;
  sceneAnchorErrorType?: string | null;
  sceneAnchorErrorMessage?: string | null;
  sceneAnchorErrorMessageRedacted?: string | null;
  sceneAnchorErrorBodyRedacted?: string | null;
  assetPersistErrorType?: string | null;
  assetPersistErrorMessageRedacted?: string | null;
  createRuntimeSceneAnchorConfigured?: boolean | null;
  sceneAnchorPromptLength?: number | null;
  sceneAnchorPromptLimit?: number | null;
  sceneAnchorPromptCompressed?: boolean | null;
  sceneAnchorPromptTruncated?: boolean | null;
  sceneAnchorPayloadFieldNames?: string[] | null;
  sceneAnchorReferenceCount?: number | null;
  sceneAnchorSubmittedReferenceCount?: number | null;
  sceneAnchorReferenceRolesUsed?: string[] | null;
  sceneAnchorDroppedReferenceRoles?: string[] | null;
  sceneAnchorProviderReferenceLimit?: number | null;
  sceneAnchorOutputParsed?: boolean | null;
  sceneAnchorValidation?: Record<string, unknown> | null;
  primaryInputType?: string | null;
  primaryVideoInputType?: string | null;
  primaryVideoInputSource?: string | null;
  identityReferencesPassedToVideoStage?: boolean | null;
  identityReferenceCount?: number | null;
  identityReferenceMode?: string | null;
  startFrameSource?: string | null;
  posterFrameSource?: string | null;
  firstFrameSource?: string | null;
  stage2ProviderModel?: string | null;
  stage2ProviderRouteType?: string | null;
  rawReferenceVisualInputsSentToStage2?: boolean | null;
  sceneIntent?: unknown;
  framingIntent?: string | null;
  primaryReferenceRole?: string | null;
  supportingReferenceRoles?: unknown;
  userSpecifiedOutfit?: boolean | null;
  outfitTermsDetected?: unknown;
  environmentTermsDetected?: unknown;
  referenceOutfitCarryoverSuppressed?: boolean | null;
  compositionCarryoverSuppressed?: boolean | null;
  frontOnlyFallback?: boolean | null;
  klingReferenceDiagnostics?: Record<string, unknown> | null;
  multimodalReferenceMode?: unknown;
  promptAdaptationApplied?: boolean | null;
  providerRequestCount?: number | null;
  providerRetryCount?: number | null;
  providerFallbackCount?: number | null;
  inputMode?: SeedanceInputMode | null;
  assetPersistence?: unknown;
  moderation?: unknown;
  suggestedPrompt?: unknown;
  sanitizedPrompt?: unknown;
  moderationDiagnostics?: unknown;
  providerFallbackDiagnostics?: unknown;
  sceneOptimization?: SceneOptimizationDiagnostics | null;
  renderReliability?: {
    complexityScore: number | null;
    referenceQualityScore: number | null;
    successMode: RenderSuccessMode | null;
    referenceStrategy: string | null;
    creatorMessage: string | null;
  } | null;
  warnings?: unknown;
  error?: string;
  errorMessage?: string;
  errorCategory?: string;
  suggestion?: string;
  details?: unknown;
  message?: string;
  progressLabel?: string;
  providerStatus?: string | null;
  providerPredictionId?: string | null;
  providerPredictionUrl?: string | null;
  providerFallbackStage?: string | null;
  renderMode?: string | null;
  duplicateOf?: string | null;
  retryAfterSeconds?: number | null;
  retryAvailableAt?: string | null;
  selfLikenessIntensity?: SelfLikenessIntensity | null;
  textSelfGuidanceAvailable?: boolean | null;
  audioConfigured?: boolean | null;
  viralPresetUsed?: string | null;
  promptPolished?: boolean | null;
  renderFailure?: RenderFailureEnvelope | null;
};

type RenderFailureEnvelope = {
  route?: string | null;
  provider?: string | null;
  stage?: string | null;
  category?: string | null;
  safeTitle?: string | null;
  safeMessage?: string | null;
  recommendedNextAction?: string | null;
  sceneAnchorProvider?: string | null;
  sceneAnchorModel?: string | null;
  sceneAnchorPromptLength?: number | null;
  sceneAnchorPromptLimit?: number | null;
  sceneAnchorPromptCompressed?: boolean | null;
  sceneAnchorPromptTruncated?: boolean | null;
  sceneAnchorPayloadFieldNames?: string[] | null;
  sceneAnchorSubmittedReferenceCount?: number | null;
  sceneAnchorDroppedReferenceRoles?: string[] | null;
  sceneAnchorHttpStatus?: number | null;
  sceneAnchorErrorType?: string | null;
  sceneAnchorErrorMessageRedacted?: string | null;
  sceneAnchorOutputParsed?: boolean | null;
  sceneAnchorPersisted?: boolean | null;
  assetPersistErrorType?: string | null;
  assetPersistErrorMessageRedacted?: string | null;
  missingConfig?: string[] | null;
  stage2ProviderModel?: string | null;
  stage2ProviderRouteType?: string | null;
  stage2HttpStatus?: number | null;
  stage2ErrorMessageRedacted?: string | null;
  privateUrlsRedacted?: boolean | null;
  secretsRedacted?: boolean | null;
};

type GenerationStatusState = 'idle' | 'queued' | 'processing' | 'verifying_output' | 'rate_limited' | 'completed' | 'failed';
type GenerationFailureStatus = Extract<CreatorRenderStatus, 'paused' | 'blocked' | 'failed' | 'timeout' | 'reference_repair'>;
type ToastState = {
  type: 'success' | 'error';
  message: string;
} | null;

const generationStatusLabels: Record<Exclude<GenerationStatusState, 'idle'>, string> = {
  queued: 'Queued',
  processing: 'Rendering',
  verifying_output: 'Verifying',
  rate_limited: 'Cooling down',
  completed: 'Saved',
  failed: 'Paused',
};

const asyncRenderStatuses = new Set(['queued', 'rendering', 'processing', 'paused', 'rate_limited']);

function asyncRenderJobId(data: GenerateVideoApiResponse | GenerationResponse | null | undefined) {
  if (!data) return null;
  const jobId = typeof data.jobId === 'string' ? data.jobId : null;
  const id = typeof data.id === 'string' ? data.id : null;
  return jobId || id;
}

function isAsyncRenderResponse(data: GenerateVideoApiResponse | GenerationResponse | null | undefined) {
  const status = typeof data?.status === 'string' ? data.status : '';
  const outputUrl = getVerifiedVideoOutputUrl(data as Record<string, unknown> | null | undefined);
  return Boolean(asyncRenderJobId(data) && asyncRenderStatuses.has(status) && !outputUrl);
}

function retrySecondsForRender(data: GenerateVideoApiResponse | GenerationResponse | null | undefined) {
  if (!data) return 0;
  if (typeof data.retryAvailableAt === 'string') {
    const seconds = Math.ceil((Date.parse(data.retryAvailableAt) - Date.now()) / 1000);
    return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  }
  return typeof data.retryAfterSeconds === 'number' && Number.isFinite(data.retryAfterSeconds)
    ? Math.max(0, Math.ceil(data.retryAfterSeconds))
    : 0;
}

function retrySecondsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const value = record.retryAfterSeconds ?? record.retry_after_seconds ?? record.retryAfter ?? record.retry_after;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.ceil(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(1, Math.ceil(parsed));
    const secondsMatch = value.match(/(\d+(?:\.\d+)?)\s*s/i);
    if (secondsMatch) return Math.max(1, Math.ceil(Number(secondsMatch[1])));
  }
  return null;
}

function asyncRenderStatusMessage(data: GenerateVideoApiResponse | GenerationResponse) {
  if (data.status === 'rate_limited') {
    const seconds = retrySecondsForRender(data);
    return seconds > 0
      ? `Render queue is cooling down. Lumora will resume automatically in about ${seconds} seconds.`
      : 'Render queue is cooling down. Lumora will resume automatically.';
  }
  const status = typeof data.status === 'string' ? data.status : '';
  const progressLabel = typeof data.progressLabel === 'string' ? data.progressLabel : '';
  const message = typeof data.message === 'string' ? data.message : '';
  const visibleMessage = progressLabel || message;
  if (visibleMessage && !isProviderTechnicalText(visibleMessage)) return visibleMessage;
  if (status === 'queued') return 'Render queued. Lumora is preparing your scene.';
  if (status === 'paused') return 'This scene is saved, but no video has completed yet.';
  if (status === 'verifying_output') return 'Lumora is checking the video output before marking this draft ready.';
  return 'Rendering your cinematic take...';
}

function cooldownBodyCopy(seconds: number) {
  return creatorRenderStateCopy('rate_limited', seconds).body;
}

function renderStateTone(state: GenerationStatusState) {
  if (state === 'idle') return 'idle';
  return creatorRenderStateCopy(state === 'processing' ? 'rendering' : state).tone;
}

function renderStateHeadline(state: GenerationStatusState) {
  if (state === 'idle') return '';
  return creatorRenderStateCopy(state === 'processing' ? 'rendering' : state).title;
}

function renderStateBody(state: GenerationStatusState, cooldownSeconds: number) {
  if (state === 'idle') return '';
  return creatorRenderStateCopy(state === 'processing' ? 'rendering' : state, cooldownSeconds).body;
}

function creatorRenderModeLabel(mode: string) {
  switch (mode) {
    case 'seedance-multimodal-reference':
      return 'Cast reference scene';
    case 'seedance-text-to-video':
      return 'Cinematic text scene';
    case 'seedance-image-to-video-first-frame':
      return 'Seedance Fast — first-frame animation';
    case 'self-reference-video':
      return 'Self reference scene';
    case 'image-to-video':
      return 'Reference-led scene';
    case 'text-to-video-fallback':
      return 'Cinematic text scene';
    case 'kling-exact-likeness-reference':
      return 'Kling Reference Beta scene';
    default:
      return mode.replace(/-/g, ' ');
  }
}

function creatorSceneStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return 'Saved';
    case 'failed':
      return 'Paused';
    case 'processing':
      return 'Rendering';
    case 'verifying_output':
      return 'Verifying';
    case 'queued':
      return 'Queued';
    default:
      return status;
  }
}

const likenessFeedbackOptions: Array<{ value: LumoraIdentityFeedbackChoice; label: string }> = [
  { value: 'looks_like_me', label: 'self guidance feels right' },
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

function localMockQueryEnabled(flag: string) {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const host = window.location.hostname;
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return params.get(flag) === '1' && (import.meta.env.DEV || localHost);
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

function formatStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  'This scene needs a softer cinematic direction before rendering.';
const providerModerationMessage =
  'This scene needs a softer cinematic direction before rendering.';
const providerQueueBusyMessage = 'Render queue is cooling down.';
const replicateThrottledMessage =
  'Render queue is cooling down.';

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

function klingProviderFailureMessage(category: string | null | undefined, fallback: string) {
  if (category === 'kling_provider_safety_filter') {
    return 'Kling Reference Beta paused this render for safety. Save this draft, try Seedance Fast, or test identity-only fallback.';
  }
  if (category === 'kling_input_schema') {
    return 'Kling Reference Beta could not start this render. Save this draft or try Seedance Fast.';
  }
  if (category === 'kling_scene_anchor_unavailable') {
    return 'Kling Reference Beta scene-anchor setup is not connected. Use Seedance Fast, Demo Mode, or identity-only fallback.';
  }
  if (category === 'kling_scene_anchor_generation_failed') {
    return 'Scene-anchor mode could not start this render. Try identity-only fallback or save this draft.';
  }
  if (category === 'scene_anchor_input_schema' || category === 'scene_anchor_model_schema_unmapped') {
    const lower = fallback.toLowerCase();
    if (lower.includes('string_too_long') || lower.includes('body.prompt') || lower.includes('prompt')) {
      return 'Scene-anchor mode could not start from this prompt. Save this draft, simplify the scene, or use Seedance Fast.';
    }
    return 'Scene-anchor mode could not start this render. Try identity-only fallback or save this draft.';
  }
  if (category === 'scene_anchor_output_parse_failed') {
    return 'Scene-anchor mode returned an unreadable result. Save this draft or try identity-only fallback.';
  }
  if (category === 'scene_anchor_provider_moderation_block') {
    return 'Scene-anchor mode paused this image request for safety. Save this draft or try Seedance Fast.';
  }
  if (category === 'scene_anchor_provider_disabled' || category === 'scene_anchor_provider_not_configured' || category === 'scene_anchor_fal_key_missing') {
    return 'Kling Reference Beta scene-anchor setup is not connected. Use Seedance Fast, Demo Mode, or identity-only fallback.';
  }
  if (category === 'scene_anchor_asset_persist' || category === 'scene_anchor_asset_persist_failed') {
    return 'Lumora could not save the scene anchor for Kling. Save this draft or try the identity-only fallback.';
  }
  if (category && category.startsWith('scene_anchor_')) {
    return 'Scene anchor generation failed. Check diagnostics before retrying.';
  }
  if (category === 'kling_provider_unavailable') {
    return 'Kling is temporarily unavailable. Your scene is safe to retry later.';
  }
  if (category === 'kling_billing_required') {
    return 'Kling account access needs attention before Beta renders can run.';
  }
  if (category && category.startsWith('kling_')) {
    return `Kling Reference Beta render paused: ${category.replace(/_/g, ' ')}.`;
  }
  return fallback;
}

function renderFailureTitleForCategory(category: string | null | undefined) {
  if (category === 'scene_anchor_input_schema' || category === 'scene_anchor_model_schema_unmapped') {
    return 'Scene-anchor mode could not start this render.';
  }
  if (category === 'scene_anchor_output_parse_failed' || category === 'scene_anchor_output_missing') {
    return 'Scene-anchor mode returned an unreadable result.';
  }
  if (category === 'scene_anchor_provider_moderation_block') {
    return 'Scene-anchor mode paused this image request.';
  }
  if (category === 'scene_anchor_asset_persist' || category === 'scene_anchor_asset_persist_failed') {
    return 'Scene anchor could not be saved for animation.';
  }
  if (category === 'scene_anchor_asset_download_failed') {
    return 'Scene anchor image could not be downloaded.';
  }
  if (
    category === 'scene_anchor_provider_disabled' ||
    category === 'scene_anchor_provider_not_configured' ||
    category === 'scene_anchor_fal_key_missing'
  ) {
    return 'Kling Reference Beta setup is not connected.';
  }
  if (category === 'kling_scene_anchor_video_input_schema') {
    return 'Scene-anchor mode could not start this render.';
  }
  if (category === 'kling_scene_anchor_video_model_not_found') {
    return 'Kling Reference Beta video route is unavailable.';
  }
  if (category === 'kling_scene_anchor_video_model_not_configured') {
    return 'Kling Reference Beta video setup is not connected.';
  }
  if (category === 'kling_scene_anchor_video_billing_required') {
    return 'Kling account access needs attention.';
  }
  if (category === 'kling_scene_anchor_video_poll_failed') {
    return 'Kling Reference Beta could not finish this render.';
  }
  if (category === 'kling_scene_anchor_video_output_parse_failed') {
    return 'Kling Reference Beta returned an unreadable result.';
  }
  if (category === 'kling_scene_anchor_video_provider_unavailable') {
    return 'Kling Reference Beta is temporarily unavailable.';
  }
  return 'Lumora paused this render.';
}

function renderFailureMessageForCategory(category: string | null | undefined, fallback = '') {
  if (category === 'scene_anchor_asset_persist' || category === 'scene_anchor_asset_persist_failed') {
    const lowerFallback = fallback.toLowerCase();
    if (lowerFallback.includes('supabase') || lowerFallback.includes('create runtime is missing')) {
      return sanitizeCreatorErrorMessage(fallback, 'Lumora paused this render.');
    }
    return 'Lumora could not save the scene anchor for Kling. Save this draft or try the identity-only fallback.';
  }
  if (fallback.trim()) return sanitizeCreatorErrorMessage(fallback, 'Lumora paused this render.');
  if (category === 'scene_anchor_input_schema' || category === 'scene_anchor_model_schema_unmapped') {
    return 'Scene-anchor mode could not start this render. Try identity-only fallback, save this draft, or use Seedance Fast.';
  }
  if (category === 'scene_anchor_output_parse_failed' || category === 'scene_anchor_output_missing') {
    return 'Scene-anchor mode returned an unreadable result. Save this draft or try identity-only fallback.';
  }
  if (category === 'scene_anchor_provider_moderation_block') {
    return 'Scene-anchor mode paused this image request for safety. Save this draft or try Seedance Fast.';
  }
  if (category === 'scene_anchor_asset_download_failed') {
    return 'Scene-anchor mode created a draft image but could not prepare it for animation. Save this draft or try identity-only fallback.';
  }
  if (category === 'kling_scene_anchor_video_input_schema') {
    return sceneAnchorStartFailureMessage;
  }
  return 'Lumora paused this render, but no specific provider category was returned.';
}

function redactDebugText(value: unknown) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:fal|sk|rk)_[A-Za-z0-9._-]{12,}\b/g, '[redacted-key]')
    .trim();
}

function normalizeRenderFailure(value: unknown): RenderFailureEnvelope | null {
  const record = recordValue(value);
  const category = stringFromRecord(record, 'category');
  if (!category) return null;
  return {
    route: stringFromRecord(record, 'route'),
    provider: stringFromRecord(record, 'provider'),
    stage: stringFromRecord(record, 'stage'),
    category,
    safeTitle: stringFromRecord(record, 'safeTitle') || renderFailureTitleForCategory(category),
    safeMessage: renderFailureMessageForCategory(category, stringFromRecord(record, 'safeMessage') || ''),
    recommendedNextAction: stringFromRecord(record, 'recommendedNextAction'),
    sceneAnchorProvider: stringFromRecord(record, 'sceneAnchorProvider'),
    sceneAnchorModel: stringFromRecord(record, 'sceneAnchorModel'),
    sceneAnchorPromptLength: numberFromRecord(record, 'sceneAnchorPromptLength'),
    sceneAnchorPromptLimit: numberFromRecord(record, 'sceneAnchorPromptLimit'),
    sceneAnchorPromptCompressed: booleanFromRecord(record, 'sceneAnchorPromptCompressed'),
    sceneAnchorPromptTruncated: booleanFromRecord(record, 'sceneAnchorPromptTruncated'),
    sceneAnchorPayloadFieldNames: formatStringList(record.sceneAnchorPayloadFieldNames),
    sceneAnchorSubmittedReferenceCount: numberFromRecord(record, 'sceneAnchorSubmittedReferenceCount'),
    sceneAnchorDroppedReferenceRoles: formatStringList(record.sceneAnchorDroppedReferenceRoles),
    sceneAnchorHttpStatus: numberFromRecord(record, 'sceneAnchorHttpStatus'),
    sceneAnchorErrorType: stringFromRecord(record, 'sceneAnchorErrorType'),
    sceneAnchorErrorMessageRedacted: stringFromRecord(record, 'sceneAnchorErrorMessageRedacted'),
    sceneAnchorOutputParsed: booleanFromRecord(record, 'sceneAnchorOutputParsed'),
    sceneAnchorPersisted: booleanFromRecord(record, 'sceneAnchorPersisted'),
    assetPersistErrorType: stringFromRecord(record, 'assetPersistErrorType'),
    assetPersistErrorMessageRedacted: stringFromRecord(record, 'assetPersistErrorMessageRedacted'),
    missingConfig: formatStringList(record.missingConfig),
    stage2ProviderModel: stringFromRecord(record, 'stage2ProviderModel'),
    stage2ProviderRouteType: stringFromRecord(record, 'stage2ProviderRouteType'),
    stage2HttpStatus: numberFromRecord(record, 'stage2HttpStatus'),
    stage2ErrorMessageRedacted: stringFromRecord(record, 'stage2ErrorMessageRedacted'),
    privateUrlsRedacted: booleanFromRecord(record, 'privateUrlsRedacted') ?? true,
    secretsRedacted: booleanFromRecord(record, 'secretsRedacted') ?? true,
  };
}

function renderFailureDebugSummary(failure: RenderFailureEnvelope) {
  const lines = [
    ['stage', failure.stage],
    ['category', failure.category],
    ['route', failure.route],
    ['provider', failure.provider],
    ['sceneAnchorProvider', failure.sceneAnchorProvider],
    ['sceneAnchorModel', failure.sceneAnchorModel],
    ['sceneAnchorPromptLength', failure.sceneAnchorPromptLength],
    ['sceneAnchorPromptLimit', failure.sceneAnchorPromptLimit],
    ['sceneAnchorPromptCompressed', failure.sceneAnchorPromptCompressed],
    ['sceneAnchorPromptTruncated', failure.sceneAnchorPromptTruncated],
    ['sceneAnchorPayloadFieldNames', failure.sceneAnchorPayloadFieldNames?.join(', ')],
    ['sceneAnchorSubmittedReferenceCount', failure.sceneAnchorSubmittedReferenceCount],
    ['sceneAnchorDroppedReferenceRoles', failure.sceneAnchorDroppedReferenceRoles?.join(', ')],
    ['sceneAnchorHttpStatus', failure.sceneAnchorHttpStatus],
    ['sceneAnchorErrorType', failure.sceneAnchorErrorType],
    ['sceneAnchorErrorMessageRedacted', failure.sceneAnchorErrorMessageRedacted],
    ['sceneAnchorOutputParsed', failure.sceneAnchorOutputParsed],
    ['sceneAnchorPersisted', failure.sceneAnchorPersisted],
    ['assetPersistErrorType', failure.assetPersistErrorType],
    ['assetPersistErrorMessageRedacted', failure.assetPersistErrorMessageRedacted],
    ['missingConfig', failure.missingConfig?.join(', ')],
    ['stage2ProviderModel', failure.stage2ProviderModel],
    ['stage2ProviderRouteType', failure.stage2ProviderRouteType],
    ['stage2HttpStatus', failure.stage2HttpStatus],
    ['stage2ErrorMessageRedacted', failure.stage2ErrorMessageRedacted],
    ['recommendedNextAction', failure.recommendedNextAction],
    ['privateUrlsRedacted', true],
    ['secretsRedacted', true],
  ].flatMap(([label, value]) => {
    if (value === null || value === undefined || value === '') return [];
    return [`${label}: ${redactDebugText(value)}`];
  });
  return lines.join('\n');
}

function isClearlySafeKlingPrompt(value: string) {
  return Boolean(value.trim()) && !/\b(nsfw|nude|nudity|erotic|sexual|onlyfans|fetish|lingerie|seductive|provocative|revealing|sheer|see[-\s]?through|cleavage|skimpy)\b/i.test(value);
}

function isKlingComplexityError(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes('too complex') ||
    lower.includes('scene complexity') ||
    lower.includes('prompt is too long') ||
    lower.includes('prompt too long') ||
    lower.includes('too many') ||
    lower.includes('timed out before') ||
    lower.includes('timeout before')
  );
}

function isProviderModerationPayload(value: unknown): value is {
  moderation?: boolean;
  suggestedPrompt?: string;
  sanitizedPrompt?: string;
  suggestion?: string;
  moderationDiagnostics?: unknown;
  providerFallbackDiagnostics?: unknown;
} {
  return Boolean(value) && typeof value === 'object' && Boolean((value as { moderation?: unknown }).moderation);
}

function isProviderModerationDiagnostics(value: unknown): value is ProviderModerationDiagnostics {
  return Boolean(value) && typeof value === 'object' && (
    Array.isArray((value as { retryStages?: unknown }).retryStages) ||
    Array.isArray((value as { orchestrationPath?: unknown }).orchestrationPath) ||
    typeof (value as { rewriteStrategy?: unknown }).rewriteStrategy === 'string'
  );
}

function moderationRetryStageMessages(value: unknown): string[] {
  if (!isProviderModerationDiagnostics(value)) return [];

  const directStages = Array.isArray(value.retryStages)
    ? value.retryStages.filter((stage): stage is string => typeof stage === 'string' && stage.trim().length > 0)
    : [];
  const pathStages = Array.isArray(value.orchestrationPath)
    ? value.orchestrationPath
        .map((step) => step.stageMessage)
        .filter((stage): stage is string => typeof stage === 'string' && stage.trim().length > 0)
    : [];

  return Array.from(new Set([...directStages, ...pathStages].map(creatorModerationStageMessage)));
}

function isProviderFallbackDiagnostics(value: unknown): value is ProviderFallbackDiagnostics {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as { stages?: unknown }).stages);
}

function providerFallbackStageMessages(value: unknown): string[] {
  if (!isProviderFallbackDiagnostics(value)) return [];

  return Array.from(new Set(
    value.stages
      .map((stage) => stage.message)
      .filter((message): message is string => typeof message === 'string' && message.trim().length > 0),
  )).map(creatorFacingStageMessage);
}

function providerFallbackWarningMessages(value: unknown): string[] {
  if (!isProviderFallbackDiagnostics(value)) return [];

  const messages = providerFallbackStageMessages(value).map((stage) => `Creative adaptation: ${stage}`);
  if (value.displayNameMasked) {
    messages.push('Lumora kept the cast name in your world and used saved references for the renderer.');
  }
  if (value.finalProviderStatus === 'succeeded' && value.stages.some((stage) => stage.status === 'blocked')) {
    messages.push('Lumora found a safer cinematic route.');
  }
  if (value.creatorMessage) {
    messages.push(value.creatorMessage);
  }
  if (value.sceneOptimization?.simplified) {
    messages.push('Lumora simplified this scene to help it render smoothly.');
  }
  if (value.renderedWithLighterCastGuidance) {
    messages.push('Rendered with soft self guidance.');
  }

  return Array.from(new Set(messages));
}

function creatorVisibleFinalPrompt(data: GenerateVideoApiResponse, fallbackPrompt: string) {
  if (typeof data.suggestedPrompt === 'string' && data.suggestedPrompt.trim()) {
    const suggested = data.suggestedPrompt.trim();
    if (!looksLikeInternalRenderPrompt(suggested)) return suggested;
  }

  if (typeof data.finalPrompt === 'string' && data.finalPrompt.trim()) {
    const finalPrompt = data.finalPrompt.trim();
    const lower = finalPrompt.toLowerCase();
    const looksProviderInternal = finalPrompt.includes('[Image') ||
      lower.includes('reference_images') ||
      lower.includes('use all provided images') ||
      lower.includes('the cinematic character from [image') ||
      looksLikeInternalRenderPrompt(finalPrompt);
    if (!looksProviderInternal) return finalPrompt;
  }

  return fallbackPrompt;
}

function creatorModerationStageMessage(stage: string): string {
  const lower = stage.toLowerCase();

  if (lower.includes('level 1') || lower.includes('minor') || lower.includes('wording') || lower.includes('rewrite')) {
    return 'Trying safer cinematic wording...';
  }

  if (lower.includes('level 2') || lower.includes('celebrity') || lower.includes('influencer') || lower.includes('public figure')) {
    return 'Removing fame-style framing...';
  }

  if (
    lower.includes('level 3') ||
    lower.includes('cinematic realism') ||
    lower.includes('reduced realism') ||
    lower.includes('downgrade from photorealistic')
  ) {
    return 'Trying cinematic realism...';
  }

  if (lower.includes('level 4') || lower.includes('stylized')) {
    return 'Trying stylized cinematic mode...';
  }

  if (lower.includes('level 5') || lower.includes('painterly') || lower.includes('dreamlike') || lower.includes('animated')) {
    return 'Trying painterly/dreamlike cinematic mode...';
  }

  if (lower.includes('alternate') || lower.includes('provider fallback') || lower.includes('fallback')) {
    return 'Trying another safe creative path...';
  }

  return stage
    .replace(/moderation orchestrator/gi, 'Creative adaptation')
    .replace(/moderation orchestration/gi, 'creative adaptation')
    .replace(/orchestration/gi, 'creative flow')
    .replace(/moderation/gi, 'creative safety');
}

function creatorFacingStageMessage(stage: string): string {
  const mapped = creatorModerationStageMessage(stage);
  const lower = mapped.toLowerCase();

  if (isProviderQueueBusyError(mapped)) return 'Waiting for the render queue...';
  if (isProviderSafetyFilterError(mapped)) return 'Trying a softer cinematic direction...';
  if (
    lower.includes('prediction failed') ||
    lower.includes('async prediction') ||
    lower.includes('modelerror') ||
    lower.includes('model error') ||
    lower.includes('provider') ||
    lower.includes('replicate') ||
    lower.includes('seedance') ||
    lower.includes('stack trace')
  ) {
    return 'Trying another safe creative path...';
  }

  return mapped;
}

function moderationWarningMessages(value: unknown): string[] {
  const stages = moderationRetryStageMessages(value);
  if (!stages.length) return [];

  return stages.map((stage) => `Creative adaptation: ${stage}`);
}

function persistedAssetCount(summary: unknown) {
  if (!summary || typeof summary === 'boolean' || typeof summary !== 'object') return 0;
  const persisted = (summary as { persisted?: unknown }).persisted;
  return typeof persisted === 'number' ? persisted : 0;
}

function assetRepairCopy(issue: ReferenceRepairIssue) {
  if (isReferenceRepairIssueRemovable(issue) && issue.slot === 'manualReferenceImageUrl') {
    return 'This temporary reference is no longer needed. Your saved Lumora references will still be used.';
  }
  if (issue.reason === 'protected_external_url') {
    return 'Some social image links expire or block studio tools. Upload the image directly so Lumora can save it safely.';
  }
  if (issue.reason === 'expired_signed_url') {
    return 'This image link has expired. Upload the image directly so Lumora can save it safely.';
  }
  return 'Upload the image directly so Lumora can save it safely.';
}

function assetRepairTitle(issue: ReferenceRepairIssue) {
  return isReferenceRepairIssueRemovable(issue) && issue.slot === 'manualReferenceImageUrl'
    ? 'This temporary reference is no longer needed'
    : 'This reference image needs to be re-uploaded';
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

function isTimeoutOrStillProcessingText(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborterror') ||
    lower.includes('still rendering') ||
    lower.includes('still processing')
  );
}

function isProviderTechnicalText(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('prediction failed') ||
    lower.includes('async prediction failed') ||
    lower.includes('modelerror') ||
    lower.includes('model error') ||
    lower.includes('provider exception') ||
    lower.includes('provider failed') ||
    lower.includes('provider_error') ||
    lower.includes('replicate') ||
    lower.includes('seedance') ||
    lower.includes('e005') ||
    lower.includes('flagged as sensitive') ||
    lower.includes('stack trace') ||
    lower.includes('traceback') ||
    lower.includes('details:') ||
    lower.includes('prediction_id') ||
    lower.includes('provider_prediction')
  );
}

function collectErrorText(value: unknown): string {
  const fragments: string[] = [];

  const visit = (input: unknown, depth: number) => {
    if (input === null || input === undefined || depth > 3) return;
    if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
      const text = String(input).trim();
      if (text) fragments.push(text);
      return;
    }
    if (input instanceof ApiRequestError) {
      fragments.push(input.message);
      visit(input.payload, depth + 1);
      return;
    }
    if (input instanceof Error) {
      fragments.push(input.message);
      return;
    }
    if (Array.isArray(input)) {
      input.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof input === 'object') {
      const record = input as Record<string, unknown>;
      [
        'error',
        'message',
        'details',
        'detail',
        'suggestion',
        'code',
        'errorMessage',
        'errorCategory',
        'providerMessage',
        'providerStatus',
        'reason',
        'status',
      ].forEach((key) => visit(record[key], depth + 1));
    }
  };

  visit(value, 0);
  return Array.from(new Set(fragments)).join(' ');
}

function generationFailureStatusFor(
  error: unknown,
  options: {
    moderation: boolean;
    referenceRepair: boolean;
  },
): GenerationFailureStatus {
  if (options.referenceRepair) return 'reference_repair';

  const text = collectErrorText(error);
  if (options.moderation || isProviderSafetyFilterError(text)) return 'paused';
  if (isTimeoutOrStillProcessingText(text)) return 'timeout';

  const lower = text.toLowerCase();
  const status = error instanceof ApiRequestError ? error.status : null;
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('not configured') ||
    lower.includes('missing config') ||
    lower.includes('account session') ||
    lower.includes('authentication')
  ) {
    return 'blocked';
  }

  return 'failed';
}

function parseGenerateResponse(text: string): {
  data: GenerateVideoApiResponse;
  parseError: string | null;
} {
  if (!text.trim()) {
    return {
      data: {},
      parseError: 'Lumora did not receive a scene response.',
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

const characterProfilesMigrationWarning = 'Cast needs the latest Lumora update.';

function characterProfileSchemaWarning(diagnostics: ApiHealthDiagnostics) {
  const missingCharacterId = diagnostics.database?.schemaChecks?.some((check) => (
    check.name === 'column.generation_jobs.character_id' && !check.ok
  ));

  return missingCharacterId ? characterProfilesMigrationWarning : '';
}

function hasReadyRealGenerationProvider(diagnostics: ApiHealthDiagnostics | null, engine: VideoEngine) {
  const providers = diagnostics?.generationProviders;
  if (!Array.isArray(providers)) return false;

  const providerIds: Partial<Record<VideoEngine, string[]>> = {
    'seedance-2.0': ['seedance-2.0'],
    'seedance-quality': ['seedance-quality', 'seedance-2.0'],
    replicate: ['kling-reference-beta', 'kling'],
    'sora-2': ['openai-sora'],
    'sora-2-pro': ['openai-sora'],
    veo: ['veo'],
    runway: ['runway'],
    openai: ['openai-sora'],
  };
  const expectedIds = providerIds[engine] ?? [];
  return providers.some((provider) => provider.ready && expectedIds.includes(provider.id));
}

function providerConfigurationMessage(engine: VideoEngine) {
  if (engine === 'seedance-2.0' || engine === 'seedance-quality') {
    return 'Real rendering needs the server-side REPLICATE_API_TOKEN setting. Demo Mode and draft saving remain available.';
  }
  if (engine === 'replicate') {
    return 'Kling rendering needs the server-side KLING_ENABLED, KLING_REFERENCE_MODEL, and FAL_KEY or KLING_API_KEY settings. Demo Mode and draft saving remain available.';
  }
  if (engine === 'sora-2' || engine === 'sora-2-pro' || engine === 'openai') {
    return 'Sora rendering needs the server-side OPENAI_API_KEY and OPENAI_VIDEO_ENABLED settings. Demo Mode and draft saving remain available.';
  }
  if (engine === 'veo') {
    return 'Veo rendering needs its server-side Google provider credential. Demo Mode and draft saving remain available.';
  }
  if (engine === 'runway') {
    return 'Runway rendering needs its server-side provider credential. Demo Mode and draft saving remain available.';
  }
  return providerConfigVideoEngineMessage;
}

function creatorStoryMemoryErrorMessage(error: unknown, fallback = 'Story Memory could not sync. You can still draft scenes.') {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('database is not configured') ||
    lower.includes('database_url') ||
    lower.includes('database-backed routes')
  ) {
    return storyMemoryLocalPreviewMessage;
  }

  return sanitizeCreatorErrorMessage(raw, fallback);
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

function creatorFacingErrorMessage(value: unknown, fallback = 'Lumora safely paused this scene.'): string {
  const raw = collectErrorText(value) || (value instanceof Error ? value.message : String(value ?? ''));
  const lower = raw.toLowerCase();

  if (
    lower.includes('generation_jobs') &&
    (lower.includes('character_id') || lower.includes('character profiles'))
  ) {
    return characterProfilesMigrationWarning;
  }
  if (lower.includes('reference') && (lower.includes('re-upload') || lower.includes('protected') || lower.includes('expired'))) {
    return 'One reference needs to be re-uploaded before Lumora can use it.';
  }
  if (isProviderQueueBusyError(raw)) {
    return 'Render queue is cooling down.';
  }
  if (isTimeoutOrStillProcessingText(raw)) {
    return 'Your cinematic moment is still processing.';
  }
  if (isProviderSafetyFilterError(raw)) {
    return 'This scene needs a softer cinematic direction before rendering.';
  }
  if (isProviderTechnicalText(raw)) {
    return 'This renderer paused the scene safely.';
  }
  if (!raw || raw === 'Request failed' || raw.length > 220 || raw.includes('{') || raw.includes('}')) {
    return fallback;
  }

  return sanitizeCreatorErrorMessage(raw, fallback);
}

function creatorFacingPausedDetail(value: unknown): string {
  const raw = collectErrorText(value);
  if (isProviderSafetyFilterError(raw)) {
    return 'Try a simpler, softer cinematic direction. Your cast and Story Memory are preserved.';
  }
  if (isProviderQueueBusyError(raw)) {
    return 'Render queue is cooling down. Lumora will resume automatically.';
  }
  return 'Your scene setup is saved. Resume when you are ready.';
}

function creatorFacingWarningMessage(value: string): string | null {
  if (!value.trim()) return null;
  if (isProviderQueueBusyError(value)) return 'Render queue is cooling down.';
  if (isProviderSafetyFilterError(value)) return 'Creative adaptation kept this scene safe.';
  if (isProviderTechnicalText(value)) return 'Lumora kept your work safe while the renderer paused.';
  return value;
}

function formatCreatorWarnings(messages: string[]): string[] {
  return Array.from(new Set(
    messages
      .map(creatorFacingWarningMessage)
      .filter((message): message is string => Boolean(message)),
  ));
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
  onOpenSelfVerificationSetup,
  onCharacterUpdated,
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

  const [duration, setDuration] = useState(4);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [renderPreference, setRenderPreference] = useState<RenderSuccessMode>('success_first');
  const [selfLikenessIntensity, setSelfLikenessIntensity] = useState<SelfLikenessIntensity>('balanced');
  const [engine, setEngine] = useState<VideoEngine>(SEEDANCE_ENGINE_ID);
  const [stageSelectionMode, setStageSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [firstFrameCanaryEnabled, setFirstFrameCanaryEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const [generationStatusState, setGenerationStatusState] = useState<GenerationStatusState>('idle');
  const [toast, setToast] = useState<ToastState>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationFailureStatus, setGenerationFailureStatus] = useState<GenerationFailureStatus | null>(null);
  const [activeRenderFailure, setActiveRenderFailure] = useState<RenderFailureEnvelope | null>(null);
  const [generationSafeRewrite, setGenerationSafeRewrite] = useState('');
  const [generationModerationDetail, setGenerationModerationDetail] = useState('');
  const [generationModerationStages, setGenerationModerationStages] = useState<string[]>([]);
  const [identityOnlyKlingFallbackActive, setIdentityOnlyKlingFallbackActive] = useState(false);
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
  const [expandedSceneDescriptions, setExpandedSceneDescriptions] = useState<Set<string>>(new Set());
  const [referenceRepair, setReferenceRepair] = useState<ReferenceRepairIssue | null>(null);
  const [repairUploading, setRepairUploading] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [skippedReferenceUrls, setSkippedReferenceUrls] = useState<string[]>([]);
  const [schemaWarning, setSchemaWarning] = useState('');
  const [healthDiagnostics, setHealthDiagnostics] = useState<ApiHealthDiagnostics | null>(null);
  const [healthDiagnosticsStatus, setHealthDiagnosticsStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const [generatedDisplayEngine, setGeneratedDisplayEngine] = useState('');
  const [generatedReferenceImageUrl, setGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [generatedMode, setGeneratedMode] = useState<GenerationMode | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [viralPresetUsed, setViralPresetUsed] = useState<string | null>(null);
  const [promptPolished, setPromptPolished] = useState(false);
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
  const [renderCooldownUntil, setRenderCooldownUntil] = useState<string | null>(null);
  const [renderCooldownSeconds, setRenderCooldownSeconds] = useState(0);
  const [selectedFeedbackChoices, setSelectedFeedbackChoices] = useState<LumoraIdentityFeedbackChoice[]>([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const generationInFlightRef = useRef(false);
  const progressTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const repairFileInputRef = useRef<HTMLInputElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mockRateLimitUi = Boolean(
    localMockQueryEnabled('mockRateLimit')
  );
  const mockPausedUi = Boolean(
    localMockQueryEnabled('mockPaused')
  );
  const mockBlockedUi = Boolean(
    localMockQueryEnabled('mockBlocked')
  );
  const mockSuccessFirstUi = Boolean(
    localMockQueryEnabled('mockSuccessFirst') || localMockQueryEnabled('mockRenderingNoOutput')
  );
  const mockRenderSuccessUi = Boolean(
    localMockQueryEnabled('mockRenderSuccess') || localMockQueryEnabled('mockVerifiedOutput')
  );
  const mockOutputMissingUi = Boolean(
    localMockQueryEnabled('mockOutputMissing')
  );
  const mockAllAttemptsBlockedUi = Boolean(
    localMockQueryEnabled('mockAllAttemptsBlocked') || localMockQueryEnabled('mockAttemptsExhausted')
  );
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
  const hasPrompt = activePrompt.trim().length > 0;
  const realProviderReady = hasReadyRealGenerationProvider(healthDiagnostics, engine);
  const autoDemoFallbackActive =
    stageSelectionMode === 'auto' &&
    healthDiagnosticsStatus === 'connected' &&
    !realProviderReady;
  const selectedEngineRequiresBackend = engine !== 'mock' && !autoDemoFallbackActive;
  const providerReadinessMessage = !selectedEngineRequiresBackend
    ? null
    : healthDiagnosticsStatus === 'offline'
      ? apiOfflineVideoEngineMessage
      : healthDiagnosticsStatus === 'connected' && !realProviderReady
        ? providerConfigurationMessage(engine)
        : null;
  const backendReadyForGeneration = !selectedEngineRequiresBackend || (
    healthDiagnosticsStatus === 'connected' &&
    realProviderReady
  );
  const allSeedanceReferenceImages = buildSeedanceReferenceImages({
    referenceImageUrl,
    referenceImageUrls,
    additionalReferenceImageUrls,
    identityProfile,
    characterAvatar,
  });
  const runtimeSeedanceReferenceImages = filterObsoleteSeedanceReferences(allSeedanceReferenceImages);
  const seedanceReferenceImages = runtimeSeedanceReferenceImages.filter((reference) => (
    !skippedReferenceUrls.includes(reference.url)
  ));
  const preflightReferenceRepair = seedanceReferenceImages
    .map<ReferenceRepairIssue | null>((reference) => {
      const optional = !(reference.role === 'front_angle' || reference.role === 'side_angle');
      const status = referenceStatus(reference.url, optional);
      if (status.kind !== 'needs_reupload') return null;
      return {
        sourceUrl: reference.url,
        label: reference.label || 'Reference image',
        role: reference.role ?? null,
        slot: referenceSlotForSeedanceReference(reference),
        host: null,
        reason: 'protected_external_url',
        canContinueWithoutReference: optional,
      } satisfies ReferenceRepairIssue;
    })
    .find((issue): issue is ReferenceRepairIssue => Boolean(issue)) ?? null;
  const activeReferenceRepair = referenceRepair ?? preflightReferenceRepair;
  const seedanceReferenceCount = seedanceReferenceImages.length;
  const activeFrontFaceReferenceCount = seedanceReferenceImages.filter((reference) => (
    reference.role === 'front_angle'
  )).length;
  const activeOtherReferenceCount = seedanceReferenceCount - activeFrontFaceReferenceCount;
  const referenceLedRouteModerated = Boolean(
    healthDiagnostics?.referenceRouteStatus?.seedanceReferenceRoutesBlocked ||
    healthDiagnostics?.seedanceImageReferenceBlocked
  );
  const firstFrameCanaryEligible = isSeedanceFirstFrameCanaryEligible({
    activeFrontFaceReferenceCount,
    activeOtherReferenceCount,
    referenceLedRouteModerated,
  });
  const firstFrameCanaryActive =
    stageSelectionMode === 'auto' &&
    firstFrameCanaryEnabled &&
    firstFrameCanaryEligible;
  const savedSeedanceReferenceCount = seedanceReferenceImages.filter((reference) => (
    referenceStatus(reference.url, true).kind === 'saved'
  )).length;
  const readySeedanceReferenceCount = savedSeedanceReferenceCount || seedanceReferenceCount;
  const showReferenceSetupGuidance =
    isHydrated &&
    isSeedanceEngine &&
    !referenceLoading &&
    readySeedanceReferenceCount === 0;
  const sceneExecutorUserId = authUser?.id ?? identityProfile?.userId ?? null;
  const seedanceMultimodalActive = isSeedanceEngine && seedanceReferenceCount > 1;
  const seedanceSingleReferenceWarning =
    isSeedanceEngine &&
    seedanceReferenceCount === 1 &&
    !firstFrameCanaryEligible;
  const successFirstLighterReferencePath = isSeedanceEngine && renderPreference === 'success_first' && seedanceReferenceCount > 0;
  const selectedGenerationMode: GenerationMode = isSeedanceEngine
    ? firstFrameCanaryActive
      ? 'seedance-image-to-video-first-frame'
      : renderPreference === 'success_first'
        ? 'seedance-text-to-video'
        : seedanceReferenceCount > 0
          ? 'seedance-multimodal-reference'
          : 'seedance-text-to-video'
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
      ? 'Building self character'
    : (identityProfile.feedbackIterations ?? 0) > 0
        ? 'Self guidance learning'
        : (identityProfile.identityStrength ?? 0) >= 70
          ? 'Self character stabilized'
          : identityProfile.status === 'ready'
            ? 'Self character ready'
            : 'Needs references';
  const seedanceVideoReferenceReady =
    selfReferenceMode &&
    characterProfile?.videoReferenceRouteStatus === 'canary_succeeded';
  const openAIProviderSelfCharacterReady =
    selfReferenceMode &&
    characterProfile?.providerIdentityProvider === 'openai_sora' &&
    characterProfile.providerCharacterStatus === 'ready' &&
    characterProfile.likenessProviderStatus === 'canary_succeeded';
  const exactLikenessRouter = healthDiagnostics?.exactLikenessRouter;
  const klingExactLikenessReady = Boolean(
    selfReferenceMode &&
    exactLikenessRouter?.route === 'kling_reference' &&
    exactLikenessRouter?.canaryStatus === 'canary_succeeded' &&
    exactLikenessRouter?.exactLikeness,
  );
  const autoStageDecision = decideAutoStage({
    hasPrompt,
    explicitDemoMode: (stageSelectionMode === 'manual' && engine === 'mock') || autoDemoFallbackActive,
    exactLikenessReady: klingExactLikenessReady,
    selfCharacterReady: Boolean(selfReferenceMode && hasGenerationReference),
    userPrompt: activePrompt,
    activeFrontFaceReferenceCount,
    activeOtherReferenceCount,
    referenceLedRouteModerated,
    explicitFirstFrameCanaryAuthorized: firstFrameCanaryActive,
  });

  useEffect(() => {
    if (!firstFrameCanaryEligible) setFirstFrameCanaryEnabled(false);
  }, [firstFrameCanaryEligible, characterId]);

  const effectiveUiEngine = stageSelectionMode === 'manual' ? engine : autoStageDecision.engine;
  const demoModeActive = isDemoModeEngine(effectiveUiEngine);
  const castSetupIncomplete =
    selfReferenceMode &&
    !referenceLoading &&
    !hasGenerationReference &&
    !demoModeActive;
  const klingReferenceSelected = effectiveUiEngine === 'replicate';
  const selectedKlingExactReady = klingReferenceSelected && klingExactLikenessReady;
  const klingExactReadyOnOtherRenderer = klingExactLikenessReady && !klingReferenceSelected;
  const showKlingReferenceSwitch = !demoModeActive && klingExactReadyOnOtherRenderer && hasGenerationReference;
  const sceneAnchorConfigured = Boolean(healthDiagnostics?.sceneAnchorConfigured);
  const sceneAnchorGuidance = demoModeActive
    ? null
    : buildSceneAnchorCreateGuidance({
        klingReferenceSelected,
        klingExactReady: selectedKlingExactReady,
        sceneAnchorConfigured,
      });
  const providerSelfCharacterReady = openAIProviderSelfCharacterReady || seedanceVideoReferenceReady || selectedKlingExactReady;
  const effectiveVerificationVideoPresent = hasEffectiveSelfVerificationVideo(characterProfile);
  const providerSelfCharacterSetupStarted =
    selfReferenceMode &&
    Boolean(
      (characterProfile?.providerIdentityProvider === 'openai_sora' && characterProfile.providerCharacterStatus) ||
      effectiveVerificationVideoPresent ||
      characterProfile?.videoReferenceRouteStatus,
    );
  const selfCharacterProviderStatusLabel = demoModeActive
    ? 'Demo Mode'
    : selectedKlingExactReady
    ? 'Kling Reference Beta'
    : klingExactReadyOnOtherRenderer
      ? 'Soft guidance renderer'
    : providerSelfCharacterReady
    ? 'Verified self character ready'
    : providerSelfCharacterSetupStarted
      ? characterProfile?.videoReferenceRouteStatus === 'blocked' ||
        characterProfile?.videoReferenceRouteStatus === 'failed_blocked' ||
        characterProfile?.videoReferenceRouteStatus === 'reference_moderation_block' ||
        characterProfile?.videoReferenceRouteStatus === 'video_reference_moderation_block'
        ? 'Soft guidance active'
        : !effectiveVerificationVideoPresent
          ? 'Record self verification video'
          : characterProfile?.providerCharacterStatus === 'failed'
        ? 'Self character route unavailable'
        : characterProfile?.providerCharacterStatus === 'disabled'
          ? 'Self character route unavailable'
          : 'Self character needs setup'
      : selfReferenceMode
        ? 'Record self verification video'
        : '';
  const selfCharacterProviderStatusCopy = demoModeActive
    ? 'Demo preview only. No real render was created.'
    : selectedKlingExactReady
    ? sceneAnchorConfigured
      ? 'Kling Reference is experimental for exact-likeness testing. Use Seedance Fast for the safest first render.'
      : 'Kling Reference is experimental. Identity-only fallback is available if you want to test exact likeness.'
    : klingExactReadyOnOtherRenderer
      ? 'Use Seedance Fast for the safest first render. Kling Reference stays available as an experimental exact-likeness test.'
    : providerSelfCharacterReady
    ? 'Verified self character ready.'
    : characterProfile?.providerCharacterStatus === 'ready' && characterProfile.likenessProviderStatus === 'character_created_usage_unmapped'
      ? 'Verified self character created. Video route not available yet.'
      : createSelfCharacterStatusCopy({
          character: characterProfile,
          exactRouteReady: providerSelfCharacterReady,
        });
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
    backendReadyForGeneration &&
    !castSetupIncomplete &&
    !(activeReferenceRepair && !activeReferenceRepair.canContinueWithoutReference) &&
    (!requiresReferenceImage || hasGenerationReference || mockRateLimitUi);
  const renderCooldownActive = renderCooldownSeconds > 0;
  const activeRenderBlocksGenerate = Boolean(activeRenderJobId) && generationStatusState !== 'rate_limited';
  const generateBusy = busy || generationLoading || referenceLoading || renderCooldownActive || activeRenderBlocksGenerate;
  const saveBusy = busy || generationLoading;
  const sceneExecuteDisabledReason = !creativePlan
    ? 'Shape cinematic beats first'
    : !sceneExecutorUserId
      ? 'Sign in to save each shot'
      : !isSeedanceEngine
        ? 'Choose a cast-friendly render path'
        : sceneExecutionLoading
          ? 'Rendering story flow...'
          : '';
  const sceneExecuteBusy = Boolean(sceneExecuteDisabledReason) || generationLoading || busy;
  const engineRoutingMessage =
    isSeedanceEngine
      ? engine === SEEDANCE_ENGINE_ID
        ? renderPreference === 'success_first'
          ? 'Stage: safest first render with Seedance Fast. Save a draft first, then preview when ready.'
          : `Stage: safest first render with Seedance Fast and ${readySeedanceReferenceCount} cast reference${readySeedanceReferenceCount === 1 ? '' : 's'}.`
        : 'Seedance Quality is the slower real render path after Seedance Fast or a saved draft feels right.'
    : engine === 'veo'
      ? klingExactReadyOnOtherRenderer
        ? 'Veo Experimental uses soft self guidance. Seedance Fast is the safest first render.'
        : 'Veo Experimental is available for cinematic route testing.'
    : engine === 'mock'
      ? 'Stage preview without credits.'
    : isSoraEngine
      ? (providerSelfCharacterReady
          ? 'Exact self character route is ready.'
          : klingExactReadyOnOtherRenderer
            ? 'Using soft self guidance with this renderer. Seedance Fast remains the safest first render.'
            : 'Using soft self guidance. Exact-likeness rendering still needs setup.')
    : klingReferenceSelected
      ? selectedKlingExactReady
        ? sceneAnchorConfigured
          ? 'Kling Reference is experimental for exact-likeness testing. Use Seedance Fast for the safest first render.'
          : 'Kling Reference is experimental. Identity-only fallback is available for testing.'
        : 'Kling Reference is experimental. Exact-likeness rendering still needs setup.'
      : 'Using soft self guidance. Exact-likeness rendering still needs setup.';
  const aiCastReadiness = buildAiCastReadiness({
    selfCharacterSaved: Boolean(hasSelfCharacter && (characterName || characterProfile || identityProfile)),
    verificationVideoSaved: effectiveVerificationVideoPresent,
    klingExactLikenessReady,
    sceneAnchorConfigured,
    draftsReady: true,
    continueStoryReady: true,
    audioConfigured: false,
    viralPolishReady: true,
  });
  const captionSuggestions = buildViralCaptionSuggestions(activePrompt, characterName);
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
  const storyMemoryMoment = continuityMemoryDraft.environment
    ? `Lumora remembered this setting: ${continuityMemoryDraft.environment}.`
    : continuityMemoryDraft.wardrobe
      ? 'Lumora adapted wardrobe continuity for this scene.'
      : continuityMemoryDraft.emotionalTone
        ? 'Emotional pacing matched your prior scene.'
        : 'Lumora will remember your world as you create.';
  const generationResultVideoUrl = getVerifiedVideoOutputUrl(generationResult as unknown as Record<string, unknown> | null);
  const verifiedGeneratedVideoUrl = normalizeVerifiedVideoOutputUrl(generatedVideoUrl);
  const hasVerifiedGenerationOutput = Boolean(generationResultVideoUrl);
  const activeSuccessFirstWithoutOutput = renderPreference === 'success_first' && !hasVerifiedGenerationOutput && (
    generationStatusState === 'queued' ||
    generationStatusState === 'processing' ||
    generationStatusState === 'verifying_output' ||
    generationStatusState === 'rate_limited'
  );
  const klingExactRenderStateActive = selectedKlingExactReady && (
    generationStatusState === 'queued' ||
    generationStatusState === 'processing' ||
    generationStatusState === 'verifying_output'
  );
  const identityOnlyKlingFallbackRenderActive = identityOnlyKlingFallbackActive && klingExactRenderStateActive;
  const sceneAnchorKlingRenderStateActive = klingExactRenderStateActive && !identityOnlyKlingFallbackRenderActive;
  const visibleRenderState = generationStatusState === 'idle' || hasVerifiedGenerationOutput ? null : {
    label: generationStatusLabels[generationStatusState],
    tone: renderStateTone(generationStatusState),
    headline: identityOnlyKlingFallbackRenderActive
      ? generationStatusState === 'verifying_output'
        ? 'Saving to Drafts'
        : 'Using identity-only Kling fallback'
      : sceneAnchorKlingRenderStateActive
      ? generationStatusState === 'verifying_output'
        ? 'Saving to Drafts'
        : 'Generating scene anchor...'
      : renderStateHeadline(generationStatusState),
    body: identityOnlyKlingFallbackRenderActive
      ? generationStatusState === 'verifying_output'
        ? 'Lumora is verifying the Kling video before marking the draft ready.'
        : 'This uses your saved identity references without staging a scene anchor.'
      : sceneAnchorKlingRenderStateActive
      ? generationStatusState === 'verifying_output'
        ? 'Lumora is verifying the Kling video before marking the draft ready.'
        : 'Kling Reference Beta is staging the scene before Kling animation.'
      : status && !isProviderTechnicalText(status)
      ? status
      : renderStateBody(generationStatusState, renderCooldownSeconds),
  };
  const activeRenderFailureCategory = activeRenderFailure?.category || null;
  const pausedRenderCopy = activeRenderFailureCategory
    ? {
        ...creatorRenderStateCopy('paused'),
        title: activeRenderFailure?.safeTitle || renderFailureTitleForCategory(activeRenderFailureCategory),
        body: activeRenderFailure?.safeMessage || generationError || renderFailureMessageForCategory(activeRenderFailureCategory),
        suggestedNextStep: activeRenderFailure?.category === 'scene_anchor_asset_persist' ||
          activeRenderFailure?.category === 'scene_anchor_asset_persist_failed'
          ? 'Suggested next step: save this draft or try the identity-only fallback.'
          : activeRenderFailure?.recommendedNextAction
            ? `Suggested next step: ${activeRenderFailure.recommendedNextAction}`
            : 'Suggested next step: save this draft before retrying.',
      }
    : selectedKlingExactReady && generationError
    ? {
        ...creatorRenderStateCopy('paused'),
        title: 'Kling Reference Beta render paused.',
        body: generationError,
        suggestedNextStep: /scene[-\s]?anchor/i.test(generationError)
          ? 'Suggested next step: use identity-only fallback, save this draft, or return to Seedance Fast.'
          : 'Suggested next step: retry Kling later, edit the scene, or switch to soft guidance.',
      }
    : creatorRenderStateCopy(generationFailureStatus ?? 'failed');
  const sceneAnchorPauseActive = selectedKlingExactReady && (
    /scene[-\s]?anchor/i.test(generationError) ||
    Boolean(activeRenderFailure?.category?.startsWith('scene_anchor_')) ||
    Boolean(activeRenderFailure?.category?.startsWith('kling_scene_anchor_video_'))
  );
  const suggestedTakePrompt = buildSafeTakePrompt(
    generationSafeRewrite || activePrompt,
    { displayName: characterName },
  );
  const suggestedTakePreview = buildSafeTakePreview(
    generationSafeRewrite || activePrompt,
    { displayName: characterName },
  );
  const tryTakeBusy = busy || generationLoading || referenceLoading || renderCooldownActive || activeRenderBlocksGenerate;
  const baseGenerateCtaLabel = demoModeActive ? 'Preview Demo' : 'Generate';
  const isCreateFlowPreparing = shouldShowCreatePreparingState({
    engine,
    isHydrated,
    sessionLoading,
    healthDiagnosticsStatus,
    referenceLoading,
  });
  const generateCtaLabel = !hasPrompt
    ? 'Add a scene idea'
    : renderCooldownActive
      ? `${renderCooldownSeconds}s`
      : generationStatusState === 'rate_limited'
        ? 'Resume'
        : generationError && !activeReferenceRepair
          ? 'Try again'
          : activeRenderBlocksGenerate
            ? 'Rendering'
            : generationLoading
              ? 'Generating'
              : isCreateFlowPreparing
                ? 'Preparing'
                : !canGenerate
                  ? castSetupIncomplete
                    ? 'Finish AI Cast'
                    : demoModeActive
                    ? 'Preview Demo'
                    : requiresReferenceImage && !hasGenerationReference && !mockRateLimitUi
                      ? 'Add a cast reference'
                      : !backendReadyForGeneration
                        ? healthDiagnosticsStatus === 'offline'
                          ? 'Stage unavailable'
                          : 'Preview Demo'
                        : baseGenerateCtaLabel
                  : baseGenerateCtaLabel;
  const generateButtonDisabled = castSetupIncomplete && onResaveReferencePhoto
    ? false
    : generationError && !activeReferenceRepair
    ? tryTakeBusy
    : generateBusy || !hasPrompt || !canGenerate;
  const showCinematicStructure = Boolean(
    !activeSuccessFirstWithoutOutput && (
      creativePlanLoading ||
      creativePlan ||
      sceneExecutionPlan ||
      sceneExecutionResult ||
      creativePlanStatus ||
      creativePlanError ||
      sceneExecutionStatus ||
      sceneExecutionError
    ),
  );
  const cinematicStructureStatusLabel = creativePlanLoading
    ? 'Shaping'
    : sceneExecutionResult?.status === 'completed'
      ? 'Saved'
      : sceneExecutionResult?.status === 'failed' || generationStatusState === 'failed'
        ? 'Paused'
        : generationStatusState === 'processing'
          ? 'Rendering'
          : sceneExecutionPlan || creativePlan
            ? 'Ready'
            : 'Preparing';
  const cinematicBeatCount =
    sceneExecutionResult?.clips.length ??
    sceneExecutionPlan?.shotList.length ??
    creativePlan?.shotList.length ??
    0;
  const cinematicStructureSummary = cinematicBeatCount
    ? `Structure ready - ${cinematicBeatCount} beat${cinematicBeatCount === 1 ? '' : 's'}`
    : 'Structure ready';
  const featuredViralScenePresets = viralScenePresets.slice(0, 4);
  const additionalViralScenePresets = viralScenePresets.slice(4);
  const selectedStageOption = providerOptions.find((option) => option.engine === engine) ?? providerOptions[0];

  useEffect(() => {
    const savedPrompt = localStorage.getItem('remixPrompt');
    const savedTitle = localStorage.getItem('remixTitle');
    const savedRenderPreference = localStorage.getItem('lumora_remix_render_preference');
    const savedRenderEngine = localStorage.getItem('lumora_remix_render_engine');

    if (savedPrompt) {
      setActivePrompt(savedPrompt);
      localStorage.removeItem('remixPrompt');
    }

    if (savedTitle) {
      setDraftTitle(savedTitle);
      localStorage.removeItem('remixTitle');
    }

    if (
      savedRenderPreference === 'success_first' ||
      savedRenderPreference === 'balanced' ||
      savedRenderPreference === 'cinematic_quality'
    ) {
      setRenderPreference(savedRenderPreference);
      localStorage.removeItem('lumora_remix_render_preference');
    }

    if (
      savedRenderEngine === SEEDANCE_ENGINE_ID ||
      savedRenderEngine === SEEDANCE_QUALITY_ENGINE_ID ||
      savedRenderEngine === 'replicate' ||
      savedRenderEngine === 'runway' ||
      savedRenderEngine === 'openai' ||
      savedRenderEngine === 'mock'
    ) {
      setEngine(savedRenderEngine as VideoEngine);
      localStorage.removeItem('lumora_remix_render_engine');
    }
  }, [setActivePrompt, setDraftTitle]);

  useEffect(() => {
    setReferenceRepair(null);
    setRepairStatus('');
    setSkippedReferenceUrls([]);
  }, [characterId, referenceImageUrl]);

  useEffect(() => {
    let active = true;

    setHealthDiagnosticsStatus('checking');
    api.healthDiagnostics()
      .then((diagnostics) => {
        if (active) {
          setHealthDiagnostics(diagnostics);
          setHealthDiagnosticsStatus('connected');
          setSchemaWarning(characterProfileSchemaWarning(diagnostics));
        }
      })
      .catch(() => {
        if (active) {
          setHealthDiagnostics(null);
          setHealthDiagnosticsStatus('offline');
          setSchemaWarning('');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeRenderJobId) return undefined;
    const renderJobId = activeRenderJobId;

    let active = true;
    let pollTimer: number | null = null;

    async function pollJob() {
      try {
        const job = await api.getGenerationJob(renderJobId);
        if (!active) return;

        const outputUrl = getVerifiedVideoOutputUrl(job as unknown as Record<string, unknown>);
        const statusValue = typeof job.status === 'string' ? job.status : '';
        const progressLabel = asyncRenderStatusMessage(job);

        if (statusValue === 'completed' && outputUrl) {
          clearRenderCooldown();
          const generatedMedia = resolveGeneratedVideoMedia({
            ...job,
            outputUrl,
            videoUrl: outputUrl,
            characterAvatar,
          });
          const thumbnailUrl = generatedMedia.thumbnailUrl;
          const posterUrl = generatedMedia.posterUrl;
          const displayEngine = job.displayEngine ?? (
            engine === SEEDANCE_QUALITY_ENGINE_ID
              ? 'Seedance Quality'
              : engine === SEEDANCE_ENGINE_ID
                ? 'Seedance Fast'
                : engineLabels[engine] ?? engine
          );
          const completedAt = new Date().toISOString();
          setGeneratedVideoUrl(outputUrl);
          setFinalGeneratedPrompt(job.finalPrompt ?? job.prompt ?? activePrompt);
          setGeneratedModel(job.model ?? '');
          setGeneratedDisplayEngine(displayEngine);
          setGeneratedReferenceImageUrl(null);
          setGeneratedMode(job.generationMode ?? selectedGenerationMode);
          setGenerationResult({
            id: job.id ?? renderJobId,
            jobId: job.jobId ?? renderJobId,
            status: 'completed',
            engine,
            provider: job.provider ?? 'replicate',
            characterId,
            characterName,
            characterAvatar,
            isDefaultSelfCharacter,
            prompt: job.prompt ?? activePrompt,
            outputUrl,
            videoUrl: outputUrl,
            thumbnailUrl,
            posterUrl,
            thumbnailSource: generatedMedia.thumbnailSource,
            generationMode: job.generationMode ?? selectedGenerationMode,
            finalPrompt: job.finalPrompt ?? job.prompt ?? activePrompt,
            model: job.model ?? null,
            displayEngine,
            projectId: job.projectId ?? null,
            createdAt: job.createdAt ?? completedAt,
            exactLikenessRoute: job.exactLikenessRoute ?? null,
            exactLikenessProvider: job.exactLikenessProvider ?? null,
            exactLikenessCanaryStatus: job.exactLikenessCanaryStatus ?? null,
            referenceStrategy: job.referenceStrategy ?? null,
            referenceRolesUsed: job.referenceRolesUsed ?? null,
            referenceCount: job.referenceCount ?? null,
            sceneAnchorStrategy: job.sceneAnchorStrategy ?? null,
            sceneAnchorGenerated: job.sceneAnchorGenerated ?? null,
            sceneAnchorProvider: job.sceneAnchorProvider ?? null,
            sceneAnchorReason: job.sceneAnchorReason ?? null,
            sceneAnchorFailureCategory: job.sceneAnchorFailureCategory ?? null,
            sceneAnchorHttpStatus: job.sceneAnchorHttpStatus ?? null,
            sceneAnchorErrorType: job.sceneAnchorErrorType ?? null,
            sceneAnchorErrorMessage: job.sceneAnchorErrorMessage ?? null,
            sceneAnchorPayloadFieldNames: job.sceneAnchorPayloadFieldNames ?? null,
            sceneAnchorReferenceCount: job.sceneAnchorReferenceCount ?? null,
            sceneAnchorSubmittedReferenceCount: job.sceneAnchorSubmittedReferenceCount ?? null,
            sceneAnchorReferenceRolesUsed: job.sceneAnchorReferenceRolesUsed ?? null,
            sceneAnchorDroppedReferenceRoles: job.sceneAnchorDroppedReferenceRoles ?? null,
            sceneAnchorProviderReferenceLimit: job.sceneAnchorProviderReferenceLimit ?? null,
            sceneAnchorOutputParsed: job.sceneAnchorOutputParsed ?? null,
            sceneAnchorValidation: job.sceneAnchorValidation ?? null,
            primaryInputType: job.primaryInputType ?? null,
            primaryVideoInputType: job.primaryVideoInputType ?? null,
            primaryVideoInputSource: job.primaryVideoInputSource ?? null,
            identityReferencesPassedToVideoStage: job.identityReferencesPassedToVideoStage ?? null,
            identityReferenceCount: job.identityReferenceCount ?? null,
            identityReferenceMode: job.identityReferenceMode ?? null,
            startFrameSource: job.startFrameSource ?? null,
            posterFrameSource: job.posterFrameSource ?? null,
            firstFrameSource: job.firstFrameSource ?? null,
            stage2ProviderModel: job.stage2ProviderModel ?? null,
            stage2ProviderRouteType: job.stage2ProviderRouteType ?? null,
            rawReferenceVisualInputsSentToStage2: job.rawReferenceVisualInputsSentToStage2 ?? null,
            sceneIntent: job.sceneIntent ?? null,
            framingIntent: job.framingIntent ?? null,
            primaryReferenceRole: job.primaryReferenceRole ?? null,
            supportingReferenceRoles: job.supportingReferenceRoles ?? null,
            userSpecifiedOutfit: job.userSpecifiedOutfit ?? null,
            outfitTermsDetected: job.outfitTermsDetected ?? null,
            environmentTermsDetected: job.environmentTermsDetected ?? null,
            referenceOutfitCarryoverSuppressed: job.referenceOutfitCarryoverSuppressed ?? null,
            compositionCarryoverSuppressed: job.compositionCarryoverSuppressed ?? null,
            frontOnlyFallback: job.frontOnlyFallback ?? null,
            klingReferenceDiagnostics: job.klingReferenceDiagnostics ?? null,
            message: job.message ?? (job.exactLikenessRoute === 'kling_reference'
              ? 'Kling Reference Beta scene created with scene-anchor identity planning.'
              : job.textSelfGuidanceAvailable ? 'Rendered with soft self guidance.' : 'Your cinematic draft is saved.'),
            selfLikenessIntensity: job.selfLikenessIntensity ?? selfLikenessIntensity,
            textSelfGuidanceAvailable: job.textSelfGuidanceAvailable ?? null,
          });
          setActiveRenderJobId(null);
          finishGenerationProgress('completed');
          setStatus('Your cinematic draft is saved.');
          showToast({ type: 'success', message: 'Your cinematic draft is saved. Continue the story from Drafts when ready.' });
          return;
        }

        if (statusValue === 'completed' && !outputUrl) {
          setGenerationResult(null);
          setGeneratedVideoUrl(null);
          setGenerationStatusState('verifying_output');
          setStatus('Lumora is checking the video output before marking this draft ready.');
          pollTimer = window.setTimeout(pollJob, 4000);
          return;
        }

        if (statusValue === 'rate_limited') {
          pauseGenerationProgressForCooldown(job);
          setGenerationError('');
          setStatus(progressLabel);
          pollTimer = window.setTimeout(pollJob, 8000);
          return;
        }

        if (statusValue === 'failed' || statusValue === 'paused') {
          const pausedMessage = creatorFacingErrorMessage(
            [job.error, job.errorMessage, progressLabel],
            'This renderer paused the scene safely.',
          );
          clearRenderCooldown();
          setActiveRenderJobId(null);
          finishGenerationProgress('failed');
          setGenerationError(pausedMessage);
          setStatus('Your scene is saved, but no video has completed yet.');
          showToast({ type: 'error', message: 'Lumora paused this scene before a verified video was returned.' });
          return;
        }

        clearRenderCooldown();
        setGenerationStatusState(statusValue === 'queued' ? 'queued' : 'processing');
        setStatus(progressLabel);
        pollTimer = window.setTimeout(pollJob, 4000);
      } catch (error) {
        if (!active) return;
        setStatus(creatorFacingErrorMessage(error, 'Your scene is still rendering. Lumora will keep checking and save it to Drafts.'));
        pollTimer = window.setTimeout(pollJob, 6000);
      }
    }

    void pollJob();

    return () => {
      active = false;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [
    activeRenderJobId,
    activePrompt,
    characterAvatar,
    characterId,
    characterName,
    engine,
    isDefaultSelfCharacter,
    selectedGenerationMode,
  ]);

  useEffect(() => {
    if (!renderCooldownUntil) {
      setRenderCooldownSeconds(0);
      return undefined;
    }

    let active = true;
    let timer: number | null = null;

    const tick = () => {
      const seconds = Math.ceil((Date.parse(renderCooldownUntil) - Date.now()) / 1000);
      if (!active) return;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        setRenderCooldownSeconds(0);
        setRenderCooldownUntil(null);
        return;
      }
      setRenderCooldownSeconds(seconds);
      timer = window.setTimeout(tick, 1000);
    };

    tick();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [renderCooldownUntil]);

  useEffect(() => {
    if (!mockPausedUi && !mockBlockedUi) return;

    const sourcePrompt = activePrompt.trim() ||
      'The cast character walks through a sunlit garden, gently picking flowers.';
    setGenerationStatusState('failed');
    setGenerationError(creatorRenderStateCopy('paused').title);
    setGenerationModerationDetail('');
    setGenerationModerationStages(mockBlockedUi ? ['Trying a softer cinematic direction...'] : []);
    setGenerationSafeRewrite(buildSafeTakePrompt(sourcePrompt, { displayName: characterName }));
    setSceneExecutionPlan({
      cinematicTone: 'Gentle cinematic',
      visualStyle: 'Soft storybook light',
      soundtrackMood: 'Quiet emotional lift',
      continuityNotes: ['Story Memory stays aligned.'],
      cameraFraming: ['Medium portrait'],
      environmentDescription: 'A calm sunlit garden.',
      emotionalPacing: 'Slow and peaceful.',
      sceneTransitions: ['Soft fade'],
      promptRewrite: sourcePrompt,
      shotList: [
        {
          id: 'mock-beat-1',
          title: 'Scene 1',
          description: 'The cast character enters the garden with calm movement and soft light.',
          cameraFraming: 'Medium portrait',
          cameraMovement: 'Gentle push-in',
          subjectAction: 'Walks through the flowers',
          environmentFocus: 'Sunlit blooms',
          durationHint: '4s',
          transition: 'Soft fade',
        },
        {
          id: 'mock-beat-2',
          title: 'Scene 2',
          description: 'The moment settles into a peaceful close detail with Story Memory preserved.',
          cameraFraming: 'Close detail',
          cameraMovement: 'Slow drift',
          subjectAction: 'Pauses gently',
          environmentFocus: 'Soft garden light',
          durationHint: '4s',
          transition: 'Gentle dissolve',
        },
      ],
    });
    setStatus('Your scene setup is saved in Drafts.');
  }, [activePrompt, characterName, mockBlockedUi, mockPausedUi]);

  useEffect(() => {
    if (!mockRateLimitUi) return;

    const retryAfterSeconds = 10;
    pauseGenerationProgressForCooldown({
      status: 'rate_limited',
      retryAfterSeconds,
      retryAvailableAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    });
    setGenerationError('');
    setGenerationModerationDetail('');
    setGenerationModerationStages([]);
    setGenerationSafeRewrite('');
    setStatus('Render queue is cooling down. Lumora will resume automatically.');
  }, [mockRateLimitUi]);

  useEffect(() => {
    if (!mockSuccessFirstUi) return;

    setRenderPreference('success_first');
    setDuration(4);
    setAspectRatio('16:9');
    setEngine(SEEDANCE_ENGINE_ID);
    setGenerationStatusState('processing');
    setGenerationError('');
    setGenerationResult(null);
    setGeneratedVideoUrl(null);
    setStatus('Lumora is finding the cleanest render path...');
  }, [mockSuccessFirstUi]);

  useEffect(() => {
    if (!mockRenderSuccessUi) return;

    const now = new Date().toISOString();
    const mockVideoUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
    setRenderPreference('success_first');
    setDuration(4);
    setAspectRatio('16:9');
    setEngine(SEEDANCE_ENGINE_ID);
    setGenerationStatusState('completed');
    setGenerationError('');
    setGeneratedVideoUrl(mockVideoUrl);
    setFinalGeneratedPrompt(ULTRA_SAFE_SCENE_PROMPT);
    setGeneratedDisplayEngine('Seedance Fast');
    setGeneratedMode('seedance-text-to-video');
    setGenerationResult({
      id: 'mock-render-success',
      jobId: 'mock-render-success',
      status: 'completed',
      engine: SEEDANCE_ENGINE_ID,
      provider: 'replicate',
      characterId,
      characterName,
      characterAvatar,
      isDefaultSelfCharacter,
      prompt: activePrompt || ULTRA_SAFE_SCENE_PROMPT,
      outputUrl: mockVideoUrl,
      videoUrl: mockVideoUrl,
      generationMode: 'seedance-text-to-video',
      finalPrompt: ULTRA_SAFE_SCENE_PROMPT,
      model: 'bytedance/seedance-2.0-fast',
      displayEngine: 'Seedance Fast',
      createdAt: now,
      message: 'Mock verified output for QA only.',
    });
    setStatus('Cinematic draft ready.');
  }, [activePrompt, characterAvatar, characterId, characterName, isDefaultSelfCharacter, mockRenderSuccessUi]);

  useEffect(() => {
    if (!mockOutputMissingUi) return;

    setRenderPreference('success_first');
    setDuration(4);
    setAspectRatio('16:9');
    setEngine(SEEDANCE_ENGINE_ID);
    setGenerationStatusState('verifying_output');
    setGenerationError('');
    setGeneratedVideoUrl(null);
    setGenerationResult(null);
    setGenerationModerationStages([
      'Provider reported success, but Lumora did not find a usable video URL.',
      'Trying the next safe render path...',
    ]);
    setStatus('Lumora is checking the video output before marking this draft ready.');
  }, [mockOutputMissingUi]);

  useEffect(() => {
    if (!mockAllAttemptsBlockedUi) return;

    setRenderPreference('success_first');
    setDuration(4);
    setAspectRatio('16:9');
    setEngine(SEEDANCE_ENGINE_ID);
    setGenerationStatusState('failed');
    setGenerationFailureStatus('paused');
    setGenerationError('This scene needs a simpler direction before rendering.');
    setGenerationSafeRewrite(ULTRA_SAFE_SCENE_PROMPT);
    setGenerationResult(null);
    setGeneratedVideoUrl(null);
    setGenerationModerationDetail('Lumora tried the safe render ladder and preserved your draft.');
    setGenerationModerationStages([
      'Trying primary reference...',
      'Trying storybook cinematic take...',
      'Trying soft self guidance...',
    ]);
    setStatus('This scene needs a simpler direction before rendering.');
  }, [mockAllAttemptsBlockedUi]);

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
      setContinuityMemoryStatus(memory.id ? 'Story Memory is synced.' : 'Story Memory is ready.');
    }).catch((error) => {
      if (!active) return;
      setContinuityMemory(null);
      setContinuityMemoryDraft(emptyContinuityMemoryState);
      setContinuityMemoryLocks({});
      setContinuityMemoryError(creatorStoryMemoryErrorMessage(error));
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

  async function handleCopyRenderFailureDebugSummary() {
    if (!activeRenderFailure) return;
    const summary = renderFailureDebugSummary(activeRenderFailure);
    try {
      await navigator.clipboard.writeText(summary);
      showToast({ type: 'success', message: 'Copied safe render debug summary.' });
    } catch {
      showToast({ type: 'error', message: 'Could not copy debug summary automatically.' });
    }
  }

  function clearRenderCooldown() {
    setRenderCooldownUntil(null);
    setRenderCooldownSeconds(0);
  }

  function applyRenderCooldown(data: GenerateVideoApiResponse | GenerationResponse) {
    const seconds = retrySecondsForRender(data);
    const retryAvailableAt = typeof data.retryAvailableAt === 'string'
      ? data.retryAvailableAt
      : seconds > 0
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : null;

    setRenderCooldownUntil(retryAvailableAt);
    setRenderCooldownSeconds(seconds);
  }

  function beginGenerationProgress() {
    clearRenderCooldown();
    setActiveRenderFailure(null);
    setGenerationFailureStatus(null);
    setGenerationStatusState('queued');
    setStatus('Lumora is finding the cleanest render path...');
    if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      setGenerationStatusState('processing');
      setStatus('Trying primary reference...');
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

  function pauseGenerationProgressForCooldown(data: GenerateVideoApiResponse | GenerationResponse) {
    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    applyRenderCooldown(data);
    setGenerationStatusState('rate_limited');
  }

  function handleContinuityMemoryFieldChange(field: ContinuityMemoryField, value: string) {
    setContinuityMemoryDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setContinuityMemoryStatus('Story Memory updated.');
    setContinuityMemoryError('');
  }

  function handleContinuityMemoryLockChange(field: ContinuityMemoryField, locked: boolean) {
    setContinuityMemoryLocks((current) => ({
      ...current,
      [field]: locked,
    }));
    setContinuityMemoryStatus(locked ? `${continuityMemoryLabels[field]} held steady.` : `${continuityMemoryLabels[field]} free to evolve.`);
    setContinuityMemoryError('');
  }

  async function saveContinuityMemory(options: { silent?: boolean } = {}) {
    if (!sceneExecutorUserId) {
      if (!options.silent) setContinuityMemoryError('Sign in before saving Story Memory.');
      return null;
    }

    setContinuityMemorySaving(true);
    if (!options.silent) {
      setContinuityMemoryStatus('Saving Story Memory...');
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
        setContinuityMemoryStatus('Story Memory saved.');
        showToast({ type: 'success', message: 'Story Memory saved.' });
      }
      return memory;
    } catch (error) {
      const message = creatorStoryMemoryErrorMessage(error, 'Story Memory could not save. You can still draft scenes.');
      setContinuityMemoryError(message);
      if (!options.silent) showToast({ type: 'error', message });
      return null;
    } finally {
      setContinuityMemorySaving(false);
    }
  }

  async function buildCinematicStructureForPrompt(options: {
    visible?: boolean;
    source: 'generate' | 'advanced';
    promptOverride?: string;
  }): Promise<CreativeBrainScenePlan | null> {
    setCreativePlanLoading(true);
    setCreativePlanError('');
    setCreativePlanStatus(options.visible ? 'Lumora is shaping cinematic beats...' : '');

    try {
      const planPrompt = options.promptOverride ?? activePrompt;
      const styleTheme = selectedStylePrompt(selectedStyles, planPrompt);
      const response = await api.createCreativeBrainPlan({
        prompt: planPrompt,
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
      setSceneExecutionPlan(response.plan);
      setSceneExecutionError('');
      setSceneExecutionStatus('Cinematic beats are ready. Lumora is carrying them into the render.');
      setCreativePlanStatus('Cinematic beats are ready.');
      void trackCreatorEvent('first_storyboard_built', { source: options.source, characterId }, authUser?.id ?? null);
      return response.plan;
    } catch (error) {
      setCreativePlanError(error instanceof Error ? creatorFacingErrorMessage(error, 'Lumora will shape the scene directly this time.') : 'Lumora will shape the scene directly this time.');
      setCreativePlanStatus('');
      return null;
    } finally {
      setCreativePlanLoading(false);
    }
  }

  async function handleBuildCreativePlan() {
    if (!activePrompt.trim()) {
      setCreativePlanError('Add a scene idea before Lumora shapes cinematic beats.');
      return;
    }

    await buildCinematicStructureForPrompt({ visible: true, source: 'advanced' });
  }

  function handleCreativePlanDraftChange(value: string) {
    setCreativePlanDraft(value);
    const nextPlan = parseCreativePlanDraft(value);
    if (nextPlan) {
      setCreativePlan(nextPlan);
      setCreativePlanError('');
      setCreativePlanStatus('Cinematic beats updated.');
      setSceneExecutionResult(null);
      setSceneExecutionPlan(nextPlan);
      setSceneExecutionError('');
    } else {
      setCreativePlanError('Advanced cinematic structure edits need valid notes before Lumora can use them.');
    }
  }

  async function handleExecuteScenePlan() {
    if (sceneExecutionLoading) return;

    const activePlan = parseCreativePlanDraft(creativePlanDraft) ?? creativePlan;
    if (!activePlan) {
      setSceneExecutionError('Shape cinematic beats before starting the story flow.');
      return;
    }

    if (!sceneExecutorUserId) {
      setSceneExecutionError('Sign in before Scene Flow so Lumora can save each shot.');
      return;
    }

    if (!isSeedanceEngine) {
      setSceneExecutionError('Choose a cast-friendly render path before rendering this story flow.');
      return;
    }

    if (continuityMemoryDirty) {
      const savedMemory = await saveContinuityMemory({ silent: true });
      if (!savedMemory) {
        setSceneExecutionError('Save Story Memory before rendering your scene flow.');
        return;
      }
    }

    setSceneExecutionLoading(true);
    setSceneExecutionError('');
    setSceneExecutionStatus('Saving scene references...');
    setSceneExecutionPlan(activePlan);
    setSceneExecutionResult(null);

    try {
      const result = await api.executeScenePlan({
        scenePlan: activePlan,
        userId: sceneExecutorUserId,
        characterId,
        referenceImages: seedanceReferenceImages,
        quality: engine === SEEDANCE_QUALITY_ENGINE_ID ? 'quality' : 'fast',
        renderPreference,
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
      const scenePersistedAssetCount = persistedAssetCount(result.assetPersistence);
      if (scenePersistedAssetCount > 0) {
        void trackCreatorEvent(
          'asset_persisted',
          { source: 'scene-flow', persisted: scenePersistedAssetCount },
          sceneExecutorUserId,
        );
      }
      if (result.continuityMemory) {
        setContinuityMemory(result.continuityMemory);
        setContinuityMemoryDraft(normalizeContinuityMemoryState(result.continuityMemory.state));
        setContinuityMemoryLocks(result.continuityMemory.lockedFields);
        setContinuityMemoryStatus('Story Memory updated from scene progress.');
      }
      setSceneExecutionStatus(
        result.status === 'completed'
          ? `Scene continuity preserved across ${result.clips.length} cinematic shot${result.clips.length === 1 ? '' : 's'}.`
          : 'Your scene is saved, but no new video has completed yet.',
      );
      if (result.status === 'completed') {
        showToast({ type: 'success', message: 'Scene continuity preserved and saved to Drafts.' });
      } else {
        showToast({
          type: 'error',
          message: result.failedClip?.error
            ? creatorFacingErrorMessage(result.failedClip.error, 'That shot needs another take. Finished shots stayed saved.')
            : 'That shot needs another take. Finished shots stayed saved.',
        });
      }
    } catch (error) {
      const repairIssue = error instanceof ApiRequestError
        ? normalizeReferenceRepairIssue(error.payload)
        : null;
      if (repairIssue) {
        setReferenceRepair(repairIssue);
        setRepairStatus('');
      }
      const message = error instanceof ApiRequestError || error instanceof Error
        ? repairIssue
          ? 'One reference image needs to be re-uploaded before Lumora can use it.'
          : creatorFacingErrorMessage(error, friendlyCharacterProfileError(error))
        : 'Lumora could not finish shaping the cinematic beats yet.';
      setSceneExecutionError(message);
      setSceneExecutionStatus('');
      showToast({ type: 'error', message });
    } finally {
      setSceneExecutionLoading(false);
    }
  }

  function toggleSceneDescription(key: string) {
    setExpandedSceneDescriptions((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleContinueWithoutReference() {
    if (!activeReferenceRepair?.sourceUrl || !activeReferenceRepair.canContinueWithoutReference) return;
    setSkippedReferenceUrls((current) => Array.from(new Set([...current, activeReferenceRepair.sourceUrl as string])));
    setGenerationError('');
    setSceneExecutionError('');
    setReferenceRepair(null);
    setRepairStatus('');
    setStatus(`${activeReferenceRepair.label} skipped for this scene. Your saved cast profile stayed unchanged.`);
  }

  async function handleRemoveReferencePermanently() {
    if (!activeReferenceRepair?.sourceUrl || !activeReferenceRepair.slot) return;

    if (!isReferenceRepairIssueRemovable(activeReferenceRepair)) {
      setRepairStatus('Replace this required reference before removing it.');
      return;
    }

    setRepairUploading(true);
    setRepairStatus('Removing old reference...');
    try {
      if (!characterProfile) {
        setSkippedReferenceUrls((current) => Array.from(new Set([...current, activeReferenceRepair.sourceUrl as string])));
        setGenerationError('');
        setSceneExecutionError('');
        setReferenceRepair(null);
        setRepairStatus('This old reference was skipped for this scene. Open Your AI Cast to remove it permanently.');
        return;
      }

      const nextReferenceImageUrls = removeReferenceImageUrl(
        characterProfile.referenceImageUrls,
        activeReferenceRepair.slot,
      );
      let updated: CharacterProfile | null = null;

      if (authUser) {
        updated = await updateSupabaseCharacterReferenceImageUrls({
          userId: authUser.id,
          character: characterProfile,
          referenceImageUrls: nextReferenceImageUrls,
        });
      } else {
        updated = updateLocalCharacterProfile({
          characterId: characterProfile.id,
          referenceImageUrls: nextReferenceImageUrls,
        });
      }

      if (!updated) throw new Error('Cast member not found.');

      onCharacterUpdated?.(updated);
      setSkippedReferenceUrls((current) => Array.from(new Set([...current, activeReferenceRepair.sourceUrl as string])));
      setGenerationError('');
      setSceneExecutionError('');
      setReferenceRepair(null);
      setRepairStatus('Old reference removed. Your saved Lumora references will still be used.');
      setStatus('Old reference removed. You can continue with your saved Lumora references.');
      showToast({ type: 'success', message: 'Old reference removed.' });
    } catch (error) {
      setRepairStatus(error instanceof Error ? error.message : 'Unable to remove this reference yet.');
    } finally {
      setRepairUploading(false);
    }
  }

  async function handleRepairUpload(file: File | null | undefined) {
    if (!file || !activeReferenceRepair) return;

    const slot = activeReferenceRepair.slot;
    if (!slot) {
      setRepairStatus('Open Your AI Cast to replace this reference in the right cast slot.');
      return;
    }

    if (!authUser) {
      setRepairStatus('Sign in to save repaired references to Lumora.');
      return;
    }

    if (!characterProfile) {
      setRepairStatus('Open Your AI Cast to choose the cast member before replacing this reference.');
      return;
    }

    setRepairUploading(true);
    setRepairStatus('Saving reference to Lumora...');
    let uploadedUrl = '';
    try {
      const upload = await uploadLumoraMedia({
        userId: authUser.id,
        bucket: 'lumora-assets',
        file,
        folder: `reference-repairs/${characterProfile.id}`,
        usage: 'character_reference_image',
        entityType: 'character_profile',
        entityId: characterProfile.id,
      });
      uploadedUrl = upload.url;
      const nextReferenceImageUrls = patchReferenceImageUrls(characterProfile.referenceImageUrls, slot, uploadedUrl);
      const updated = await updateSupabaseCharacterProfile({
        userId: authUser.id,
        characterId: characterProfile.id,
        referenceImageUrls: nextReferenceImageUrls,
      });
      onCharacterUpdated?.(updated);
      setSkippedReferenceUrls((current) => current.filter((url) => url !== activeReferenceRepair.sourceUrl));
      setReferenceRepair(null);
      setGenerationError('');
      setSceneExecutionError('');
      setRepairStatus('Reference saved to Lumora.');
      setStatus('Reference saved to Lumora. You can retry the scene now.');
      showToast({ type: 'success', message: 'Reference saved to Lumora.' });
    } catch (error) {
      if (uploadedUrl) {
        const nextReferenceImageUrls = patchReferenceImageUrls(characterProfile.referenceImageUrls, slot, uploadedUrl);
        const updated = updateLocalCharacterProfile({
          characterId: characterProfile.id,
          referenceImageUrls: nextReferenceImageUrls,
        });
        if (updated) {
          onCharacterUpdated?.(updated);
          setSkippedReferenceUrls((current) => current.filter((url) => url !== activeReferenceRepair.sourceUrl));
          setReferenceRepair(null);
          setGenerationError('');
          setSceneExecutionError('');
          setRepairStatus('Reference saved to Lumora.');
          setStatus('Reference saved to Lumora. You can retry the scene now.');
          return;
        }
      }
      setRepairStatus(error instanceof Error ? error.message : 'Unable to save this reference yet.');
    } finally {
      setRepairUploading(false);
      if (repairFileInputRef.current) repairFileInputRef.current.value = '';
    }
  }

  function renderReferenceRepairActions() {
    if (!activeReferenceRepair) return null;

    return (
      <div className="button-row">
        <button
          type="button"
          className="primary-btn"
          disabled={repairUploading}
          onClick={() => repairFileInputRef.current?.click()}
        >
          {repairUploading ? 'Saving...' : 'Replace this reference'}
        </button>
        {isReferenceRepairIssueRemovable(activeReferenceRepair) ? (
          <button
            type="button"
            className="ghost-btn"
            disabled={repairUploading}
            onClick={() => void handleRemoveReferencePermanently()}
          >
            Remove this reference
          </button>
        ) : null}
        {activeReferenceRepair.canContinueWithoutReference ? (
          <button type="button" className="ghost-btn" onClick={handleContinueWithoutReference}>
            Continue without this reference
          </button>
        ) : null}
        {onResaveReferencePhoto ? (
          <button type="button" className="ghost-btn" onClick={onResaveReferencePhoto}>
            Open Your AI Cast
          </button>
        ) : null}
      </div>
    );
  }

  function handleApplyViralPreset(preset: ViralScenePreset) {
    setActivePrompt(applyViralScenePreset(activePrompt, preset));
    setViralPresetUsed(preset.id);
    setStatus(`${preset.label} added. Review the prompt before generating.`);
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }

  function handlePolishPrompt() {
    const polished = polishKlingCinematicPrompt(activePrompt);
    setActivePrompt(polished.prompt);
    setPromptPolished(true);
    setStatus(polished.promptPolished
      ? 'Prompt polished for Kling scene-first staging.'
      : 'Prompt already has strong cinematic staging.');
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }

  async function handleGenerate(options: {
    promptOverride?: string;
    renderPreferenceOverride?: RenderSuccessMode;
    durationOverride?: number;
    forceNewTake?: boolean;
    allowIdentityOnlyKlingFallback?: boolean;
    engineOverride?: VideoEngine;
    fallbackAttempted?: boolean;
  } = {}) {
    if (generationInFlightRef.current) return;

    const canStartFreshTakeFromPause = Boolean(options.forceNewTake && generationStatusState === 'failed');

    if (activeRenderJobId && generationStatusState !== 'rate_limited' && !canStartFreshTakeFromPause) {
      setStatus('Lumora is already rendering this scene and will save it to Drafts.');
      return;
    }

    if (generationStatusState === 'rate_limited' && renderCooldownSeconds > 0) {
      setStatus(cooldownBodyCopy(renderCooldownSeconds));
      return;
    }

    const releaseGenerateLock = () => {
      generationInFlightRef.current = false;
      setGenerationLoading(false);
    };

    const currentPrompt = options.promptOverride ?? activePrompt;
    const userPrompt = currentPrompt.trim();
    const selectedEngine = options.engineOverride ?? (stageSelectionMode === 'manual' ? engine : autoStageDecision.engine);
    const autoPromptPolish = selectedEngine === 'replicate'
      ? polishKlingCinematicPrompt(userPrompt)
      : { prompt: userPrompt, promptPolished: false, additions: [] };
    const renderPrompt = autoPromptPolish.prompt;
    const publicCaption = buildPublicCaptionFromPrompt(userPrompt);
    const selectedEngineRequiresBackend = !isDemoModeEngine(selectedEngine);
    const isDemoModeSelection = isDemoModeEngine(selectedEngine);

    if (!userPrompt) {
      setGenerationError('Add a prompt before generating.');
      setGenerationFailureStatus('failed');
      setGenerationStatusState('failed');
      releaseGenerateLock();
      return;
    }

    if (isDemoModeSelection) {
      generationInFlightRef.current = true;
      setGenerationLoading(true);
      const now = new Date().toISOString();
      const demoPreviewId = `demo-preview-${Date.now()}`;
      const demoVideoUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
      finishGenerationProgress('completed');
      setGeneratedVideoUrl(demoVideoUrl);
      setFinalGeneratedPrompt(userPrompt);
      setGeneratedDisplayEngine('Demo Mode');
      setGeneratedMode('text-to-video-fallback');
      setGenerationResult({
        id: demoPreviewId,
        jobId: demoPreviewId,
        status: 'completed',
        engine: 'mock',
        provider: 'mock',
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        prompt: userPrompt,
        outputUrl: demoVideoUrl,
        videoUrl: demoVideoUrl,
        generationMode: 'text-to-video-fallback',
        finalPrompt: userPrompt,
        model: 'demo-preview',
        displayEngine: 'Demo Mode',
        createdAt: now,
        message: 'Demo preview only. No real render was created.',
      });
      setGenerationWarnings(['Demo preview only. No real render was created.']);
      setStatus('Demo preview ready. No real render was created.');
      releaseGenerateLock();
      return;
    }

    if (selectedEngineRequiresBackend && healthDiagnosticsStatus === 'checking') {
      setStatus('Checking video engine. Try again in a moment.');
      return;
    }

    if (activeRenderJobId && generationStatusState === 'rate_limited') {
      generationInFlightRef.current = true;
      setGenerationLoading(true);
      try {
        const resumed = await api.resumeGenerationJob(activeRenderJobId);
        setActiveRenderJobId(asyncRenderJobId(resumed) ?? activeRenderJobId);
        if (resumed.status === 'rate_limited') {
          pauseGenerationProgressForCooldown(resumed);
        } else {
          clearRenderCooldown();
          setGenerationStatusState(resumed.status === 'queued' ? 'queued' : 'processing');
        }
        setGenerationError('');
        setStatus(asyncRenderStatusMessage(resumed));
        showToast({ type: 'success', message: 'Lumora is resuming the saved render path.' });
      } catch (error) {
        setStatus(creatorFacingErrorMessage(error, 'Lumora could not resume this render yet. It remains saved in Drafts.'));
      } finally {
        releaseGenerateLock();
      }
      return;
    }

    if (providerReadinessMessage) {
      setGenerationError(providerReadinessMessage);
      setGenerationFailureStatus('blocked');
      setGenerationStatusState('failed');
      setStatus(providerReadinessMessage);
      showToast({ type: 'error', message: providerReadinessMessage });
      return;
    }

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

    const selectedAspectRatio = aspectRatio;
    const selectedDuration = options.durationOverride ?? duration;
    const selectedRenderPreference = options.renderPreferenceOverride ?? renderPreference;
    const selectedSelfLikenessIntensity = selfLikenessIntensity;
    const selectedReferenceImageUrl = resolveRenderableReferenceUrl(referenceImageUrl) || selectedSelfReferenceImageUrl;
    const selectedKlingExactReadyForRequest = selectedEngine === 'replicate' && klingExactLikenessReady;
    const identityOnlyKlingFallbackRequest = Boolean(
      options.allowIdentityOnlyKlingFallback &&
      selectedKlingExactReadyForRequest,
    );
    setIdentityOnlyKlingFallbackActive(identityOnlyKlingFallbackRequest);

    if (selectedEngine === 'replicate' && !selectedReferenceImageUrl && !mockRateLimitUi) {
      setGenerationError('Add or re-save a public reference photo before generating.');
      setGenerationStatusState('failed');
      releaseGenerateLock();
      return;
    }

    const selectedIsSeedanceEngine = selectedEngine === SEEDANCE_ENGINE_ID || selectedEngine === SEEDANCE_QUALITY_ENGINE_ID;
    const selectedIsBackendProviderEngine = selectedIsSeedanceEngine || selectedEngine === 'veo' || selectedEngine === 'mock';
    const selectedFirstFrameCanaryActive =
      selectedIsSeedanceEngine &&
      selectedEngine === SEEDANCE_ENGINE_ID &&
      firstFrameCanaryActive &&
      autoStageDecision.route === 'seedance_fast_first_frame';
    const selectedFirstFrameImage = selectedFirstFrameCanaryActive
      ? seedanceReferenceImages[0] ?? null
      : null;
    const selectedSeedanceReferences: SeedanceReferenceImage[] = selectedIsSeedanceEngine
      ? selectedFirstFrameCanaryActive
        ? []
        : seedanceReferenceImages
      : [];
    const selectedSeedanceInputMode: SeedanceInputMode = selectedFirstFrameCanaryActive
      ? 'image_to_video_first_frame'
      : selectedSeedanceReferences.length > 0
        ? 'multimodal_reference'
        : 'text_to_video';
    const referenceImageForRequest = selectedIsSeedanceEngine
      ? null
      : selectedReferenceImageUrl;
    const selectedGenerationMode: GenerationMode = selectedIsSeedanceEngine
      ? selectedFirstFrameCanaryActive
        ? 'seedance-image-to-video-first-frame'
        : selectedSeedanceReferences.length > 0
          ? 'seedance-multimodal-reference'
          : 'seedance-text-to-video'
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
    setGenerationModerationDetail(identityOnlyKlingFallbackRequest ? identityOnlyKlingFallbackMessage : '');
    setGenerationModerationStages(identityOnlyKlingFallbackRequest
      ? ['Using identity-only Kling fallback', 'Animating with Kling Reference Beta']
      : []);
    setGeneratedVideoUrl(null);
    setFinalGeneratedPrompt('');
    setGeneratedModel('');
    setGeneratedDisplayEngine('');
    setGeneratedReferenceImageUrl(null);
    setGeneratedMode(null);
    setGenerationWarnings([]);
    setGenerationResult(null);
    setCreativePlan(null);
    setCreativePlanDraft('');
    setCreativePlanError('');
    setCreativePlanStatus('');
    setSceneExecutionPlan(null);
    setSceneExecutionResult(null);
    setSceneExecutionError('');
    setSceneExecutionStatus('');
    setStatus('');
    beginGenerationProgress();

    if (mockRateLimitUi) {
      const retryAfterSeconds = 10;
      pauseGenerationProgressForCooldown({
        status: 'rate_limited',
        retryAfterSeconds,
        retryAvailableAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
      });
      setGenerationError('');
      setStatus('Render queue is cooling down. Lumora will resume automatically.');
      showToast({
        type: 'error',
        message: 'Render queue is cooling down. Lumora will resume automatically.',
      });
      releaseGenerateLock();
      return;
    }

    try {
      if (continuityMemoryDirty && sceneExecutorUserId) {
        setStatus('Preserving Story Memory...');
        await saveContinuityMemory({ silent: true });
      }
      let invisiblePlan: CreativeBrainScenePlan | null = null;
      if (selectedRenderPreference === 'success_first') {
        setStatus('Story Memory is guiding this scene.');
      } else {
        setStatus('Shaping cinematic beats...');
        invisiblePlan = await buildCinematicStructureForPrompt({ source: 'generate', promptOverride: currentPrompt });
      }
      if (identityOnlyKlingFallbackRequest) {
        setStatus('Using identity-only Kling fallback...');
      } else if (selectedKlingExactReadyForRequest) {
        setStatus('Generating scene anchor...');
      } else if (invisiblePlan && selectedRenderPreference !== 'success_first') {
        setStatus('Preparing your cast for the render...');
      } else {
        setStatus('Lumora is finding the cleanest render path...');
      }

      const generationStylePrompt = selectedStylePrompt(selectedStyles, currentPrompt);
      const videoGenerationMode: GenerationMode = selectedGenerationMode;

      let data: GenerateVideoApiResponse;
      if (selectedIsSeedanceEngine) {
        const seedanceResult = await api.createSeedanceGeneration({
          title: draftTitle,
          prompt: renderPrompt,
          stylePreset: selectedStyles,
          userId: authUser?.id ?? identityProfile?.userId ?? null,
          engine: selectedEngine,
          quality: selectedEngine === SEEDANCE_QUALITY_ENGINE_ID ? 'quality' : 'fast',
          renderPreference: selectedRenderPreference,
          selfLikenessIntensity: selectedSelfLikenessIntensity,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          duration: selectedDuration,
          aspectRatio: selectedAspectRatio,
          resolution: '480p',
          generateAudio: false,
          maxProviderRequests: 1,
          referenceImages: selectedSeedanceReferences,
          firstFrameImage: selectedFirstFrameImage,
          inputMode: selectedSeedanceInputMode,
          referenceImageUrls: selectedFirstFrameCanaryActive ? undefined : referencePayload,
          additionalReferenceImageUrls: selectedFirstFrameCanaryActive ? [] : additionalReferenceImageUrls,
        });

        data = {
          id: seedanceResult.id,
          jobId: seedanceResult.jobId,
          status: seedanceResult.status,
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
          promptAdaptationApplied: seedanceResult.promptAdaptationApplied ?? null,
          providerRequestCount: seedanceResult.providerRequestCount ?? null,
          providerRetryCount: seedanceResult.providerRetryCount ?? null,
          providerFallbackCount: seedanceResult.providerFallbackCount ?? null,
          inputMode: seedanceResult.inputMode ?? selectedSeedanceInputMode,
          suggestedPrompt: seedanceResult.suggestedPrompt ?? undefined,
          sanitizedPrompt: seedanceResult.sanitizedPrompt ?? undefined,
          moderationDiagnostics: seedanceResult.moderationDiagnostics ?? undefined,
          warnings: seedanceResult.warnings ?? undefined,
          message: seedanceResult.message,
          progressLabel: seedanceResult.progressLabel ?? undefined,
          providerStatus: seedanceResult.providerStatus,
          providerPredictionId: seedanceResult.providerPredictionId,
          providerPredictionUrl: seedanceResult.providerPredictionUrl,
          providerFallbackStage: seedanceResult.providerFallbackStage,
          renderMode: seedanceResult.renderMode,
          duplicateOf: seedanceResult.duplicateOf,
          retryAfterSeconds: seedanceResult.retryAfterSeconds ?? null,
          retryAvailableAt: seedanceResult.retryAvailableAt ?? null,
          selfLikenessIntensity: seedanceResult.selfLikenessIntensity ?? selectedSelfLikenessIntensity,
          textSelfGuidanceAvailable: seedanceResult.textSelfGuidanceAvailable ?? null,
        };
      } else if (selectedIsBackendProviderEngine) {
        const providerResult = await api.createGeneration({
          title: draftTitle,
          prompt: renderPrompt,
          stylePreset: selectedStyles,
          userId: authUser?.id ?? identityProfile?.userId ?? null,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          duration: selectedDuration,
          aspectRatio: selectedAspectRatio,
          engine: selectedEngine,
          renderPreference: selectedRenderPreference,
          selfLikenessIntensity: selectedSelfLikenessIntensity,
        });

        if (providerResult.status === 'failed') {
          throw new Error(creatorFacingErrorMessage(
            [providerResult.error, providerResult.message, providerResult.providerStatus],
            'This renderer paused the scene safely.',
          ));
        }

        data = {
          id: providerResult.id,
          jobId: providerResult.jobId,
          status: providerResult.status,
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
          message: providerResult.message,
          progressLabel: providerResult.progressLabel ?? undefined,
          providerStatus: providerResult.providerStatus,
          retryAfterSeconds: providerResult.retryAfterSeconds ?? null,
          retryAvailableAt: providerResult.retryAvailableAt ?? null,
          selfLikenessIntensity: providerResult.selfLikenessIntensity ?? selectedSelfLikenessIntensity,
          textSelfGuidanceAvailable: providerResult.textSelfGuidanceAvailable ?? null,
        };
      } else {
        const res = await fetchApiResponse('/api/lumora/generate-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: renderPrompt,
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
            duration: selectedDuration,
            style: generationStylePrompt,
            audio: true,
            provider: 'replicate',
            engine: selectedEngine,
            renderPreference: selectedRenderPreference,
            selfLikenessIntensity: selectedSelfLikenessIntensity,
            generationMode: videoGenerationMode,
            exactLikenessRoute: selectedKlingExactReadyForRequest ? 'kling_reference' : null,
            exactLikenessReady: selectedKlingExactReadyForRequest,
            exactLikenessCanaryStatus: selectedKlingExactReadyForRequest ? 'canary_succeeded' : null,
            allowIdentityOnlyKlingFallback: Boolean(options.allowIdentityOnlyKlingFallback),
            viralPresetUsed,
            promptPolished,
          }),
        });

        const responseText = await res.text();
        const { data: parsedData, parseError } = parseGenerateResponse(responseText);

        if (!res.ok) {
          const renderFailure = normalizeRenderFailure(parsedData.renderFailure);
          if (renderFailure) {
            setActiveRenderFailure(renderFailure);
          }
          const detail = formatUnknownDetail(parsedData.details);
          const failureCategory = renderFailure?.category ?? (typeof parsedData.errorCategory === 'string' ? parsedData.errorCategory : null);
          const apiMessage = renderFailure?.safeMessage || parsedData.error || parseError || 'Lumora paused this scene.';
          const rawFailure = [apiMessage, failureCategory || '', parsedData.suggestion || '', detail].join(' ');
          console.error('Video generation request paused', {
            status: res.status,
            error: apiMessage,
            failureCategory,
            renderFailure: renderFailure
              ? {
                  stage: renderFailure.stage,
                  category: renderFailure.category,
                  sceneAnchorPromptLength: renderFailure.sceneAnchorPromptLength,
                  sceneAnchorPromptLimit: renderFailure.sceneAnchorPromptLimit,
                  sceneAnchorPromptCompressed: renderFailure.sceneAnchorPromptCompressed,
                  sceneAnchorPromptTruncated: renderFailure.sceneAnchorPromptTruncated,
                  sceneAnchorPayloadFieldNames: renderFailure.sceneAnchorPayloadFieldNames,
                  sceneAnchorSubmittedReferenceCount: renderFailure.sceneAnchorSubmittedReferenceCount,
                  sceneAnchorHttpStatus: renderFailure.sceneAnchorHttpStatus,
                  sceneAnchorPersisted: renderFailure.sceneAnchorPersisted,
                  assetPersistErrorType: renderFailure.assetPersistErrorType,
                  stage2HttpStatus: renderFailure.stage2HttpStatus,
                  privateUrlsRedacted: true,
                  secretsRedacted: true,
                }
              : null,
            details: detail,
          });
          if (selectedKlingExactReadyForRequest && renderFailure?.category) {
            throw new Error(renderFailure.safeMessage || klingProviderFailureMessage(renderFailure.category, apiMessage));
          }
          if (selectedKlingExactReadyForRequest && failureCategory) {
            throw new Error(klingProviderFailureMessage(failureCategory, apiMessage));
          }
          if (isProviderSafetyFilterError(rawFailure)) {
            throw new Error(selectedKlingExactReadyForRequest
              ? klingProviderFailureMessage('kling_provider_safety_filter', providerSafetyFilterMessage)
              : creatorFacingErrorMessage(rawFailure, providerSafetyFilterMessage));
          }
          if (isReplicateThrottledError(rawFailure)) {
            throw new Error(creatorFacingErrorMessage(rawFailure, replicateThrottledMessage));
          }
          if (isProviderQueueBusyError(rawFailure)) {
            throw new Error(creatorFacingErrorMessage(rawFailure, providerQueueBusyMessage));
          }

          throw new Error(creatorFacingErrorMessage(rawFailure, 'Lumora safely paused this scene.'));
        }

        if (parseError) {
          throw new Error(parseError);
        }

        data = parsedData;
      }

      console.log('GENERATION RESPONSE:', data);
      setActiveRenderFailure(null);
      if (selectedKlingExactReadyForRequest && data.sceneAnchorGenerated) {
        setStatus('Scene anchor approved. Animating with Kling Reference Beta...');
      }

      if (isAsyncRenderResponse(data)) {
        const jobId = asyncRenderJobId(data);
        if (!jobId) {
          throw new Error('Lumora started rendering, but the render job could not be tracked.');
        }

        setActiveRenderJobId(jobId);
        if (data.status === 'rate_limited') {
          pauseGenerationProgressForCooldown(data);
          setGenerationError('');
        } else {
          clearRenderCooldown();
          setGenerationStatusState(data.status === 'queued' ? 'queued' : 'processing');
        }
        setStatus(asyncRenderStatusMessage(data));
        setGenerationResult(null);
        setGeneratedVideoUrl(null);
        showToast({
          type: data.status === 'rate_limited' ? 'error' : 'success',
          message: data.status === 'rate_limited'
            ? 'Render queue is cooling down. Lumora saved this render so you can resume in a moment.'
            : data.duplicateOf
              ? 'Lumora found the current render and will keep checking it.'
              : 'Lumora is rendering your scene and will save it to Drafts.',
        });
        return;
      }

      const nextVideoUrl = getVerifiedVideoOutputUrl({
        videoUrl: data.videoUrl,
        outputUrl: data.outputUrl,
        resultAssetUrl: data.video,
      });
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
      const providerFallbackDiagnostics = isProviderFallbackDiagnostics(data.providerFallbackDiagnostics)
        ? data.providerFallbackDiagnostics
        : null;
      const renderedWithLighterCastGuidance = Boolean(providerFallbackDiagnostics?.renderedWithLighterCastGuidance);
      const responseSeedanceReferenceUrls = formatSeedanceReferenceUrls(data.referenceImages);
      const effectiveSeedanceReferences = selectedIsSeedanceEngine
        ? responseSeedanceReferenceUrls.length
          ? selectedSeedanceReferences.filter((reference) => responseSeedanceReferenceUrls.includes(reference.url))
          : renderedWithLighterCastGuidance
            ? []
            : selectedSeedanceReferences
        : [];
      const nextAdditionalReferenceImageUrls = selectedIsSeedanceEngine
        ? (responseSeedanceReferenceUrls.length
            ? responseSeedanceReferenceUrls
            : renderedWithLighterCastGuidance
              ? []
              : selectedSeedanceReferences.map((reference) => reference.url))
        : formatUrlList(data.additionalReferenceImageUrls).length
          ? formatUrlList(data.additionalReferenceImageUrls)
          : additionalReferenceImageUrls;
      const nextExactLikenessRoute = typeof data.exactLikenessRoute === 'string'
        ? data.exactLikenessRoute
        : selectedKlingExactReadyForRequest
          ? 'kling_reference'
          : null;
      const nextExactLikenessProvider = nextExactLikenessRoute === 'kling_reference' ? 'kling' : data.exactLikenessProvider ?? null;
      const nextExactLikenessCanaryStatus = typeof data.exactLikenessCanaryStatus === 'string'
        ? data.exactLikenessCanaryStatus
        : nextExactLikenessRoute === 'kling_reference'
          ? 'canary_succeeded'
          : null;
      const nextReferenceStrategy = typeof data.referenceStrategy === 'string'
        ? data.referenceStrategy
        : nextExactLikenessRoute === 'kling_reference'
          ? (nextAdditionalReferenceImageUrls.length ? 'direct_identity_references' : 'front_only_fallback')
          : null;
      const nextReferenceRolesUsed = formatStringList(data.referenceRolesUsed);
      const nextReferenceCount = typeof data.referenceCount === 'number'
        ? data.referenceCount
        : nextExactLikenessRoute === 'kling_reference'
          ? 1 + nextAdditionalReferenceImageUrls.length
          : null;
      const nextKlingDiagnostics = data.klingReferenceDiagnostics ?? null;
      const nextKlingDiagnosticsRecord = recordValue(nextKlingDiagnostics);
      const nextSceneAnchorStrategy = data.sceneAnchorStrategy ?? stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorStrategy');
      const nextSceneAnchorGenerated = typeof data.sceneAnchorGenerated === 'boolean'
        ? data.sceneAnchorGenerated
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorGenerated');
      const nextSceneAnchorPersisted = typeof data.sceneAnchorPersisted === 'boolean'
        ? data.sceneAnchorPersisted
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorPersisted');
      const nextSceneAnchorProvider = data.sceneAnchorProvider ?? stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorProvider');
      const nextSceneAnchorReason = data.sceneAnchorReason ?? stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorReason');
      const nextSceneAnchorFailureCategory = data.sceneAnchorFailureCategory ?? stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorFailureCategory');
      const nextSceneAnchorHttpStatus = typeof data.sceneAnchorHttpStatus === 'number'
        ? data.sceneAnchorHttpStatus
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorHttpStatus');
      const nextSceneAnchorErrorType = data.sceneAnchorErrorType ?? stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorErrorType');
      const nextSceneAnchorErrorMessage = data.sceneAnchorErrorMessageRedacted ??
        data.sceneAnchorErrorMessage ??
        stringFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorErrorMessage');
      const nextSceneAnchorPromptLength = typeof data.sceneAnchorPromptLength === 'number'
        ? data.sceneAnchorPromptLength
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorPromptLength');
      const nextSceneAnchorPromptLimit = typeof data.sceneAnchorPromptLimit === 'number'
        ? data.sceneAnchorPromptLimit
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorPromptLimit');
      const nextSceneAnchorPromptCompressed = typeof data.sceneAnchorPromptCompressed === 'boolean'
        ? data.sceneAnchorPromptCompressed
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorPromptCompressed');
      const nextSceneAnchorPromptTruncated = typeof data.sceneAnchorPromptTruncated === 'boolean'
        ? data.sceneAnchorPromptTruncated
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorPromptTruncated');
      const nextSceneAnchorPayloadFieldNames = formatStringList(data.sceneAnchorPayloadFieldNames).length
        ? formatStringList(data.sceneAnchorPayloadFieldNames)
        : formatStringList(nextKlingDiagnosticsRecord.sceneAnchorPayloadFieldNames);
      const nextSceneAnchorReferenceCount = typeof data.sceneAnchorReferenceCount === 'number'
        ? data.sceneAnchorReferenceCount
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorReferenceCount');
      const nextSceneAnchorSubmittedReferenceCount = typeof data.sceneAnchorSubmittedReferenceCount === 'number'
        ? data.sceneAnchorSubmittedReferenceCount
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorSubmittedReferenceCount');
      const nextSceneAnchorReferenceRolesUsed = formatStringList(data.sceneAnchorReferenceRolesUsed).length
        ? formatStringList(data.sceneAnchorReferenceRolesUsed)
        : formatStringList(nextKlingDiagnosticsRecord.sceneAnchorReferenceRolesUsed);
      const nextSceneAnchorDroppedReferenceRoles = formatStringList(data.sceneAnchorDroppedReferenceRoles).length
        ? formatStringList(data.sceneAnchorDroppedReferenceRoles)
        : formatStringList(nextKlingDiagnosticsRecord.sceneAnchorDroppedReferenceRoles);
      const nextSceneAnchorProviderReferenceLimit = typeof data.sceneAnchorProviderReferenceLimit === 'number'
        ? data.sceneAnchorProviderReferenceLimit
        : numberFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorProviderReferenceLimit');
      const nextSceneAnchorOutputParsed = typeof data.sceneAnchorOutputParsed === 'boolean'
        ? data.sceneAnchorOutputParsed
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'sceneAnchorOutputParsed');
      const nextSceneAnchorValidation =
        recordValue(data.sceneAnchorValidation).passed !== undefined
          ? recordValue(data.sceneAnchorValidation)
          : recordValue(nextKlingDiagnosticsRecord.sceneAnchorValidation);
      const nextPrimaryInputType = data.primaryInputType ?? stringFromRecord(nextKlingDiagnosticsRecord, 'primaryInputType');
      const nextPrimaryVideoInputType = data.primaryVideoInputType ?? stringFromRecord(nextKlingDiagnosticsRecord, 'primaryVideoInputType');
      const nextPrimaryVideoInputSource = data.primaryVideoInputSource ?? stringFromRecord(nextKlingDiagnosticsRecord, 'primaryVideoInputSource');
      const nextIdentityReferencesPassedToVideoStage = typeof data.identityReferencesPassedToVideoStage === 'boolean'
        ? data.identityReferencesPassedToVideoStage
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'identityReferencesPassedToVideoStage');
      const nextIdentityReferenceCount = typeof data.identityReferenceCount === 'number'
        ? data.identityReferenceCount
        : numberFromRecord(nextKlingDiagnosticsRecord, 'identityReferenceCount');
      const nextIdentityReferenceMode = data.identityReferenceMode ?? stringFromRecord(nextKlingDiagnosticsRecord, 'identityReferenceMode');
      const nextStartFrameSource = data.startFrameSource ?? stringFromRecord(nextKlingDiagnosticsRecord, 'startFrameSource');
      const nextPosterFrameSource = data.posterFrameSource ?? stringFromRecord(nextKlingDiagnosticsRecord, 'posterFrameSource');
      const nextFirstFrameSource = data.firstFrameSource ?? stringFromRecord(nextKlingDiagnosticsRecord, 'firstFrameSource');
      const nextStage2ProviderModel = data.stage2ProviderModel ?? stringFromRecord(nextKlingDiagnosticsRecord, 'stage2ProviderModel');
      const nextStage2ProviderRouteType = data.stage2ProviderRouteType ?? stringFromRecord(nextKlingDiagnosticsRecord, 'stage2ProviderRouteType');
      const nextRawReferenceVisualInputsSentToStage2 = typeof data.rawReferenceVisualInputsSentToStage2 === 'boolean'
        ? data.rawReferenceVisualInputsSentToStage2
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'rawReferenceVisualInputsSentToStage2');
      const nextSceneIntent = formatStringList(data.sceneIntent).length
        ? formatStringList(data.sceneIntent)
        : formatStringList(nextKlingDiagnosticsRecord.sceneIntent);
      const nextFramingIntent = data.framingIntent ?? stringFromRecord(nextKlingDiagnosticsRecord, 'framingIntent');
      const nextPrimaryReferenceRole = data.primaryReferenceRole ?? stringFromRecord(nextKlingDiagnosticsRecord, 'primaryReferenceRole');
      const nextSupportingReferenceRoles = formatStringList(data.supportingReferenceRoles).length
        ? formatStringList(data.supportingReferenceRoles)
        : formatStringList(nextKlingDiagnosticsRecord.supportingReferenceRoles);
      const nextUserSpecifiedOutfit = typeof data.userSpecifiedOutfit === 'boolean'
        ? data.userSpecifiedOutfit
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'userSpecifiedOutfit');
      const nextOutfitTermsDetected = formatStringList(data.outfitTermsDetected).length
        ? formatStringList(data.outfitTermsDetected)
        : formatStringList(nextKlingDiagnosticsRecord.outfitTermsDetected);
      const nextEnvironmentTermsDetected = formatStringList(data.environmentTermsDetected).length
        ? formatStringList(data.environmentTermsDetected)
        : formatStringList(nextKlingDiagnosticsRecord.environmentTermsDetected);
      const nextReferenceOutfitCarryoverSuppressed = typeof data.referenceOutfitCarryoverSuppressed === 'boolean'
        ? data.referenceOutfitCarryoverSuppressed
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'referenceOutfitCarryoverSuppressed');
      const nextCompositionCarryoverSuppressed = typeof data.compositionCarryoverSuppressed === 'boolean'
        ? data.compositionCarryoverSuppressed
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'compositionCarryoverSuppressed');
      const nextFrontOnlyFallback = typeof data.frontOnlyFallback === 'boolean'
        ? data.frontOnlyFallback
        : booleanFromRecord(nextKlingDiagnosticsRecord, 'frontOnlyFallback');
      const nextViralPresetUsed = typeof data.viralPresetUsed === 'string'
        ? data.viralPresetUsed
        : viralPresetUsed;
      const nextPromptPolished = typeof data.promptPolished === 'boolean'
        ? data.promptPolished
        : (promptPolished || autoPromptPolish.promptPolished);
      const nextAudioConfigured = typeof data.audioConfigured === 'boolean'
        ? data.audioConfigured
        : false;
      const generatedMedia = resolveGeneratedVideoMedia({
        videoUrl: nextVideoUrl,
        outputUrl: nextVideoUrl,
        thumbnailUrl: data.thumbnailUrl,
        posterUrl: data.posterUrl,
        previewImageUrl: data.previewImageUrl,
        referenceImageUrl: nextReferenceImageUrl,
        referenceImageUrls: referencePayload,
        referenceImages: effectiveSeedanceReferences,
        additionalReferenceImageUrls: nextAdditionalReferenceImageUrls,
        characterAvatar,
      });
      const nextThumbnailUrl = generatedMedia.thumbnailUrl;
      const nextPosterUrl = generatedMedia.posterUrl;
      const nextWarnings = formatCreatorWarnings([
        ...formatWarnings(data.warnings),
        ...(data.renderReliability?.creatorMessage ? [data.renderReliability.creatorMessage] : []),
        ...(data.sceneOptimization?.creatorMessage ? [data.sceneOptimization.creatorMessage] : []),
        ...moderationWarningMessages(data.moderationDiagnostics),
        ...providerFallbackWarningMessages(data.providerFallbackDiagnostics),
        ...(data.referenceImageNote ? [data.referenceImageNote] : []),
        ...(selectedIsSeedanceEngine && selectedSeedanceReferences.length === 1
          ? ['Only one image is uploaded. Add side, full-body, expression, or outfit references for stronger cast consistency.']
          : []),
      ]);
      const nextModerationStages = Array.from(new Set([
        ...moderationRetryStageMessages(data.moderationDiagnostics),
        ...providerFallbackStageMessages(data.providerFallbackDiagnostics),
      ]));

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('Lumora did not receive a playable scene yet.');
        setGenerationResult(null);
        setGeneratedVideoUrl(null);
        finishGenerationProgress('failed');
        showToast({ type: 'error', message: 'Lumora paused this scene before a video was returned.' });
        return;
      }

      const nextFinalPrompt = creatorVisibleFinalPrompt(data, userPrompt);
      const hiddenRenderPrompt = typeof data.finalPrompt === 'string' && data.finalPrompt.trim()
        ? data.finalPrompt.trim()
        : renderPrompt;
      const renderedWithIdentityOnlyKlingFallback = Boolean(
        nextExactLikenessRoute === 'kling_reference' &&
        nextSceneAnchorReason === 'identity_only_fallback_explicitly_selected' &&
        nextStage2ProviderRouteType === 'reference_to_video',
      );
      let studioSaveStatus = 'Video generated and saved to Drafts.';
      setGeneratedVideoUrl(nextVideoUrl);
      setFinalGeneratedPrompt(nextFinalPrompt);
      setGeneratedModel(data.model || '');
      setGeneratedDisplayEngine(nextDisplayEngine);
      setGeneratedReferenceImageUrl(nextReferenceImageUrl);
      setGeneratedMode(nextGenerationMode);
      setGenerationWarnings(nextWarnings);
      setGenerationModerationStages(nextModerationStages);
      const generatedPersistedAssetCount = persistedAssetCount(data.assetPersistence);
      if (generatedPersistedAssetCount > 0) {
        void trackCreatorEvent(
          'asset_persisted',
          { source: 'generation', persisted: generatedPersistedAssetCount },
          authUser?.id ?? null,
        );
      }

      const profile = authUser ? await loadSupabaseProfile(authUser.id) : loadLumoraProfile();
      if (selectedKlingExactReadyForRequest) {
        setStatus('Saving to Drafts');
      }
      const now = new Date().toISOString();
      const generationId = createLocalGenerationId();
      const renderedWithSoftSelfGuidance = Boolean(
        isDefaultSelfCharacter &&
        nextGenerationMode === 'seedance-text-to-video' &&
        (data.textSelfGuidanceAvailable || selectedRenderPreference === 'success_first')
      );
      const result: GenerationResponse = {
        id: generationId,
        jobId: generationId,
        status: 'completed',
        engine: selectedEngine,
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        prompt: userPrompt,
        outputUrl: nextVideoUrl,
        thumbnailUrl: nextThumbnailUrl,
        posterUrl: nextPosterUrl,
        thumbnailSource: generatedMedia.thumbnailSource,
        previewImageUrl: typeof data.previewImageUrl === 'string' ? data.previewImageUrl : null,
        generationMode: nextGenerationMode,
        moderationDiagnostics: isProviderModerationDiagnostics(data.moderationDiagnostics)
          ? data.moderationDiagnostics
          : null,
        providerFallbackDiagnostics,
        sceneOptimization: data.sceneOptimization ?? providerFallbackDiagnostics?.sceneOptimization ?? null,
        renderReliability: data.renderReliability ?? null,
        finalPrompt: hiddenRenderPrompt,
        model: data.model || null,
        displayEngine: nextDisplayEngine,
        referenceImageUrl: nextReferenceImageUrl,
        referenceImages: selectedIsSeedanceEngine
          ? effectiveSeedanceReferences
          : null,
        referenceImageCount: selectedIsSeedanceEngine
          ? effectiveSeedanceReferences.length
          : null,
        multimodalReferenceMode: selectedIsSeedanceEngine
          ? effectiveSeedanceReferences.length > 1
          : null,
        selfLikenessIntensity: data.selfLikenessIntensity ?? selectedSelfLikenessIntensity,
        textSelfGuidanceAvailable: data.textSelfGuidanceAvailable ?? null,
        exactLikenessRoute: nextExactLikenessRoute,
        exactLikenessAvailable: nextExactLikenessRoute === 'kling_reference',
        exactLikenessReason: nextExactLikenessRoute === 'kling_reference' ? 'Kling Reference Beta route is canary-proven.' : data.exactLikenessReason ?? null,
        exactLikenessProvider: nextExactLikenessProvider,
        exactLikenessCanaryStatus: nextExactLikenessCanaryStatus,
        referenceStrategy: nextReferenceStrategy,
        referenceRolesUsed: nextReferenceRolesUsed.length ? nextReferenceRolesUsed : null,
        referenceCount: nextReferenceCount,
        sceneAnchorStrategy: nextSceneAnchorStrategy,
        sceneAnchorGenerated: nextSceneAnchorGenerated,
        sceneAnchorPersisted: nextSceneAnchorPersisted,
        sceneAnchorProvider: nextSceneAnchorProvider,
        sceneAnchorReason: nextSceneAnchorReason,
        sceneAnchorFailureCategory: nextSceneAnchorFailureCategory,
        sceneAnchorHttpStatus: nextSceneAnchorHttpStatus,
        sceneAnchorErrorType: nextSceneAnchorErrorType,
        sceneAnchorErrorMessage: nextSceneAnchorErrorMessage,
        sceneAnchorPromptLength: nextSceneAnchorPromptLength,
        sceneAnchorPromptLimit: nextSceneAnchorPromptLimit,
        sceneAnchorPromptCompressed: nextSceneAnchorPromptCompressed,
        sceneAnchorPromptTruncated: nextSceneAnchorPromptTruncated,
        sceneAnchorPayloadFieldNames: nextSceneAnchorPayloadFieldNames.length ? nextSceneAnchorPayloadFieldNames : null,
        sceneAnchorReferenceCount: nextSceneAnchorReferenceCount,
        sceneAnchorSubmittedReferenceCount: nextSceneAnchorSubmittedReferenceCount,
        sceneAnchorReferenceRolesUsed: nextSceneAnchorReferenceRolesUsed.length ? nextSceneAnchorReferenceRolesUsed : null,
        sceneAnchorDroppedReferenceRoles: nextSceneAnchorDroppedReferenceRoles.length ? nextSceneAnchorDroppedReferenceRoles : null,
        sceneAnchorProviderReferenceLimit: nextSceneAnchorProviderReferenceLimit,
        sceneAnchorOutputParsed: nextSceneAnchorOutputParsed,
        sceneAnchorValidation: Object.keys(nextSceneAnchorValidation).length ? nextSceneAnchorValidation : null,
        primaryInputType: nextPrimaryInputType,
        primaryVideoInputType: nextPrimaryVideoInputType,
        primaryVideoInputSource: nextPrimaryVideoInputSource,
        identityReferencesPassedToVideoStage: nextIdentityReferencesPassedToVideoStage,
        identityReferenceCount: nextIdentityReferenceCount,
        identityReferenceMode: nextIdentityReferenceMode,
        startFrameSource: nextStartFrameSource,
        posterFrameSource: nextPosterFrameSource,
        firstFrameSource: nextFirstFrameSource,
        stage2ProviderModel: nextStage2ProviderModel,
        stage2ProviderRouteType: nextStage2ProviderRouteType,
        rawReferenceVisualInputsSentToStage2: nextRawReferenceVisualInputsSentToStage2,
        sceneIntent: nextSceneIntent.length ? nextSceneIntent : null,
        framingIntent: nextFramingIntent,
        primaryReferenceRole: nextPrimaryReferenceRole,
        supportingReferenceRoles: nextSupportingReferenceRoles.length ? nextSupportingReferenceRoles : null,
        userSpecifiedOutfit: nextUserSpecifiedOutfit,
        outfitTermsDetected: nextOutfitTermsDetected.length ? nextOutfitTermsDetected : null,
        environmentTermsDetected: nextEnvironmentTermsDetected.length ? nextEnvironmentTermsDetected : null,
        referenceOutfitCarryoverSuppressed: nextReferenceOutfitCarryoverSuppressed,
        compositionCarryoverSuppressed: nextCompositionCarryoverSuppressed,
        frontOnlyFallback: nextFrontOnlyFallback,
        klingReferenceDiagnostics: nextKlingDiagnostics,
        audioConfigured: nextAudioConfigured,
        viralPresetUsed: nextViralPresetUsed,
        promptPolished: nextPromptPolished,
        message: data.message && !isProviderTechnicalText(data.message)
          ? data.message
          : renderedWithIdentityOnlyKlingFallback
          ? identityOnlyKlingFallbackMessage
          : renderedWithLighterCastGuidance || renderedWithSoftSelfGuidance
          ? 'Rendered with soft self guidance.'
          : nextExactLikenessRoute === 'kling_reference'
          ? 'Kling Reference Beta scene created with scene-anchor identity planning.'
          : nextGenerationMode === 'seedance-multimodal-reference'
          ? 'Cast reference render created.'
          : nextGenerationMode === 'seedance-text-to-video'
          ? 'Cinematic video render created.'
          : nextGenerationMode === 'text-to-video-fallback'
          ? 'Text-only render created with soft self guidance.'
          : 'Kling self-reference video render created.',
        createdAt: now,
      };
      setGenerationResult(result);

      if (result.status === 'completed' && result.outputUrl) {
        const studioProject: StudioProject = {
          id: result.jobId,
          title: draftTitle,
          caption: publicCaption,
          prompt: userPrompt,
          finalPrompt: hiddenRenderPrompt,
          videoUrl: result.outputUrl,
          thumbnailUrl: nextThumbnailUrl,
          posterUrl: nextPosterUrl,
          thumbnailSource: generatedMedia.thumbnailSource,
          status: 'draft',
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
          exactLikenessRoute: nextExactLikenessRoute,
          exactLikenessProvider: nextExactLikenessProvider,
          exactLikenessCanaryStatus: nextExactLikenessCanaryStatus,
          referenceStrategy: nextReferenceStrategy,
          referenceRolesUsed: nextReferenceRolesUsed.length ? nextReferenceRolesUsed : null,
          referenceCount: nextReferenceCount,
          sceneAnchorStrategy: nextSceneAnchorStrategy,
          sceneAnchorGenerated: nextSceneAnchorGenerated,
          sceneAnchorPersisted: nextSceneAnchorPersisted,
          sceneAnchorProvider: nextSceneAnchorProvider,
          sceneAnchorReason: nextSceneAnchorReason,
          sceneAnchorFailureCategory: nextSceneAnchorFailureCategory,
          sceneAnchorHttpStatus: nextSceneAnchorHttpStatus,
          sceneAnchorErrorType: nextSceneAnchorErrorType,
          sceneAnchorErrorMessage: nextSceneAnchorErrorMessage,
          sceneAnchorPromptLength: nextSceneAnchorPromptLength,
          sceneAnchorPromptLimit: nextSceneAnchorPromptLimit,
          sceneAnchorPromptCompressed: nextSceneAnchorPromptCompressed,
          sceneAnchorPromptTruncated: nextSceneAnchorPromptTruncated,
          sceneAnchorPayloadFieldNames: nextSceneAnchorPayloadFieldNames.length ? nextSceneAnchorPayloadFieldNames : null,
          sceneAnchorReferenceCount: nextSceneAnchorReferenceCount,
          sceneAnchorSubmittedReferenceCount: nextSceneAnchorSubmittedReferenceCount,
          sceneAnchorReferenceRolesUsed: nextSceneAnchorReferenceRolesUsed.length ? nextSceneAnchorReferenceRolesUsed : null,
          sceneAnchorDroppedReferenceRoles: nextSceneAnchorDroppedReferenceRoles.length ? nextSceneAnchorDroppedReferenceRoles : null,
          sceneAnchorProviderReferenceLimit: nextSceneAnchorProviderReferenceLimit,
          sceneAnchorOutputParsed: nextSceneAnchorOutputParsed,
          sceneAnchorValidation: Object.keys(nextSceneAnchorValidation).length ? nextSceneAnchorValidation : null,
          primaryInputType: nextPrimaryInputType,
          primaryVideoInputType: nextPrimaryVideoInputType,
          primaryVideoInputSource: nextPrimaryVideoInputSource,
          identityReferencesPassedToVideoStage: nextIdentityReferencesPassedToVideoStage,
          identityReferenceCount: nextIdentityReferenceCount,
          identityReferenceMode: nextIdentityReferenceMode,
          startFrameSource: nextStartFrameSource,
          posterFrameSource: nextPosterFrameSource,
          firstFrameSource: nextFirstFrameSource,
          stage2ProviderModel: nextStage2ProviderModel,
          stage2ProviderRouteType: nextStage2ProviderRouteType,
          rawReferenceVisualInputsSentToStage2: nextRawReferenceVisualInputsSentToStage2,
          sceneIntent: nextSceneIntent.length ? nextSceneIntent : null,
          framingIntent: nextFramingIntent,
          primaryReferenceRole: nextPrimaryReferenceRole,
          supportingReferenceRoles: nextSupportingReferenceRoles.length ? nextSupportingReferenceRoles : null,
          userSpecifiedOutfit: nextUserSpecifiedOutfit,
          outfitTermsDetected: nextOutfitTermsDetected.length ? nextOutfitTermsDetected : null,
          environmentTermsDetected: nextEnvironmentTermsDetected.length ? nextEnvironmentTermsDetected : null,
          referenceOutfitCarryoverSuppressed: nextReferenceOutfitCarryoverSuppressed,
          compositionCarryoverSuppressed: nextCompositionCarryoverSuppressed,
          frontOnlyFallback: nextFrontOnlyFallback,
          renderProvider: nextExactLikenessRoute === 'kling_reference' ? 'kling' : generationProvider,
          klingReferenceDiagnostics: {
            ...recordValue(nextKlingDiagnostics),
            primaryVideoInputType: nextPrimaryVideoInputType,
            primaryVideoInputSource: nextPrimaryVideoInputSource,
            identityReferencesPassedToVideoStage: nextIdentityReferencesPassedToVideoStage,
            identityReferenceCount: nextIdentityReferenceCount,
            identityReferenceMode: nextIdentityReferenceMode,
            startFrameSource: nextStartFrameSource,
            posterFrameSource: nextPosterFrameSource,
            firstFrameSource: nextFirstFrameSource,
            stage2ProviderModel: nextStage2ProviderModel,
            stage2ProviderRouteType: nextStage2ProviderRouteType,
            rawReferenceVisualInputsSentToStage2: nextRawReferenceVisualInputsSentToStage2,
            sceneAnchorHttpStatus: nextSceneAnchorHttpStatus,
            sceneAnchorErrorType: nextSceneAnchorErrorType,
            sceneAnchorErrorMessage: nextSceneAnchorErrorMessage,
            sceneAnchorPromptLength: nextSceneAnchorPromptLength,
            sceneAnchorPromptLimit: nextSceneAnchorPromptLimit,
            sceneAnchorPromptCompressed: nextSceneAnchorPromptCompressed,
            sceneAnchorPromptTruncated: nextSceneAnchorPromptTruncated,
            sceneAnchorPayloadFieldNames: nextSceneAnchorPayloadFieldNames.length ? nextSceneAnchorPayloadFieldNames : null,
            sceneAnchorReferenceCount: nextSceneAnchorReferenceCount,
            sceneAnchorSubmittedReferenceCount: nextSceneAnchorSubmittedReferenceCount,
            sceneAnchorReferenceRolesUsed: nextSceneAnchorReferenceRolesUsed.length ? nextSceneAnchorReferenceRolesUsed : null,
            sceneAnchorDroppedReferenceRoles: nextSceneAnchorDroppedReferenceRoles.length ? nextSceneAnchorDroppedReferenceRoles : null,
            sceneAnchorProviderReferenceLimit: nextSceneAnchorProviderReferenceLimit,
            sceneAnchorOutputParsed: nextSceneAnchorOutputParsed,
            audioConfigured: nextAudioConfigured,
            viralPresetUsed: nextViralPresetUsed,
            promptPolished: nextPromptPolished,
          },
          audioConfigured: nextAudioConfigured,
          viralPresetUsed: nextViralPresetUsed,
          promptPolished: nextPromptPolished,
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
            studioSaveStatus = 'Video generated. Account save failed, so a local Drafts backup was saved.';
            setGenerationWarnings((current) => [
              ...current,
              creatorFacingWarningMessage(
                saveError instanceof Error
                  ? `Account save failed: ${saveError.message}. A local Drafts backup was saved.`
                  : 'Account save failed. A local Drafts backup was saved.',
              ) ?? 'A local Drafts backup was saved.',
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
      void trackCreatorEvent('first_draft_created', { source: 'generation', engine }, authUser?.id ?? null);
      showToast({
        type: 'success',
        message: isProviderFallbackDiagnostics(data.providerFallbackDiagnostics) &&
          data.providerFallbackDiagnostics.stages.some((stage) => stage.status === 'blocked')
          ? 'Lumora found a safer cinematic route.'
          : 'Your cinematic draft is saved. Continue the story from Drafts when ready.',
      });
    } catch (error) {
      console.error('Generation failed', error);
      const message = error instanceof Error ? error.message : 'Unable to create draft render';
      const apiPayload = error instanceof ApiRequestError ? error.payload : null;
      const moderationPayload = isProviderModerationPayload(apiPayload) ? apiPayload : null;
      if (
        !options.fallbackAttempted &&
        stageSelectionMode === 'auto' &&
        selectedEngine === 'replicate' &&
        autoStageDecision.fallbackEngine === SEEDANCE_ENGINE_ID &&
        !moderationPayload &&
        !isProviderSafetyFilterError(message) &&
        !isReplicateThrottledError(message)
      ) {
        setGenerationModerationDetail('Lumora tried the best Stage route and switched to a safer fallback.');
        setGenerationModerationStages(['Trying Kling Reference Beta route', 'Switching to Seedance Fast fallback']);
        setGenerationError('');
        setStatus('Lumora tried the best Stage route and switched to a safer fallback.');
        releaseGenerateLock();
        await handleGenerate({
          promptOverride: userPrompt,
          renderPreferenceOverride: selectedRenderPreference,
          durationOverride: selectedDuration,
          forceNewTake: true,
          engineOverride: SEEDANCE_ENGINE_ID,
          fallbackAttempted: true,
        });
        return;
      }
      if (error instanceof ApiRequestError && error.status === 429) {
        const retryAfterSeconds = retrySecondsFromPayload(apiPayload) ?? 10;
        const rateLimitedData: GenerateVideoApiResponse = {
          status: 'rate_limited',
          retryAfterSeconds,
          retryAvailableAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
        };
        pauseGenerationProgressForCooldown(rateLimitedData);
        setGenerationSafeRewrite('');
        setGenerationModerationDetail('');
        setGenerationModerationStages([]);
        setGenerationError('');
        setStatus('Render queue is cooling down. Lumora will resume automatically.');
        showToast({
          type: 'error',
          message: `Render queue is cooling down. Lumora will resume automatically in ${retryAfterSeconds} seconds.`,
        });
        return;
      }
      if (
        selectedKlingExactReadyForRequest &&
        !options.forceNewTake &&
        isClearlySafeKlingPrompt(currentPrompt) &&
        isKlingComplexityError(message)
      ) {
        const overrides = successFirstOverrides(selectedDuration);
        setActivePrompt(ULTRA_SAFE_SCENE_PROMPT);
        setRenderPreference(overrides.renderPreference);
        setDuration(overrides.duration);
        setGenerationSafeRewrite(ULTRA_SAFE_SCENE_PROMPT);
        setGenerationModerationDetail('Lumora simplified the safe garden prompt and kept Kling Reference Beta selected.');
        setGenerationModerationStages(['Trying Kling Reference Beta render', 'Saving to Drafts']);
        setGenerationError('');
        setStatus('Trying Kling Reference Beta render...');
        releaseGenerateLock();
        await handleGenerate({
          promptOverride: ULTRA_SAFE_SCENE_PROMPT,
          renderPreferenceOverride: overrides.renderPreference,
          durationOverride: overrides.duration,
          forceNewTake: true,
        });
        return;
      }
      const repairIssue = normalizeReferenceRepairIssue(apiPayload);
      if (repairIssue) {
        setReferenceRepair(repairIssue);
        setRepairStatus('');
      }
      const providerFallbackPayload = isProviderFallbackDiagnostics(moderationPayload?.providerFallbackDiagnostics)
        ? moderationPayload.providerFallbackDiagnostics
        : null;
      const firstFrameModeration = Boolean(
        moderationPayload &&
        selectedFirstFrameCanaryActive
      );
      const suggestedRewrite = firstFrameModeration
        ? ''
        :
        providerFallbackPayload?.suggestedPrompt ||
        providerFallbackPayload?.sanitizedPrompt ||
        moderationPayload?.suggestedPrompt ||
        moderationPayload?.sanitizedPrompt ||
        '';
      const retryStages = firstFrameModeration ? [] : Array.from(new Set([
        ...moderationRetryStageMessages(moderationPayload?.moderationDiagnostics),
        ...providerFallbackStageMessages(providerFallbackPayload),
      ]));
      const displayMessage = options.fallbackAttempted
        ? 'Lumora could not complete this route. Your draft is saved.'
        : firstFrameModeration
        ? 'Seedance paused this image-to-video first-frame animation at provider moderation. Your scene is preserved.'
        : moderationPayload
        ? providerFallbackPayload
          ? 'This scene needs a simpler direction before rendering.'
          : providerModerationMessage
        : repairIssue
        ? 'One reference image needs to be re-uploaded before Lumora can use it.'
        : isProviderSafetyFilterError(message)
        ? providerSafetyFilterMessage
        : isReplicateThrottledError(message)
          ? replicateThrottledMessage
        : isProviderQueueBusyError(message)
          ? providerQueueBusyMessage
        : creatorFacingErrorMessage(error, 'Lumora safely paused this scene.');
      setGenerationSafeRewrite(suggestedRewrite);
      setGenerationModerationDetail(
        repairIssue
          ? assetRepairCopy(repairIssue)
          : firstFrameModeration
          ? 'No retry or fallback was attempted. Save Draft remains available.'
          : providerFallbackPayload
          ? 'Lumora kept your cast and Story Memory intact. Try the safer rewrite, simplify the scene, or save the draft before another take.'
          : moderationPayload?.suggestion && !isProviderTechnicalText(moderationPayload.suggestion)
            ? moderationPayload.suggestion
            :
        (moderationPayload
          ? 'Lumora preserved your cast, Story Memory, and story flow while adapting the style for cinematic safety.'
          : creatorFacingPausedDetail(error)),
      );
      setGenerationModerationStages(retryStages);
      if (moderationPayload) {
        void trackCreatorEvent('moderation_adapted', { source: 'create', engine }, authUser?.id ?? null);
      } else {
        void trackCreatorEvent('generation_failed', { source: 'create', engine }, authUser?.id ?? null);
      }
      setGenerationError(
        isSoraEngine && !isProviderSafetyFilterError(displayMessage) && !moderationPayload
          ? `${displayMessage} Self-character likeness is currently using the reference-led video path.`
          : displayMessage,
      );
      setGenerationFailureStatus(generationFailureStatusFor(error, {
        moderation: Boolean(moderationPayload),
        referenceRepair: Boolean(repairIssue),
      }));
      finishGenerationProgress('failed');
      showToast({
        type: 'error',
        message: firstFrameModeration
          ? 'First-frame animation paused. No retry or fallback occurred.'
          : moderationPayload
          ? 'Lumora is trying a softer cinematic direction.'
          : 'Lumora paused this scene. You can retry when ready.',
      });
    } finally {
      releaseGenerateLock();
    }
  }

  async function handleTrySuggestedTake() {
    const safeTake = suggestedTakePrompt;
    const overrides = successFirstOverrides(duration);

    setActivePrompt(safeTake);
    setRenderPreference(overrides.renderPreference);
    if (overrides.duration !== duration) {
      setDuration(overrides.duration);
    }
    setGenerationSafeRewrite('');
    setGenerationModerationDetail('');
    setGenerationModerationStages([]);
    setGenerationError('');
    setStatus('Lumora is trying a gentler cinematic take.');
    void trackCreatorEvent('continue_story_clicked', {
      source: 'create_suggested_take',
      renderPreference: overrides.renderPreference,
      shortenedDuration: overrides.duration !== duration,
    }, authUser?.id ?? null);

    await handleGenerate({
      promptOverride: safeTake,
      renderPreferenceOverride: overrides.renderPreference,
      durationOverride: overrides.duration,
      forceNewTake: true,
    });
  }

  function handleUseSaferSceneIdea() {
    const overrides = successFirstOverrides(duration);

    setActivePrompt(ULTRA_SAFE_SCENE_PROMPT);
    setRenderPreference('success_first');
    setStageSelectionMode('manual');
    setEngine(SEEDANCE_ENGINE_ID);
    setDuration(overrides.duration);
    setGenerationSafeRewrite('');
    setGenerationModerationDetail('');
    setGenerationModerationStages([]);
    setGenerationError('');
    setGenerationFailureStatus(null);
    setPromptPolished(true);
    setStatus('Safer scene idea loaded. Review it, then tap Generate.');
    void trackCreatorEvent('continue_story_clicked', {
      source: 'create_safer_scene_adaptation',
      renderPreference: 'success_first',
      shortenedDuration: overrides.duration !== duration,
    }, authUser?.id ?? null);
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }

  async function handleUseIdentityOnlyKlingFallback() {
    setGenerationSafeRewrite('');
    setIdentityOnlyKlingFallbackActive(true);
    setGenerationModerationDetail(identityOnlyKlingFallbackMessage);
    setGenerationModerationStages(['Using identity-only Kling fallback', 'Animating with Kling Reference Beta']);
    setGenerationError('');
    setStatus('Using identity-only Kling fallback...');
    await handleGenerate({
      forceNewTake: true,
      allowIdentityOnlyKlingFallback: true,
    });
  }

  async function handleSaveDraft() {
    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    const scenePrompt = activePrompt.trim();
    if (!scenePrompt) {
      setStatus('Add a scene idea before saving.');
      return;
    }

    setBusy(true);
    setStatus('Saving draft...');

    try {
      const now = new Date().toISOString();
      const profile = loadLumoraProfile();
      const draftEngine = stageSelectionMode === 'manual' ? engine : autoStageDecision.engine;
      const displayEngine = stageSelectionMode === 'auto'
        ? firstFrameCanaryActive
          ? 'Seedance Fast — first-frame animation'
          : 'Lumora Auto Stage'
        : draftEngine === SEEDANCE_ENGINE_ID
        ? 'Seedance Fast'
        : draftEngine === SEEDANCE_QUALITY_ENGINE_ID
          ? 'Seedance Quality'
          : draftEngine === 'replicate'
            ? 'Kling Reference'
            : engineLabels[draftEngine] ?? draftEngine;
      const studioDraft: StudioProject = {
        id: createLocalGenerationId(),
        title: draftTitle.trim() || 'Untitled scene',
        caption: buildPublicCaptionFromPrompt(scenePrompt),
        prompt: scenePrompt,
        finalPrompt: scenePrompt,
        videoUrl: '',
        thumbnailUrl: null,
        posterUrl: null,
        thumbnailSource: null,
        status: 'draft',
        provider: draftEngine,
        engine: draftEngine,
        aspectRatio,
        model: null,
        displayEngine,
        generationMode: selectedGenerationMode,
        identityId: identityProfile?.identityId ?? null,
        identityPrompt: identityProfile?.identityPrompt ?? null,
        consistencyPrompt: identityProfile?.generationConsistencyPrompt ?? null,
        canonicalReferenceSet: identityProfile?.canonicalReferenceSet ?? null,
        keyframeUrl: null,
        referenceImageUrl: selectedSelfReferenceImageUrl,
        referenceImageUrls: referencePayload,
        additionalReferenceImageUrls,
        exactLikenessRoute: null,
        exactLikenessProvider: null,
        exactLikenessCanaryStatus: null,
        referenceStrategy: null,
        referenceRolesUsed: null,
        referenceCount: readySeedanceReferenceCount,
        sceneAnchorStrategy: null,
        sceneAnchorGenerated: null,
        sceneAnchorPersisted: null,
        sceneAnchorProvider: null,
        sceneAnchorReason: null,
        sceneAnchorFailureCategory: null,
        sceneAnchorHttpStatus: null,
        sceneAnchorErrorType: null,
        sceneAnchorErrorMessage: null,
        sceneAnchorPromptLength: null,
        sceneAnchorPromptLimit: null,
        sceneAnchorPromptCompressed: null,
        sceneAnchorPromptTruncated: null,
        sceneAnchorPayloadFieldNames: null,
        sceneAnchorReferenceCount: null,
        sceneAnchorSubmittedReferenceCount: null,
        sceneAnchorReferenceRolesUsed: null,
        sceneAnchorDroppedReferenceRoles: null,
        sceneAnchorProviderReferenceLimit: null,
        sceneAnchorOutputParsed: null,
        sceneAnchorValidation: null,
        primaryInputType: null,
        primaryVideoInputType: null,
        primaryVideoInputSource: null,
        identityReferencesPassedToVideoStage: null,
        identityReferenceCount: null,
        identityReferenceMode: null,
        startFrameSource: null,
        posterFrameSource: null,
        firstFrameSource: null,
        stage2ProviderModel: null,
        stage2ProviderRouteType: null,
        rawReferenceVisualInputsSentToStage2: null,
        sceneIntent: null,
        framingIntent: null,
        primaryReferenceRole: null,
        supportingReferenceRoles: null,
        userSpecifiedOutfit: null,
        outfitTermsDetected: null,
        environmentTermsDetected: null,
        referenceOutfitCarryoverSuppressed: null,
        compositionCarryoverSuppressed: null,
        frontOnlyFallback: null,
        renderProvider: null,
        klingReferenceDiagnostics: null,
        audioConfigured: null,
        viralPresetUsed,
        promptPolished,
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        creatorName: profile.displayName || 'Lumora Creator',
        creatorUsername: profile.username || 'lumora.creator',
        creatorAvatar: profile.avatar || null,
        createdAt: now,
        updatedAt: now,
      };

      if (authUser) {
        try {
          await saveSupabaseProject(authUser.id, studioDraft);
          setStatus('Draft saved to your account.');
        } catch (saveError) {
          console.error('Account draft save failed; saving local draft backup.', saveError);
          saveStudioProject(studioDraft);
          setStatus('Account save is unavailable, so a local Drafts backup was saved.');
        }
        void trackCreatorEvent('first_draft_created', { source: 'manual-save' }, authUser.id);
      } else {
        saveStudioProject(studioDraft);
        setStatus('Draft saved locally.');
        void trackCreatorEvent('first_draft_created', { source: 'manual-save' }, null);
      }
    } catch (error) {
      console.error('Unable to save draft.', error);
      setStatus('Unable to save draft.');
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
    setStatus('Scene direction loaded for another take.');
  }

  async function handleSubmitLikenessFeedback() {
    if (!onLikenessFeedback || (!selectedFeedbackChoices.length && !feedbackNote.trim())) return;

    setFeedbackStatus('Saving cast feedback...');
    try {
      await onLikenessFeedback({
        choices: selectedFeedbackChoices,
        customNote: feedbackNote.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
      setFeedbackStatus('Feedback saved for future cast consistency.');
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
      <section className="editor-card lumora-card create-luxury-card">
        <div>
          <h3>Create an AI cast video</h3>
        </div>

        {schemaWarning ? (
          <div className="generation-warning-list schema-warning-card" role="status">
            <p>{schemaWarning}</p>
          </div>
        ) : null}

        {providerReadinessMessage ? (
          <div className="generation-warning-list schema-warning-card" role="status">
            <p>{providerReadinessMessage}</p>
          </div>
        ) : null}
        {autoDemoFallbackActive ? (
          <div className="generation-warning-list schema-warning-card" role="status">
            <p>Demo Mode is available for this preview and uses no render credits. Save Draft remains available.</p>
            <p className="muted">{providerConfigurationMessage(engine)}</p>
          </div>
        ) : null}

        <details className="advanced-create-details minimal-title-details">
          <summary>Title</summary>
          <label className="field-block">
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Scene title" />
          </label>
        </details>

        <label className="field-block minimal-scene-idea">
          <div className="row-between create-scene-heading-row">
            <span>Scene idea</span>
            <button type="button" className="ghost-btn compact-action" onClick={handlePolishPrompt} disabled={!hasPrompt}>
              Prompt polish
            </button>
          </div>
          <textarea
            ref={promptTextareaRef}
            value={activePrompt}
            onChange={(event) => setActivePrompt(event.target.value)}
            rows={5}
            placeholder="Describe the generated scene for your cast member..."
          />
        </label>

        <div className="cast-summary-card focused-cast-summary-card">
          <div>
            <strong>{characterName ? (isDefaultSelfCharacter ? 'Soft self guidance selected' : characterName) : 'Choose or create your AI Cast'}</strong>
            <p className="muted">
              {!characterName
                ? 'Choose or create your AI Cast'
                : isSeedanceEngine
                ? `${readySeedanceReferenceCount} reference${readySeedanceReferenceCount === 1 ? '' : 's'} ready`
                : hasGenerationReference
                  ? 'Reference ready'
                  : 'Choose a cast reference'}
            </p>
            {onResaveReferencePhoto ? (
              <button
                type="button"
                className="ghost-btn reference-setup-btn"
                onClick={onResaveReferencePhoto}
              >
                Open Your AI Cast
              </button>
            ) : null}
          </div>
          {characterAvatar ? (
            <img src={characterAvatar} alt="" />
          ) : (
            <span className="cast-summary-placeholder">Cast</span>
          )}
        </div>

        <details className="advanced-create-details ai-cast-readiness-card" aria-label="Sora-worthy readiness checklist">
          <summary>Cast readiness</summary>
          <div className="row-between create-section-header">
            <div className="ai-cast-readiness-heading create-section-heading">
              <span className="eyebrow">SORA-WORTHY READINESS</span>
              <strong>AI Cast Studio checklist</strong>
            </div>
            <span className="tiny-pill">Studio mode</span>
          </div>
          <div className="ai-cast-readiness-grid">
            {aiCastReadiness.map((item) => (
              <span key={item.key} className={`readiness-chip ${item.ready ? 'ready' : 'pending'}`}>
                <strong>{item.label}</strong>
                <small>{item.status}</small>
              </span>
            ))}
          </div>
        </details>

        <details className="advanced-create-details viral-polish-panel" aria-label="Viral AI cast scene tools">
          <summary>Scene presets</summary>
          <div className="row-between create-section-header">
            <div className="viral-polish-heading create-section-heading">
              <span className="eyebrow">VIRAL SCENE PRESETS</span>
              <strong>Tap a safe AI-cast setup</strong>
            </div>
            <span className="tiny-pill">Secondary tool</span>
          </div>
          <div className="chip-row wrap viral-preset-row">
            {featuredViralScenePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`chip ${viralPresetUsed === preset.id ? 'active' : ''}`}
                onClick={() => handleApplyViralPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {additionalViralScenePresets.length ? (
            <details className="compact-reference-details caption-helper-details">
              <summary>More presets</summary>
              <div className="chip-row wrap viral-preset-row">
                {additionalViralScenePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`chip ${viralPresetUsed === preset.id ? 'active' : ''}`}
                    onClick={() => handleApplyViralPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          <details className="compact-reference-details caption-helper-details">
            <summary>Caption helper</summary>
            <div className="caption-helper-grid">
              <p><strong>Short</strong>{captionSuggestions.short}</p>
              <p><strong>Dramatic</strong>{captionSuggestions.dramatic}</p>
              <p><strong>Reality-show</strong>{captionSuggestions.realityShow}</p>
              <p><strong>Dreamy</strong>{captionSuggestions.dreamyCinematic}</p>
            </div>
          </details>
        </details>

        <div className="field-block minimal-style-field">
          <span>Cinematic style</span>
          <div className="chip-row wrap">
            {STYLE_PRESETS.slice(0, 5).map((style) => (
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
          {STYLE_PRESETS.length > 5 ? (
            <details className="compact-reference-details">
              <summary>More styles</summary>
              <div className="chip-row wrap">
                {STYLE_PRESETS.slice(5).map((style) => (
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
            </details>
          ) : null}
        </div>

        <div className="continuity-memory-panel focused-memory-moment">
          <div className="row-between">
            <div>
              <strong>{storyMemoryMoment}</strong>
            </div>
            <span className="tiny-pill continuity-confidence-pill">{continuityConfidencePercent}%</span>
          </div>
          {continuityMemoryLoading ? <p className="muted">Syncing Story Memory...</p> : null}
          {continuityMemoryStatus ? <p className="muted">{continuityMemoryStatus}</p> : null}
          {continuityMemoryError ? <p className="creative-plan-error">{continuityMemoryError}</p> : null}
          <details className="advanced-create-details continuity-memory-details">
            <summary>View memory details</summary>
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
                <span className="eyebrow">Continuity notes</span>
                {recentDriftAlerts.map((alert) => (
                  <p key={`${alert.field}-${alert.detectedAt}-${alert.clipOrder}`}>
                    <strong>{continuityMemoryLabels[alert.field]}</strong> {alert.reason}
                  </p>
                ))}
              </div>
            ) : null}
            {recentSceneMemorySummaries.length ? (
              <div className="scene-memory-summary-list">
                <span className="eyebrow">Scene memories</span>
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
                {sceneExecutorUserId ? (continuityMemoryDirty ? 'Unsaved changes' : 'Continuity synced.') : 'Sign in to save memory'}
              </small>
            </div>
          </details>
        </div>

        {creativePlan && activeReferenceRepair && sceneExecutionResult && false && (
        <details className="advanced-create-details cinematic-flow-details">
          <summary>View cinematic structure</summary>
          <div className="creative-brain-panel">
          <div className="row-between">
            <div>
              <span className="eyebrow">Story flow</span>
              <strong>Cinematic beats before rendering</strong>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void handleBuildCreativePlan()}
              disabled={creativePlanLoading || !hasPrompt}
            >
              {creativePlanLoading ? 'Shaping...' : creativePlan ? 'Refresh cinematic beats' : 'Shape cinematic beats'}
            </button>
          </div>
          <p className="muted">
            Lumora shapes your idea into cinematic beats before anything starts rendering.
          </p>
          {creativePlanStatus ? <p className="muted">{creativePlanStatus}</p> : null}
          {creativePlanError ? <p className="creative-plan-error">{creativePlanError}</p> : null}
          {creativePlan ? (
            <div className="creative-plan-preview">
              <div className="creative-plan-summary">
                <span><strong>Tone</strong>{creativePlan!.cinematicTone}</span>
                <span><strong>Style</strong>{creativePlan!.visualStyle}</span>
                <span><strong>Sound</strong>{creativePlan!.soundtrackMood}</span>
              </div>
              <p><strong>Environment:</strong> {creativePlan!.environmentDescription}</p>
              <p><strong>Pacing:</strong> {creativePlan!.emotionalPacing}</p>
              <ol className="creative-shot-list">
                {creativePlan!.shotList.map((shot) => (
                  <li key={shot.id}>
                    <strong>{shot.title}</strong>
                    <span>{shot.description}</span>
                    <small>{shot.cameraFraming} / {shot.cameraMovement} / {shot.transition}</small>
                  </li>
                ))}
              </ol>
              <details className="creative-plan-editor-shell">
                <summary>Advanced cinematic structure</summary>
                <label className="field-block creative-plan-editor">
                  <span>Structured scene notes</span>
                  <textarea
                    value={creativePlanDraft}
                    onChange={(event) => handleCreativePlanDraftChange(event.target.value)}
                    rows={12}
                  />
                </label>
              </details>
              <div className="scene-executor-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleExecuteScenePlan()}
                  disabled={sceneExecuteBusy}
                  aria-busy={sceneExecutionLoading}
                  title={sceneExecuteDisabledReason || undefined}
                >
                  {sceneExecutionLoading ? 'Preserving story flow...' : 'Render cinematic beats'}
                </button>
                <small className="muted">
                  {sceneExecuteDisabledReason || 'Renders one beat at a time while keeping the story flow intact.'}
                </small>
              </div>
              {sceneExecutionStatus ? <p className="muted">{sceneExecutionStatus}</p> : null}
              {sceneExecutionError ? (
                <div className="generation-error-card scene-flow-error-card">
                  <p>{sceneExecutionError}</p>
                  <p>Your cinematic work is preserved. Resume when you are ready.</p>
                </div>
              ) : null}
              {sceneExecutionError && activeReferenceRepair ? (
                <div className="reference-repair-panel">
                  <div>
                    <span className="eyebrow">reference repair</span>
                    <h3>{assetRepairTitle(activeReferenceRepair!)}</h3>
                    <p>{activeReferenceRepair!.label}</p>
                    <p className="muted">{assetRepairCopy(activeReferenceRepair!)}</p>
                  </div>
                  {renderReferenceRepairActions()}
                  {repairStatus ? <p className="muted">{repairStatus}</p> : null}
                </div>
              ) : null}
              {sceneExecutionPlan || sceneExecutionResult ? (
                <div className="scene-progress-panel" aria-live="polite">
                  <div className="row-between">
                    <div>
                      <span className="eyebrow">Scene Flow</span>
                      <strong>Rendering the sequence</strong>
                    </div>
                    <span className="tiny-pill">
                      {sceneExecutionLoading
                        ? 'Rendering'
                        : sceneExecutionResult?.status === 'completed'
                          ? 'Completed'
                          : sceneExecutionResult?.status === 'failed'
                            ? 'Paused'
                            : 'Queued'}
                    </span>
                  </div>
                  <ol className="scene-progress-list">
                    {sceneExecutionResult
                      ? sceneExecutionResult!.clips.map((clip) => {
                          const clipModerationStages = moderationRetryStageMessages(
                            clip.moderationDiagnostics ?? clip.metadata.moderationOrchestration,
                          );
                          const clipProviderFallbackStages = providerFallbackStageMessages(
                            clip.providerFallbackDiagnostics ?? clip.metadata.providerFallback,
                          );
                          const clipDescription = clip.metadata.shotDescription || clip.title;
                          const clipDescriptionKey = `clip-${clip.id}`;
                          const clipExpanded = expandedSceneDescriptions.has(clipDescriptionKey);
                          const clipCanExpand = clipDescription.length > 180;
                          const clipSafeError = clip.error
                            ? generationStatusState === 'failed'
                              ? 'Shot paused safely.'
                              : creatorFacingErrorMessage(clip.error, 'This shot paused safely.')
                            : '';
                          const clipHasAdaptation = clipModerationStages.length > 0 || clipProviderFallbackStages.length > 0;

                          return (
                            <li key={clip.id} className={`scene-progress-item ${clip.status}`}>
                              <span className="scene-progress-index">{clip.clipOrder}</span>
                              <div className="scene-progress-body">
                                <div className="scene-progress-title-row">
                                  <strong>{clip.title}</strong>
                                  <span className="tiny-pill scene-status-pill">{creatorSceneStatusLabel(clip.status)}</span>
                                </div>
                                <p className={`scene-shot-description ${clipExpanded ? 'expanded' : ''}`}>
                                  {clipDescription}
                                </p>
                                <div className="scene-shot-meta">
                                  <span>{clip.metadata.cameraFraming}</span>
                                  <span>{clip.metadata.cameraMovement}</span>
                                </div>
                                {clipHasAdaptation ? (
                                  <small className="scene-shot-note">Creative adaptation guided this shot.</small>
                                ) : null}
                                {clipSafeError ? <small className="scene-shot-safe-error">{clipSafeError}</small> : null}
                                {clipCanExpand ? (
                                  <button type="button" className="text-btn scene-expand-btn" onClick={() => toggleSceneDescription(clipDescriptionKey)}>
                                    {clipExpanded ? 'Collapse scene' : 'Expand scene'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })
                      : sceneExecutionPlan?.shotList.map((shot, index) => {
                          const shotDescriptionKey = `shot-${shot.id}`;
                          const shotExpanded = expandedSceneDescriptions.has(shotDescriptionKey);
                          const shotCanExpand = shot.description.length > 180;

                          return (
                            <li
                              key={shot.id}
                              className={`scene-progress-item ${sceneExecutionLoading && index === 0 ? 'processing' : 'queued'}`}
                            >
                              <span className="scene-progress-index">{index + 1}</span>
                              <div className="scene-progress-body">
                                <div className="scene-progress-title-row">
                                  <strong>{shot.title}</strong>
                                  <span className="tiny-pill scene-status-pill">
                                    {sceneExecutionLoading && index === 0 ? 'Rendering' : 'Queued'}
                                  </span>
                                </div>
                                <p className={`scene-shot-description ${shotExpanded ? 'expanded' : ''}`}>
                                  {shot.description}
                                </p>
                                <div className="scene-shot-meta">
                                  <span>{shot.cameraFraming}</span>
                                  <span>{shot.cameraMovement}</span>
                                </div>
                                {shotCanExpand ? (
                                  <button type="button" className="text-btn scene-expand-btn" onClick={() => toggleSceneDescription(shotDescriptionKey)}>
                                    {shotExpanded ? 'Collapse scene' : 'Expand scene'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                  </ol>
                  {sceneExecutionResult?.clips.some((clip) => Boolean(clip.videoUrl)) ? (
                    <div className="scene-clip-timeline">
                      {sceneExecutionResult!.clips
                        .filter((clip) => Boolean(clip.videoUrl))
                        .map((clip) => (
                          <article key={`${clip.id}-video`} className="scene-clip-card">
                            <div className="row-between">
                              <span className="eyebrow">Shot {clip.clipOrder}</span>
                              <span className="tiny-pill">{clip.model || sceneExecutionResult!.engine}</span>
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
        </details>
        )}

        <div className="field-block minimal-duration-field">
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
          {renderPreference === 'success_first' ? (
            <small className="muted">Success First helps Lumora land the first generated AI cast video before adding complexity.</small>
          ) : null}
        </div>

        <div className="field-block minimal-aspect-field">
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

        <details className="advanced-create-details minimal-render-feel">
          <summary>Render feel</summary>
          <div className="field-block">
            <div className="chip-row wrap render-preference-row">
              {renderPreferenceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chip render-preference-chip ${renderPreference === option.value ? 'active' : ''}`}
                  onClick={() => setRenderPreference(option.value)}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <small className="muted">
              {renderPreferenceOptions.find((option) => option.value === renderPreference)?.description}
            </small>
          </div>
          {selfReferenceMode && isSeedanceEngine ? (
            <div className="field-block">
              <span>Self likeness</span>
              <div className="chip-row wrap" role="radiogroup" aria-label="Self likeness intensity">
                {selfLikenessOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selfLikenessIntensity === option.value}
                    className={`chip ${selfLikenessIntensity === option.value ? 'active' : ''}`}
                    onClick={() => setSelfLikenessIntensity(option.value)}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <small className="muted">
                {selfLikenessOptions.find((option) => option.value === selfLikenessIntensity)?.description}
              </small>
            </div>
          ) : null}
        </details>

        <section className="renderer-details stage-main-card" aria-label="Lumora Stage">
          <div className="row-between create-section-header">
            <div className="create-section-heading">
              <span className="eyebrow">LUMORA STAGE</span>
              <strong>{stageSelectionMode === 'auto' ? 'Lumora Auto Stage' : selectedStageOption.label}</strong>
            </div>
            <span className="tiny-pill">{stageSelectionMode === 'auto' ? 'Auto' : selectedStageOption.speed}</span>
          </div>
          <p className="muted stage-main-copy">
            {stageSelectionMode === 'auto'
              ? 'Lumora chooses the safest available render path for this scene.'
              : selectedStageOption.description}
          </p>
          {firstFrameCanaryEligible ? (
            <div className="reference-mode-copy">
              <strong>Seedance Fast — first-frame animation</strong>
              <span className="muted">
                Proposed no-fallback route: animate the single Front face image as the first frame.
              </span>
              <button
                type="button"
                className={`ghost-btn ${firstFrameCanaryActive ? 'active' : ''}`}
                onClick={() => {
                  setStageSelectionMode('auto');
                  setFirstFrameCanaryEnabled((enabled) => !enabled);
                  setDuration(4);
                  setAspectRatio('9:16');
                  setStatus('First-frame route prepared. No render has started.');
                }}
              >
                {firstFrameCanaryActive ? 'First-frame route prepared' : 'Prepare first-frame route'}
              </button>
              <small className="muted">This only selects the route. Generate remains a separate action.</small>
            </div>
          ) : null}
          <details className="advanced-create-details stage-technical-details">
            <summary>Stage details</summary>
            <small className="muted">{stageSelectionMode === 'auto' ? autoStageDecision.reason : engineRoutingMessage}</small>
            <div className="button-row" style={{ marginTop: '12px' }}>
              <button
                type="button"
                className={`ghost-btn ${stageSelectionMode === 'auto' ? 'active' : ''}`}
                onClick={() => setStageSelectionMode('auto')}
              >
                Auto Stage
              </button>
            </div>
            <div className="provider-grid" role="radiogroup" aria-label="Lumora Stage provider override">
              {providerOptions.map((option) => {
                const optionActive = stageSelectionMode === 'manual' && engine === option.engine;
                const optionKling = option.engine === 'replicate';
                const optionKlingReady = optionKling && klingExactLikenessReady;
                const optionSeedanceFast = option.engine === SEEDANCE_ENGINE_ID;
                const optionDemoMode = option.engine === 'mock';
                return (
                  <button
                    key={option.engine}
                    type="button"
                    role="radio"
                    aria-checked={optionActive}
                    className={`provider-option ${optionActive ? 'active' : ''} ${optionKlingReady ? 'ready' : ''}`}
                    onClick={() => {
                      setStageSelectionMode('manual');
                      setFirstFrameCanaryEnabled(false);
                      setEngine(option.engine);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <span className="provider-meta">
                      <span>Speed {option.speed}</span>
                      <span>Quality {option.quality}</span>
                      {optionSeedanceFast ? <span>Safest first render</span> : null}
                      {optionDemoMode ? <span>No credits</span> : null}
                      {optionKling ? (
                        <>
                          <span>Beta</span>
                          <span>{optionKlingReady ? 'Exact-likeness ready' : 'Needs AI Cast setup'}</span>
                        </>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </details>
        </section>

        <div className="reference-mode-card focused-reference-summary">
          <div className="reference-mode-copy">
            <strong>
              {referenceLoading
                ? 'Preparing your cast...'
                : demoModeActive
                  ? 'Stage preview'
                  : isSeedanceEngine
                    ? `${readySeedanceReferenceCount} reference${readySeedanceReferenceCount === 1 ? '' : 's'} ready`
                    : hasGenerationReference
                      ? 'Cast reference ready'
                      : 'Save a reference before rendering'}
            </strong>
            {showReferenceSetupGuidance ? (
              <>
                <span className="muted reference-setup-prompt">
                  Open Your AI Cast to add front, side, or full-body reference media before a real render.
                </span>
                {onResaveReferencePhoto ? (
                  <button
                    type="button"
                    className="ghost-btn reference-setup-btn"
                    onClick={onResaveReferencePhoto}
                  >
                    Open Your AI Cast
                  </button>
                ) : null}
              </>
            ) : null}
            {seedanceMultimodalActive ? (
              <span className="tiny-pill multimodal-reference-badge">Cast reference mode</span>
            ) : null}
            {seedanceSingleReferenceWarning ? (
              <span className="seedance-reference-warning">
                Only one image uploaded. Add side, full-body, expression, or outfit references for stronger cast consistency.
              </span>
            ) : null}
            {successFirstLighterReferencePath && !klingExactReadyOnOtherRenderer ? (
              <>
                <span className="muted">Lumora will use your saved look as text guidance first.</span>
                <span className="muted">Photo likeness is saved, but this renderer needs a lighter identity path.</span>
              </>
            ) : null}
            {selfReferenceMode ? (
              <div style={{ display: 'grid', gap: '6px', marginTop: '10px' }}>
                <span className="tiny-pill" style={{ width: 'fit-content' }}>{selfCharacterProviderStatusLabel}</span>
                <span className="muted">{selfCharacterProviderStatusCopy}</span>
                {showKlingReferenceSwitch ? (
                  <button
                    type="button"
                    className="ghost-btn kling-reference-switch-btn"
                    onClick={() => setEngine('replicate')}
                  >
                    Try Kling Reference Beta
                  </button>
                ) : null}
                {sceneAnchorGuidance ? (
                  <div className={`scene-anchor-guidance-card ${sceneAnchorConfigured ? 'ready' : 'pending'}`}>
                    <strong>{sceneAnchorGuidance.title}</strong>
                    <span>{sceneAnchorGuidance.body}</span>
                    <small>{sceneAnchorGuidance.helper}</small>
                  </div>
                ) : null}
                {!effectiveVerificationVideoPresent && onOpenSelfVerificationSetup ? (
                  <button
                    type="button"
                    className="text-btn"
                    style={{ width: 'fit-content', padding: 0 }}
                    onClick={onOpenSelfVerificationSetup}
                  >
                    Add self verification video
                  </button>
                ) : null}
              </div>
            ) : null}
            {isSeedanceEngine && seedanceReferenceCount > 0 ? (
              <details className="compact-reference-details">
                <summary>
                  {readySeedanceReferenceCount} cast reference{readySeedanceReferenceCount === 1 ? '' : 's'} saved to Lumora
                </summary>
                <div className="seedance-reference-list" aria-label="Cast references">
                  {seedanceReferenceImages.map((reference) => {
                    const slot = referenceSlotForSeedanceReference(reference);
                    const optional = !(reference.role === 'front_angle' || reference.role === 'side_angle');
                    const status = referenceStatus(reference.url, optional);
                    return (
                      <span key={`${reference.token}-${reference.url}`} className={`reference-status-chip ${status.kind}`}>
                        {reference.token} {reference.label || 'Reference image'}
                        <small>{status.label}</small>
                        {slot ? null : <small>Optional</small>}
                      </span>
                    );
                  })}
                </div>
              </details>
            ) : null}
            {selfReferenceMode && effectiveUiEngine === 'replicate' ? (
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                <span className="tiny-pill" style={{ width: 'fit-content' }}>{identityStatusLabel}</span>
                <span className="muted">
                  Lumora will use your feedback to improve future scenes and cast consistency.
                </span>
              </div>
            ) : null}
            {selfReferenceMode && effectiveUiEngine === 'replicate' && onResaveReferencePhoto ? (
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
                required={effectiveUiEngine === 'replicate' && selfReferenceMode}
              />
            </div>
          ) : null}
          {primaryReferenceImage.label || selfReferenceMode || isSeedanceEngine ? (
            <span className="tiny-pill reference-mode-pill">
              {isSeedanceEngine
                ? `${readySeedanceReferenceCount} cast reference${readySeedanceReferenceCount === 1 ? '' : 's'}`
                : referenceLabel || primaryReferenceImage.label || 'Saved self character'}
            </span>
          ) : null}
        </div>

        {selfReferenceMode && effectiveUiEngine === 'replicate' && isHydrated ? (
          <details className="advanced-create-details reference-detail-shell">
            <summary>Lumora Cast Reference</summary>
            <div className="reference-grid" style={{ gap: '8px' }}>
              {identityReferenceCards.map((item) => (
                  <div key={item.label} className="reference-upload" style={{ padding: '8px', minHeight: 'unset' }}>
                    <span>{item.label}</span>
                    <SelfReferencePreview
                      label={item.label}
                      reference={item.reference}
                      required={item.required}
                    />
                    <span className={`reference-status-badge ${referenceStatus(item.reference.url ?? item.reference.path, !item.required).kind}`}>
                      {referenceStatus(item.reference.url ?? item.reference.path, !item.required).label}
                    </span>
                  </div>
                ))}
            </div>
          </details>
        ) : null}

        <input
          ref={repairFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(event) => void handleRepairUpload(event.target.files?.[0])}
        />

        {activeReferenceRepair && !generationError && !sceneExecutionError ? (
          <div className="reference-repair-panel">
            <div>
              <span className="eyebrow">reference repair</span>
              <h3>{assetRepairTitle(activeReferenceRepair)}</h3>
              <p>{activeReferenceRepair.label}</p>
              <p className="muted">{assetRepairCopy(activeReferenceRepair)}</p>
            </div>
            {activeReferenceRepair.sourceUrl ? (
              <div className="reference-repair-preview">
                <img src={activeReferenceRepair.sourceUrl} alt={`${activeReferenceRepair.label} preview`} />
              </div>
            ) : null}
            {renderReferenceRepairActions()}
            {repairStatus ? <p className="muted">{repairStatus}</p> : null}
          </div>
        ) : null}

        <div className="button-row luxury-action-row">
          <button
            type="button"
            className={`primary-btn cinematic-generate-btn state-${generationStatusState}`}
            onClick={() => {
              if (castSetupIncomplete && onResaveReferencePhoto) {
                onResaveReferencePhoto();
                return;
              }
              void (generationError && !activeReferenceRepair
                ? handleGenerate({ forceNewTake: true })
                : handleGenerate());
            }}
            disabled={generationError && !activeReferenceRepair ? tryTakeBusy : generateButtonDisabled}
            aria-busy={generateBusy}
          >
            {generateCtaLabel}
          </button>
          <button type="button" className="quiet-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
            Save draft
          </button>
        </div>
        {castSetupIncomplete ? (
          <p className="muted">Add at least one saved AI Cast reference before generating a real scene.</p>
        ) : demoModeActive ? (
          <p className="muted">Demo preview only. No render credits will be used.</p>
        ) : null}
        {visibleRenderState && !(generationError && generationStatusState === 'failed') ? (
          <div
            className={`render-state-card render-state-${visibleRenderState.tone} ${generationStatusState === 'rate_limited' ? 'rate-limit-card' : ''}`}
            role="status"
            aria-live="polite"
          >
            <div className="render-state-topline">
              <span className="tiny-pill">{visibleRenderState.label}</span>
              {activeRenderJobId || generationStatusState === 'rate_limited' ? (
                <span className="render-state-safe-note">Scene saved</span>
              ) : null}
            </div>
            <div className="render-state-copy">
              <strong>{visibleRenderState.headline}</strong>
              <p>{visibleRenderState.body}</p>
            </div>
            <div className="generation-progress compact" aria-hidden="true">
              <span className="active">{visibleRenderState.label}</span>
              {generationStatusState === 'rate_limited' ? (
                <span>{renderCooldownSeconds > 0 ? 'Queue cooldown' : 'Ready to resume'}</span>
              ) : generationStatusState === 'processing' || generationStatusState === 'queued' ? (
                <span>Drafts autosave</span>
              ) : null}
            </div>
            {(generationStatusState === 'queued' || generationStatusState === 'processing' || generationStatusState === 'rate_limited') ? (
              <ol className="success-ladder-progress" aria-label="Render progress">
                {[
                  selectedKlingExactReady ? 'Generating scene anchor' : 'Preparing cast',
                  selectedKlingExactReady
                    ? 'Scene anchor approved'
                    : successFirstLighterReferencePath ? 'Creating soft self-guided draft' : 'Trying storybook cinematic take',
                  selectedKlingExactReady ? 'Animating with Kling Reference Beta' : 'Saving to Drafts',
                  ...(selectedKlingExactReady ? ['Saving to Drafts'] : []),
                ].map((step, index) => (
                  <li key={step} className={index === 0 || generationStatusState === 'processing' ? 'active' : ''}>
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}
            {generationStatusState === 'rate_limited' ? (
              <div className="render-state-actions">
                <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
                  Save draft
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {showCinematicStructure ? (
          <details className="advanced-create-details cinematic-flow-details invisible-flow-details">
            <summary>
              <span>{cinematicStructureSummary}</span>
              <span className="minimal-structure-status">{cinematicStructureStatusLabel}</span>
            </summary>
            <div className="minimal-structure-body">
              {creativePlanStatus ? <p className="muted">{creativePlanStatus}</p> : null}
              {creativePlanError ? <p className="muted">{creativePlanError}</p> : null}
              {creativePlan ? (
                <div className="minimal-structure-metadata">
                  <details className="creative-plan-editor-shell compact-metadata-details">
                    <summary>Details</summary>
                    <div className="creative-plan-summary">
                      <span><strong>Tone</strong>{creativePlan.cinematicTone}</span>
                      <span><strong>Style</strong>{creativePlan.visualStyle}</span>
                      <span><strong>Sound</strong>{creativePlan.soundtrackMood}</span>
                    </div>
                    <p><strong>Environment:</strong> {creativePlan.environmentDescription}</p>
                    <p><strong>Pacing:</strong> {creativePlan.emotionalPacing}</p>
                  </details>
                  <details className="creative-plan-editor-shell">
                    <summary>Edit structure</summary>
                    <label className="field-block creative-plan-editor">
                      <textarea
                        value={creativePlanDraft}
                        onChange={(event) => handleCreativePlanDraftChange(event.target.value)}
                        rows={12}
                      />
                    </label>
                  </details>
                </div>
              ) : creativePlanLoading ? (
                <p className="minimal-structure-note cinematic-shimmer">Shaping the beats...</p>
              ) : null}
              {sceneExecutionStatus ? <p className="muted">{sceneExecutionStatus}</p> : null}
              {sceneExecutionError ? (
                <p className="minimal-structure-note">Your scene is preserved. Resume when you are ready.</p>
              ) : null}
              {sceneExecutionPlan || sceneExecutionResult ? (
                <div className="minimal-timeline-shell" aria-live="polite">
                  <ol className="minimal-beat-timeline">
                    {sceneExecutionResult
                      ? sceneExecutionResult.clips.map((clip) => {
                          const clipDescription = clip.metadata.shotDescription || clip.title;
                          const clipDescriptionKey = `visible-clip-${clip.id}`;
                          const clipExpanded = expandedSceneDescriptions.has(clipDescriptionKey);
                          const clipCanExpand = clipDescription.length > 180;
                          const clipSafeError = clip.error
                            ? generationStatusState === 'failed'
                              ? 'Shot paused safely.'
                              : creatorFacingErrorMessage(clip.error, 'This shot paused safely.')
                            : '';

                          return (
                            <li key={clip.id} className={`minimal-beat-item ${clip.status}`}>
                              <span className="minimal-beat-index">{clip.clipOrder}</span>
                              <div className="minimal-beat-body">
                                <div className="minimal-beat-title-row">
                                  <strong>{clip.title}</strong>
                                  <span className="minimal-beat-status">{creatorSceneStatusLabel(clip.status)}</span>
                                </div>
                                <p className={`minimal-beat-description ${clipExpanded ? 'expanded' : ''}`}>
                                  {clipDescription}
                                </p>
                                {clipSafeError ? <small className="minimal-beat-note">{clipSafeError}</small> : null}
                                {clipCanExpand ? (
                                  <button type="button" className="text-btn scene-expand-btn" onClick={() => toggleSceneDescription(clipDescriptionKey)}>
                                    {clipExpanded ? 'Collapse scene' : 'Expand scene'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })
                      : sceneExecutionPlan?.shotList.map((shot, index) => {
                          const shotDescriptionKey = `visible-shot-${shot.id}`;
                          const shotExpanded = expandedSceneDescriptions.has(shotDescriptionKey);
                          const shotCanExpand = shot.description.length > 180;

                          return (
                            <li
                              key={shot.id}
                              className={`minimal-beat-item ${generationStatusState === 'processing' && index === 0 ? 'processing' : 'queued'}`}
                            >
                              <span className="minimal-beat-index">{index + 1}</span>
                              <div className="minimal-beat-body">
                                <div className="minimal-beat-title-row">
                                  <strong>{shot.title}</strong>
                                  <span className="minimal-beat-status">
                                    {generationStatusState === 'processing' && index === 0 ? 'Rendering' : 'Queued'}
                                  </span>
                                </div>
                                <p className={`minimal-beat-description ${shotExpanded ? 'expanded' : ''}`}>
                                  {shot.description}
                                </p>
                                {shotCanExpand ? (
                                  <button type="button" className="text-btn scene-expand-btn" onClick={() => toggleSceneDescription(shotDescriptionKey)}>
                                    {shotExpanded ? 'Collapse scene' : 'Expand scene'}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                      })}
                  </ol>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {generationError ? (
          <div className="render-trust-stack">
            <div className="generation-error-card paused-render-card">
              <div className="render-state-topline">
                <span className="render-state-safe-note">Scene idea kept</span>
              </div>
              <div className="render-state-copy">
                <strong>{activeReferenceRepair ? 'One reference needs to be re-uploaded.' : pausedRenderCopy.title}</strong>
                <p>
                  {activeReferenceRepair
                    ? 'Upload the image directly so Lumora can save it safely, or keep creating with your saved Lumora references.'
                    : pausedRenderCopy.body}
                </p>
                {!activeReferenceRepair && pausedRenderCopy.suggestedNextStep ? (
                  <small>{pausedRenderCopy.suggestedNextStep}</small>
                ) : null}
                {!activeReferenceRepair && activeRenderFailure ? (
                  <details className="render-failure-debug-card technical-details">
                    <summary>Diagnostics</summary>
                    <div className="render-failure-debug-grid">
                      <span>Stage</span>
                      <strong>{activeRenderFailure.stage || 'unknown'}</strong>
                      <span>Category</span>
                      <strong>{activeRenderFailure.category || 'unknown'}</strong>
                      {activeRenderFailure.sceneAnchorModel ? (
                        <>
                          <span>Scene anchor model</span>
                          <strong>{activeRenderFailure.sceneAnchorModel}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.stage2ProviderModel ? (
                        <>
                          <span>Stage 2 model</span>
                          <strong>{activeRenderFailure.stage2ProviderModel}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorHttpStatus || activeRenderFailure.stage2HttpStatus ? (
                        <>
                          <span>HTTP status</span>
                          <strong>{activeRenderFailure.sceneAnchorHttpStatus ?? activeRenderFailure.stage2HttpStatus}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorPromptLength !== null && activeRenderFailure.sceneAnchorPromptLength !== undefined ? (
                        <>
                          <span>Prompt length</span>
                          <strong>
                            {activeRenderFailure.sceneAnchorPromptLength}
                            {activeRenderFailure.sceneAnchorPromptLimit ? ` / ${activeRenderFailure.sceneAnchorPromptLimit}` : ''}
                          </strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorPayloadFieldNames?.length ? (
                        <>
                          <span>Payload fields</span>
                          <strong>{activeRenderFailure.sceneAnchorPayloadFieldNames.join(', ')}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorSubmittedReferenceCount !== null && activeRenderFailure.sceneAnchorSubmittedReferenceCount !== undefined ? (
                        <>
                          <span>References sent</span>
                          <strong>{activeRenderFailure.sceneAnchorSubmittedReferenceCount}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorPromptCompressed || activeRenderFailure.sceneAnchorPromptTruncated ? (
                        <>
                          <span>Prompt safety</span>
                          <strong>
                            {[
                              activeRenderFailure.sceneAnchorPromptCompressed ? 'compressed' : '',
                              activeRenderFailure.sceneAnchorPromptTruncated ? 'truncated' : '',
                            ].filter(Boolean).join(', ')}
                          </strong>
                        </>
                      ) : null}
                      {activeRenderFailure.sceneAnchorPersisted !== null && activeRenderFailure.sceneAnchorPersisted !== undefined ? (
                        <>
                          <span>Scene anchor saved</span>
                          <strong>{activeRenderFailure.sceneAnchorPersisted ? 'yes' : 'no'}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.assetPersistErrorType ? (
                        <>
                          <span>Asset save error</span>
                          <strong>{activeRenderFailure.assetPersistErrorType}</strong>
                        </>
                      ) : null}
                      {activeRenderFailure.missingConfig?.length ? (
                        <>
                          <span>Missing config</span>
                          <strong>{activeRenderFailure.missingConfig.join(', ')}</strong>
                        </>
                      ) : null}
                    </div>
                    {activeRenderFailure.assetPersistErrorMessageRedacted ||
                    activeRenderFailure.sceneAnchorErrorMessageRedacted ||
                    activeRenderFailure.stage2ErrorMessageRedacted ? (
                      <p className="muted">
                        Provider message: {activeRenderFailure.assetPersistErrorMessageRedacted ??
                          activeRenderFailure.sceneAnchorErrorMessageRedacted ??
                          activeRenderFailure.stage2ErrorMessageRedacted}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="quiet-btn"
                      onClick={() => void handleCopyRenderFailureDebugSummary()}
                    >
                      Copy debug summary
                    </button>
                  </details>
                ) : null}
              </div>
              {!activeReferenceRepair ? (
                <div className="focused-next-take">
                  <strong>Safer scene idea</strong>
                  <p>
                    {sceneAnchorPauseActive
                      ? 'Kling Reference is experimental. Use identity-only fallback for exact-likeness testing, or save this draft and continue with Seedance Fast.'
                      : 'This scene uses the simplest render path before adding complexity.'}
                  </p>
                  <blockquote className="next-take-preview">{ULTRA_SAFE_SCENE_PROMPT}</blockquote>
                  <div className="next-take-actions">
                    {sceneAnchorPauseActive ? (
                      <button
                        type="button"
                        className="primary-btn cinematic-generate-btn"
                        onClick={() => void handleUseIdentityOnlyKlingFallback()}
                        disabled={tryTakeBusy}
                      >
                        Use identity-only Kling fallback
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={sceneAnchorPauseActive ? 'ghost-btn' : 'primary-btn cinematic-generate-btn'}
                      onClick={handleUseSaferSceneIdea}
                      disabled={tryTakeBusy}
                    >
                      Use safer scene idea
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setGenerationError('');
                        setActiveRenderFailure(null);
                        setGenerationModerationDetail('');
                        setGenerationModerationStages([]);
                        setStatus('Adjust the scene direction, then Lumora can try another take.');
                        promptTextareaRef.current?.focus();
                      }}
                    >
                      Edit scene
                    </button>
                    <button type="button" className="quiet-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
                      Save draft
                    </button>
                  </div>
                  {generationModerationDetail || generationModerationStages.length ? (
                    <details className="advanced-create-details technical-details">
                      <summary>Creative adaptation steps</summary>
                      {generationModerationDetail ? <p className="muted">{generationModerationDetail}</p> : null}
                      <div className="generation-warning-list">
                        {generationModerationStages.map((stage) => (
                          <p key={stage}>{stage}</p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {activeReferenceRepair ? (
                <div className="reference-repair-panel">
                  <div>
                    <span className="eyebrow">reference repair</span>
                    <h3>{assetRepairTitle(activeReferenceRepair)}</h3>
                    <p>{activeReferenceRepair.label}</p>
                    {activeReferenceRepair.host ? <p className="muted">This image link is protected.</p> : null}
                  </div>
                  {activeReferenceRepair.sourceUrl ? (
                    <div className="reference-repair-preview">
                      <img src={activeReferenceRepair.sourceUrl} alt={`${activeReferenceRepair.label} preview`} />
                    </div>
                  ) : null}
                  {renderReferenceRepairActions()}
                  {repairStatus ? <p className="muted">{repairStatus}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {generationWarnings.length ? (
          <div className="generation-warning-list">
            {generationWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
        {status && !visibleRenderState ? <p className="muted create-status-copy">{status}</p> : null}
        {verifiedGeneratedVideoUrl && !generationResult ? (
          <div style={{ display: 'grid', gap: '12px', marginTop: '14px' }}>
            <GeneratedVideoPreview
              item={{ videoUrl: verifiedGeneratedVideoUrl, outputUrl: verifiedGeneratedVideoUrl }}
              title="Generated video"
              controls
              autoPlay
              forceVideo
              showCastBadge={false}
              style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 12 }}
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                window.location.href = '/drafts';
              }}
              style={{ flex: 'unset', width: '100%' }}
            >
              Publish
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={handleRemixResult}
              style={{ flex: 'unset', width: '100%' }}
            >
              Continue Story
            </button>
          </div>
        ) : null}
      </section>

      {generationResult && hasVerifiedGenerationOutput ? (
        <section className="editor-card lumora-card video-result-card">
          <div className="row-between">
            <div>
              <span className="eyebrow">scene reveal</span>
              <h3>Your cinematic draft is ready</h3>
            </div>
            <span className="tiny-pill">Draft saved</span>
          </div>
          {isDefaultSelfCharacter && generationResult.exactLikenessRoute === 'kling_reference' ? (
            <p><strong>Kling Reference Beta</strong></p>
          ) : isDefaultSelfCharacter ? (
            <p><strong>Soft self guidance</strong></p>
          ) : generationResult.characterName ? (
            <p>Character: <strong>{generationResult.characterName}</strong></p>
          ) : null}
          {generationResult.message ? <p>{generationResult.message}</p> : null}
          <p>Original idea: {generationResult.prompt}</p>
          {finalGeneratedPrompt ? (
            <p className="muted">Final scene direction: {finalGeneratedPrompt}</p>
          ) : null}
          {generatedMode ? (
            <p className="muted">Render style: {creatorRenderModeLabel(generatedMode)}</p>
          ) : null}
          {generatedMode === 'seedance-multimodal-reference' ? (
            <div className="reference-result-row">
              <span className="tiny-pill multimodal-reference-badge">Cast reference mode</span>
              <span className="muted">
                Lumora used {generationResult.referenceImageCount ?? seedanceReferenceCount} cast references for a fresh cinematic scene.
              </span>
            </div>
          ) : null}
          {generationResult.exactLikenessRoute === 'kling_reference' && generationResult.startFrameSource === 'scene_anchor' ? (
            <div className="reference-result-row">
              <span className="tiny-pill">Starts from scene anchor</span>
              <span className="muted">Identity references were baked into the anchor instead of used as the video opening frame.</span>
            </div>
          ) : generatedReferenceThumbnailUrl && generatedMode !== 'seedance-multimodal-reference' ? (
            <div className="reference-result-row">
              <SelfReferencePreview
                label="Reference image used for likeness"
                reference={normalizedGeneratedReference}
              />
              <span className="muted">Scene reference used for cast consistency</span>
            </div>
          ) : null}
          {generationResultVideoUrl ? (
            <GeneratedVideoPreview
              item={generationResult}
              title={generationResult.prompt || 'Generated video'}
              controls
              autoPlay
              forceVideo
              style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 12 }}
            />
          ) : null}
          <ContentSafetyActions
            contentType="generation"
            contentId={generationResult.jobId}
            creatorLabel="this AI output"
            currentUserId={authUser?.id}
          />
          <div className="button-row">
            <button type="button" className="primary-btn" onClick={handleRemixResult}>
              Continue Story
            </button>
            <button type="button" className="ghost-btn" onClick={() => { window.location.href = '/drafts'; }}>
              Publish
            </button>
            <button type="button" className="ghost-btn" onClick={handleRemixResult}>
              Try another take
            </button>
          </div>
          {selfReferenceMode && onLikenessFeedback ? (
            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
              <strong>Improve self guidance</strong>
              <p className="muted" style={{ margin: 0 }}>
                Lumora will use your feedback to tune future text guidance while photo routes stay protected.
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
                  placeholder="Add a self guidance note"
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
