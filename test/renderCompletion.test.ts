import assert from 'node:assert/strict';
import {
  getVerifiedVideoOutputUrl,
  hasVerifiedVideoOutput,
  isContinueStoryEligible,
  isPublishEligible,
  normalizeVerifiedVideoOutputUrl,
} from '../src/lib/renderCompletion';

const verified = {
  status: 'completed',
  outputUrl: 'https://cdn.example.com/lumora/render.mp4',
};

assert.equal(normalizeVerifiedVideoOutputUrl(''), null);
assert.equal(normalizeVerifiedVideoOutputUrl('blob:http://localhost/video'), null);
assert.equal(normalizeVerifiedVideoOutputUrl('/demo-placeholder.jpg'), null);
assert.equal(normalizeVerifiedVideoOutputUrl('/demo-video.mp4'), null);
assert.equal(normalizeVerifiedVideoOutputUrl('/render.mp4'), '/render.mp4');
assert.equal(getVerifiedVideoOutputUrl(verified), verified.outputUrl);
assert.equal(hasVerifiedVideoOutput({ status: 'completed', outputUrl: '' }), false);
assert.equal(hasVerifiedVideoOutput({ status: 'completed', resultAssetUrl: '/demo-placeholder.jpg' }), false);
assert.equal(hasVerifiedVideoOutput(verified), true);
assert.equal(isPublishEligible({ status: 'completed', outputUrl: '' }), false);
assert.equal(isPublishEligible(verified), true);
assert.equal(isContinueStoryEligible({ status: 'rendering', outputUrl: null }), false);
assert.equal(isContinueStoryEligible(verified), true);

console.log('renderCompletion eligibility tests passed');
