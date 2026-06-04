import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCreateRuntimeSceneAnchorStatus,
  buildSceneAnchorRuntimeEndpointPayload,
} from '../../api/lumora/scene-anchor-runtime-status';

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
assert.equal(missingRuntime.secretsRedacted, true);
assert.equal(missingRuntime.endpointLoaded, true);
assert.equal(missingRuntime.helperLoaded, true);
assert.equal(missingRuntime.runtimeStatusBuilt, true);

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
  KLING_PROVIDER: 'fal',
  KLING_REFERENCE_MODEL: 'fal-ai/kling-video/o1/reference-to-video',
  KLING_SCENE_ANCHOR_VIDEO_MODEL: 'fal-ai/kling-video/v2.1/master/image-to-video',
  ENABLE_RENDER_PROBE: 'false',
} as NodeJS.ProcessEnv);

assert.equal(configuredRuntime.sceneAnchorEnabled, true);
assert.equal(configuredRuntime.sceneAnchorConfigured, true);
assert.equal(configuredRuntime.sceneAnchorImplemented, true);
assert.equal(configuredRuntime.sceneAnchorProvider, 'fal');
assert.equal(configuredRuntime.sceneAnchorModel, 'fal-ai/vidu/q2/reference-to-image');
assert.deepEqual(configuredRuntime.missingConfig, []);
assert.equal(configuredRuntime.falKeyPresent, true);
assert.equal(configuredRuntime.klingApiKeyPresent, true);
assert.equal(configuredRuntime.sceneAnchorFalCredentialPresent, true);
assert.equal(configuredRuntime.klingEnabled, true);
assert.equal(configuredRuntime.klingProvider, 'fal');
assert.equal(configuredRuntime.klingSceneAnchorVideoModelConfigured, true);
assert.equal(configuredRuntime.enableRenderProbe, false);
assert.equal(configuredRuntime.secretsRedacted, true);
assert.match(configuredRuntime.recommendedNextAction, /ready/i);

const serialized = JSON.stringify(configuredRuntime);
assert.doesNotMatch(serialized, /fal-secret-value-should-not-leak/);
assert.doesNotMatch(serialized, /kling-secret-value-should-not-leak/);
assert.match(serialized, /"falKeyPresent":true/);
assert.match(serialized, /"klingApiKeyPresent":true/);

const endpointPayload = buildSceneAnchorRuntimeEndpointPayload(() => configuredRuntime);
assert.equal(endpointPayload.ok, true);
assert.equal(endpointPayload.endpointLoaded, true);
assert.equal(endpointPayload.helperLoaded, true);
assert.equal(endpointPayload.runtimeStatusBuilt, true);

const endpointBuilderFailure = buildSceneAnchorRuntimeEndpointPayload(() => {
  throw new Error('builder failed with Bearer secret-value-should-not-leak and https://signed.example/private');
});
assert.equal(endpointBuilderFailure.ok, false);
assert.equal(endpointBuilderFailure.endpointLoaded, true);
assert.equal(endpointBuilderFailure.helperLoaded, false);
assert.equal(endpointBuilderFailure.runtimeStatusBuilt, false);
assert.doesNotMatch(endpointBuilderFailure.message, /https:\/\/signed\.example/);
assert.doesNotMatch(endpointBuilderFailure.message, /secret-value-should-not-leak/);

const endpointSource = readFileSync(
  join(process.cwd(), 'api/lumora/scene-anchor-runtime-status.ts'),
  'utf8',
);
assert.match(endpointSource, /buildCreateRuntimeSceneAnchorStatus/);
assert.match(endpointSource, /buildSceneAnchorRuntimeEndpointPayload/);
assert.match(endpointSource, /endpointLoaded/);
assert.match(endpointSource, /helperLoaded/);
assert.match(endpointSource, /runtimeStatusBuilt/);
assert.match(endpointSource, /try/);
assert.match(endpointSource, /catch/);
assert.doesNotMatch(endpointSource, /^import\s/m);
assert.doesNotMatch(endpointSource, /generate-video/);
assert.doesNotMatch(endpointSource, /node:http/);
assert.doesNotMatch(endpointSource, /import\(/);
assert.doesNotMatch(endpointSource, /runtimeSceneAnchorStatus/);
assert.doesNotMatch(endpointSource, /Replicate|Supabase|storageService|falSceneAnchorJson|OpenAI/);

const scriptSource = readFileSync(
  join(process.cwd(), 'scripts/create-runtime-scene-anchor-status.ps1'),
  'utf8',
);
assert.match(scriptSource, /\$status\.ok -eq \$false/);
assert.match(scriptSource, /Invoke-WebRequest/);
assert.match(scriptSource, /runtime_status_http_error/);
assert.match(scriptSource, /endpoint loaded/);
assert.match(scriptSource, /helper loaded/);
assert.match(scriptSource, /runtime status built/);

const generateSource = readFileSync(join(process.cwd(), 'api/lumora/generate-video.ts'), 'utf8');
assert.match(generateSource, /sceneAnchorErrorMessageRedacted/);
assert.match(generateSource, /createRuntimeSceneAnchorConfigured/);
assert.match(generateSource, /CREATE_RUNTIME_SCENE_ANCHOR_PAYLOAD_SHAPE/);
assert.match(generateSource, /sceneAnchorAssetStorage/);
assert.doesNotMatch(generateSource, /backend\/src\/services\/storageService|backend\\\\src\\\\services\\\\storageService|storageService/);
assert.doesNotMatch(generateSource, /buildCreateRuntimeSceneAnchorStatus/);

console.log('createRuntimeSceneAnchorStatus unit tests passed');
