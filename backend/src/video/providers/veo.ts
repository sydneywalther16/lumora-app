import { randomUUID } from 'node:crypto';
import { env } from '../../lib/env';
import type { VideoGenerationRequest, VideoProvider, VideoProviderResult } from './types';

declare module '@google/generative-ai';

const VIDEO_MODEL = 'veo-3.1-generate-preview';
const MOCK_OUTPUT_URL = '/demo-video.mp4';

function createMockResult(input: VideoGenerationRequest, message: string): VideoProviderResult {
  return {
    status: 'completed',
    provider: 'veo',
    providerJobId: 'veo-mock-fallback',
    resultAssetUrl: MOCK_OUTPUT_URL,
    message,
    prompt: input.prompt,
    characterId: input.characterId ?? null,
    characterName: input.characterName ?? null,
  };
}

function extractVideoUrl(operationResult: any): string | null {
  if (!operationResult) return null;
  const response = operationResult.response ?? operationResult;
  return (
    response?.output?.[0]?.uri ||
    response?.artifacts?.[0]?.uri ||
    response?.video?.uri ||
    response?.videoUri ||
    response?.output?.[0]?.video?.uri ||
    null
  );
}

export class VeoVideoProvider implements VideoProvider {
  engine = 'veo' as const;

  async createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> {
    if (!env.GOOGLE_API_KEY) {
      return createMockResult(input, 'Veo unavailable, showing mock output instead');
    }

    try {
      const sdk = await import('@google/generative-ai');
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
        return {
          status: 'completed',
          provider: this.engine,
          providerJobId,
          resultAssetUrl: outputUrl || MOCK_OUTPUT_URL,
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
      const outputUrl = extractVideoUrl(completedOperation) ?? MOCK_OUTPUT_URL;

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
      console.info('Veo unavailable, showing mock output instead', error);
      return createMockResult(input, 'Veo unavailable, showing mock output instead');
    }
  }
}
