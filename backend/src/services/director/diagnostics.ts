import { GEMINI_OMNI_FLASH_MODEL, NANO_BANANA_2_MODEL } from './adapters';

export type DirectorInternalDiagnostics = {
  visibility: 'internal_only';
  sdk: '@google/genai';
  legacyGoogleAdapterRetained: true;
  adapters: Array<{
    role: 'scene_anchor' | 'primary_video';
    model: string;
    enabled: false;
  }>;
};

export function buildDirectorInternalDiagnostics(): DirectorInternalDiagnostics {
  return {
    visibility: 'internal_only',
    sdk: '@google/genai',
    legacyGoogleAdapterRetained: true,
    adapters: [
      { role: 'scene_anchor', model: NANO_BANANA_2_MODEL, enabled: false },
      { role: 'primary_video', model: GEMINI_OMNI_FLASH_MODEL, enabled: false },
    ],
  };
}
