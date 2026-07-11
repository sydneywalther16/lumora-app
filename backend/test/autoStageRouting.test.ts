import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPublicCaptionFromPrompt,
  decideAutoStage,
  looksLikeInternalRenderPrompt,
} from '../../src/lib/aiCastExperience';

const autoSeedance = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: false,
  selfCharacterReady: false,
  userPrompt: 'she sees the sunshine',
});
assert.equal(autoSeedance.engine, 'seedance-2.0');

const autoKling = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: true,
  selfCharacterReady: true,
  userPrompt: 'preserve my exact face in motion',
});
assert.equal(autoKling.engine, 'replicate');
assert.equal(autoKling.fallbackEngine, 'seedance-2.0');

const demoMode = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: true,
  exactLikenessReady: true,
  selfCharacterReady: true,
  userPrompt: 'any scene',
});
assert.equal(demoMode.engine, 'mock');

assert.equal(looksLikeInternalRenderPrompt('Use medium-wide or full-body cinematic framing with visible environment.'), true);
assert.equal(buildPublicCaptionFromPrompt('Use medium-wide framing. Preserve identity and camera drift.'), 'A cinematic scene is ready.');
assert.equal(buildPublicCaptionFromPrompt('she sees the sunshine'), 'She sees the sunshine.');

const createVideoSource = readFileSync(join(process.cwd(), 'src/components/CreateVideo.tsx'), 'utf8');
assert.match(createVideoSource, /renderPrompt/);
assert.match(createVideoSource, /buildPublicCaptionFromPrompt/);
assert.match(createVideoSource, /fallbackAttempted/);

console.log('autoStageRouting unit tests passed');
