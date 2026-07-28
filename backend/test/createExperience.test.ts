import assert from 'node:assert/strict';
import {
  CREATOR_CREATE_STATE_COPY,
  CREATOR_PROGRESS_STEPS,
  creatorProgressStep,
  deriveCreatorCastReadiness,
  deriveCreatorCreateState,
  sceneTextForDraftEdit,
  shouldShowInternalCreateDiagnostics,
} from '../../src/lib/createExperience';

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: false,
    isTemporarilyUnavailable: false,
    needsEdit: false,
  }),
  'READY',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'none',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: false,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'NO_CAST',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'incomplete',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: false,
    isTemporarilyUnavailable: false,
    needsEdit: false,
  }),
  'INCOMPLETE_CAST',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: true,
    isTemporarilyUnavailable: false,
    needsEdit: false,
  }),
  'ACCOUNT_UNAVAILABLE',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'incomplete',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: true,
    isTemporarilyUnavailable: false,
    needsEdit: false,
  }),
  'ACCOUNT_UNAVAILABLE',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: true,
    hasSavedResult: false,
    isAccountServiceUnavailable: true,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'GENERATING',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: false,
    hasSavedResult: true,
    isAccountServiceUnavailable: true,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'SAVED',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: false,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'TEMPORARILY_UNAVAILABLE',
);

assert.equal(
  deriveCreatorCreateState({
    castReadiness: 'usable',
    isGenerating: false,
    hasSavedResult: false,
    isAccountServiceUnavailable: false,
    isTemporarilyUnavailable: false,
    needsEdit: true,
  }),
  'NEEDS_EDIT',
);

assert.deepEqual(CREATOR_PROGRESS_STEPS, [
  'Planning your scene',
  'Building the cast and setting',
  'Creating the shot',
  'Checking movement and continuity',
  'Polishing the result',
  'Saving to Drafts',
]);
assert.equal(creatorProgressStep('queued'), 'Planning your scene');
assert.equal(creatorProgressStep('processing'), 'Creating the shot');
assert.equal(creatorProgressStep('verifying_output'), 'Checking movement and continuity');
assert.equal(creatorProgressStep('completed'), 'Saving to Drafts');

assert.equal(CREATOR_CREATE_STATE_COPY.READY.primaryAction, 'Generate');
assert.equal(CREATOR_CREATE_STATE_COPY.NO_CAST.primaryAction, 'Choose your AI Cast');
assert.equal(CREATOR_CREATE_STATE_COPY.INCOMPLETE_CAST.primaryAction, 'Finish your AI Cast');
assert.equal(CREATOR_CREATE_STATE_COPY.ACCOUNT_UNAVAILABLE.primaryAction, 'Try again');
assert.equal(CREATOR_CREATE_STATE_COPY.TEMPORARILY_UNAVAILABLE.body, 'Your scene is safely preserved.');
assert.equal(CREATOR_CREATE_STATE_COPY.NEEDS_EDIT.primaryAction, 'Edit scene');
assert.equal(
  deriveCreatorCastReadiness({ hasSelectedCast: true, isSetupIncomplete: false }),
  'usable',
);
assert.equal(
  deriveCreatorCastReadiness({ hasSelectedCast: true, isSetupIncomplete: true }),
  'incomplete',
);
assert.equal(
  deriveCreatorCastReadiness({ hasSelectedCast: false, isSetupIncomplete: false }),
  'none',
);
assert.equal(
  sceneTextForDraftEdit({
    prompt: 'She pauses beside the candlelit doorway.',
    title: 'Candlelit doorway',
  }),
  'She pauses beside the candlelit doorway.',
);

assert.equal(shouldShowInternalCreateDiagnostics('?internalDiagnostics=1', true), true);
assert.equal(shouldShowInternalCreateDiagnostics('?internalDiagnostics=1', false), false);
assert.equal(shouldShowInternalCreateDiagnostics('', true), false);

console.info('Creator experience state tests passed.');
