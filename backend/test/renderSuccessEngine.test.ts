import assert from 'node:assert/strict';
import {
  DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT,
  buildRenderSuccessAttemptPlan,
  isUsableVideoOutput,
  prioritizeAttemptsWithMemory,
  rateLimitRetryDelayMs,
  recipeMemoryPayload,
  sanitizeSuccessProviderPrompt,
  selectAttemptsWithinBudget,
  shouldPreventDuplicateRender,
} from '../src/services/renderSuccessEngine';
import type { SeedanceReferenceImage } from '../src/services/providers/seedanceProvider';

const savedReferences: SeedanceReferenceImage[] = [
  {
    url: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/front.jpg',
    label: 'Front face',
    role: 'front_angle',
  },
  {
    url: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/side.jpg',
    label: 'Side angle',
    role: 'side_angle',
  },
  {
    url: 'https://demo.supabase.co/storage/v1/object/public/lumora-assets/user/manual.jpg',
    label: 'Manual reference override',
    role: 'manual_reference_override',
  },
  {
    url: 'https://cdninstagram.com/protected.jpg',
    label: 'External protected',
    role: 'reference',
  },
];

const plan = buildRenderSuccessAttemptPlan({
  referenceImages: savedReferences,
  characterName: 'Sydney Rose',
  allowDemoFallback: true,
});

assert.deepEqual(plan.map((attempt) => attempt.tier), [1, 2, 3, 4, 5]);
assert.deepEqual(plan.map((attempt) => attempt.provider), [
  'seedance-fast',
  'seedance-fast',
  'seedance-quality',
  'seedance-fast',
  'demo-mode',
]);
assert.equal(plan[0].durationSeconds, 4);
assert.equal(plan[0].referenceCount, 1);
assert.equal(plan[1].referenceCount, 2);
assert.equal(plan[3].referenceCount, 0);
assert.ok(plan.every((attempt) => !attempt.prompt.includes('Sydney')));
assert.ok(plan.every((attempt) => !/photoshoot|influencer|superstar|model|public figure/i.test(attempt.prompt)));

const sanitized = sanitizeSuccessProviderPrompt({
  prompt: 'Sydney Rose walks into a glamour model photoshoot as a superstar public figure.',
  characterName: 'Sydney Rose',
});
assert.equal(sanitized.includes('Sydney'), false);
assert.equal(/photoshoot|superstar|public figure|model/i.test(sanitized), false);
assert.ok(sanitized.includes('fully clothed'));

const budgeted = selectAttemptsWithinBudget({
  attempts: plan,
  maxPaidAttempts: 3,
  maxTotalAttempts: 5,
});
assert.deepEqual(budgeted.selected.map((attempt) => attempt.tier), [1, 2, 3, 5]);
assert.deepEqual(budgeted.skipped.map((attempt) => attempt.tier), [4]);
assert.equal(budgeted.paidAttempts, 3);

const memoryPrioritized = prioritizeAttemptsWithMemory(plan, {
  provider: 'seedance-quality',
  providerModel: 'bytedance/seedance-2.0',
  attemptTier: 3,
  referenceCount: 1,
  promptStyle: 'storybook_cinematic',
});
assert.equal(memoryPrioritized[0].tier, 3);

assert.equal(rateLimitRetryDelayMs({ retryAfterMs: 5_000, retryCount: 0, jitterRatio: 0 }), 7_000);
assert.equal(rateLimitRetryDelayMs({ retryAfterMs: null, retryCount: 1, jitterRatio: 0 }), 22_000);

const recipe = recipeMemoryPayload({
  userId: '00000000-0000-4000-8000-000000000001',
  characterId: 'self',
  attempt: plan[0],
  success: true,
});
assert.equal(recipe.provider, 'seedance-fast');
assert.equal(recipe.renderFeel, 'success_first');
assert.equal(recipe.attemptTier, 1);
assert.equal(recipe.successCount, 1);
assert.equal(recipe.failureCount, 0);

assert.equal(isUsableVideoOutput({ providerStatus: 'succeeded', outputUrl: 'https://video.example/render.mp4' }), true);
assert.equal(isUsableVideoOutput({ providerStatus: 'succeeded', outputUrl: '' }), false);
assert.equal(isUsableVideoOutput({ providerStatus: 'failed', outputUrl: 'https://video.example/render.mp4' }), false);
assert.equal(isUsableVideoOutput({ providerStatus: 'succeeded', outputUrl: 'https://video.example/render.mp4', storagePath: 'user/generations/render.mp4' }), true);

assert.equal(shouldPreventDuplicateRender({
  activeStatus: 'rendering',
  activeCreatedAt: new Date().toISOString(),
}), true);
assert.equal(shouldPreventDuplicateRender({
  activeStatus: 'completed',
  activeCreatedAt: new Date().toISOString(),
}), false);

assert.equal(DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT.includes('storybook cinematic style'), true);

console.log('renderSuccessEngine unit tests passed');
