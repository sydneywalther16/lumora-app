export const DIRECTOR_PROGRESS_STATES = [
  'Planning your story',
  'Building your cast and setting',
  'Creating your scene',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
] as const;

export type DirectorProgressState = (typeof DIRECTOR_PROGRESS_STATES)[number];

const providerDetailPattern =
  /\b(?:nano banana|gemini omni|gemini|veo|seedance|firefly|replicate|provider payload|api error)\b/i;

export function isProviderNeutralDirectorProgress(value: string): value is DirectorProgressState {
  return DIRECTOR_PROGRESS_STATES.includes(value as DirectorProgressState) &&
    !providerDetailPattern.test(value);
}

export function directorProgressForGenerationState(
  state: 'idle' | 'queued' | 'processing' | 'verifying_output' | 'rate_limited' | 'completed' | 'failed',
): DirectorProgressState | null {
  switch (state) {
    case 'queued':
      return DIRECTOR_PROGRESS_STATES[0];
    case 'processing':
      return DIRECTOR_PROGRESS_STATES[2];
    case 'verifying_output':
      return DIRECTOR_PROGRESS_STATES[3];
    case 'completed':
      return DIRECTOR_PROGRESS_STATES[5];
    case 'rate_limited':
      return DIRECTOR_PROGRESS_STATES[2];
    case 'failed':
    case 'idle':
      return null;
  }
}
