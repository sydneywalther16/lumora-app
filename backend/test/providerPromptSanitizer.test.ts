import assert from 'node:assert/strict';
import {
  buildStyleSafeScenePrompt,
  sanitizeProviderPrompt,
} from '../src/services/providerPromptSanitizer';

const flowerPrompt = sanitizeProviderPrompt({
  prompt: 'Sydney Spears picks flowers for a photoshoot, hey yall, superstar glamour influencer',
  characterName: 'Sydney Spears',
});

assert.equal(
  flowerPrompt.prompt,
  'the cast character picks flowers for a cinematic scene, confident protagonist, elegant cinematic tone, creator',
);
assert.equal(flowerPrompt.displayNameMasked, true);
assert.deepEqual(flowerPrompt.riskyTermsRemoved, [
  'photoshoot',
  'superstar',
  'glamour',
  'influencer',
]);
assert.deepEqual(flowerPrompt.socialPhrasesRemoved, ['hey yall']);

const fullNamePrompt = sanitizeProviderPrompt({
  prompt: 'Sydney walks through a bloom garden.',
  characterName: 'Sydney Spears',
});
assert.equal(fullNamePrompt.prompt, 'the cast character walks through a bloom garden.');

const realismPrompt = sanitizeProviderPrompt({
  prompt: 'A photorealistic woman walks through a garden.',
});
assert.equal(realismPrompt.prompt, 'A cinematic character walks through a garden.');
assert.ok(realismPrompt.riskyTermsRemoved.includes('photorealistic woman'));

const artifactPrompt = sanitizeProviderPrompt({
  prompt: 'Render Sydney Spears as a public figure celebrity model posing in glamour.',
  characterName: 'Sydney Spears',
});
assert.equal(
  artifactPrompt.prompt,
  'the cast character as a natural movement in elegant cinematic tone.',
);
assert.ok(artifactPrompt.artifactsRemoved.includes('Render'));
assert.ok(artifactPrompt.riskyTermsRemoved.includes('public figure'));
assert.ok(artifactPrompt.riskyTermsRemoved.includes('celebrity'));

assert.equal(
  buildStyleSafeScenePrompt(),
  'the cast character gently picks flowers in a sunlit bloom garden, peaceful mood, natural movement, fully clothed, storybook cinematic style, soft lighting, gentle camera movement.',
);

console.log('providerPromptSanitizer smoke tests passed');
