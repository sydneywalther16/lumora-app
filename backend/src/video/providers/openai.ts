import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class OpenAIVideoProvider implements VideoProvider {
  engine = 'openai' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    // This is a placeholder OpenAI video provider.
    // Sora 2 Videos API is deprecated and shutting down September 24, 2026,
    // so Lumora should not depend on that flow here.
    // OpenAI video support remains a placeholder until a stable replacement is available.
    if (!env.OPENAI_API_KEY || !env.OPENAI_VIDEO_MODEL) {
      return {
        status: 'completed',
        provider: this.engine,
        providerJobId: randomUUID(),
        resultAssetUrl: '/demo-video.mp4',
        message:
          'OpenAI video provider is not configured. Using mock response for local development.',
        prompt: input.prompt,
        characterId: input.characterId ?? null,
        characterName: input.characterName ?? null,
      };
    }

    // When a stable OpenAI video model contract is available, wire the request here.
    // The implementation should send prompt, character metadata, and any reference media
    // to the OpenAI video API, then return a completed or queued result.
    return {
      status: 'completed',
      provider: this.engine,
      providerJobId: randomUUID(),
      resultAssetUrl: '/demo-video.mp4',
      message:
        'OpenAI video provider is configured, but the real adapter is not implemented yet.',
      prompt: input.prompt,
      characterId: input.characterId ?? null,
      characterName: input.characterName ?? null,
    };
  }
}
