import assert from 'node:assert/strict';
import test from 'node:test';
import { isDemoModeEngine, shouldShowCreatePreparingState } from '../../src/lib/aiCastExperience';

test('Mock engine is treated as Demo Mode', () => {
  assert.equal(isDemoModeEngine('mock'), true);
  assert.equal(isDemoModeEngine('seedance-2.0'), false);
});

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
