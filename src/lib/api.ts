const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

function buildRequestHeaders(headers: HeadersInit | undefined) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  return requestHeaders;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(
    `${baseUrl}${path}`,
    Object.assign({}, init, { headers: buildRequestHeaders(init.headers) }),
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export type GenerationPayload = {
  title?: string;
  prompt: string;
  stylePreset?: string;
  outputType?: 'image' | 'video';
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  duration?: number;
  aspectRatio?: VideoAspectRatio;
  engine?: VideoEngine;
  privacy?: PrivacySetting;
};

export type GenerationResponse = {
  id: string;
  jobId: string;
  status: string;
  engine: VideoEngine;
  characterId: string | null;
  characterName: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  prompt: string;
  outputUrl: string;
  generationMode?: GenerationMode | null;
  model?: string | null;
  displayEngine?: string | null;
  referenceImageUrl?: string | null;
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
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CharacterStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type PrivacySetting = 'private' | 'approved_only' | 'public';
export type VideoEngine = 'sora-2' | 'sora-2-pro' | 'replicate' | 'veo' | 'runway' | 'mock' | 'openai';
export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type GenerationMode = 'self-reference-video' | 'image-to-video' | 'text-to-video-fallback';

export type MediaUploadInput = {
  url?: string;
  dataUrl?: string;
  fileName?: string;
  contentType?: string;
};

export type ReferenceImageUrls = {
  frontFace: string;
  leftAngle: string;
  rightAngle: string;
  fullBody?: string | null;
  expressive?: string | null;
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
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
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
    }),

  listGenerationJobs: () => request<{ jobs: GenerationJob[] }>('/api/generations'),

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
