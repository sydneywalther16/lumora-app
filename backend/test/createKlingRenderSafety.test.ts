import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
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

console.log('createKlingRenderSafety unit tests passed');
