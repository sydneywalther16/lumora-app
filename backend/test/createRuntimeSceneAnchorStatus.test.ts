import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCreateRuntimeSceneAnchorStatus } from '../../api/lumora/generate-video';

const missingRuntime = buildCreateRuntimeSceneAnchorStatus({
  VERCEL: '1',
  VERCEL_ENV: 'production',
  NODE_ENV: 'production',
} as NodeJS.ProcessEnv);

assert.equal(missingRuntime.runtime, 'vercel');
assert.equal(missingRuntime.sceneAnchorConfigured, false);
assert.equal(missingRuntime.falKeyPresent, false);
assert.equal(missingRuntime.klingApiKeyPresent, false);
assert.ok(missingRuntime.missingConfig.includes('SCENE_ANCHOR_ENABLED'));
assert.match(missingRuntime.recommendedNextAction, /Create runtime|Vercel/i);
assert.equal(missingRuntime.privateUrlsRedacted, true);

const configuredRuntime = buildCreateRuntimeSceneAnchorStatus({
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: 'abc123',
  NODE_ENV: 'production',
  SCENE_ANCHOR_ENABLED: 'true',
  SCENE_ANCHOR_PROVIDER: 'fal',
  SCENE_ANCHOR_MODEL: 'fal-ai/vidu/q2/reference-to-image',
  SCENE_ANCHOR_FALLBACK_MODE: 'pause',
  FAL_KEY: 'fal-secret-value-should-not-leak',
  KLING_API_KEY: 'kling-secret-value-should-not-leak',
  KLING_ENABLED: 'true',
  KLING_REFERENCE_MODEL: 'fal-ai/kling-video/o1/reference-to-video',
  KLING_SCENE_ANCHOR_VIDEO_MODEL: 'fal-ai/kling-video/v2.1/master/image-to-video',
  ENABLE_RENDER_PROBE: 'false',
} as NodeJS.ProcessEnv);

assert.equal(configuredRuntime.sceneAnchorEnabled, true);
assert.equal(configuredRuntime.sceneAnchorConfigured, true);
assert.equal(configuredRuntime.sceneAnchorProvider, 'fal');
assert.equal(configuredRuntime.sceneAnchorModel, 'fal-ai/vidu/q2/reference-to-image');
assert.deepEqual(configuredRuntime.missingConfig, []);
assert.equal(configuredRuntime.falKeyPresent, true);
assert.equal(configuredRuntime.klingApiKeyPresent, true);
assert.equal(configuredRuntime.sceneAnchorFalCredentialPresent, true);
assert.equal(configuredRuntime.klingEnabled, true);
assert.equal(configuredRuntime.klingSceneAnchorVideoModelConfigured, true);
assert.equal(configuredRuntime.enableRenderProbe, false);
assert.match(configuredRuntime.recommendedNextAction, /ready/i);

const serialized = JSON.stringify(configuredRuntime);
assert.doesNotMatch(serialized, /fal-secret-value-should-not-leak/);
assert.doesNotMatch(serialized, /kling-secret-value-should-not-leak/);
assert.match(serialized, /"falKeyPresent":true/);
assert.match(serialized, /"klingApiKeyPresent":true/);

const endpointSource = readFileSync(
  join(process.cwd(), 'api/lumora/scene-anchor-runtime-status.ts'),
  'utf8',
);
assert.match(endpointSource, /buildCreateRuntimeSceneAnchorStatus/);
assert.doesNotMatch(endpointSource, /FAL_KEY[^P]/);
assert.doesNotMatch(endpointSource, /KLING_API_KEY[^P]/);

const generateSource = readFileSync(join(process.cwd(), 'api/lumora/generate-video.ts'), 'utf8');
assert.match(generateSource, /sceneAnchorErrorMessageRedacted/);
assert.match(generateSource, /createRuntimeSceneAnchorConfigured/);
assert.match(generateSource, /CREATE_RUNTIME_SCENE_ANCHOR_PAYLOAD_SHAPE/);

console.log('createRuntimeSceneAnchorStatus unit tests passed');
