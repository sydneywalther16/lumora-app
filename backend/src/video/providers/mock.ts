import { randomUUID } from 'node:crypto';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class MockVideoProvider implements VideoProvider {
  engine = 'mock' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    return {
      status: 'failed',
      provider: this.engine,
      providerJobId: randomUUID(),
      message: 'Demo Mode is preview-only and did not create provider video output.',
      errorMessage: 'Demo Mode did not create provider video output.',
    };
  }
}
