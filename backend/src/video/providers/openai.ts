import { randomUUID } from 'node:crypto';
import { getOpenAISoraProviderReadiness } from '../../services/providers/openaiSoraProvider';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

export class OpenAIVideoProvider implements VideoProvider {
  engine = 'openai' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    const readiness = getOpenAISoraProviderReadiness();
    if (!readiness.openaiApiKeyConfigured || !readiness.openaiVideoEnabled) {
      return {
        status: 'failed',
        provider: this.engine,
        providerJobId: randomUUID(),
        message:
          'OpenAI video provider is not configured. Choose Seedance Fast or explicit Demo Mode.',
        errorMessage: 'OpenAI video provider is not configured.',
      };
    }

    return {
      status: 'failed',
      provider: this.engine,
      providerJobId: randomUUID(),
      message:
        readiness.message,
      errorMessage: readiness.message,
    };
  }
}
