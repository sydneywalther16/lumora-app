import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyViralScenePreset,
  buildAiCastReadiness,
  buildContinueStoryScaffold,
  buildDraftAiCastLabels,
  buildSceneAnchorCreateGuidance,
  buildViralCaptionSuggestions,
  polishKlingCinematicPrompt,
  viralScenePresets,
} from '../../src/lib/aiCastExperience';
import { prepareContinueStory } from '../../src/lib/continueStory';

const repoRoot = process.cwd();
const aiCastHelperSource = readFileSync(join(repoRoot, 'src/lib/aiCastExperience.ts'), 'utf8');
const createVideoSource = readFileSync(join(repoRoot, 'src/components/CreateVideo.tsx'), 'utf8');
const studioListSource = readFileSync(join(repoRoot, 'src/components/StudioList.tsx'), 'utf8');

const gardenPreset = viralScenePresets.find((preset) => preset.id === 'golden-hour-garden-walk');
assert.ok(gardenPreset);
assert.match(gardenPreset.prompt, /full-body cinematic walking shot/i);
assert.match(gardenPreset.prompt, /flowing ivory dress/i);
assert.equal(applyViralScenePreset('', gardenPreset), gardenPreset.prompt);
assert.match(applyViralScenePreset('Make it dreamy.', gardenPreset), /AI cast preset:/);

const polished = polishKlingCinematicPrompt('walk through a garden at golden hour');
assert.equal(polished.promptPolished, true);
assert.match(polished.prompt, /medium-wide or full-body cinematic framing/i);
assert.match(polished.prompt, /Preserve the saved self character identity/i);
assert.doesNotMatch(polished.prompt, /nudity|minor|unsafe|nsfw/i);

const alreadyPolished = polishKlingCinematicPrompt(
  'Full-body cinematic walking shot through a flower garden, wearing a flowing ivory dress, gentle camera motion, consistent saved self character identity.',
);
assert.equal(alreadyPolished.additions.some((addition) => /outfit/i.test(addition)), false);

const configuredGuidance = buildSceneAnchorCreateGuidance({
  klingReferenceSelected: true,
  klingExactReady: true,
  sceneAnchorConfigured: true,
});
assert.equal(configuredGuidance?.title, 'Scene-anchor-first exact likeness');
assert.match(configuredGuidance?.body ?? '', /stage the scene first/i);

const missingProviderGuidance = buildSceneAnchorCreateGuidance({
  klingReferenceSelected: true,
  klingExactReady: true,
  sceneAnchorConfigured: false,
});
assert.equal(missingProviderGuidance?.title, 'Scene anchor provider not configured yet.');
assert.match(missingProviderGuidance?.helper ?? '', /Sora-level staging/i);

const readiness = buildAiCastReadiness({
  selfCharacterSaved: true,
  verificationVideoSaved: true,
  klingExactLikenessReady: true,
  sceneAnchorConfigured: false,
  audioConfigured: false,
});
assert.equal(readiness.find((item) => item.key === 'scene-anchor')?.status, 'Not configured');
assert.equal(readiness.find((item) => item.key === 'audio')?.status, 'Not configured yet');

const klingDraftLabels = buildDraftAiCastLabels({
  exactLikenessRoute: 'kling_reference',
  generationMode: 'kling-exact-likeness-reference',
  sceneAnchorStrategy: 'scene_anchor_still',
  primaryInputType: 'scene_anchor_still',
  audioConfigured: false,
});
assert.deepEqual(klingDraftLabels, [
  'Kling exact likeness',
  'Scene-anchor-first',
  'Continue Story ready',
  'No audio',
]);
assert.equal(klingDraftLabels.some((label) => /soft guidance/i.test(label)), false);

const identityOnlyLabels = buildDraftAiCastLabels({
  exactLikenessRoute: 'kling_reference',
  referenceStrategy: 'direct_identity_references',
});
assert.ok(identityOnlyLabels.includes('Identity-only fallback'));

const scaffold = buildContinueStoryScaffold({
  exactLikenessRoute: 'kling_reference',
  sceneAnchorStrategy: 'scene_anchor_still',
  outfitTermsDetected: ['flowing ivory dress'],
  environmentTermsDetected: ['flower garden'],
  framingIntent: 'walking_full_body',
});
assert.match(scaffold, /scene-anchor-first exact-likeness planning/i);
assert.match(scaffold, /flowing ivory dress/i);
assert.match(scaffold, /flower garden/i);
assert.match(scaffold, /without resetting into a generic portrait/i);

const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
const originalLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  value: {},
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});
try {
  prepareContinueStory({
    id: 'draft-kling-polish',
    title: 'Garden dress walk',
    prompt: 'walk through a flower garden',
    exactLikenessRoute: 'kling_reference',
    generationMode: 'kling-exact-likeness-reference',
    sceneAnchorStrategy: 'scene_anchor_still',
    outfitTermsDetected: ['flowing ivory dress'],
    environmentTermsDetected: ['flower garden'],
    framingIntent: 'walking_full_body',
    audioConfigured: false,
    viralPresetUsed: 'golden-hour-garden-walk',
    promptPolished: true,
  }, 'unit-test');
  const payload = JSON.parse(storage.get('lumora_remix_project') ?? '{}') as Record<string, unknown>;
  assert.equal(payload.exactLikenessRoute, 'kling_reference');
  assert.equal(payload.sceneAnchorStrategy, 'scene_anchor_still');
  assert.equal(payload.audioConfigured, false);
  assert.equal(payload.viralPresetUsed, 'golden-hour-garden-walk');
  assert.equal(payload.promptPolished, true);
  assert.match(String(payload.prompt), /scene-anchor-first exact-likeness planning/i);
  assert.equal(storage.get('lumora_remix_render_engine'), 'replicate');
} finally {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: originalLocalStorage,
    configurable: true,
  });
}

const captions = buildViralCaptionSuggestions('golden hour garden walk', 'Sydney');
assert.match(captions.short, /Sydney/);
assert.match(captions.dramatic, /golden hour garden walk/i);

assert.doesNotMatch(aiCastHelperSource, /\bfetch\s*\(/);
assert.doesNotMatch(aiCastHelperSource, /FAL_KEY|KLING_API_KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE/i);
assert.match(createVideoSource, /Sora-worthy readiness/);
assert.match(createVideoSource, /Viral Scene Presets/);
assert.match(createVideoSource, /Scene anchor provider not configured yet\./);
assert.match(createVideoSource, /Prompt polish/);
assert.match(studioListSource, /buildDraftAiCastLabels/);
assert.match(studioListSource, /Viral caption helper/);

console.log('aiCastStudioExperience unit tests passed');
