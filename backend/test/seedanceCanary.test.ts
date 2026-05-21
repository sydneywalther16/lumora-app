import assert from 'node:assert/strict';
import {
  buildSeedanceCanaryPayload,
  canaryRateLimitStatus,
  redactRenderPathCompareValue,
  selectPrimaryCanaryReference,
  SEEDANCE_CANARY_PROMPT,
} from '../src/services/seedanceCanary';
import { parseProviderVideoOutput } from '../src/services/providerOutputParser';
import { validateSeedanceProviderPayload } from '../src/services/providers/seedanceProvider';

const textPayload = buildSeedanceCanaryPayload();

assert.equal(textPayload.prompt, SEEDANCE_CANARY_PROMPT);
assert.equal(textPayload.duration, 5);
assert.equal(textPayload.aspect_ratio, '9:16');
assert.equal(textPayload.resolution, '480p');
assert.equal(textPayload.generate_audio, false);
assert.equal('reference_images' in textPayload, false);
assert.equal(/Sydney|display name|Story Memory|Scene Flow/i.test(textPayload.prompt), false);
assert.equal(/photoshoot|influencer|superstar|public figure|glamour|seductive/i.test(textPayload.prompt), false);

const invalidDuration = validateSeedanceProviderPayload({
  ...textPayload,
  duration: 4,
});
assert.equal(invalidDuration.ok, false);
assert.equal(invalidDuration.ok ? '' : invalidDuration.issues[0].field, 'duration');

assert.equal(parseProviderVideoOutput('https://cdn.example.com/video.mp4').ok, true);
assert.equal(parseProviderVideoOutput(['https://cdn.example.com/video.mp4']).ok, true);
assert.equal(parseProviderVideoOutput({ output: { video: 'https://cdn.example.com/video.mp4' } }).ok, true);

assert.equal(canaryRateLimitStatus(), 'rate_limited');

const references = selectPrimaryCanaryReference([
  { url: 'https://assets.example.com/front.jpg', role: 'front_angle' },
  { url: 'https://assets.example.com/side.jpg', role: 'side_angle' },
]);
assert.equal(references.length, 1);
const referencePayload = buildSeedanceCanaryPayload({ referenceImages: references });
assert.deepEqual(referencePayload.reference_images, ['https://assets.example.com/front.jpg']);

const redacted = redactRenderPathCompareValue({
  referenceUrl: 'https://signed.example.com/private.jpg?token=secret',
  nested: {
    videoUrl: 'https://signed.example.com/private.mp4?token=secret',
  },
  list: ['https://signed.example.com/other.jpg'],
});
assert.deepEqual(redacted, {
  referenceUrl: '[redacted-url]',
  nested: { videoUrl: '[redacted-url]' },
  list: ['[redacted-url]'],
});

console.log('seedanceCanary unit tests passed');
