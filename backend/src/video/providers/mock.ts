import { randomUUID } from 'node:crypto';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class MockVideoProvider implements VideoProvider {
  engine = 'mock' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    return {
      status: 'completed',
      provider: this.engine,
      providerJobId: randomUUID(),
      resultAssetUrl: '/demo-video.mp4',
      message: 'Mock video generated successfully for local development.',
      prompt: input.prompt,
      characterId: input.characterId ?? null,
      characterName: input.characterName ?? null,
    };
  }
}
