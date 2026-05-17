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
  type ProviderModerationDiagnostics,
  type ProviderFallbackDiagnostics,
  type ReferenceImageUrls,
  type SceneExecutorResult,
  type SeedanceReferenceImage,
  type VideoAspectRatio,
  type VideoEngine,
} from '../lib/api';
import { updateLocalCharacterProfile } from '../lib/characterStorage';
import { saveStudioProject, type StudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import {
  loadSupabaseProfile,
  saveSupabaseDraft,
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
import { getBestPoster, getBestThumbnail } from '../lib/mediaThumbnail';
import { useSession } from '../hooks/useSession';
import { useAppStore } from '../store/useAppStore';
import SelfReferencePreview, { normalizeReference } from './SelfReferencePreview';
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
  onCharacterUpdated?: (character: CharacterProfile) => void;
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
    description: 'Quick cinematic renders with cast references.',
  },
  {
    engine: SEEDANCE_QUALITY_ENGINE_ID,
    label: 'Seedance Quality',
    speed: '~3-6 min',
    quality: 'Higher',
    description: 'Slower pass for stronger identity and motion detail.',
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
    description: 'Instant preview without spending render credits.',
  },
  {
    engine: 'replicate',
    label: 'Kling Reference',
    speed: '~1-3 min',
    quality: 'Reference',
    description: 'Reference-led motion for your self character.',
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
  multimodalReferenceMode?: unknown;
  assetPersistence?: unknown;
  moderation?: unknown;
  suggestedPrompt?: unknown;
  sanitizedPrompt?: unknown;
  moderationDiagnostics?: unknown;
  providerFallbackDiagnostics?: unknown;
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
};

type GenerationStatusState = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
type ToastState = {
  type: 'success' | 'error';
  message: string;
} | null;

const generationStatusLabels: Record<Exclude<GenerationStatusState, 'idle'>, string> = {
  queued: 'Queued',
  processing: 'Rendering',
  completed: 'Saved',
  failed: 'Paused',
};

const asyncRenderStatuses = new Set(['queued', 'rendering', 'processing', 'paused']);

function asyncRenderJobId(data: GenerateVideoApiResponse | GenerationResponse | null | undefined) {
  if (!data) return null;
  const jobId = typeof data.jobId === 'string' ? data.jobId : null;
  const id = typeof data.id === 'string' ? data.id : null;
  return jobId || id;
}

function isAsyncRenderResponse(data: GenerateVideoApiResponse | GenerationResponse | null | undefined) {
  const status = typeof data?.status === 'string' ? data.status : '';
  const outputUrl = normalizeVideoUrl(data?.videoUrl ?? data?.outputUrl);
  return Boolean(asyncRenderJobId(data) && asyncRenderStatuses.has(status) && !outputUrl);
}

function asyncRenderStatusMessage(data: GenerateVideoApiResponse | GenerationResponse) {
  if (typeof data.progressLabel === 'string' && data.progressLabel) return data.progressLabel;
  if (typeof data.message === 'string' && data.message) return data.message;
  const status = typeof data.status === 'string' ? data.status : '';
  if (status === 'paused') return 'This scene took longer than expected. Completed shots are saved in Drafts.';
  return 'Rendering your cinematic take...';
}

function creatorRenderModeLabel(mode: string) {
  switch (mode) {
    case 'seedance-multimodal-reference':
      return 'Cast reference scene';
    case 'seedance-text-to-video':
      return 'Cinematic text scene';
    case 'self-reference-video':
      return 'Self reference scene';
    case 'image-to-video':
      return 'Reference-led scene';
    case 'text-to-video-fallback':
      return 'Cinematic text scene';
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
    case 'queued':
      return 'Queued';
    default:
      return status;
  }
}

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
  'Creative safety paused this render. Try gentler cinematic wording with styled wardrobe and fictional framing.';
const providerModerationMessage =
  'Creative safety paused this render after Lumora tried safer cinematic styling.';
const providerQueueBusyMessage = 'The render line is busy. Lumora will try again in a moment...';
const replicateThrottledMessage =
  'The cinematic renderer is cooling down for a moment. Wait a minute and try again.';

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
  ));
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
  if (value.renderedWithLighterCastGuidance) {
    messages.push('Rendered with lighter cast guidance.');
  }

  return Array.from(new Set(messages));
}

function creatorVisibleFinalPrompt(data: GenerateVideoApiResponse, fallbackPrompt: string) {
  if (typeof data.suggestedPrompt === 'string' && data.suggestedPrompt.trim()) {
    return data.suggestedPrompt.trim();
  }

  if (typeof data.finalPrompt === 'string' && data.finalPrompt.trim()) {
    const finalPrompt = data.finalPrompt.trim();
    const lower = finalPrompt.toLowerCase();
    const looksProviderInternal = finalPrompt.includes('[Image') ||
      lower.includes('reference_images') ||
      lower.includes('use all provided images') ||
      lower.includes('the cinematic character from [image');
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
  const [generationModerationStages, setGenerationModerationStages] = useState<string[]>([]);
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
  const [referenceRepair, setReferenceRepair] = useState<ReferenceRepairIssue | null>(null);
  const [repairUploading, setRepairUploading] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [skippedReferenceUrls, setSkippedReferenceUrls] = useState<string[]>([]);
  const [schemaWarning, setSchemaWarning] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const [generatedDisplayEngine, setGeneratedDisplayEngine] = useState('');
  const [generatedReferenceImageUrl, setGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [generatedMode, setGeneratedMode] = useState<GenerationMode | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
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
    !(activeReferenceRepair && !activeReferenceRepair.canContinueWithoutReference) &&
    (!requiresReferenceImage || hasGenerationReference);
  const generateBusy = !canGenerate || busy || generationLoading || referenceLoading;
  const saveBusy = busy || generationLoading;
  const sceneExecuteDisabledReason = !creativePlan
    ? 'Build a storyboard first'
    : !sceneExecutorUserId
      ? 'Sign in to save each shot'
      : !isSeedanceEngine
        ? 'Select Seedance Fast or Seedance Quality'
        : sceneExecutionLoading
          ? 'Rendering scene flow...'
          : '';
  const sceneExecuteBusy = Boolean(sceneExecuteDisabledReason) || generationLoading || busy;
  const engineRoutingMessage =
    isSeedanceEngine
      ? `${selectedProviderOption.label} uses ${seedanceReferenceCount} cast reference${seedanceReferenceCount === 1 ? '' : 's'} while keeping the scene fresh.`
    : engine === 'veo'
      ? 'Veo Experimental is ready for the next cinematic video route.'
    : engine === 'mock'
      ? 'Demo Mode returns an instant preview and never spends render credits.'
    : isSoraEngine
      ? 'Self-character likeness currently uses the reference-led video path.'
      : 'Kling uses your self-character reference image first.';
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
  const creatorInsightCards = [
    {
      label: 'Style',
      copy: selectedStyles.length
        ? `Lumora remembered your ${selectedStyles.slice(0, 2).join(' + ')} direction.`
        : 'Choose a style and Lumora will remember the feeling.',
    },
    {
      label: 'Memory',
      copy: continuityMemory?.id
        ? 'Your story memory shaped this transition.'
        : 'This scene can become the first memory in your world.',
    },
    {
      label: 'Flow',
      copy: creativePlan
        ? 'Your storyboard is ready to move shot by shot.'
        : 'Lumora can shape your idea into cinematic beats.',
    },
  ];
  const storyMemoryMoment = continuityMemoryDraft.environment
    ? `Lumora remembered this setting: ${continuityMemoryDraft.environment}.`
    : continuityMemoryDraft.wardrobe
      ? 'Lumora adapted wardrobe continuity for this scene.'
      : continuityMemoryDraft.emotionalTone
        ? 'Emotional pacing matched your prior scene.'
        : 'Lumora will remember your world as you create.';

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
    setReferenceRepair(null);
    setRepairStatus('');
    setSkippedReferenceUrls([]);
  }, [characterId, referenceImageUrl]);

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
    if (!activeRenderJobId) return undefined;
    const renderJobId = activeRenderJobId;

    let active = true;
    let pollTimer: number | null = null;

    async function pollJob() {
      try {
        const job = await api.getGenerationJob(renderJobId);
        if (!active) return;

        const outputUrl = normalizeVideoUrl(job.videoUrl ?? job.outputUrl);
        const statusValue = typeof job.status === 'string' ? job.status : '';
        const progressLabel = asyncRenderStatusMessage(job);

        if (statusValue === 'completed' && outputUrl) {
          const thumbnailUrl = getBestThumbnail({
            thumbnailUrl: job.thumbnailUrl,
            posterUrl: job.posterUrl,
            previewImageUrl: job.previewImageUrl,
            characterAvatar,
          });
          const displayEngine = job.displayEngine ?? (
            engine === SEEDANCE_QUALITY_ENGINE_ID
              ? 'Seedance Quality'
              : engine === SEEDANCE_ENGINE_ID
                ? 'Seedance Fast'
                : engineLabels[engine] ?? engine
          );
          const posterUrl = getBestPoster({
            thumbnailUrl,
            posterUrl: job.posterUrl,
            previewImageUrl: job.previewImageUrl,
            characterAvatar,
          });
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
            generationMode: job.generationMode ?? selectedGenerationMode,
            finalPrompt: job.finalPrompt ?? job.prompt ?? activePrompt,
            model: job.model ?? null,
            displayEngine,
            projectId: job.projectId ?? null,
            createdAt: job.createdAt ?? completedAt,
            message: 'Your cinematic draft is saved.',
          });
          setActiveRenderJobId(null);
          finishGenerationProgress('completed');
          setStatus('Your cinematic draft is saved.');
          showToast({ type: 'success', message: 'Your cinematic draft is saved. Continue the story from Drafts when ready.' });
          return;
        }

        if (statusValue === 'failed' || statusValue === 'paused') {
          setActiveRenderJobId(null);
          finishGenerationProgress('failed');
          setGenerationError(job.error || job.errorMessage || progressLabel);
          setStatus(progressLabel);
          showToast({ type: 'error', message: 'Lumora paused this scene. Completed work is saved in Drafts.' });
          return;
        }

        setGenerationStatusState(statusValue === 'queued' ? 'queued' : 'processing');
        setStatus(progressLabel);
        pollTimer = window.setTimeout(pollJob, 4000);
      } catch (error) {
        if (!active) return;
        setStatus(error instanceof Error
          ? error.message
          : 'Your scene is still rendering. Lumora will keep checking and save it to Drafts.');
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
      setContinuityMemoryError(error instanceof Error ? error.message : 'Story Memory could not load.');
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
    setStatus('Saving scene references...');
    if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      setGenerationStatusState('processing');
      setStatus('Preserving Story Memory and shaping emotional pacing...');
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
      const message = error instanceof Error ? error.message : 'Story Memory could not save.';
      setContinuityMemoryError(message);
      if (!options.silent) showToast({ type: 'error', message });
      return null;
    } finally {
      setContinuityMemorySaving(false);
    }
  }

  async function handleBuildCreativePlan() {
    if (!activePrompt.trim()) {
      setCreativePlanError('Add a prompt before Lumora builds your storyboard.');
      return;
    }

    setCreativePlanLoading(true);
    setCreativePlanError('');
    setCreativePlanStatus('Creative Brain is building your storyboard...');

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
      setCreativePlanStatus('Storyboard ready. Review the beats before rendering.');
      void trackCreatorEvent('first_storyboard_built', { source: 'create', characterId }, authUser?.id ?? null);
    } catch (error) {
      setCreativePlanError(error instanceof Error ? friendlyCharacterProfileError(error) : 'Lumora could not build your storyboard yet.');
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
      setCreativePlanStatus('Storyboard beats updated.');
      setSceneExecutionResult(null);
      setSceneExecutionPlan(null);
      setSceneExecutionError('');
    } else {
      setCreativePlanError('Advanced storyboard edits need valid structure before Lumora can use them.');
    }
  }

  async function handleExecuteScenePlan() {
    if (sceneExecutionLoading) return;

    const activePlan = parseCreativePlanDraft(creativePlanDraft) ?? creativePlan;
    if (!activePlan) {
      setSceneExecutionError('Build or fix your storyboard before starting Scene Flow.');
      return;
    }

    if (!sceneExecutorUserId) {
      setSceneExecutionError('Sign in before Scene Flow so Lumora can save each shot.');
      return;
    }

    if (!isSeedanceEngine) {
      setSceneExecutionError('Scene Flow renders Seedance shots. Select Seedance Fast or Seedance Quality first.');
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
        setContinuityMemoryStatus('Story Memory updated from completed shots.');
      }
      setSceneExecutionStatus(
        result.status === 'completed'
          ? `Scene continuity preserved across ${result.clips.length} cinematic shot${result.clips.length === 1 ? '' : 's'}.`
          : 'Lumora saved the completed shots and paused the scene for another take.',
      );
      if (result.status === 'completed') {
        showToast({ type: 'success', message: 'Scene continuity preserved and saved to Drafts.' });
      } else {
        showToast({ type: 'error', message: result.failedClip?.error || 'That shot needs another take. Finished shots stayed saved.' });
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
          : friendlyCharacterProfileError(error)
        : 'Lumora could not finish the storyboard yet.';
      setSceneExecutionError(message);
      setSceneExecutionStatus('');
      showToast({ type: 'error', message });
    } finally {
      setSceneExecutionLoading(false);
    }
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
        setRepairStatus('This old reference was skipped for this scene. Open Characters to remove it permanently.');
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
      setRepairStatus('Open Characters to replace this reference in the right cast slot.');
      return;
    }

    if (!authUser) {
      setRepairStatus('Sign in to save repaired references to Lumora.');
      return;
    }

    if (!characterProfile) {
      setRepairStatus('Open Characters to choose the cast member before replacing this reference.');
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
            Open Characters
          </button>
        ) : null}
      </div>
    );
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
    setGenerationModerationStages([]);
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
          throw new Error(providerResult.error || providerResult.message || 'Lumora paused this scene.');
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
          const apiMessage = parsedData.error || parseError || 'Lumora paused this scene.';
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

      if (isAsyncRenderResponse(data)) {
        const jobId = asyncRenderJobId(data);
        if (!jobId) {
          throw new Error('Lumora started rendering, but the render job could not be tracked.');
        }

        setActiveRenderJobId(jobId);
        setGenerationStatusState(data.status === 'queued' ? 'queued' : 'processing');
        setStatus(asyncRenderStatusMessage(data));
        setGenerationResult({
          id: typeof data.id === 'string' ? data.id : jobId,
          jobId,
          status: typeof data.status === 'string' ? data.status : 'rendering',
          engine: selectedEngine,
          provider: data.provider ?? 'replicate',
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          prompt: currentPrompt,
          outputUrl: '',
          thumbnailUrl: getBestThumbnail({
            thumbnailUrl: data.thumbnailUrl,
            posterUrl: data.posterUrl,
            previewImageUrl: data.previewImageUrl,
            characterAvatar,
          }),
          generationMode: data.generationMode ?? videoGenerationMode,
          model: data.model ?? null,
          displayEngine: data.displayEngine ?? (selectedEngine === SEEDANCE_QUALITY_ENGINE_ID ? 'Seedance Quality' : 'Seedance Fast'),
          projectId: null,
          createdAt: new Date().toISOString(),
          message: data.message || 'Lumora is rendering your scene.',
          providerStatus: data.providerStatus ?? null,
          providerPredictionId: data.providerPredictionId ?? null,
          providerPredictionUrl: data.providerPredictionUrl ?? null,
          providerFallbackStage: data.providerFallbackStage ?? null,
          renderMode: data.renderMode ?? null,
        });
        showToast({
          type: 'success',
          message: data.duplicateOf
            ? 'Lumora found the current render and will keep checking it.'
            : 'Lumora is rendering your scene and will save it to Drafts.',
        });
        return;
      }

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
      const nextThumbnailUrl = getBestThumbnail({
        thumbnailUrl: data.thumbnailUrl,
        posterUrl: data.posterUrl,
        previewImageUrl: data.previewImageUrl,
        referenceImageUrl: nextReferenceImageUrl,
        referenceImageUrls: referencePayload,
        characterAvatar,
      });
      const nextPosterUrl = getBestPoster({
        thumbnailUrl: nextThumbnailUrl,
        posterUrl: data.posterUrl,
        previewImageUrl: data.previewImageUrl,
        referenceImageUrl: nextReferenceImageUrl,
        referenceImageUrls: referencePayload,
        characterAvatar,
      });
      const nextWarnings = Array.from(new Set([
        ...formatWarnings(data.warnings),
        ...moderationWarningMessages(data.moderationDiagnostics),
        ...providerFallbackWarningMessages(data.providerFallbackDiagnostics),
        ...(data.referenceImageNote ? [data.referenceImageNote] : []),
        ...(selectedIsSeedanceEngine && selectedSeedanceReferences.length === 1
          ? ['Only one image is uploaded. Add side, full-body, expression, or outfit references for stronger cast consistency.']
          : []),
      ]));
      const nextModerationStages = Array.from(new Set([
        ...moderationRetryStageMessages(data.moderationDiagnostics),
        ...providerFallbackStageMessages(data.providerFallbackDiagnostics),
      ]));

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('Lumora did not receive a playable scene yet.');
        finishGenerationProgress('failed');
        showToast({ type: 'error', message: 'Lumora paused this scene before a video was returned.' });
        return;
      }

      const nextFinalPrompt = creatorVisibleFinalPrompt(data, currentPrompt);
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
        thumbnailUrl: nextThumbnailUrl,
        posterUrl: nextPosterUrl,
        previewImageUrl: typeof data.previewImageUrl === 'string' ? data.previewImageUrl : null,
        generationMode: nextGenerationMode,
        moderationDiagnostics: isProviderModerationDiagnostics(data.moderationDiagnostics)
          ? data.moderationDiagnostics
          : null,
        providerFallbackDiagnostics,
        finalPrompt: nextFinalPrompt,
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
        message: renderedWithLighterCastGuidance
          ? 'Rendered with lighter cast guidance.'
          : nextGenerationMode === 'seedance-multimodal-reference'
          ? 'Cast reference render created.'
          : nextGenerationMode === 'seedance-text-to-video'
          ? 'Cinematic video render created.'
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
          posterUrl: nextPosterUrl,
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
              saveError instanceof Error
                ? `Account save failed: ${saveError.message}. A local Drafts backup was saved.`
                : 'Account save failed. A local Drafts backup was saved.',
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
      const repairIssue = normalizeReferenceRepairIssue(apiPayload);
      if (repairIssue) {
        setReferenceRepair(repairIssue);
        setRepairStatus('');
      }
      const moderationPayload = isProviderModerationPayload(apiPayload) ? apiPayload : null;
      const providerFallbackPayload = isProviderFallbackDiagnostics(moderationPayload?.providerFallbackDiagnostics)
        ? moderationPayload.providerFallbackDiagnostics
        : null;
      const suggestedRewrite =
        providerFallbackPayload?.suggestedPrompt ||
        providerFallbackPayload?.sanitizedPrompt ||
        moderationPayload?.suggestedPrompt ||
        moderationPayload?.sanitizedPrompt ||
        '';
      const retryStages = Array.from(new Set([
        ...moderationRetryStageMessages(moderationPayload?.moderationDiagnostics),
        ...providerFallbackStageMessages(providerFallbackPayload),
      ]));
      const displayMessage = moderationPayload
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
        : message;
      setGenerationSafeRewrite(suggestedRewrite);
      setGenerationModerationDetail(
        repairIssue
          ? assetRepairCopy(repairIssue)
          : providerFallbackPayload
          ? 'Lumora kept your cast and Story Memory intact. Try the safer rewrite, simplify the scene, or save the draft before another take.'
          : moderationPayload?.suggestion ||
        (moderationPayload
          ? 'Lumora preserved your cast, Story Memory, and storyboard while adapting the style for cinematic safety.'
          : ''),
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
      finishGenerationProgress('failed');
      showToast({
        type: 'error',
        message: moderationPayload
          ? 'Creative safety paused this render. A safer cinematic rewrite is ready.'
          : 'Lumora paused this scene. You can retry when ready.',
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
        void trackCreatorEvent('first_draft_created', { source: 'manual-save' }, null);
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

        <div className="creator-intelligence-strip" aria-label="Lumora creator signals">
          {creatorInsightCards.map((item) => (
            <span key={item.label}>
              <strong>{item.label}</strong>
              {item.copy}
            </span>
          ))}
        </div>

        <label className="field-block">
          <span>Project title</span>
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Title" />
        </label>

        <label className="field-block">
          <span>Core prompt</span>
          <textarea
            ref={promptTextareaRef}
            value={activePrompt}
            onChange={(event) => setActivePrompt(event.target.value)}
            rows={6}
            placeholder="Describe the scene you want to create..."
          />
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
              <span className="eyebrow">Story Memory</span>
              <strong>Your cinematic world remembers this character.</strong>
            </div>
            <span className="tiny-pill continuity-confidence-pill">{continuityConfidencePercent}%</span>
          </div>
          {continuityMemoryLoading ? <p className="muted">Syncing Story Memory...</p> : null}
          {continuityMemoryStatus ? <p className="muted">{continuityMemoryStatus}</p> : null}
          {continuityMemoryError ? <p className="creative-plan-error">{continuityMemoryError}</p> : null}
          <div className="story-memory-moment">
            <span className="tiny-dot" />
            <p>{storyMemoryMoment}</p>
          </div>
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
              {continuityMemorySaving ? 'Saving...' : continuityMemoryDirty ? 'Save Story Memory' : 'Story Memory saved'}
            </button>
            <small className="muted">
              {sceneExecutorUserId ? (continuityMemoryDirty ? 'Unsaved changes' : 'Scene continuity preserved.') : 'Sign in to save Story Memory'}
            </small>
          </div>
        </div>

        <div className="creative-brain-panel">
          <div className="row-between">
            <div>
              <span className="eyebrow">Storyboard</span>
              <strong>Storyboard before rendering</strong>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void handleBuildCreativePlan()}
              disabled={creativePlanLoading || !hasPrompt}
            >
              {creativePlanLoading ? 'Building...' : creativePlan ? 'Refresh storyboard' : 'Build storyboard'}
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
              <details className="creative-plan-editor-shell">
                <summary>Advanced storyboard structure</summary>
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
                  {sceneExecutionLoading ? 'Preserving story flow...' : 'Render storyboard'}
                </button>
                <small className="muted">
                  {sceneExecuteDisabledReason || 'Creates one cinematic shot per beat and keeps the sequence easy to review.'}
                </small>
              </div>
              {sceneExecutionStatus ? <p className="muted">{sceneExecutionStatus}</p> : null}
              {sceneExecutionError ? <p className="creative-plan-error">{sceneExecutionError}</p> : null}
              {sceneExecutionError && activeReferenceRepair ? (
                <div className="reference-repair-panel">
                  <div>
                    <span className="eyebrow">reference repair</span>
                    <h3>{assetRepairTitle(activeReferenceRepair)}</h3>
                    <p>{activeReferenceRepair.label}</p>
                    <p className="muted">{assetRepairCopy(activeReferenceRepair)}</p>
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
                      ? sceneExecutionResult.clips.map((clip) => {
                          const clipModerationStages = moderationRetryStageMessages(
                            clip.moderationDiagnostics ?? clip.metadata.moderationOrchestration,
                          );
                          const clipProviderFallbackStages = providerFallbackStageMessages(
                            clip.providerFallbackDiagnostics ?? clip.metadata.providerFallback,
                          );

                          return (
                            <li key={clip.id} className={`scene-progress-item ${clip.status}`}>
                              <span className="scene-progress-index">{clip.clipOrder}</span>
                              <span>
                                <strong>{clip.title}</strong>
                                <small>{clip.metadata.cameraFraming} / {clip.metadata.cameraMovement}</small>
                                {[...clipModerationStages, ...clipProviderFallbackStages].map((stage) => (
                                  <small key={stage}>{stage}</small>
                                ))}
                                {clip.error ? <small className="creative-plan-error">{clip.error}</small> : null}
                              </span>
                              <span className="tiny-pill">{creatorSceneStatusLabel(clip.status)}</span>
                            </li>
                          );
                        })
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
                              {sceneExecutionLoading && index === 0 ? 'Rendering' : 'Queued'}
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
                              <span className="eyebrow">Shot {clip.clipOrder}</span>
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
          <span>Cinematic renderer</span>
          <div className="provider-grid" role="radiogroup" aria-label="Cinematic renderer">
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
                  ? 'Lumora Cast'
                : referenceLoading
                  ? 'Checking self reference'
                : isTextFallbackMode
                    ? 'Reference required'
                    : 'Reference scene'}
            </span>
            <strong>
              {isSeedanceEngine
                ? 'Generate a fresh scene from your cast references'
                : engine === 'replicate' && selfReferenceMode
                  ? 'Generate new scenes from your reusable identity'
                : engine === 'veo'
                  ? 'Try the experimental cinematic route'
                : engine === 'mock'
                  ? 'Preview instantly with demo output'
                : referenceLoading
                  ? 'Looking for saved self-character photos'
                : isTextFallbackMode
                  ? 'Save a reference image first'
                  : 'Use a reference-led scene'}
            </strong>
            <span className="muted">
              {referenceLoading
                ? 'Lumora is finding your saved self references.'
                : isSeedanceEngine
                ? 'Lumora sends your saved cast references as guidance without forcing any image as the first frame.'
                : engine === 'veo'
                ? 'If Veo is unavailable, Lumora keeps the scene safe and lets you keep creating.'
                : engine === 'mock'
                ? 'Demo Mode returns a known video so you can test Drafts save and playback.'
                : selfReferenceMode
                ? primaryReferenceImage.url
                  ? 'Build a reusable cinematic character from your reference photos and videos.'
                  : 'Lumora cast references will be sent when available.'
                : isTextFallbackMode
                  ? 'Save a reference image before this route can render.'
                  : 'Lumora will guide motion from the selected image.'}
            </span>
            {seedanceMultimodalActive ? (
              <span className="tiny-pill multimodal-reference-badge">Cast reference mode</span>
            ) : null}
            {seedanceSingleReferenceWarning ? (
              <span className="seedance-reference-warning">
                Only one image uploaded. Add side, full-body, expression, or outfit references for stronger cast consistency.
              </span>
            ) : null}
            {isSeedanceEngine && seedanceReferenceCount > 0 ? (
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
            ) : null}
            {selfReferenceMode && engine === 'replicate' ? (
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                <span className="tiny-pill" style={{ width: 'fit-content' }}>{identityStatusLabel}</span>
                <span className="muted">
                  Lumora will use your feedback to improve future scenes and cast consistency.
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
                ? `${seedanceReferenceCount} cast reference${seedanceReferenceCount === 1 ? '' : 's'}`
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
            <span>Lumora Cast Reference</span>
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
          </div>
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
                {generationStatusLabels[phase]}
              </span>
            ))}
          </div>
        ) : null}
        {generationLoading ? <p className="muted">Lumora is rendering your cinematic take and saving the draft as it goes...</p> : null}
        {generationError ? (
          <div className="generation-error-card">
            <p>{generationError}</p>
            {generationModerationDetail ? <p>{generationModerationDetail}</p> : null}
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
            {generationModerationStages.length ? (
              <div className="generation-warning-list">
                {generationModerationStages.map((stage) => (
                  <p key={stage}>{stage}</p>
                ))}
              </div>
            ) : null}
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
                    setGenerationModerationStages([]);
                    setGenerationSafeRewrite('');
                    setStatus('Safer cinematic rewrite loaded. Your references stayed intact.');
                  }}
                >
                  {generationSafeRewrite.toLowerCase().includes('storybook cinematic version')
                    ? 'Use storybook garden version'
                    : 'Use cinematic rewrite'}
                </button>
              </div>
            ) : null}
            <div className="button-row">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setGenerationError('');
                  setStatus('Adjust the scene direction, then Lumora can try another take.');
                  promptTextareaRef.current?.focus();
                }}
              >
                Edit prompt
              </button>
              <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={saveBusy}>
                Save draft
              </button>
              <button type="button" className="ghost-btn" onClick={handleGenerate} disabled={generateBusy}>
                Retry generation
              </button>
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
                window.location.href = '/drafts';
              }}
              style={{ flex: 'unset', width: '100%' }}
            >
              View in Drafts
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
              <h3>Cinematic draft ready</h3>
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
              poster={getBestPoster(generationResult) ?? undefined}
              style={{ width: '100%', borderRadius: 12 }}
            />
          ) : null}
          <div className="button-row">
            <button type="button" className="ghost-btn" onClick={() => { window.location.href = '/drafts'; }}>
              Open in Drafts
            </button>
            <button type="button" className="ghost-btn" onClick={handleRemixResult}>
              Remix result
            </button>
          </div>
          {selfReferenceMode && onLikenessFeedback ? (
            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
              <strong>Improve likeness</strong>
              <p className="muted" style={{ margin: 0 }}>
                Lumora will use your feedback to improve future scenes and cast consistency.
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
