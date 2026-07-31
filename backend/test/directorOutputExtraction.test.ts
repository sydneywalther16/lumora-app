import assert from 'node:assert/strict';
import {
  DirectorMediaOutputError,
  directorFileNameFromUri,
  extractDirectorMediaOutput,
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
assert.equal(legacy.interactionId, 'interaction-1');
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
