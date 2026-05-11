import { MockVideoProvider } from './providers/mock';
import { OpenAIVideoProvider } from './providers/openai';
import { RunwayVideoProvider } from './providers/runway';
import { SeedanceVideoProvider } from './providers/seedance';
import { VeoVideoProvider } from './providers/veo';
import type { VideoEngine, VideoGenerationRequest, VideoProviderResult } from './providers/types';

// Provider registry for video generation.
// The mock provider remains the always-working fallback for local development.
// Seedance is the Replicate-backed provider, while Veo/OpenAI placeholders stay intact.
const providers = {
  'seedance-2.0': new SeedanceVideoProvider(),
  'seedance-quality': new SeedanceVideoProvider('quality'),
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
