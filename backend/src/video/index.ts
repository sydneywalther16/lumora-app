import { MockVideoProvider } from './providers/mock';
import { OpenAIVideoProvider } from './providers/openai';
import { RunwayVideoProvider } from './providers/runway';
import { VeoVideoProvider } from './providers/veo';
import type { VideoEngine, VideoGenerationRequest, VideoProviderResult } from './providers/types';

// Provider registry for video generation.
// The mock provider remains the always-working fallback for local development.
// Veo is the first real provider target, while OpenAI remains placeholder-only.
const providers = {
  veo: new VeoVideoProvider(),
  runway: new RunwayVideoProvider(),
  mock: new MockVideoProvider(),
  openai: new OpenAIVideoProvider(),
} satisfies Record<VideoEngine, { createGeneration(input: VideoGenerationRequest): Promise<VideoProviderResult> }>;

export type {
  CharacterVideoContext,
  VideoAspectRatio,
  VideoEngine,
  VideoGenerationRequest,
  VideoPrivacy,
  VideoProviderResult,
} from './providers/types';

export function getVideoProvider(engine: VideoEngine) {
  return providers[engine];
}

export async function createVideoGeneration(engine: VideoEngine, input: VideoGenerationRequest) {
  return getVideoProvider(engine).createGeneration(input);
}
