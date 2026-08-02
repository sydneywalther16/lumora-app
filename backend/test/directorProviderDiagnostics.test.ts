import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOmniFlashPayload } from '../src/services/director/adapters';
import { buildDirectorProductionDryRun } from '../src/services/director/dryRunDiagnostics';
import {
  extractDirectorProviderSafeFailureMetadata,
  sanitizeDirectorProviderDiagnosticText,
  summarizeGoogleInteractionRequest,
} from '../src/services/director/googleMedia';
import { directorOperationalTelemetry, mergeDirectorCanaryJobInteractionTelemetry } from '../src/services/director/productionCanary';
import { createDirectorCostTelemetry } from '../src/services/director/budget';
import { DIRECTOR_CANARY_SCENE } from '../src/services/director/canary';

const plan = buildDirectorProductionDryRun(DIRECTOR_CANARY_SCENE).plan;
const privateBytes = Buffer.from('private-anchor-bytes');
const payload = buildOmniFlashPayload({
  anchor: { data: privateBytes.toString('base64'), mimeType: 'image/jpeg' },
  plan,
  durationSeconds: 4,
  aspectRatio: '9:16',
  store: false,
});
const request = summarizeGoogleInteractionRequest(payload);
assert.equal(request.schemaVersion, 'google-interactions-video-v1');
assert.deepEqual(request.topLevelFields, [
  'background',
  'generation_config',
  'input',
  'model',
  'response_format',
  'store',
]);
assert.deepEqual(request.inputBlockTypes, ['image', 'text']);
assert.equal(request.imageMimeType, 'image/jpeg');
assert.equal(request.imageByteLength, privateBytes.byteLength);
assert.equal(request.responseFormatType, 'video');
assert.equal(request.aspectRatio, '9:16');
assert.equal(request.deliveryMode, 'uri');
assert.equal(request.videoTask, 'image_to_video');
assert.equal(request.sdkVersion, '2.13.0');
assert.equal(request.modelIdentifier, 'gemini-omni-flash-preview');

const privateUuid = '8f8d5d45-11a1-4f74-a7a0-75bea0013a5d';
const privateUrl = 'https://example.invalid/private/object';
const privateToken = `Bearer ${'token'.repeat(20)}`;
const privateEmail = 'private@example.com';
const privateApiKey = `AIza${'A'.repeat(35)}`;
const privatePrompt = 'the hidden candlelit mansion prompt';
const privatePath = '/Users/private/library/object.jpg';
const rawBody = 'RAW_RESPONSE_BODY_MUST_NOT_SURVIVE';
const longEncoded = Buffer.alloc(256, 7).toString('base64');
const fieldViolations = Array.from({ length: 14 }, (_, index) => ({
  field: `generation_config.video_config.field_${index}`,
  description: index === 0 ? privateUrl : 'invalid',
}));
const providerError = {
  status: 400,
  message: `Invalid request ${privateUrl} ${privateToken} ${privateUuid} ${privateEmail} ${privateApiKey} "${privatePrompt}" ${privatePath} ${longEncoded}`,
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: `Rejected ${privateUrl}`,
    details: [{
      '@type': 'type.googleapis.com/google.rpc.BadRequest',
      reason: 'INVALID_VIDEO_CONFIGURATION',
      fieldViolations,
      metadata: {
        privateAuthorizationId: privateUuid,
        model: 'gemini-omni-flash-preview',
      },
    }],
  },
  response: {
    status: 400,
    data: {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Invalid interaction request.',
        details: [{ field_violations: fieldViolations }],
      },
      body: rawBody,
    },
  },
  cause: {
    reason: 'BAD_REQUEST',
  },
};

const safe = extractDirectorProviderSafeFailureMetadata(
  providerError,
  'gemini-omni-flash-preview',
  request,
);
assert.equal(safe.httpStatus, 400);
assert.equal(safe.providerCode, '400');
assert.equal(safe.providerStatusName, 'INVALID_ARGUMENT');
assert.equal(safe.reason, 'INVALID_VIDEO_CONFIGURATION');
assert.ok(safe.message);
assert.ok((safe.message?.length ?? 0) <= 500);
assert.equal(safe.fieldViolationPaths.length, 10);
assert.equal(safe.fieldViolationPaths[0], 'generation_config.video_config.field_0');
assert.ok(safe.fieldViolationPaths.every((path) => path.length <= 160));
assert.deepEqual(safe.request, request);

const serialized = JSON.stringify(safe);
for (const privateValue of [
  privateUrl,
  privateToken,
  privateUuid,
  privateEmail,
  privateApiKey,
  privatePrompt,
  privatePath,
  longEncoded,
  rawBody,
  privateBytes.toString('base64'),
]) {
  assert.equal(serialized.includes(privateValue), false);
}
assert.doesNotMatch(serialized, /https?:\/\/|Bearer\s|RAW_RESPONSE_BODY|privateAuthorizationId/i);

assert.equal(
  sanitizeDirectorProviderDiagnosticText('Message with https://private.invalid/path and Bearer abc.def.ghi'),
  'Message with [redacted-url] and [redacted-token]',
);
assert.equal(sanitizeDirectorProviderDiagnosticText('word '.repeat(180))?.length, 500);

const telemetry = createDirectorCostTelemetry();
const authorizationTelemetry = directorOperationalTelemetry(telemetry, safe, {});
const jobTelemetry = mergeDirectorCanaryJobInteractionTelemetry({}, {}, telemetry, safe);
assert.deepEqual(authorizationTelemetry.providerFailure, safe);
assert.deepEqual(
  (jobTelemetry.directorTelemetry as { providerFailure?: unknown }).providerFailure,
  safe,
);
assert.equal(JSON.stringify(jobTelemetry).includes(rawBody), false);

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
assert.equal(packageJson.dependencies['@google/genai'], request.sdkVersion);
const sdkTypes = readFileSync(
  join(process.cwd(), 'node_modules/@google/genai/dist/node/node.d.ts'),
  'utf8',
);
assert.match(sdkTypes, /generation_config\?: GenerationConfig_2/);
assert.match(sdkTypes, /video_config\?: VideoConfig/);
assert.match(sdkTypes, /aspect_ratio\?: VideoResponseFormatAspectRatio/);
assert.match(sdkTypes, /delivery\?: VideoResponseFormatDelivery/);

console.log('Director provider diagnostics passed with bounded redaction and zero provider calls.');
