export const CREATOR_PROGRESS_STEPS = [
  'Planning your scene',
  'Building the cast and setting',
  'Creating the shot',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
] as const;

export type CreatorProgressStep = (typeof CREATOR_PROGRESS_STEPS)[number];

export type CreatorCreateState =
  | 'READY'
  | 'NEEDS_CAST'
  | 'GENERATING'
  | 'SAVED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'NEEDS_EDIT';

export type CreatorCreateStateInput = {
  hasCast: boolean;
  isGenerating: boolean;
  hasSavedResult: boolean;
  isTemporarilyUnavailable: boolean;
  needsEdit: boolean;
};

export type CreatorCreateStateCopy = {
  title: string;
  body?: string;
  primaryAction: string;
};

export const CREATOR_CREATE_STATE_COPY: Record<CreatorCreateState, CreatorCreateStateCopy> = {
  READY: {
    title: 'Create',
    primaryAction: 'Generate',
  },
  NEEDS_CAST: {
    title: 'Create',
    primaryAction: 'Finish your AI Cast',
  },
  GENERATING: {
    title: 'Lumora is directing your scene',
    body: 'You can leave this screen safely. Your work will stay with your draft.',
    primaryAction: 'Save to Drafts',
  },
  SAVED: {
    title: 'Your scene is ready',
    body: 'Your scene is saved in Drafts.',
    primaryAction: 'Continue',
  },
  TEMPORARILY_UNAVAILABLE: {
    title: 'Lumora’s studio is busy right now.',
    body: 'Your scene is safely preserved.',
    primaryAction: 'Save draft',
  },
  NEEDS_EDIT: {
    title: 'Try a different scene direction',
    body: 'Your scene text is still here and ready to edit.',
    primaryAction: 'Edit scene',
  },
};

export function deriveCreatorCreateState(input: CreatorCreateStateInput): CreatorCreateState {
  if (input.isGenerating) return 'GENERATING';
  if (input.hasSavedResult) return 'SAVED';
  if (!input.hasCast) return 'NEEDS_CAST';
  if (input.isTemporarilyUnavailable) return 'TEMPORARILY_UNAVAILABLE';
  if (input.needsEdit) return 'NEEDS_EDIT';
  return 'READY';
}

export function creatorProgressStep(
  status: 'idle' | 'queued' | 'processing' | 'verifying_output' | 'rate_limited' | 'completed' | 'failed',
): CreatorProgressStep {
  switch (status) {
    case 'queued':
      return CREATOR_PROGRESS_STEPS[0];
    case 'processing':
      return CREATOR_PROGRESS_STEPS[2];
    case 'verifying_output':
      return CREATOR_PROGRESS_STEPS[3];
    case 'completed':
      return CREATOR_PROGRESS_STEPS[5];
    case 'rate_limited':
    case 'failed':
    case 'idle':
      return CREATOR_PROGRESS_STEPS[0];
  }
}

export function shouldShowInternalCreateDiagnostics(search: string, isDevelopment: boolean): boolean {
  if (!isDevelopment) return false;
  return new URLSearchParams(search).get('internalDiagnostics') === '1';
}
