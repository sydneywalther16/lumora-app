import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKlingCreateReferencePlan,
  buildFinalPrompt,
  isKlingExactLikenessRequest,
  KLING_EXACT_LIKENESS_PROMPT_PREFIX,
} from '../../api/lumora/generate-video';

const safeGardenPrompt = 'Peaceful flower garden, golden hour, natural movement, fully clothed, gentle camera motion.';

const exactPrompt = buildFinalPrompt({
  prompt: safeGardenPrompt,
  characterDescription: '',
  identityPrompt: '',
  consistencyPrompt: '',
  engine: 'replicate',
  style: '',
  camera: '',
  mood: '',
  aspectRatio: '9:16',
  exactLikenessRoute: 'kling_reference',
  exactLikenessReady: true,
  exactLikenessCanaryStatus: 'canary_succeeded',
});

assert.equal(isKlingExactLikenessRequest({
  engine: 'replicate',
  exactLikenessRoute: 'kling_reference',
  exactLikenessReady: true,
  exactLikenessCanaryStatus: 'canary_succeeded',
}), true);
assert.match(exactPrompt, new RegExp(KLING_EXACT_LIKENESS_PROMPT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(exactPrompt, /saved self-character references as the identity guide/i);
assert.doesNotMatch(exactPrompt, /\bno nudity\b/i);
assert.doesNotMatch(exactPrompt, /\bsexual content\b/i);
assert.doesNotMatch(exactPrompt, /\bno minors\b/i);
assert.doesNotMatch(exactPrompt, /\bsuggestive posing\b/i);

const exactPromptWithLegacyConsistency = buildFinalPrompt({
  prompt: safeGardenPrompt,
  characterDescription: '',
  identityPrompt: '',
  consistencyPrompt: 'Preserve likeness. No nudity, no sexual content, no minors, no suggestive posing.',
  engine: 'replicate',
  style: '',
  camera: '',
  mood: '',
  aspectRatio: '9:16',
  exactLikenessRoute: 'kling_reference',
  exactLikenessReady: true,
  exactLikenessCanaryStatus: 'canary_succeeded',
});
assert.doesNotMatch(exactPromptWithLegacyConsistency, /\bno nudity\b/i);
assert.doesNotMatch(exactPromptWithLegacyConsistency, /\bsexual content\b/i);
assert.doesNotMatch(exactPromptWithLegacyConsistency, /\bno minors\b/i);
assert.doesNotMatch(exactPromptWithLegacyConsistency, /\bsuggestive posing\b/i);

const multiReferencePlan = buildKlingCreateReferencePlan({
  body: {
    referenceImageUrls: {
      frontFaceUrl: 'https://assets.example/front.jpg',
      leftAngleUrl: 'https://assets.example/left.jpg',
      rightAngleUrl: 'https://assets.example/right.jpg',
      fullBodyUrl: 'https://assets.example/full.jpg',
    },
    additionalReferenceImageUrls: [
      'https://assets.example/left.jpg',
      'https://assets.example/right.jpg',
      'https://assets.example/full.jpg',
    ],
  },
  primaryReference: 'https://assets.example/front.jpg',
  exactLikenessReady: true,
});
assert.equal(multiReferencePlan?.plannedStrategy, 'multi_reference');
assert.equal(multiReferencePlan?.fallbackAllowed, false);
assert.deepEqual(multiReferencePlan?.references.map((reference) => reference.role), [
  'front_angle',
  'side_angle_left',
  'side_angle_right',
  'full_body',
]);
assert.deepEqual(multiReferencePlan?.additionalReferences.map((reference) => reference.url), [
  'https://assets.example/left.jpg',
  'https://assets.example/right.jpg',
  'https://assets.example/full.jpg',
]);
assert.match(multiReferencePlan?.promptGuidance ?? '', /Use @Element1 as the primary face identity/i);
assert.match(multiReferencePlan?.promptGuidance ?? '', /@Element2 and @Element3 for side\/profile consistency/i);
assert.match(multiReferencePlan?.promptGuidance ?? '', /@Element4 for body proportion/i);
assert.match(multiReferencePlan?.promptGuidance ?? '', /Adapt clothing to the scene prompt/i);
assert.doesNotMatch(multiReferencePlan?.promptGuidance ?? '', /\bno nudity\b/i);

const frontOnlyPlan = buildKlingCreateReferencePlan({
  body: {
    referenceImageUrls: {
      frontFaceUrl: 'https://assets.example/front.jpg',
    },
  },
  primaryReference: 'https://assets.example/front.jpg',
  exactLikenessReady: true,
});
assert.equal(frontOnlyPlan?.plannedStrategy, 'front_only_fallback');
assert.equal(frontOnlyPlan?.fallbackAllowed, true);
assert.deepEqual(frontOnlyPlan?.references.map((reference) => reference.role), ['front_angle']);

const regularPrompt = buildFinalPrompt({
  prompt: safeGardenPrompt,
  characterDescription: '',
  identityPrompt: '',
  consistencyPrompt: '',
  engine: 'replicate',
  style: '',
  camera: '',
  mood: '',
  aspectRatio: '9:16',
});

assert.match(regularPrompt, /No nudity, no sexual content, no minors, no suggestive posing\./);

const createVideoSource = readFileSync(join(process.cwd(), 'src/components/CreateVideo.tsx'), 'utf8');
assert.match(createVideoSource, /Trying Kling exact likeness render\.\.\./);
assert.match(createVideoSource, /Saving to Drafts/);
assert.match(createVideoSource, /isClearlySafeKlingPrompt\(currentPrompt\)/);
assert.match(createVideoSource, /isKlingComplexityError\(message\)/);
assert.match(createVideoSource, /Kling exact-likeness render created\./);

const studioListSource = readFileSync(join(process.cwd(), 'src/components/StudioList.tsx'), 'utf8');
assert.match(studioListSource, /Kling exact likeness/);

const continueStorySource = readFileSync(join(process.cwd(), 'src/lib/continueStory.ts'), 'utf8');
assert.match(continueStorySource, /exactLikenessRoute/);
assert.match(continueStorySource, /lumora_remix_render_engine/);
assert.match(continueStorySource, /kling_reference/);

console.log('createKlingRenderSafety unit tests passed');
