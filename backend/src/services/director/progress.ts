export const DIRECTOR_PROGRESS_STATES = [
  'Planning your story',
  'Building your cast and setting',
  'Creating your scene',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
] as const;

export type DirectorProgressState = (typeof DIRECTOR_PROGRESS_STATES)[number];

const forbiddenProviderDetail =
  /\b(?:nano banana|gemini omni|gemini|veo|seedance|firefly|replicate|provider payload|api error)\b/i;

export function isProviderNeutralProgressState(value: string): value is DirectorProgressState {
  return DIRECTOR_PROGRESS_STATES.includes(value as DirectorProgressState) &&
    !forbiddenProviderDetail.test(value);
}

export function directorProgressAt(index: number): DirectorProgressState {
  return DIRECTOR_PROGRESS_STATES[Math.max(0, Math.min(index, DIRECTOR_PROGRESS_STATES.length - 1))];
}
