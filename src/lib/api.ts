import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { buildSafeHealthFallback, resolveApiUrl, SAFE_NATIVE_STATUS_PATH } from './apiOrigin';
import { supabase } from './supabase';

async function buildRequestHeaders(headers: HeadersInit | undefined) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  if (!requestHeaders.has('Authorization') && supabase) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
      if (data.session?.user?.id && !requestHeaders.has('x-lumora-user-id')) {
        requestHeaders.set('x-lumora-user-id', data.session.user.id);
      }
    }
  }
  return requestHeaders;
}

type RequestInitWithTimeout = RequestInit & {
  timeoutMs?: number;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

export async function fetchApiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = await buildRequestHeaders(init.headers);
  const url = resolveApiUrl(path, Capacitor.isNativePlatform());

  if (Capacitor.isNativePlatform()) {
    const contentType = headers.get('Content-Type') ?? '';
    let data: unknown = init.body;
    if (typeof init.body === 'string' && contentType.includes('application/json')) {
      data = JSON.parse(init.body);
    }

    const nativeResponse = await CapacitorHttp.request({
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      data,
      responseType: 'text',
    });
    const responseBody = typeof nativeResponse.data === 'string'
      ? nativeResponse.data
      : JSON.stringify(nativeResponse.data ?? {});
    return new Response(responseBody, {
      status: nativeResponse.status,
      headers: nativeResponse.headers,
    });
  }

  return fetch(url, {
    ...init,
    headers,
  });
}

async function request<T>(path: string, init: RequestInitWithTimeout = {}): Promise<T> {
  const { timeoutMs, signal, ...fetchInit } = init;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetchApiResponse(path, {
      ...fetchInit,
      signal: signal ?? controller?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Your scene is still rendering. Lumora will keep checking and save it to Drafts.');
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : 'Request failed';
    throw new ApiRequestError(message, response.status, payload);
  }

  return response.json() as Promise<T>;
}

export type RenderSuccessMode = 'cinematic_quality' | 'balanced' | 'success_first';
export type SelfLikenessIntensity = 'light' | 'balanced' | 'strong';

export type GenerationPayload = {
  title?: string;
  prompt: string;
  stylePreset?: string | string[];
  userId?: string | null;
  outputType?: 'image' | 'video';
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  duration?: number;
  aspectRatio?: VideoAspectRatio;
  engine?: VideoEngine;
  quality?: 'fast' | 'quality';
  renderPreference?: RenderSuccessMode;
  selfLikenessIntensity?: SelfLikenessIntensity;
  privacy?: PrivacySetting;
  referenceImages?: SeedanceReferenceImage[];
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
};

export type CreativeBrainShot = {
  id: string;
  title: string;
  description: string;
  cameraFraming: string;
  cameraMovement: string;
  subjectAction: string;
  environmentFocus: string;
  durationHint: string;
  transition: string;
};

export type CreativeBrainScenePlan = {
  cinematicTone: string;
  visualStyle: string;
  soundtrackMood: string;
  continuityNotes: string[];
  shotList: CreativeBrainShot[];
  cameraFraming: string[];
  environmentDescription: string;
  emotionalPacing: string;
  sceneTransitions: string[];
  promptRewrite: string;
};

export type CreativeBrainPlanPayload = {
  prompt: string;
  userId?: string | null;
  characterId?: string | null;
  characterMetadata?: Record<string, unknown> | null;
  styleTheme?: string | null;
};

export type CreativeBrainPlanResponse = {
  id: string;
  provider: string;
  model: string;
  plan: CreativeBrainScenePlan;
  rawText: string;
  attempts: number;
  createdAt: string;
};

export type SceneExecutorClipStatus = 'queued' | 'processing' | 'completed' | 'failed';

export const continuityMemoryFields = [
  'characterAppearance',
  'wardrobe',
  'hairstyle',
  'emotionalTone',
  'environment',
  'props',
  'weather',
  'timeOfDay',
  'soundtrackMood',
  'cameraStyle',
  'previousSceneSummary',
] as const;

export type ContinuityMemoryField = typeof continuityMemoryFields[number];

export type ContinuityMemoryState = Record<ContinuityMemoryField, string>;

export type ContinuityMemoryLocks = Partial<Record<ContinuityMemoryField, boolean>>;

export type ContinuityDriftAlert = {
  field: ContinuityMemoryField;
  previousValue: string;
  nextValue: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  detectedAt: string;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
};

export type SceneMemorySummary = {
  sceneExecutionId: string;
  sceneId: string;
  clipOrder: number;
  title: string;
  summary: string;
  capturedAt: string;
  continuityConfidence: number;
  driftAlerts: ContinuityDriftAlert[];
};

export type ContinuityMemoryRecord = {
  id: string | null;
  userId: string;
  projectId: string | null;
  characterId: string | null;
  memoryScope: string;
  state: ContinuityMemoryState;
  lockedFields: ContinuityMemoryLocks;
  continuityConfidence: number;
  driftAlerts: ContinuityDriftAlert[];
  sceneMemorySummaries: SceneMemorySummary[];
  previousSceneSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ContinuityMemoryScopePayload = {
  userId: string;
  projectId?: string | null;
  characterId?: string | null;
};

export type ContinuityMemoryPatchPayload = ContinuityMemoryScopePayload & {
  state?: Partial<ContinuityMemoryState>;
  lockedFields?: ContinuityMemoryLocks;
};

export type SceneClipMetadata = {
  previousScene: string | null;
  emotionalState: string;
  wardrobe: string;
  environmentContinuity: string;
  continuityNotes: string[];
  cameraFraming: string;
  cameraMovement: string;
  sceneTransition: string;
  shotDescription: string;
  subjectAction: string;
  durationHint: string;
  referenceImageCount: number;
  continuityMemoryScope?: string | null;
  continuityConfidence?: number | null;
  continuityDrift?: ContinuityDriftAlert[];
  memorySnapshot?: ContinuityMemoryState | null;
  sceneMemorySummary?: SceneMemorySummary | null;
  moderationOrchestration?: ProviderModerationDiagnostics | null;
  providerFallback?: ProviderFallbackDiagnostics | null;
  assetPersistence?: AssetPersistenceSummary | null;
};

export type SceneExecutorClip = {
  id: string;
  jobId: string | null;
  sceneExecutionId: string;
  sceneId: string;
  clipOrder: number;
  status: SceneExecutorClipStatus;
  title: string;
  prompt: string;
  finalPrompt?: string | null;
  videoUrl?: string | null;
  provider?: string | null;
  model?: string | null;
  providerJobId?: string | null;
  error?: string | null;
  metadata: SceneClipMetadata;
  moderationDiagnostics?: ProviderModerationDiagnostics | null;
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics | null;
  createdAt: string;
};

export type SceneExecutorResult = {
  id: string;
  status: 'completed' | 'failed';
  provider: 'seedance';
  engine: 'seedance-2.0' | 'seedance-quality';
  clips: SceneExecutorClip[];
  failedClip?: SceneExecutorClip | null;
  scenePlan: CreativeBrainScenePlan;
  continuityMemory?: ContinuityMemoryRecord | null;
  assetPersistence?: AssetPersistenceSummary | null;
  createdAt: string;
  completedAt: string;
};

export type SceneExecutorPayload = {
  scenePlan: CreativeBrainScenePlan;
  userId: string;
  projectId?: string | null;
  characterId?: string | null;
  characterMetadata?: Record<string, unknown> | null;
  referenceImages?: SeedanceReferenceImage[];
  quality?: 'fast' | 'quality';
  renderPreference?: RenderSuccessMode;
  privacy?: PrivacySetting;
};

export type GenerationResponse = {
  id: string;
  jobId: string;
  status: string;
  engine: VideoEngine;
  provider?: string | null;
  characterId: string | null;
  characterName: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  prompt: string;
  outputUrl: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  thumbnailSource?: string | null;
  previewImageUrl?: string | null;
  error?: string;
  moderation?: boolean;
  suggestion?: string | null;
  suggestedPrompt?: string | null;
  sanitizedPrompt?: string | null;
  moderationDiagnostics?: ProviderModerationDiagnostics | null;
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics | null;
  sceneOptimization?: SceneOptimizationDiagnostics | null;
  renderReliability?: {
    complexityScore: number | null;
    referenceQualityScore: number | null;
    successMode: RenderSuccessMode | null;
    referenceStrategy: string | null;
    creatorMessage: string | null;
  } | null;
  assetPersistence?: boolean | AssetPersistenceSummary | null;
  assetPersistenceDiagnostics?: AssetPersistenceFailureDiagnostics | Record<string, unknown> | null;
  generationMode?: GenerationMode | null;
  finalPrompt?: string | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  resolution?: string | null;
  model?: string | null;
  projectId?: string | null;
  storagePath?: string | null;
  warnings?: string[] | null;
  displayEngine?: string | null;
  referenceImageUrl?: string | null;
  referenceImages?: SeedanceReferenceImage[] | null;
  referenceImageCount?: number | null;
  multimodalReferenceMode?: boolean | null;
  createdAt: string;
  message?: string;
  exactLikenessRoute?: string | null;
  exactLikenessAvailable?: boolean | null;
  exactLikenessReason?: string | null;
  exactLikenessProvider?: string | null;
  exactLikenessCanaryStatus?: string | null;
  referenceStrategy?: string | null;
  referenceRolesUsed?: string[] | null;
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
  sceneIntent?: string[] | null;
  framingIntent?: string | null;
  primaryReferenceRole?: string | null;
  supportingReferenceRoles?: string[] | null;
  userSpecifiedOutfit?: boolean | null;
  outfitTermsDetected?: string[] | null;
  environmentTermsDetected?: string[] | null;
  referenceOutfitCarryoverSuppressed?: boolean | null;
  compositionCarryoverSuppressed?: boolean | null;
  frontOnlyFallback?: boolean | null;
  klingReferenceDiagnostics?: Record<string, unknown> | null;
  audioConfigured?: boolean | null;
  viralPresetUsed?: string | null;
  promptPolished?: boolean | null;
  selfLikenessIntensity?: SelfLikenessIntensity | null;
  textSelfGuidanceAvailable?: boolean | null;
  providerStatus?: string | null;
  progressLabel?: string | null;
  providerPredictionId?: string | null;
  providerPredictionUrl?: string | null;
  providerFallbackStage?: string | null;
  renderMode?: string | null;
  duplicateOf?: string | null;
  errorMessage?: string | null;
  errorCategory?: string | null;
  renderFailure?: Record<string, unknown> | null;
  referenceCount?: number | null;
  retryAfterSeconds?: number | null;
  retryAvailableAt?: string | null;
};

export type ExactLikenessCanaryResponse = {
  ok: boolean;
  provider: string;
  route: string;
  configured?: boolean;
  readinessStatus?: string;
  canaryStatus?: string;
  outputUrlPresent?: boolean;
  verifiedVideoPresent?: boolean;
  failureCategory?: string | null;
  providerErrorSummary?: string | null;
  recommendedNextAction?: string | null;
  warning?: string | null;
  exactLikenessRouterChoice?: Record<string, unknown> | null;
};

export type GenerationJob = {
  id: string;
  projectId: string | null;
  characterId: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  title: string;
  caption?: string | null;
  prompt: string;
  status: string;
  outputType: string;
  provider: string;
  displayEngine?: string | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  privacy: string;
  resultAssetUrl: string | null;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  thumbnailSource?: string | null;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
  generationMode?: GenerationMode | null;
  exactLikenessRoute?: string | null;
  exactLikenessProvider?: string | null;
  exactLikenessCanaryStatus?: string | null;
  referenceStrategy?: string | null;
  referenceRolesUsed?: string[] | null;
  referenceCount?: number | null;
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
  sceneIntent?: string[] | null;
  framingIntent?: string | null;
  primaryReferenceRole?: string | null;
  supportingReferenceRoles?: string[] | null;
  userSpecifiedOutfit?: boolean | null;
  outfitTermsDetected?: string[] | null;
  environmentTermsDetected?: string[] | null;
  referenceOutfitCarryoverSuppressed?: boolean | null;
  compositionCarryoverSuppressed?: boolean | null;
  frontOnlyFallback?: boolean | null;
  renderProvider?: string | null;
  klingReferenceDiagnostics?: Record<string, unknown> | null;
  audioConfigured?: boolean | null;
  viralPresetUsed?: string | null;
  promptPolished?: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CharacterStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type PrivacySetting = 'private' | 'approved_only' | 'public';
export type VideoEngine =
  | 'seedance-2.0'
  | 'seedance-quality'
  | 'sora-2'
  | 'sora-2-pro'
  | 'replicate'
  | 'veo'
  | 'runway'
  | 'mock'
  | 'openai';
export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type GenerationMode =
  | 'self-reference-video'
  | 'image-to-video'
  | 'reference-image-to-video'
  | 'text-to-video-fallback'
  | 'kling-exact-likeness-reference'
  | 'seedance-text-to-video'
  | 'seedance-multimodal-reference';

export type SeedanceReferenceImage = {
  url: string;
  label?: string;
  role?: string;
  token?: string;
};

export type AssetPersistenceSummary = {
  attempted: number;
  persisted: number;
  alreadyControlled: number;
  failed: number;
  unsupportedHosts: string[];
  assets?: Array<{
    originalUrl: string;
    sourceUrl: string;
    publicUrl: string;
    objectPath: string | null;
    bucket: string;
    contentType: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    aspectRatio: number | null;
    persisted: boolean;
    alreadyControlled: boolean;
  }>;
};

export type AssetPersistenceFailureReason =
  | 'protected_external_url'
  | 'expired_signed_url'
  | 'invalid_url'
  | 'download_failed'
  | 'asset_too_large'
  | 'unsupported_content_type'
  | 'storage_not_configured'
  | 'storage_upload_failed';

export type AssetPersistenceFailureDiagnostics = {
  code: string;
  reason: AssetPersistenceFailureReason;
  sourceUrl: string | null;
  host: string | null;
  failedReferenceIndex: number | null;
  failedReferenceLabel: string | null;
  failedReferenceRole: string | null;
  originalUrlHost: string | null;
  canContinueWithoutReference: boolean;
};

export type ModerationCategory =
  | 'identity_moderation'
  | 'celebrity_public_figure_moderation'
  | 'photorealistic_person_moderation'
  | 'glamour_editorial_moderation'
  | 'unsafe_wording'
  | 'provider_unknown_moderation';

export type ModerationRenderingMode =
  | 'photorealistic'
  | 'cinematic realism'
  | 'stylized cinematic'
  | 'painterly cinematic'
  | 'dreamlike cinematic'
  | 'animated cinematic';

export type ModerationSensitivity = 'low' | 'medium' | 'high';

export type ProviderSensitivityProfile = {
  realismTolerance: ModerationSensitivity;
  celebritySensitivity: ModerationSensitivity;
  identitySensitivity: ModerationSensitivity;
  stylizationFallbackPreference: ModerationRenderingMode;
};

export type ProviderModerationPathStep = {
  escalationLevel: number;
  rewriteStrategy: string;
  renderingMode: ModerationRenderingMode;
  realismModeSelected: ModerationRenderingMode;
  stageMessage: string;
  categories: ModerationCategory[];
  providerProfile: string;
  providerFallbackReady?: boolean;
};

export type ProviderModerationDiagnostics = {
  detected: boolean;
  provider: string;
  model: string;
  retryAttempted: boolean;
  retrySucceeded: boolean;
  retryMode: string | null;
  providerJobId: string | null;
  providerStatus: string | null;
  providerMessage: string;
  sanitizedPrompt: string;
  suggestedPrompt: string;
  referenceImageCount: number;
  category?: ModerationCategory | null;
  categories?: ModerationCategory[];
  escalationLevel?: number | null;
  rewriteStrategy?: string | null;
  renderingMode?: ModerationRenderingMode | null;
  realismModeSelected?: ModerationRenderingMode | null;
  providerProfile?: string | null;
  providerSensitivityProfile?: ProviderSensitivityProfile | null;
  orchestrationPath?: ProviderModerationPathStep[];
  retryStages?: string[];
  finalSuccessfulOrchestrationPath?: string | null;
  successfulFallbackPath?: string | null;
  moderationMemoryApplied?: boolean;
  providerFallbackReady?: boolean;
};

export type SceneOptimizationDiagnostics = {
  originalPromptLength: number;
  optimizedPromptLength: number;
  simplified: boolean;
  successMode: RenderSuccessMode;
  safeStyle: string;
  complexity: {
    score: number;
    level: 'low' | 'medium' | 'high';
    promptLength: number;
    referenceCount: number;
    sceneCount: number;
    emotionalDensity: number;
    cameraComplexity: number;
    environmentComplexity: number;
    recommendations: string[];
  };
  selectedReferenceCount: number;
  originalReferenceCount: number;
  referenceQualityScore: number;
  referenceStrategy: 'all_saved_references' | 'reduced_cast_references' | 'primary_reference' | 'no_reference_storybook';
  creatorMessage: string | null;
  promptFingerprint: string;
};

export type ProviderFallbackProvider =
  | 'seedance-quality'
  | 'seedance-fast'
  | 'veo-experimental'
  | 'kling'
  | 'demo-mode';

export type ProviderFallbackStage = {
  stage:
    | 'cast_safe_prompt'
    | 'seedance_fast'
    | 'stylized_cinematic'
    | 'reduced_references'
    | 'primary_reference'
    | 'storybook_text_only'
    | 'paused';
  provider: ProviderFallbackProvider;
  message: string;
  status: 'attempted' | 'blocked' | 'succeeded' | 'skipped' | 'paused';
  blockedReasonCategory?: string | null;
  promptChanged?: boolean;
  quality?: 'fast' | 'quality';
  referenceStrategy?: 'all_saved_references' | 'reduced_cast_references' | 'primary_reference' | 'no_reference_storybook';
  referenceCount?: number;
};

export type ProviderFallbackDiagnostics = {
  providerAttempted: ProviderFallbackProvider;
  fallbackProviderAttempted: ProviderFallbackProvider | null;
  providersAttempted: ProviderFallbackProvider[];
  castSafePromptApplied: boolean;
  displayNameMasked: boolean;
  riskyTermsRemoved: string[];
  finalProviderStatus: 'succeeded' | 'blocked' | 'paused';
  blockedReasonCategory?: string | null;
  finalProvider: ProviderFallbackProvider | null;
  finalPrompt: string;
  referenceStrategy: 'all_saved_references' | 'reduced_cast_references' | 'primary_reference' | 'no_reference_storybook' | null;
  renderedWithLighterCastGuidance: boolean;
  stages: ProviderFallbackStage[];
  suggestedPrompt?: string | null;
  sanitizedPrompt?: string | null;
  moderationDiagnostics?: ProviderModerationDiagnostics | null;
  sceneOptimization?: SceneOptimizationDiagnostics | null;
  successMode?: RenderSuccessMode | null;
  safeStyle?: string | null;
  complexityScore?: number | null;
  referenceQualityScore?: number | null;
  creatorMessage?: string | null;
};

export type ApiHealthDiagnostics = {
  service: string;
  checkedAt: string;
  ok: boolean;
  mode: string;
  configured: Record<string, boolean>;
  missingRequired?: string[];
  missingRecommended: string[];
  billing?: {
    enabled: boolean;
    required: boolean;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'missing_required';
    missing: string[];
    blocking: boolean;
  };
  assetPersistence?: {
    ok: boolean;
    bucket: string;
    persistedAssetCount: number;
    failedAssetDownloads: number;
    unsupportedHostEvents: number;
    blockedHosts?: number;
    unsupportedHosts: Array<{ host: string; count: number }>;
    failedReferenceLabels?: Array<{ label: string; count: number }>;
    repairableFailures?: number;
    mediaAssetsReadWrite?: string;
    bucketCheck?: string;
    orphanedAssetReferences: number;
    error?: unknown;
    remediation?: string;
  };
  referenceCleanup?: {
    ok: boolean;
    obsoleteExternalReferenceCount: number;
    manualReferenceOverrideCount: number;
    protectedReferenceCount: number;
    savedLumoraReferenceCount: number;
    repairableFailures: number;
    sourcesScanned: string[];
    failedReferenceLabels?: Array<{ label: string; count: number }>;
    warning?: string | null;
    error?: unknown;
  };
  aiCastPosts?: {
    ok: boolean;
    key?: string;
    message?: string;
    missing?: string[];
    publicPostsAllGenerated: boolean;
    publicPublishedPostsChecked?: number | null;
    rawUploadPostsCount: number | null;
    referenceMediaPublishedCount: number | null;
    verificationMediaPublishedCount: number | null;
    postsMissingGenerationSourceCount: number | null;
    violatingPostIdsRedacted?: string[];
    error?: unknown;
  };
  providerFallback?: {
    ok: boolean;
    configured: Record<string, boolean>;
    attempts: number;
    castSafePromptApplied: number;
    displayNameMasked: number;
    successfulFallbacks: number;
    paused: number;
    providersAttempted: Record<string, number>;
    riskyTermsRemoved: Record<string, number>;
    blockedCategories: Record<string, number>;
    lastSuccessfulPath: string | null;
    lastBlockedCategory: string | null;
    safeTestPrompts: string[];
    providerOrder: ProviderFallbackProvider[];
    note: string;
  };
  renderReliability?: {
    ok: boolean;
    persistenceAvailable: boolean;
    configured: boolean;
    safeStyles: string[];
    inMemory: Record<string, unknown>;
    persistedMemoryCount?: number;
    providerSuccessRate?: number | null;
    moderationFailureRate?: number | null;
    timeoutFailureRate?: number | null;
    averageComplexityScore?: number | null;
    averageReferenceQualityScore?: number | null;
    warning?: string;
    error?: unknown;
  };
  renderSuccessEngine?: {
    ok: boolean;
    enabled: boolean;
    totalAttempts: number;
    successRate: number | null;
    mostSuccessfulProvider: string | null;
    mostSuccessfulReferenceCount: number | null;
    lastSuccessfulRecipe: Record<string, unknown> | null;
    currentStuckJobs: number;
    activeMasters: number;
    paidAttemptsPrevented: number;
    duplicateRenderPrevented: number;
    moderationBlocksByTier: Record<string, number>;
    rateLimitsByProvider: Record<string, number>;
    providerOutputMissingCount: number;
    maxPaidAttempts: number;
    autoRetry: boolean;
    probeEnabled: boolean;
    error?: unknown;
  };
  referenceRouteStatus?: {
    state: 'succeeded' | 'failed' | 'unknown';
    referenceRole: string | null;
    variant: string | null;
    failureCategory: string | null;
    seedanceReferenceRoutesBlocked: boolean;
    blockedReferenceRoles: string[];
    requiredReferenceRoles: string[];
    knownSuccessfulReferenceRoutes: Array<Record<string, unknown>>;
    knownBlockedReferenceRoutes: Array<Record<string, unknown>>;
    allReferenceRouteResults: Array<Record<string, unknown>>;
  };
  selfVerificationVideo?: {
    schemaReady: boolean;
    oldSelfCapturePresent: boolean;
    selfVerificationVideoPresent: boolean;
    selfVerificationConsentPresent: boolean;
    verificationAudioPresent: boolean;
    verificationStatus: string | null;
    verificationPrompt: string | null;
    verificationLastTestedAt: string | null;
    seedanceVideoReferenceCanaryStatus: string | null;
    seedanceVideoReferenceLastFailureCategory?: string | null;
    seedanceVideoReferenceProviderStatus?: string | null;
    videoReferenceProvider: string | null;
    verificationVideoUrlRedacted: string | null;
    migratedFromOldSelfCapture: boolean;
    recommendedNextAction: string;
  };
  selfVerificationVideoPresent?: boolean;
  selfVerificationConsentPresent?: boolean;
  oldSelfCapturePresent?: boolean;
  migratedFromOldSelfCapture?: boolean;
  seedanceVideoReferenceCanaryStatus?: string | null;
  seedanceVideoReferenceLastFailureCategory?: string | null;
  seedanceVideoReferenceProviderStatus?: string | null;
  seedanceVideoReferenceBlocked?: boolean;
  seedanceVideoReferenceRetryAvailableAt?: string | null;
  verificationStatus?: string | null;
  obsoleteManualReferenceCount?: number;
  savedLumoraReferenceCount?: number;
  exactLikenessCanaryStatus?: string | null;
  recommendedNextAction?: string;
  seedanceImageReferenceBlocked?: boolean;
  likenessProviderCanary?: {
    textSelfGuidanceAvailable: boolean;
    alternateLikenessProvidersConfigured: string[];
    alternateLikenessProviderCanaryStatus: Array<{
      provider: string;
      configured: boolean;
      referenceCapable: boolean;
      canaryTested: boolean;
      productionRouteEnabled: boolean;
      status: string;
    }>;
  };
  exactLikenessRouter?: {
    route: string;
    provider: string;
    confidence: string;
    exactLikeness: boolean;
    reason: string;
    requiredSetup: string[];
    canaryStatus: string | null;
    fallbackRoute: string;
    recommendedNextAction: string;
  };
  runwayLikenessProvider?: Record<string, unknown>;
  klingLikenessProvider?: Record<string, unknown>;
  sceneAnchorEnabled?: boolean;
  sceneAnchorProvider?: string;
  sceneAnchorModel?: string | null;
  sceneAnchorConfigured?: boolean;
  sceneAnchorFallbackMode?: string;
  sceneAnchorPrivateUrlsRedacted?: boolean;
  sceneAnchor?: {
    enabled: boolean;
    provider: string;
    model: string | null;
    fallbackMode: string;
    configured: boolean;
    missingConfig: string[];
    lastFailureCategory: string | null;
    lastProviderStatus: string | null;
    lastProviderErrorSummary: string | null;
    lastPayloadShapeSummary: Record<string, unknown> | null;
    falHttpStatus?: number | null;
    falErrorType?: string | null;
    falErrorMessage?: string | null;
    falErrorBodyRedacted?: string | null;
    outputParsed?: boolean | null;
    recommendedNextAction: string;
    privateUrlsRedacted: boolean;
  };
  exactRouteActive?: boolean;
  exactProvider?: string | null;
  sceneAnchorStrategy?: string | null;
  lastRenderReferenceStrategy?: string | null;
  primaryVideoInputType?: string | null;
  primaryVideoInputSource?: string | null;
  startFrameSource?: string | null;
  posterFrameSource?: string | null;
  firstFrameSource?: string | null;
  stage2ProviderModel?: string | null;
  stage2ProviderRouteType?: string | null;
  rawReferenceVisualInputsSentToStage2?: boolean;
  identityReferencesPassedToVideoStage?: boolean;
  identityReferenceMode?: string | null;
  audioConfigured?: boolean;
  viralPresetUsed?: string | null;
  promptPolished?: boolean;
  lumoraIdentityPackStatus?: string;
  likenessProviderRegistry?: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    supportsExactLikeness: boolean;
    supportsReferenceImages: boolean;
    supportsStoredCharacters: boolean;
    requiresConsent: boolean;
    requiresCanary: boolean;
    canaryStatus: string;
    readinessStatus: string;
    lastSuccessAt: string | null;
    lastFailureCategory: string | null;
    deprecated: boolean;
    shutdownDate: string | null;
    implementationStatus: string;
    recommendedNextAction: string;
  }>;
  openaiSoraProvider?: {
    openaiVideoEnabled: boolean;
    openaiVideoModel: string;
    openaiVideoSize: string;
    openaiVideoSeconds: number;
    openaiCharacterEnabled: boolean;
    openaiApiKeyConfigured: boolean;
    openaiCharacterConfigured: boolean;
    openaiRawRestAvailable: boolean;
    openaiSdkVideosAvailable: boolean;
    apiReachable: boolean | null;
    openaiVideosDeprecated: boolean;
    shutdownDate: string;
    characterCreationSupported: boolean;
    characterVideoUsageMapped: boolean;
    sdkVideoSupported: boolean;
    sdkCharacterSupported: boolean;
    routeReady: boolean;
    status: string;
    message: string;
    recommendedNextAction: string;
  };
  asyncRenderJobs?: {
    ok: boolean;
    pendingJobCount: number;
    renderingJobCount: number;
    stuckJobCount: number;
    jobsMissingProviderPredictionId: number;
    jobsRenderingOverExpectedDuration: number;
    replicateRateLimitedCount: number;
    lastRetryAfterSeconds: number | null;
    webhookConfigured: boolean;
    pollerConfigured: boolean;
    activeInProcessJobs: number;
    activeRenderLocks: number;
    duplicateRenderPreventedCount: number;
    error?: unknown;
  };
  generationProviders: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'placeholder';
  }>;
  database?: {
    ok?: boolean;
    serviceRoleConfigured: boolean;
    tables: Array<{
      ok: boolean;
      name?: string;
      label?: string;
      table: string;
      source: string;
      count?: number | null;
      details?: Record<string, unknown>;
      remediation?: string;
      error?: unknown;
    }>;
    schemaChecks?: Array<{
      ok: boolean;
      name: string;
      label: string;
      source: string;
      table?: string;
      column?: string;
      count?: number | null;
      details?: Record<string, unknown>;
      remediation?: string;
      error?: unknown;
    }>;
    serviceRoleAccess?: Array<{
      ok: boolean;
      name: string;
      label: string;
      source: string;
      table?: string;
      details?: Record<string, unknown>;
      remediation?: string;
      error?: unknown;
    }>;
    rlsPolicies: {
      ok: boolean;
      source: string;
      policies?: Array<Record<string, unknown>>;
      error?: unknown;
    };
  };
};

export type SelfCharacterOwnershipDiagnostic = {
  authUserPresent: boolean;
  authUserIdRedacted: string | null;
  profileRowPresent: boolean;
  selfCharactersRowPresent: boolean;
  characterProfilesSelfRowPresent: boolean;
  legacyCreatorSelfPresent: boolean;
  writableVerificationTargetFound: boolean;
  mismatchDetected: boolean;
  ownerVerified: boolean;
  selfCharacterSource: string | null;
  sourceIdRedacted: string | null;
  writableTarget: {
    table: string;
    characterIdRedacted: string | null;
    sourceIdRedacted: string | null;
    writableFields: string[];
  } | null;
  recommendedNextAction: string;
};

export type MediaUploadInput = {
  url?: string;
  dataUrl?: string;
  fileName?: string;
  contentType?: string;
};

export type ReferenceImageUrls = {
  manualReferenceImageUrl?: string | null;
  frontFace: string;
  frontFaceUrl?: string | null;
  frontFacePath?: string | null;
  leftAngle: string;
  leftAngleUrl?: string | null;
  leftAnglePath?: string | null;
  rightAngle: string;
  rightAngleUrl?: string | null;
  rightAnglePath?: string | null;
  fullBody?: string | null;
  fullBodyUrl?: string | null;
  fullBodyPath?: string | null;
  expressive?: string | null;
  expressiveUrl?: string | null;
  expressivePath?: string | null;
};

export type LumoraIdentityStatus = 'ready' | 'needs_refs' | 'building';

export type LumoraIdentityFeedbackChoice =
  | 'looks_like_me'
  | 'hair_wrong'
  | 'face_shape_wrong'
  | 'skin_tone_wrong'
  | 'makeup_wrong'
  | 'too_realistic'
  | 'not_realistic_enough'
  | 'wrong_age'
  | 'wrong_body_type';

export type LumoraIdentityFeedback = {
  choices: LumoraIdentityFeedbackChoice[];
  customNote?: string;
  createdAt: string;
};

export type LumoraDetectedIdentityFeatures = {
  hairColor: string;
  eyeColor: string;
  skinTone: string;
  faceShape: string;
  bodyFrame: string;
  estimatedAgeRange: string;
  genderPresentation: string;
  styleTags: string[];
};

export type LumoraIdentityProfile = {
  identityId: string;
  userId: string;
  createdAt?: string;
  frontFaceUrl: string | null;
  leftAngleUrl: string | null;
  rightAngleUrl: string | null;
  fullBodyUrl?: string | null;
  videoReferenceUrls: string[];
  references?: {
    frontFaceUrl: string | null;
    leftAngleUrl: string | null;
    rightAngleUrl: string | null;
    fullBodyUrl?: string | null;
    selfieVideoUrl?: string | null;
    selfieVideo2Url?: string | null;
  };
  detectedFeatures?: LumoraDetectedIdentityFeatures;
  canonicalReferenceSet?: string[];
  primaryIdentityImageUrl?: string | null;
  identityPrompt?: string;
  generationConsistencyPrompt?: string;
  keyframeUrl?: string | null;
  appearanceSummary: string;
  userPreferences: Record<string, string>;
  dislikedTraits: string[];
  likenessNotes: string[];
  identityFeedback?: Array<LumoraIdentityFeedback & { id?: string; sentiment?: 'positive' | 'negative' | 'neutral' }>;
  preferredTraits?: string[];
  identityStrength?: number;
  successfulGenerations?: number;
  feedbackIterations?: number;
  version: number;
  status: LumoraIdentityStatus;
};

export type CreatorSelfStylePreferences = {
  everydayStyle?: string;
  glamStyle?: string;
  videoWardrobe?: string;
  colorsToFavor?: string;
  colorsToAvoid?: string;
};

export type CharacterRelationshipMemory = {
  targetCharacterId?: string | null;
  targetDisplayName?: string | null;
  relationshipSummary: string;
  emotionalDynamic?: string | null;
  lastSceneSummary?: string | null;
  updatedAt: string;
};

export type CharacterMemorySnapshot = {
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
  summary: string;
  continuityState: Partial<ContinuityMemoryState>;
  continuityConfidence: number;
  capturedAt: string;
};

export type CharacterAppearanceDrift = {
  field: 'appearanceSummary';
  expected: string;
  observed: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  detectedAt: string;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
};

export type CharacterProfile = {
  id: string;
  characterId?: string;
  ownerUserId: string;
  name: string;
  displayName?: string | null;
  status: CharacterStatus;
  consentConfirmed: boolean;
  visibility: PrivacySetting;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: ReferenceImageUrls;
  referencePhotoNames?: Partial<Record<keyof ReferenceImageUrls, string | null>>;
  sourceCaptureVideoUrl: string | null;
  sourceCaptureVideoPath?: string | null;
  sourceCaptureVideo2Url?: string | null;
  sourceCaptureVideo2Path?: string | null;
  sourceCaptureVideo2Name?: string | null;
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
  identityProfile?: LumoraIdentityProfile | null;
  creatorSelfFeatures?: Record<string, string>;
  creatorSelfStylePreferences?: CreatorSelfStylePreferences;
  appearanceSummary?: string;
  wardrobeTendencies?: string;
  emotionalTendencies?: string;
  soundtrackTendencies?: string;
  cinematicStyle?: string;
  continuityState?: Partial<ContinuityMemoryState>;
  memorySnapshots?: CharacterMemorySnapshot[];
  relationshipMemory?: Record<string, CharacterRelationshipMemory>;
  appearanceDrift?: CharacterAppearanceDrift[];
  providerIdentityProvider?: string | null;
  providerCharacterId?: string | null;
  providerCharacterIdPresent?: boolean;
  providerCharacterStatus?: string | null;
  providerCharacterCreatedAt?: string | null;
  providerCharacterLastVerifiedAt?: string | null;
  likenessProviderStatus?: string | null;
  likenessConsentAt?: string | null;
  providerCharacterSourceAssetId?: string | null;
  verificationVideoUrl?: string | null;
  verificationVideoPresent?: boolean;
  verificationVideoAssetId?: string | null;
  verificationAudioPresent?: boolean;
  verificationConsentAt?: string | null;
  verificationConsentPresent?: boolean;
  verificationStatus?: string | null;
  verificationPrompt?: string | null;
  verificationLastTestedAt?: string | null;
  videoReferenceRouteStatus?: string | null;
  videoReferenceProvider?: string | null;
  createdAt: string;
  updatedAt: string;
  isSelf?: boolean;
  isCreatorSelf?: boolean;
};

export type SoraSelfCharacterSetupPayload = {
  userId?: string | null;
  characterId?: string | null;
  consentConfirmed: boolean;
  sourceUploadAssetId?: string | null;
  sourceVideoUrl?: string | null;
};

export type SelfVerificationVideoPayload = {
  userId?: string | null;
  characterId?: string | null;
  consentConfirmed: boolean;
  sourceUploadAssetId?: string | null;
  sourceVideoUrl?: string | null;
  sourceFileName?: string | null;
  sourceContentType?: string | null;
  sourceSizeBytes?: number | null;
  verificationAudioPresent?: boolean;
};

export type CreateCharacterPayload = {
  name: string;
  consentConfirmed: boolean;
  visibility?: PrivacySetting;
  stylePreferences?: Record<string, unknown>;
  appearanceSummary?: string | null;
  wardrobeTendencies?: string | null;
  emotionalTendencies?: string | null;
  soundtrackTendencies?: string | null;
  cinematicStyle?: string | null;
  relationshipMemory?: Record<string, CharacterRelationshipMemory>;
  referenceImages: {
    frontFace: MediaUploadInput;
    leftAngle: MediaUploadInput;
    rightAngle: MediaUploadInput;
    expressive?: MediaUploadInput;
  };
  sourceCaptureVideo: MediaUploadInput;
  voiceSample?: MediaUploadInput;
};

export type DeleteCharacterResponse = {
  deleted: boolean;
  characterId: string;
  preservedGenerationReferences: number;
  cleanup: {
    characterProfiles: number;
    continuityMemory: number;
    moderationMemory: number;
  };
};

export type ReferenceCleanupResponse = {
  removedCount: number;
  remainingReferences: ReferenceImageUrls;
  character: CharacterProfile;
};

export type LumoraPost = {
  id: string;
  userId?: string | null;
  title?: string | null;
  caption?: string | null;
  prompt?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  thumbnailSource?: string | null;
  sourceGenerationId?: string | null;
  sourceGenerationJobId?: string | null;
  sourceProjectId?: string | null;
  sourceType?: string | null;
  isAiGenerated?: boolean | null;
  mediaOrigin?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  publishedAt?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  provider?: string | null;
  status?: string | null;
  privacy?: string | null;
  visibility?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  displayName?: string | null;
  username?: string | null;
  avatar?: string | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
};

function continuityMemorySearchParams(payload: ContinuityMemoryScopePayload) {
  const params = new URLSearchParams({ userId: payload.userId });
  if (payload.projectId) params.set('projectId', payload.projectId);
  if (payload.characterId) params.set('characterId', payload.characterId);
  return params.toString();
}

async function requestHealthDiagnostics(): Promise<ApiHealthDiagnostics> {
  try {
    return await request<ApiHealthDiagnostics>('/api/health/diagnostics', {
      timeoutMs: 15_000,
    });
  } catch {
    const safeStatus = await request<Parameters<typeof buildSafeHealthFallback>[0]>(SAFE_NATIVE_STATUS_PATH, {
      timeoutMs: 15_000,
    });
    return buildSafeHealthFallback(safeStatus) as ApiHealthDiagnostics;
  }
}

export const api = {
  health: requestHealthDiagnostics,

  createGeneration: (payload: GenerationPayload) =>
    request<GenerationResponse>('/api/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 45_000,
    }),

  createSeedanceGeneration: (payload: GenerationPayload) =>
    request<GenerationResponse>('/api/generations/seedance', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 45_000,
    }),

  getGenerationJob: (jobId: string) =>
    request<GenerationResponse>(`/api/generations/jobs/${encodeURIComponent(jobId)}`, {
      timeoutMs: 20_000,
    }),

  resumeGenerationJob: (jobId: string) =>
    request<GenerationResponse>(`/api/generations/jobs/${encodeURIComponent(jobId)}/resume`, {
      method: 'POST',
      timeoutMs: 20_000,
    }),

  listGenerationJobs: () => request<{ jobs: GenerationJob[] }>('/api/generations'),

  healthDiagnostics: requestHealthDiagnostics,

  startRunwayLikenessCanary: (payload: { userId?: string | null; saveAsDraft?: boolean } = {}) =>
    request<ExactLikenessCanaryResponse>('/api/diagnostics/runway-likeness-canary/self', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 180_000,
    }),

  startKlingLikenessCanary: (payload: { userId?: string | null; saveAsDraft?: boolean } = {}) =>
    request<ExactLikenessCanaryResponse>('/api/diagnostics/kling-likeness-canary/self', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 180_000,
    }),

  startSeedanceVideoReferenceCanary: (payload: { userId?: string | null; variant?: 'reference_videos_bracket' | 'reference_videos_at' | 'video_urls_at'; forceNormalize?: boolean; allowOriginalFallback?: boolean; forceRetest?: boolean } = {}) =>
    request<ExactLikenessCanaryResponse>('/api/diagnostics/seedance-video-reference-canary/self', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 60_000,
    }),

  createCreativeBrainPlan: (payload: CreativeBrainPlanPayload) =>
    request<CreativeBrainPlanResponse>('/api/creative-brain/plan', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    }),

  executeScenePlan: (payload: SceneExecutorPayload) =>
    request<SceneExecutorResult>('/api/creative-brain/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 900_000,
    }),

  getContinuityMemory: (payload: ContinuityMemoryScopePayload) =>
    request<{ memory: ContinuityMemoryRecord }>(
      `/api/creative-brain/memory?${continuityMemorySearchParams(payload)}`,
      {
        timeoutMs: 20_000,
      },
    ),

  updateContinuityMemory: (payload: ContinuityMemoryPatchPayload) =>
    request<{ memory: ContinuityMemoryRecord }>('/api/creative-brain/memory', {
      method: 'PATCH',
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    }),

  listCharacters: () => request<{ characters: CharacterProfile[] }>('/api/characters'),

  getCharacter: (id: string) => request<{ character: CharacterProfile }>(`/api/characters/${id}`),

  createCharacter: (payload: CreateCharacterPayload) =>
    request<{ character: CharacterProfile }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCharacter: (id: string, payload: Partial<CreateCharacterPayload>) =>
    request<{ character: CharacterProfile }>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteCharacter: (id: string) =>
    request<DeleteCharacterResponse>(`/api/characters/${id}`, {
      method: 'DELETE',
    }),

  cleanupObsoleteCharacterReferences: (id: string) =>
    request<ReferenceCleanupResponse>(`/api/characters/${id}/references/cleanup-obsolete`, {
      method: 'POST',
    }),

  createSoraSelfCharacter: (payload: SoraSelfCharacterSetupPayload) =>
    request<{
      ok: boolean;
      status: string;
      provider: 'openai_sora';
      providerCharacterIdPresent: boolean;
      providerCharacterIdRedacted: string | null;
      providerCharacterStatus: string | null;
      likenessProviderStatus: string | null;
      failureCategory?: string | null;
      readiness?: ApiHealthDiagnostics['openaiSoraProvider'];
      message: string;
      character: CharacterProfile | null;
    }>('/api/characters/self/sora-character', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveSelfVerificationVideo: (payload: SelfVerificationVideoPayload) =>
    request<{
      ok: boolean;
      verificationVideoPresent: boolean;
      verificationAudioPresent: boolean;
      verificationConsentPresent: boolean;
      verificationStatus: string | null;
      verificationPrompt: string | null;
      videoReferenceRouteStatus: string | null;
      message: string;
      character: CharacterProfile | null;
    }>('/api/characters/self/verification-video', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSelfVerificationVideoStatus: () =>
    request<{
      ok: boolean;
      verificationVideoPresent: boolean;
      verificationAudioPresent: boolean;
      verificationConsentPresent: boolean;
      verificationStatus: string | null;
      verificationPrompt: string | null;
      videoReferenceRouteStatus: string | null;
      videoReferenceProvider: string | null;
      verificationVideoUrlRedacted: string | null;
      oldSelfCapturePresent?: boolean;
      migratedFromOldSelfCapture?: boolean;
      recommendedNextAction: string;
    }>('/api/characters/self/verification-video/status'),

  getSelfCharacterOwnershipDiagnostic: () =>
    request<{ ok: boolean } & SelfCharacterOwnershipDiagnostic>('/api/diagnostics/self-character-ownership'),

  repairSelfCharacterOwnership: () =>
    request<{
      ok: boolean;
      ownership: SelfCharacterOwnershipDiagnostic;
      message: string;
    }>('/api/characters/self/repair-ownership', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteSelfVerificationVideo: (payload: { userId?: string | null; characterId?: string | null }) =>
    request<{
      ok: boolean;
      verificationVideoPresent: boolean;
      verificationAudioPresent: boolean;
      verificationConsentPresent: boolean;
      verificationStatus: string | null;
      verificationPrompt: string | null;
      videoReferenceRouteStatus: string | null;
      message: string;
      character: CharacterProfile | null;
    }>('/api/characters/self/verification-video', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }),

  listProjects: () => request<{ projects: Array<Record<string, unknown>> }>('/api/projects'),

  createCheckoutSession: (priceId: string) =>
    request<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ priceId }),
    }),

  subscribePush: (subscription: unknown) =>
    request<{ success: boolean }>('/api/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
};
