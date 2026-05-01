import { env } from '../../lib/env';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class RunwayVideoProvider implements VideoProvider {
  engine = 'runway' as const;

  async createGeneration(_input: VideoGenerationRequest): Promise<VideoProviderResult> {
    if (!env.RUNWAY_API_KEY) {
      throw new Error(
        'Runway generation is not configured. Set RUNWAY_API_KEY on the API server, or choose the mock engine for local demo queues.',
      );
    }

    throw new Error(
      'Runway credentials are present, but the production Runway API adapter has not been implemented yet.',
    );
  }
}
