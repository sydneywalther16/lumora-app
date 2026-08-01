import assert from 'node:assert/strict';
import {
  GoogleInteractionEnvelopeError,
  normalizeGoogleInteractionEnvelope,
  waitForGoogleInteraction,
} from '../src/services/director/googleMedia';
import { extractDirectorMediaOutput } from '../src/services/director/output';

const privateImageData = Buffer.from('private-image-fixture').toString('base64');
const privateProviderUri = 'https://generativelanguage.googleapis.com/v1beta/files/private-fixture';
const directInteraction = {
  id: 'interaction-fixture',
  status: 'completed',
  output_image: {
    type: 'image',
    data: privateImageData,
    mime_type: 'image/jpeg',
  },
  steps: [{
    type: 'model_output',
    content: [{ type: 'image', uri: privateProviderUri, mime_type: 'image/jpeg' }],
  }],
  usage: { total_output_tokens: 1 },
  sdkHttpResponse: { responseInternal: 'must-not-be-traversed' },
};

const envelopes = [
  { value: directInteraction, path: [] },
  { value: { interaction: directInteraction }, path: ['interaction'] },
  { value: { data: directInteraction }, path: ['data'] },
  { value: { result: directInteraction }, path: ['result'] },
  { value: { value: directInteraction }, path: ['value'] },
  { value: { response: directInteraction }, path: ['response'] },
  {
    value: { result: { ok: true, value: directInteraction } },
    path: ['result', 'value'],
  },
];

for (const fixture of envelopes) {
  const normalized = normalizeGoogleInteractionEnvelope(fixture.value);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.interactionId, directInteraction.id);
  assert.equal(normalized.status, 'completed');
  assert.deepEqual(normalized.wrapperPath, fixture.path);
  assert.deepEqual(normalized.structuralSummary.wrapperPath, fixture.path);
}

const missingStatus = normalizeGoogleInteractionEnvelope({ id: 'partial-interaction' });
assert.equal(missingStatus.valid, false);
assert.equal(missingStatus.partial, true);
assert.equal(missingStatus.status, null);

const missingId = normalizeGoogleInteractionEnvelope({ status: 'completed', steps: [] });
assert.equal(missingId.valid, false);
assert.equal(missingId.interactionId, null);

const idlessFixtures = [
  {
    status: 'completed',
    output_image: { type: 'image', data: privateImageData, mime_type: 'image/jpeg' },
  },
  {
    status: 'completed',
    outputs: [
      { type: 'image', data: Buffer.from('thought-only').toString('base64'), mime_type: 'image/png', thought: true },
      { type: 'image', data: privateImageData, mime_type: 'image/png' },
    ],
  },
  {
    status: 'completed',
    steps: [{
      type: 'model_output',
      content: [
        { type: 'image', data: Buffer.from('interim-thought').toString('base64'), mime_type: 'image/png', thought: true },
        { type: 'image', data: privateImageData, mime_type: 'image/png' },
      ],
    }],
  },
];
let idlessPollCount = 0;
for (const fixture of idlessFixtures) {
  const normalized = normalizeGoogleInteractionEnvelope(fixture);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.status, 'completed');
  assert.equal(normalized.interactionId, null);
  assert.equal(normalized.structuralSummary.acceptedCompletedResponseWithoutId, true);
  const completed = await waitForGoogleInteraction({
    initialInteraction: fixture,
    maximumPolls: 1,
    intervalMs: 0,
    async getInteraction() {
      idlessPollCount += 1;
      throw new Error('must not poll completed ID-less media');
    },
  });
  assert.equal((completed as { status?: string }).status, 'completed');
  assert.equal(extractDirectorMediaOutput(completed, 'scene_anchor').providerInteractionId, null);
}
assert.equal(idlessPollCount, 0);

assert.equal(
  normalizeGoogleInteractionEnvelope({ arbitrary: directInteraction }).valid,
  false,
);
assert.equal(
  normalizeGoogleInteractionEnvelope({
    response: { data: { result: { value: directInteraction } } },
  }).valid,
  false,
);

let readOnlyGetCount = 0;
let providerGenerationCount = 0;
const completedAfterPartial = await waitForGoogleInteraction({
  initialInteraction: { data: { id: 'partial-interaction' } },
  maximumPolls: 2,
  intervalMs: 0,
  async getInteraction(id) {
    readOnlyGetCount += 1;
    assert.equal(id, 'partial-interaction');
    return { result: { id, status: 'completed', steps: [] } };
  },
});
assert.equal((completedAfterPartial as { status?: string }).status, 'completed');
assert.equal(readOnlyGetCount, 1);
assert.equal(providerGenerationCount, 0);

await assert.rejects(
  waitForGoogleInteraction({
    initialInteraction: { status: 'completed', steps: [] },
    maximumPolls: 1,
    intervalMs: 0,
    async getInteraction() {
      throw new Error('must not poll without an interaction ID');
    },
  }),
  (error) => error instanceof GoogleInteractionEnvelopeError,
);

for (const invalidIdless of [
  {
    status: 'running',
    output_image: { type: 'image', data: privateImageData, mime_type: 'image/jpeg' },
  },
  {
    output_image: { type: 'image', data: privateImageData, mime_type: 'image/jpeg' },
  },
  {
    status: 'completed',
    outputs: [{ type: 'text', text: 'No image was produced.' }],
  },
  {
    status: 'completed',
    output_image: { type: 'image', data: '', mime_type: 'image/jpeg' },
  },
]) {
  let invalidPollCount = 0;
  await assert.rejects(
    waitForGoogleInteraction({
      initialInteraction: invalidIdless,
      maximumPolls: 1,
      intervalMs: 0,
      async getInteraction() {
        invalidPollCount += 1;
        throw new Error('must not poll without a provider interaction ID');
      },
    }),
    (error) => error instanceof GoogleInteractionEnvelopeError,
  );
  assert.equal(invalidPollCount, 0);
}

await assert.rejects(
  waitForGoogleInteraction({
    initialInteraction: { id: 'still-partial' },
    maximumPolls: 2,
    intervalMs: 0,
    async getInteraction(id) {
      assert.equal(id, 'still-partial');
      return { id };
    },
  }),
  (error) => error instanceof GoogleInteractionEnvelopeError,
);

const outputImage = extractDirectorMediaOutput(directInteraction, 'scene_anchor');
assert.equal(outputImage.data, privateImageData);
assert.equal(outputImage.mimeType, 'image/jpeg');

const outputsArray = {
  id: 'outputs-array',
  status: 'completed',
  outputs: [
    { type: 'text', text: 'final' },
    { type: 'image', data: privateImageData, mime_type: 'image/png' },
  ],
};
assert.equal(
  extractDirectorMediaOutput(outputsArray, 'scene_anchor').safeSummary.selectedSource,
  'outputs',
);

const modelOutputStep = {
  id: 'model-output-step',
  status: 'completed',
  steps: [{
    type: 'model_output',
    content: [
      { type: 'image', data: Buffer.from('thought').toString('base64'), mime_type: 'image/png', thought: true },
      { type: 'image', data: privateImageData, mime_type: 'image/png' },
    ],
  }],
};
assert.equal(
  extractDirectorMediaOutput(modelOutputStep, 'scene_anchor').data,
  privateImageData,
);

const textOnly = normalizeGoogleInteractionEnvelope({
  id: 'text-only',
  status: 'completed',
  outputs: [{ type: 'text', text: 'no image' }],
});
assert.equal(textOnly.structuralSummary.outputsCount, 1);
assert.deepEqual(textOnly.structuralSummary.outputsTypes, ['text']);
assert.equal(textOnly.structuralSummary.imageDataPresent, false);

const structural = normalizeGoogleInteractionEnvelope({
  data: {
    ...directInteraction,
    output_image: {
      type: 'image',
      data: privateImageData,
      uri: privateProviderUri,
      mime_type: 'image/jpeg',
    },
  },
  apiKeyPrivateSecret: 'must-not-be-retained',
  sessionToken: 'must-not-be-retained',
}).structuralSummary;
assert.equal(structural.hasInteractionId, true);
assert.equal(structural.acceptedCompletedResponseWithoutId, false);
assert.equal(structural.outputImagePresent, true);
assert.equal(structural.imageMimeType, 'image/jpeg');
assert.equal(structural.imageDataPresent, true);
assert.equal(structural.imageDataCharacterLength, privateImageData.length);
assert.equal(structural.imageUriPresent, true);
assert.equal(structural.imageUriScheme, 'https');
assert.equal(structural.usagePresent, true);
assert.deepEqual(structural.modelOutputContentTypes, ['image']);

const serializedSummary = JSON.stringify(structural);
for (const privateValue of [
  privateImageData,
  privateProviderUri,
  'must-not-be-retained',
  'private-fixture',
]) {
  assert.equal(serializedSummary.includes(privateValue), false);
}
assert.doesNotMatch(serializedSummary, /apiKeyPrivateSecret|sessionToken|generativelanguage\.googleapis\.com/i);
assert.equal(providerGenerationCount, 0);

console.log('Google interaction envelope fixtures passed with zero provider-generation requests.');
