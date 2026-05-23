import assert from 'node:assert/strict';
import {
  applySelfLikenessDescriptorToPrompt,
  buildSelfLikenessDescriptor,
} from '../src/services/selfLikenessDescriptor';
import { hasProductionReadyAlternateLikenessProvider } from '../src/services/likenessProviderCanary';
import { TEXT_ONLY_SUCCESS_FIRST_PROVIDER_PROMPT } from '../src/services/renderSuccessEngine';

const descriptor = buildSelfLikenessDescriptor({
  displayName: 'Sydney Rose',
  characterName: 'Sydney',
  intensity: 'balanced',
  appearanceSummary: 'Sydney has long copper-red wavy hair, fair skin, blue-green eyes, soft expressive features, and a glamorous model photoshoot aura.',
  wardrobeTendencies: 'Elegant feminine everyday style with polished dresses.',
  cinematicStyle: 'storybook cinematic',
});

assert.equal(descriptor.available, true);
assert.ok(descriptor.descriptor);
assert.ok(descriptor.wordCount <= 35);
assert.equal(/Sydney/i.test(descriptor.descriptor ?? ''), false);
assert.equal(/photoshoot|influencer|superstar|model|celebrity|public figure|glamour/i.test(descriptor.descriptor ?? ''), false);
assert.ok((descriptor.descriptor ?? '').includes('copper-red'));
assert.ok((descriptor.descriptor ?? '').includes('blue-green'));

const light = buildSelfLikenessDescriptor({
  intensity: 'light',
  appearanceSummary: 'short dark curls, warm brown skin, deep brown eyes, angular brows',
  wardrobeTendencies: 'minimal tailored style',
});
assert.ok(light.wordCount <= descriptor.wordCount);

const prompted = applySelfLikenessDescriptorToPrompt(TEXT_ONLY_SUCCESS_FIRST_PROVIDER_PROMPT, descriptor.descriptor);
assert.ok(prompted.startsWith('A recurring cinematic character with'));
assert.ok(prompted.includes('walks slowly through a peaceful sunlit garden'));
assert.equal(prompted.includes('[Image1]'), false);
assert.equal(hasProductionReadyAlternateLikenessProvider(), false);

console.log('selfLikenessDescriptor unit tests passed');
