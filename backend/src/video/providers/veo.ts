import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import { extractProviderVideoUrl } from '../../services/providerOutputParser';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

const VIDEO_MODEL = 'veo-3.1-generate-preview';

function createUnavailableResult(message: string): VideoProviderResult {
  return {
    status: 'failed',
    provider: 'veo',
    providerJobId: randomUUID(),
    message,
    errorMessage: message,
  };
}

function extractVideoUrl(operationResult: any): string | null {
  if (!operationResult) return null;
  const response = operationResult.response ?? operationResult;
  return extractProviderVideoUrl(response);
}

export class VeoVideoProvider implements VideoProvider {
  engine = 'veo' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    if (!env.GOOGLE_API_KEY) {
      return createUnavailableResult('Veo provider is not configured. Choose Seedance Fast or explicit Demo Mode.');
    }

    try {
      const sdk = await import('@google/generative-ai') as any;
      const VideoGenerationModel = sdk.VideoGenerationModel ?? sdk.VideoModel ?? sdk.VideoGeneration;
      const OperationsClient = sdk.OperationsClient ?? sdk.operations?.OperationsClient;

      if (!VideoGenerationModel) {
        throw new Error('Veo SDK model class not available');
      }

      const model = new VideoGenerationModel({ apiKey: env.GOOGLE_API_KEY });
      console.info('Generating with Veo...');
      const operation = await model.generate({
        model: VIDEO_MODEL,
        input: { prompt: input.prompt },
      });

      const providerJobId = operation?.name ?? randomUUID();
      console.info('Veo generation started', { providerJobId, model: VIDEO_MODEL });

      if (operation.done) {
        const outputUrl = extractVideoUrl(operation.result ?? operation.response ?? operation);
        if (!outputUrl) {
          return createUnavailableResult('Veo completed without a usable video output.');
        }
        return {
          status: 'completed',
          provider: this.engine,
          providerJobId,
          resultAssetUrl: outputUrl,
          message: 'Veo generation started',
          prompt: input.prompt,
          characterId: input.characterId ?? null,
          characterName: input.characterName ?? null,
          rawResponse: operation,
        };
      }

      if (!OperationsClient) {
        throw new Error('Veo operations client not available');
      }

      const operationsClient = new OperationsClient({ apiKey: env.GOOGLE_API_KEY });
      let finalOperation = operation;
      for (let attempt = 0; attempt < 10 && !finalOperation.done; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        finalOperation = await operationsClient.getOperation({ name: providerJobId });
      }

      const [operationResponse] =
        typeof finalOperation.promise === 'function'
          ? await finalOperation.promise()
          : [finalOperation];

      const completedOperation = operationResponse ?? finalOperation;
      const outputUrl = extractVideoUrl(completedOperation);
      if (!outputUrl) {
        return createUnavailableResult('Veo completed without a usable video output.');
      }

      return {
        status: 'completed',
        provider: this.engine,
        providerJobId,
        resultAssetUrl: outputUrl,
        message: 'Veo generation started',
        prompt: input.prompt,
        characterId: input.characterId ?? null,
        characterName: input.characterName ?? null,
        rawResponse: completedOperation,
      };
    } catch (error) {
      console.info('Veo unavailable', error);
      return createUnavailableResult('Veo provider is unavailable. Choose Seedance Fast or explicit Demo Mode.');
    }
  }
}
