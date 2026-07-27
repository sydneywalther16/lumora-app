import assert from 'node:assert/strict';
import {
  CREATOR_CREATE_STATE_COPY,
  CREATOR_PROGRESS_STEPS,
  creatorProgressStep,
  deriveCreatorCreateState,
  shouldShowInternalCreateDiagnostics,
} from '../../src/lib/createExperience';

assert.equal(
  deriveCreatorCreateState({
    hasCast: true,
    isGenerating: false,
    hasSavedResult: false,
    isTemporarilyUnavailable: false,
    needsEdit: false,
  }),
  'READY',
);

assert.equal(
  deriveCreatorCreateState({
    hasCast: false,
    isGenerating: false,
    hasSavedResult: false,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'NEEDS_CAST',
);

assert.equal(
  deriveCreatorCreateState({
    hasCast: true,
    isGenerating: true,
    hasSavedResult: false,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'GENERATING',
);

assert.equal(
  deriveCreatorCreateState({
    hasCast: true,
    isGenerating: false,
    hasSavedResult: true,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'SAVED',
);

assert.equal(
  deriveCreatorCreateState({
    hasCast: true,
    isGenerating: false,
    hasSavedResult: false,
    isTemporarilyUnavailable: true,
    needsEdit: true,
  }),
  'TEMPORARILY_UNAVAILABLE',
);

assert.equal(
  deriveCreatorCreateState({
    hasCast: true,
    isGenerating: false,
    hasSavedResult: false,
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
assert.equal(CREATOR_CREATE_STATE_COPY.TEMPORARILY_UNAVAILABLE.body, 'Your scene is safely preserved.');
assert.equal(CREATOR_CREATE_STATE_COPY.NEEDS_EDIT.primaryAction, 'Edit scene');

assert.equal(shouldShowInternalCreateDiagnostics('?internalDiagnostics=1', true), true);
assert.equal(shouldShowInternalCreateDiagnostics('?internalDiagnostics=1', false), false);
assert.equal(shouldShowInternalCreateDiagnostics('', true), false);

console.info('Creator experience state tests passed.');
