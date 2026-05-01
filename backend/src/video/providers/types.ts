import type { CharacterReferenceImageUrls, CharacterVisibility } from '../../services/characterService';

export type VideoEngine = 'veo' | 'runway' | 'mock' | 'openai';
export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type VideoPrivacy = CharacterVisibility;

export type CharacterVideoContext = {
  id: string;
  name: string;
  referenceImageUrls: CharacterReferenceImageUrls;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  stylePreferences: Record<string, unknown>;
};

export type VideoGenerationRequest = {
  userId: string;
  prompt: string;
  character?: CharacterVideoContext | null;
  characterId?: string | null;
  characterName?: string | null;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  privacy: VideoPrivacy;
};

export type VideoProviderQueuedResult = {
  status: 'queued' | 'queued-demo';
  provider: VideoEngine;
  providerJobId: string;
  message: string;
};

export type VideoProviderCompletedResult = {
  status: 'completed';
  provider: VideoEngine;
  providerJobId: string;
  resultAssetUrl: string;
  message: string;
  prompt: string;
  characterId: string | null;
  characterName: string | null;
  rawResponse?: unknown;
};

export type VideoProviderResult = VideoProviderQueuedResult | VideoProviderCompletedResult;

export interface VideoProvider {
  engine: VideoEngine;
  createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult>;
}
