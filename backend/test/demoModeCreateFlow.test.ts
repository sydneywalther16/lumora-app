import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowCreatePreparingState } from '../../src/lib/aiCastExperience';

test('Demo Mode bypasses readiness-based preparing state', () => {
  assert.equal(
    shouldShowCreatePreparingState({
      engine: 'mock',
      isHydrated: true,
      sessionLoading: false,
      healthDiagnosticsStatus: 'checking',
      referenceLoading: false,
    }),
    false,
  );
});

test('Non-demo renderers still wait for readiness before showing Generate', () => {
  assert.equal(
    shouldShowCreatePreparingState({
      engine: 'seedance-2.0',
      isHydrated: true,
      sessionLoading: false,
      healthDiagnosticsStatus: 'checking',
      referenceLoading: false,
    }),
    true,
  );
});
