import assert from 'node:assert/strict';
import { env } from '../src/lib/env';
import { buildSceneAnchorHealthDiagnostics } from '../src/services/renderDiagnostics';

const original = {
  SCENE_ANCHOR_ENABLED: env.SCENE_ANCHOR_ENABLED,
  SCENE_ANCHOR_PROVIDER: env.SCENE_ANCHOR_PROVIDER,
  SCENE_ANCHOR_MODEL: env.SCENE_ANCHOR_MODEL,
  SCENE_ANCHOR_FALLBACK_MODE: env.SCENE_ANCHOR_FALLBACK_MODE,
  FAL_KEY: env.FAL_KEY,
  KLING_API_KEY: env.KLING_API_KEY,
};

try {
  env.SCENE_ANCHOR_ENABLED = true;
  env.SCENE_ANCHOR_PROVIDER = 'fal';
  env.SCENE_ANCHOR_MODEL = 'fal-ai/vidu/reference-to-image';
  env.SCENE_ANCHOR_FALLBACK_MODE = 'pause';
  env.FAL_KEY = 'test-fal-key';
  env.KLING_API_KEY = undefined;

  const diagnostics = await buildSceneAnchorHealthDiagnostics();
  assert.equal(diagnostics.enabled, true);
  assert.equal(diagnostics.provider, 'fal');
  assert.equal(diagnostics.model, 'fal-ai/vidu/reference-to-image');
  assert.equal(diagnostics.configured, true);
  assert.deepEqual(diagnostics.missingConfig, []);
  assert.equal(diagnostics.privateUrlsRedacted, true);
  assert.ok('lastFailureCategory' in diagnostics);
  assert.ok('lastPayloadShapeSummary' in diagnostics);
  assert.match(diagnostics.recommendedNextAction, /Retry|Run|Configure/i);
} finally {
  env.SCENE_ANCHOR_ENABLED = original.SCENE_ANCHOR_ENABLED;
  env.SCENE_ANCHOR_PROVIDER = original.SCENE_ANCHOR_PROVIDER;
  env.SCENE_ANCHOR_MODEL = original.SCENE_ANCHOR_MODEL;
  env.SCENE_ANCHOR_FALLBACK_MODE = original.SCENE_ANCHOR_FALLBACK_MODE;
  env.FAL_KEY = original.FAL_KEY;
  env.KLING_API_KEY = original.KLING_API_KEY;
}

console.log('sceneAnchorDiagnostics unit tests passed');
