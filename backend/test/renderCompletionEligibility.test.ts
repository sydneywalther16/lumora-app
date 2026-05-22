import assert from 'node:assert/strict';
import {
  hasVerifiedVideoOutput,
  isContinueStoryEligible,
  isPublishEligible,
  lighterCastGuidanceMessage,
} from '../../src/lib/renderCompletion';

const verifiedTextOnly = {
  status: 'completed',
  outputUrl: 'https://replicate.delivery/pbxt/render.mp4',
  generationMode: 'seedance-text-to-video',
  isDefaultSelfCharacter: true,
};

assert.equal(hasVerifiedVideoOutput(verifiedTextOnly), true);
assert.equal(isPublishEligible(verifiedTextOnly), true);
assert.equal(isContinueStoryEligible(verifiedTextOnly), true);
assert.equal(lighterCastGuidanceMessage(verifiedTextOnly), 'Rendered with lighter cast guidance.');

const renderingNoOutput = {
  status: 'rendering',
  generationMode: 'seedance-text-to-video',
  isDefaultSelfCharacter: true,
};

assert.equal(hasVerifiedVideoOutput(renderingNoOutput), false);
assert.equal(isPublishEligible(renderingNoOutput), false);
assert.equal(isContinueStoryEligible(renderingNoOutput), false);
assert.equal(lighterCastGuidanceMessage(renderingNoOutput), null);

const verifiedReference = {
  status: 'completed',
  outputUrl: 'https://replicate.delivery/pbxt/render.mp4',
  generationMode: 'seedance-multimodal-reference',
  isDefaultSelfCharacter: true,
};

assert.equal(lighterCastGuidanceMessage(verifiedReference), null);

console.log('renderCompletion eligibility tests passed');
