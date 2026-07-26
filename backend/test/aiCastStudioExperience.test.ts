import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyViralScenePreset,
  buildPublicCaptionFromPrompt,
  buildAiCastReadiness,
  buildContinueStoryScaffold,
  buildDraftAiCastLabels,
  buildDraftPublicCaption,
  buildPortrayalDisclosure,
  buildSceneAnchorCreateGuidance,
  buildViralCaptionSuggestions,
  decideAutoStage,
  isLegacyDemoMedia,
  looksLikeInternalRenderPrompt,
  polishKlingCinematicPrompt,
  viralScenePresets,
} from '../../src/lib/aiCastExperience';
import { prepareContinueStory } from '../../src/lib/continueStory';

const repoRoot = process.cwd();
const aiCastHelperSource = readFileSync(join(repoRoot, 'src/lib/aiCastExperience.ts'), 'utf8');
const createVideoSource = readFileSync(join(repoRoot, 'src/components/CreateVideo.tsx'), 'utf8');
const studioListSource = readFileSync(join(repoRoot, 'src/components/StudioList.tsx'), 'utf8');

assert.equal(isLegacyDemoMedia({ title: 'Testing 5/16', username: 'TheCreator' }), true);
assert.equal(isLegacyDemoMedia({ title: 'A finished campaign', username: 'sydney' }), false);
assert.equal(
  buildPortrayalDisclosure({ title: 'Untitled concept', username: 'TheCreator', isDefaultSelfCharacter: true }),
  'Sample AI portrayal',
);
assert.equal(
  buildPortrayalDisclosure({ title: 'A finished campaign', username: 'sydney', isDefaultSelfCharacter: true }),
  'Synthetic portrayal',
);

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
assert.equal(configuredGuidance?.title, 'Kling Reference Beta');
assert.match(configuredGuidance?.body ?? '', /Seedance Fast/i);

const missingProviderGuidance = buildSceneAnchorCreateGuidance({
  klingReferenceSelected: true,
  klingExactReady: true,
  sceneAnchorConfigured: false,
});
assert.equal(missingProviderGuidance?.title, 'Kling Reference Beta needs setup');
assert.match(missingProviderGuidance?.helper ?? '', /Identity-only fallback/i);

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
  startFrameSource: 'scene_anchor',
  identityReferencesPassedToVideoStage: false,
  stage2ProviderRouteType: 'image_to_video',
  audioConfigured: false,
});
assert.deepEqual(klingDraftLabels, [
  'Kling Reference Beta',
  'Scene-anchor Beta',
  'Starts from scene anchor',
  'Identity references baked into anchor',
  'Image-to-video stage',
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
assert.match(scaffold, /Kling Reference Beta scene-anchor planning/i);
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
    stage2ProviderModel: 'fal-ai/kling-video/v2.1/master/image-to-video',
    stage2ProviderRouteType: 'image_to_video',
    rawReferenceVisualInputsSentToStage2: false,
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
  assert.equal(payload.stage2ProviderRouteType, 'image_to_video');
  assert.equal(payload.rawReferenceVisualInputsSentToStage2, false);
  assert.equal(payload.audioConfigured, false);
  assert.equal(payload.viralPresetUsed, 'golden-hour-garden-walk');
  assert.equal(payload.promptPolished, true);
  assert.match(String(payload.prompt), /Kling Reference Beta scene-anchor planning/i);
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

const autoDefaultRoute = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: false,
  selfCharacterReady: false,
  userPrompt: 'she sees the sunshine',
});
assert.equal(autoDefaultRoute.engine, 'seedance-2.0');
assert.equal(autoDefaultRoute.route, 'seedance_fast_default');

const autoExactRoute = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: true,
  selfCharacterReady: true,
  userPrompt: 'keep my exact face and same face through motion',
});
assert.equal(autoExactRoute.route, 'director_primary');
assert.equal(autoExactRoute.fallbackEngine, null);

const autoDemoRoute = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: true,
  exactLikenessReady: true,
  selfCharacterReady: true,
  userPrompt: 'anything',
});
assert.equal(autoDemoRoute.engine, 'mock');

assert.equal(
  buildPublicCaptionFromPrompt('Use medium-wide or full-body cinematic framing. Preserve the saved self character identity.'),
  'A cinematic scene is ready.',
);
assert.equal(buildPublicCaptionFromPrompt('she sees the sunshine'), 'She sees the sunshine.');
assert.equal(buildDraftPublicCaption({
  caption: 'A quiet garden arrival',
  prompt: 'Use medium-wide framing and preserve identity.',
}), 'A quiet garden arrival.');
assert.equal(buildDraftPublicCaption({
  caption: 'Render instructions: use 9:16 aspect ratio guidance.',
  prompt: 'she sees the sunshine. Use medium-wide framing with camera drift.',
}), 'She sees the sunshine.');
assert.equal(buildDraftPublicCaption({
  prompt: 'Provider payload: keep the subject fully clothed and use the reference image.',
}), 'A cinematic scene is ready.');
assert.equal(buildDraftPublicCaption({
  prompt: 'A rooftop hello',
  finalPrompt: 'Use medium-wide framing with provider payload instructions.',
} as Parameters<typeof buildDraftPublicCaption>[0] & { finalPrompt: string }), 'A rooftop hello.');
assert.equal(buildPortrayalDisclosure({
  provider: 'mock',
  characterName: 'Sydney Spears',
  creatorName: 'Sydney Spears',
}), 'Sample AI portrayal');
assert.equal(buildPortrayalDisclosure({
  characterName: 'Sydney Spears',
  creatorName: 'Sydney Spears',
}), 'Demo/Test media');
assert.equal(buildPortrayalDisclosure({
  isDefaultSelfCharacter: true,
  characterName: 'Sydney Spears',
  creatorName: 'Sydney Spears',
}), 'Synthetic portrayal');
assert.equal(buildPortrayalDisclosure({
  characterName: 'Nova',
  creatorName: 'Sydney Spears',
}), 'Featuring Nova');
assert.equal(
  looksLikeInternalRenderPrompt('Use medium-wide or full-body cinematic framing with visible environment around the subject.'),
  true,
);

assert.doesNotMatch(aiCastHelperSource, /\bfetch\s*\(/);
assert.doesNotMatch(aiCastHelperSource, /FAL_KEY|KLING_API_KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE/i);
assert.match(aiCastHelperSource, /decideAutoStage/);
assert.match(createVideoSource, /Sora-worthy readiness/);
assert.match(createVideoSource, /Lumora Auto Stage/);
assert.match(createVideoSource, /VIRAL SCENE PRESETS/i);
assert.match(createVideoSource, /Kling Reference is experimental/);
assert.match(createVideoSource, /Prompt polish/);
assert.match(createVideoSource, /Lumora tried the best Stage route and switched to a safer fallback\./);
assert.match(createVideoSource, /buildPublicCaptionFromPrompt/);
assert.match(studioListSource, /buildDraftAiCastLabels/);
assert.match(studioListSource, /buildDraftPublicCaption\(job\)/);
assert.match(studioListSource, /Viral caption helper/);

console.log('aiCastStudioExperience unit tests passed');
