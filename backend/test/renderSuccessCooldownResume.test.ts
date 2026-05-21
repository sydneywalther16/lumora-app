import assert from 'node:assert/strict';
import {
  buildRenderSuccessAttemptPlan,
  paidAttemptConsumesBudget,
  rateLimitCountsAsFailedAttempt,
  shouldResumeRateLimitedAttempt,
} from '../src/services/renderSuccessEngine';

const now = Date.now();

assert.equal(rateLimitCountsAsFailedAttempt(), false);
assert.equal(paidAttemptConsumesBudget({
  renderSuccessPaid: true,
  providerPredictionId: null,
}), false);
assert.equal(paidAttemptConsumesBudget({
  renderSuccessPaid: true,
  providerPredictionId: 'prediction-created-before-cooldown',
}), true);

assert.equal(shouldResumeRateLimitedAttempt({
  status: 'rate_limited',
  retryAvailableAt: new Date(now - 1_000).toISOString(),
  nowMs: now,
}), true);
assert.equal(shouldResumeRateLimitedAttempt({
  status: 'rate_limited',
  retryAvailableAt: new Date(now + 30_000).toISOString(),
  nowMs: now,
}), false);
assert.equal(shouldResumeRateLimitedAttempt({
  status: 'rendering',
  retryAvailableAt: new Date(now - 1_000).toISOString(),
  nowMs: now,
}), false);

const rescuePlan = buildRenderSuccessAttemptPlan({
  referenceImages: [
    {
      url: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
      role: 'front_angle',
      label: 'Front',
    },
    {
      url: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
      role: 'manual_reference_override',
      label: 'Manual override',
    },
  ],
  characterName: 'Sydney',
  firstVideoRescue: true,
});

assert.equal(rescuePlan.length, 2);
assert.deepEqual(rescuePlan.map((attempt) => attempt.provider), ['seedance-fast', 'seedance-fast']);
assert.deepEqual(rescuePlan.map((attempt) => attempt.referenceCount), [1, 0]);
assert.ok(rescuePlan.every((attempt) => attempt.durationSeconds === 5));
assert.ok(rescuePlan.every((attempt) => attempt.aspectRatio === '9:16'));
assert.ok(rescuePlan.every((attempt) => attempt.resolution === '480p'));
assert.ok(rescuePlan.every((attempt) => !attempt.prompt.includes('Sydney')));

console.log('render success cooldown/resume tests passed');
