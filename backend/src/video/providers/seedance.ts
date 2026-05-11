import { generateSeedanceVideo, type SeedanceQualityMode } from '../../services/providers/seedanceProvider';
import type { VideoEngine, VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class SeedanceVideoProvider implements VideoProvider {
  engine: VideoEngine;

  constructor(private readonly quality: SeedanceQualityMode = 'fast') {
    this.engine = quality === 'quality' ? 'seedance-quality' : 'seedance-2.0';
  }

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    const result = await generateSeedanceVideo(input.prompt, { quality: this.quality });

    return {
      status: 'completed',
      provider: this.engine,
      providerJobId: result.id,
      resultAssetUrl: result.videoUrl,
      message: 'Seedance 2.0 video generated successfully.',
      prompt: input.prompt,
      characterId: input.characterId ?? null,
      characterName: input.characterName ?? null,
      rawResponse: result.rawOutput,
    };
  }
}
