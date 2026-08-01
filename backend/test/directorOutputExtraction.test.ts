import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  directorMediaSafeTelemetry,
  DirectorMediaOutputError,
  directorFileNameFromUri,
  extractDirectorMediaOutput,
  identifyDirectorMediaArtifact,
  persistDirectorOutputBytes,
} from '../src/services/director/output';

const legacyBytes = Buffer.from('legacy-image-fixture').toString('base64');
const arrayBytes = Buffer.from('outputs-array-image-fixture').toString('base64');
const camelBytes = Buffer.from('camel-image-fixture').toString('base64');
const interimBytes = Buffer.from('interim-image-fixture').toString('base64');
const firstFinalBytes = Buffer.from('first-final-image-fixture').toString('base64');
const lastFinalBytes = Buffer.from('last-final-image-fixture').toString('base64');
const stepBytes = Buffer.from('model-output-step-fixture').toString('base64');

const legacy = extractDirectorMediaOutput({
  id: 'interaction-1',
  status: 'completed',
  output_image: {
    data: legacyBytes,
    mime_type: 'image/png',
  },
}, 'scene_anchor');
assert.equal(legacy.providerInteractionId, 'interaction-1');
assert.equal(legacy.data, legacyBytes);
assert.equal(legacy.mimeType, 'image/png');
assert.equal(legacy.safeSummary.selectedSource, 'output_image');

const outputsArray = extractDirectorMediaOutput({
  id: 'interaction-2',
  status: 'completed',
  outputs: [
    { type: 'text', text: 'Created the scene.' },
    { type: 'image', data: arrayBytes, mime_type: 'image/jpeg' },
  ],
}, 'scene_anchor');
assert.equal(outputsArray.data, arrayBytes);
assert.equal(outputsArray.mimeType, 'image/jpeg');
assert.equal(outputsArray.safeSummary.selectedSource, 'outputs');
assert.equal(outputsArray.safeSummary.outputCount, 2);
assert.deepEqual(outputsArray.safeSummary.outputTypes, ['text', 'image']);

const camelCase = extractDirectorMediaOutput({
  id: 'interaction-3',
  status: 'completed',
  outputImage: {
    data: camelBytes,
    mimeType: 'image/webp',
  },
}, 'scene_anchor');
assert.equal(camelCase.data, camelBytes);
assert.equal(camelCase.mimeType, 'image/webp');
assert.equal(camelCase.safeSummary.selectedSource, 'outputImage');

const finalNonThought = extractDirectorMediaOutput({
  id: 'interaction-4',
  status: 'completed',
  outputs: [
    { type: 'image', data: interimBytes, mime_type: 'image/jpeg', thought: true },
    { type: 'image', data: firstFinalBytes, mime_type: 'image/jpeg' },
    { type: 'image', data: lastFinalBytes, mime_type: 'image/png' },
  ],
}, 'scene_anchor');
assert.equal(finalNonThought.data, lastFinalBytes);
assert.equal(finalNonThought.mimeType, 'image/png');
assert.equal(finalNonThought.safeSummary.outputCount, 3);

const providerUri = 'https://generativelanguage.googleapis.com/v1beta/files/fixture-image';
const uriOnly = extractDirectorMediaOutput({
  id: 'interaction-5',
  status: 'completed',
  outputs: [{ type: 'image', uri: providerUri, mime_type: 'image/png' }],
}, 'scene_anchor');
assert.equal(uriOnly.data, null);
assert.equal(uriOnly.uri, providerUri);
assert.equal(directorFileNameFromUri(providerUri), 'files/fixture-image');
assert.equal(directorFileNameFromUri('files/fixture-image'), 'files/fixture-image');

const completedModelOutput = extractDirectorMediaOutput({
  id: 'interaction-6',
  status: 'completed',
  steps: [
    {
      type: 'thought',
      summary: [{ type: 'image', data: interimBytes, mime_type: 'image/jpeg' }],
    },
    {
      type: 'model_output',
      content: [
        { type: 'text', text: 'Final scene anchor.' },
        { type: 'image', data: stepBytes, mime_type: 'image/jpeg' },
      ],
    },
  ],
}, 'scene_anchor');
assert.equal(completedModelOutput.data, stepBytes);
assert.equal(completedModelOutput.safeSummary.selectedSource, 'model_output_step');
assert.deepEqual(completedModelOutput.safeSummary.outputTypes, ['text', 'image']);

assert.throws(
  () => extractDirectorMediaOutput({
    id: 'interaction-text-only',
    status: 'completed',
    outputs: [{ type: 'text', text: 'Created the scene.' }],
  }, 'scene_anchor'),
  (error) => error instanceof DirectorMediaOutputError && error.category === 'anchor_text_only',
);

assert.throws(
  () => extractDirectorMediaOutput({
    id: 'interaction-moderated',
    status: 'completed',
    outputs: [{ type: 'text', text: 'The image was blocked by the safety policy.' }],
  }, 'scene_anchor'),
  (error) => error instanceof DirectorMediaOutputError && error.category === 'anchor_moderated',
);

let malformedError: DirectorMediaOutputError | null = null;
try {
  extractDirectorMediaOutput({
    id: 'interaction-malformed',
    status: 'completed',
    outputs: [{ type: 'image', data: 'not_base64!', mime_type: 'image/png' }],
  }, 'scene_anchor');
} catch (error) {
  malformedError = error instanceof DirectorMediaOutputError ? error : null;
}
assert.equal(malformedError?.category, 'anchor_media_missing');
assert.doesNotMatch(JSON.stringify(malformedError?.safeSummary), /not_base64|fixture-image|https?:\/\//i);

assert.throws(
  () => extractDirectorMediaOutput({
    id: 'interaction-unsupported',
    status: 'completed',
    generatedImage: { blob: 'unsupported-fixture' },
  }, 'scene_anchor'),
  (error) => error instanceof DirectorMediaOutputError && error.category === 'anchor_output_unrecognized',
);

const videoBytes = Buffer.from('video-fixture').toString('base64');
const video = extractDirectorMediaOutput({
  id: 'interaction-video',
  status: 'completed',
  output_video: {
    data: videoBytes,
    mime_type: 'video/mp4',
  },
}, 'primary_video');
assert.equal(video.data, videoBytes);
assert.equal(video.mimeType, 'video/mp4');
assert.equal(video.safeSummary.selectedSource, 'output_video');

const idlessBytes = Buffer.from('completed-idless-anchor-fixture');
const idlessData = idlessBytes.toString('base64');
const idlessCandidate = extractDirectorMediaOutput({
  status: 'completed',
  output_image: { type: 'image', data: idlessData, mime_type: 'image/jpeg' },
}, 'scene_anchor');
assert.equal(idlessCandidate.providerInteractionId, null);
const artifactContext = {
  authorizationId: 'authorization-private-fixture',
  idempotencyKey: 'idempotency-private-fixture',
};
const idlessArtifact = identifyDirectorMediaArtifact({
  candidate: idlessCandidate,
  bytes: idlessBytes,
  context: artifactContext,
});
const repeatedArtifact = identifyDirectorMediaArtifact({
  candidate: idlessCandidate,
  bytes: idlessBytes,
  context: artifactContext,
});
assert.equal(idlessArtifact.mediaIdentitySource, 'content_hash');
assert.equal(idlessArtifact.mediaArtifactId, repeatedArtifact.mediaArtifactId);
assert.match(idlessArtifact.mediaArtifactId, /^scene_anchor-content-[a-f0-9]{32}$/);

const differentBytes = Buffer.from('different-completed-idless-anchor');
const differentCandidate = extractDirectorMediaOutput({
  status: 'completed',
  outputs: [{ type: 'image', data: differentBytes.toString('base64'), mime_type: 'image/jpeg' }],
}, 'scene_anchor');
const differentArtifact = identifyDirectorMediaArtifact({
  candidate: differentCandidate,
  bytes: differentBytes,
  context: artifactContext,
});
assert.notEqual(idlessArtifact.mediaArtifactId, differentArtifact.mediaArtifactId);

const providerIdentity = identifyDirectorMediaArtifact({
  candidate: legacy,
  bytes: Buffer.from(legacyBytes, 'base64'),
  context: artifactContext,
});
assert.equal(providerIdentity.mediaIdentitySource, 'provider_interaction');
assert.equal(providerIdentity.mediaArtifactId, 'interaction-1');

const fullContentHash = createHash('sha256').update(idlessBytes).digest('hex');
const safeTelemetry = directorMediaSafeTelemetry({
  output: idlessArtifact,
  storageSucceeded: true,
});
const safeTelemetryJson = JSON.stringify(safeTelemetry);
assert.equal(safeTelemetry.acceptedCompletedResponseWithoutId, true);
assert.equal(safeTelemetry.mediaIdentitySource, 'content_hash');
assert.equal(safeTelemetry.storageSucceeded, true);
assert.equal(safeTelemetry.inlineDataCharacterLength, idlessData.length);
for (const privateValue of [
  fullContentHash,
  idlessData,
  artifactContext.authorizationId,
  artifactContext.idempotencyKey,
  idlessArtifact.mediaArtifactId,
]) {
  assert.equal(safeTelemetryJson.includes(privateValue), false);
}

const persistedArtifacts = new Map<string, { controlledUrl: string; byteSize: number }>();
const persistence = {
  async save(input: { mediaArtifactId: string; bytes: Uint8Array }) {
    const existing = persistedArtifacts.get(input.mediaArtifactId);
    if (existing) return existing;
    const saved = {
      controlledUrl: '/controlled/director-artifact',
      byteSize: input.bytes.byteLength,
    };
    persistedArtifacts.set(input.mediaArtifactId, saved);
    return saved;
  },
};
const firstPersistence = await persistDirectorOutputBytes(idlessArtifact, idlessBytes, persistence);
const repeatedPersistence = await persistDirectorOutputBytes(idlessArtifact, idlessBytes, persistence);
assert.deepEqual(repeatedPersistence, firstPersistence);
assert.equal(persistedArtifacts.size, 1);

for (const summary of [
  legacy.safeSummary,
  outputsArray.safeSummary,
  camelCase.safeSummary,
  finalNonThought.safeSummary,
  uriOnly.safeSummary,
  completedModelOutput.safeSummary,
  video.safeSummary,
]) {
  const diagnosticJson = JSON.stringify(summary);
  assert.doesNotMatch(diagnosticJson, /https?:\/\//i);
  for (const privateValue of [
    legacyBytes,
    arrayBytes,
    camelBytes,
    interimBytes,
    firstFinalBytes,
    lastFinalBytes,
    stepBytes,
    videoBytes,
    providerUri,
  ]) {
    assert.equal(diagnosticJson.includes(privateValue), false);
  }
}

console.log('Director media output extraction fixtures passed without a provider request.');
