const baseUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? '';

function buildRequestHeaders(headers: HeadersInit | undefined) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  return requestHeaders;
}

type RequestInitWithTimeout = RequestInit & {
  timeoutMs?: number;
};

async function request<T>(path: string, init: RequestInitWithTimeout = {}): Promise<T> {
  const { timeoutMs, signal, ...fetchInit } = init;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}${path}`,
      Object.assign({}, fetchInit, {
        headers: buildRequestHeaders(init.headers),
        signal: signal ?? controller?.signal,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Generation request timed out. Try again in a moment.');
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

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
  privacy?: PrivacySetting;
  referenceImages?: SeedanceReferenceImage[];
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
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
  error?: string;
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
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
  generationMode?: GenerationMode | null;
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
  | 'seedance-text-to-video'
  | 'seedance-multimodal-reference';

export type SeedanceReferenceImage = {
  url: string;
  label?: string;
  role?: string;
  token?: string;
};

export type ApiHealthDiagnostics = {
  service: string;
  checkedAt: string;
  ok: boolean;
  mode: string;
  configured: Record<string, boolean>;
  missingRecommended: string[];
  generationProviders: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'placeholder';
  }>;
  database?: {
    serviceRoleConfigured: boolean;
    tables: Array<{
      ok: boolean;
      table: string;
      source: string;
      count?: number | null;
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

export type CharacterProfile = {
  id: string;
  ownerUserId: string;
  name: string;
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
  createdAt: string;
  updatedAt: string;
  isSelf?: boolean;
  isCreatorSelf?: boolean;
};

export type CreateCharacterPayload = {
  name: string;
  consentConfirmed: boolean;
  visibility?: PrivacySetting;
  stylePreferences?: Record<string, unknown>;
  referenceImages: {
    frontFace: MediaUploadInput;
    leftAngle: MediaUploadInput;
    rightAngle: MediaUploadInput;
    expressive?: MediaUploadInput;
  };
  sourceCaptureVideo: MediaUploadInput;
  voiceSample?: MediaUploadInput;
};

export type LumoraPost = {
  id: string;
  userId?: string | null;
  title?: string | null;
  caption?: string | null;
  prompt?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  sourceGenerationId?: string | null;
  createdAt: string;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  provider?: string | null;
  status?: string | null;
  privacy?: string | null;
  displayName?: string | null;
  username?: string | null;
  avatar?: string | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
};

export const api = {
  health: () => request<{ ok: boolean; service: string }>('/health'),

  createGeneration: (payload: GenerationPayload) =>
    request<GenerationResponse>('/api/generations', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 240_000,
    }),

  createSeedanceGeneration: (payload: GenerationPayload) =>
    request<GenerationResponse>('/api/generations/seedance', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 240_000,
    }),

  listGenerationJobs: () => request<{ jobs: GenerationJob[] }>('/api/generations'),

  healthDiagnostics: () => request<ApiHealthDiagnostics>('/api/health/diagnostics', {
    timeoutMs: 15_000,
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
