import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeKlingSceneIntent,
  buildKlingCreateReferencePlan,
  buildFinalPrompt,
  isKlingExactLikenessRequest,
  klingReferenceDiagnostics,
  KLING_EXACT_LIKENESS_PROMPT_PREFIX,
} from '../../api/lumora/generate-video';
import { prepareContinueStory } from '../../src/lib/continueStory';

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

const walkingIntent = analyzeKlingSceneIntent('The self character walks through a peaceful flower garden at golden hour.');
assert.ok(walkingIntent.sceneIntent.includes('walking'));
assert.ok(walkingIntent.sceneIntent.includes('open_space_environment'));
assert.equal(walkingIntent.framingIntent, 'walking_full_body');
assert.equal(walkingIntent.prefersFullBodyPrimary, true);

const walkingReferencePlan = buildKlingCreateReferencePlan({
  body: {
    prompt: 'The self character walks through a peaceful flower garden at golden hour.',
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
assert.equal(walkingReferencePlan?.plannedStrategy, 'scene_anchor_still');
assert.equal(walkingReferencePlan?.sceneAnchorStrategy, 'scene_anchor_still');
assert.equal(walkingReferencePlan?.sceneAnchorGenerated, false);
assert.equal(walkingReferencePlan?.sceneAnchorReason, 'scene_anchor_provider_disabled');
assert.equal(walkingReferencePlan?.sceneAnchorFailureCategory, 'scene_anchor_provider_disabled');
assert.equal(walkingReferencePlan?.sceneAnchorRequired, true);
assert.equal(walkingReferencePlan?.fallbackAllowed, false);
assert.equal(walkingReferencePlan?.primaryReferenceRole, 'full_body');
assert.equal(walkingReferencePlan?.providerPrimaryReference.role, 'scene_anchor');
assert.equal(walkingReferencePlan?.providerPrimaryReference.url, 'https://assets.example/full.jpg');
assert.equal(walkingReferencePlan?.providerAdditionalReferences.length, 0);
assert.equal(walkingReferencePlan?.primaryVideoInputType, 'scene_anchor');
assert.equal(walkingReferencePlan?.primaryVideoInputSource, 'scene_anchor');
assert.equal(walkingReferencePlan?.identityReferencesPassedToVideoStage, false);
assert.equal(walkingReferencePlan?.identityReferenceMode, 'stage1_only');
assert.equal(walkingReferencePlan?.startFrameSource, 'scene_anchor');
assert.equal(walkingReferencePlan?.stage2ProviderModel, null);
assert.equal(walkingReferencePlan?.stage2ProviderRouteType, 'image_to_video');
assert.equal(walkingReferencePlan?.rawReferenceVisualInputsSentToStage2, false);
assert.equal(walkingReferencePlan?.framingIntent, 'walking_full_body');
assert.equal(walkingReferencePlan?.compositionNeutralized, true);
assert.deepEqual(walkingReferencePlan?.references.map((reference) => reference.role), [
  'full_body',
  'front_angle',
  'side_angle_left',
  'side_angle_right',
]);
assert.deepEqual(walkingReferencePlan?.additionalReferences.map((reference) => reference.url), [
  'https://assets.example/front.jpg',
  'https://assets.example/left.jpg',
  'https://assets.example/right.jpg',
]);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /Use @Element1 as the full-figure identity/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /Use @Element2 as the primary face identity/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /@Element3 and @Element4 for side\/profile consistency/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /Adapt clothing to the scene prompt/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /standing and moving naturally through open space/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /clean unobstructed silhouette/i);
assert.match(walkingReferencePlan?.promptGuidance ?? '', /source-photo furniture, seat-back shapes, studio framing, and seated posture/i);
assert.match(walkingReferencePlan?.sceneAnchorPrompt ?? '', /Create a new scene anchor still/i);
assert.match(walkingReferencePlan?.sceneAnchorPrompt ?? '', /free of chair backs, furniture, studio backdrop, seated pose, tight portrait crop/i);
assert.doesNotMatch(walkingReferencePlan?.sceneAnchorPrompt ?? '', /Scene request:\s*Scene prompt/i);
assert.doesNotMatch(walkingReferencePlan?.promptGuidance ?? '', /\bno nudity\b/i);

const walkingDiagnostics = klingReferenceDiagnostics({
  plan: walkingReferencePlan,
  referenceStrategy: 'scene_anchor_still',
  exactLikenessRoute: 'kling_reference',
  providerRoute: 'replicate_kling_image_to_video',
});
assert.equal(walkingDiagnostics.exactRouteActive, true);
assert.equal(walkingDiagnostics.primaryReferenceRole, 'full_body');
assert.deepEqual(walkingDiagnostics.supportingReferenceRoles, ['front_angle', 'side_angle_left', 'side_angle_right']);
assert.equal(walkingDiagnostics.usedMultiReferencePlan, true);
assert.equal(walkingDiagnostics.fellBackToFrontOnly, false);
assert.equal(walkingDiagnostics.compositionNeutralized, true);
assert.equal(walkingDiagnostics.sceneAnchorStrategy, 'scene_anchor_still');
assert.equal(walkingDiagnostics.sceneAnchorGenerated, false);
assert.equal(walkingDiagnostics.sceneAnchorReason, 'scene_anchor_provider_disabled');
assert.equal(walkingDiagnostics.sceneAnchorFailureCategory, 'scene_anchor_provider_disabled');
assert.equal(walkingDiagnostics.primaryInputType, 'scene_anchor_still');
assert.equal(walkingDiagnostics.primaryVideoInputType, 'scene_anchor');
assert.equal(walkingDiagnostics.primaryVideoInputSource, 'scene_anchor');
assert.equal(walkingDiagnostics.identityReferencesPassedToVideoStage, false);
assert.equal(walkingDiagnostics.identityReferenceMode, 'stage1_only');
assert.equal(walkingDiagnostics.startFrameSource, 'scene_anchor');
assert.equal(walkingDiagnostics.posterFrameSource, 'video_frame');
assert.equal(walkingDiagnostics.firstFrameSource, 'scene_anchor');
assert.equal(walkingDiagnostics.stage2ProviderModel, null);
assert.equal(walkingDiagnostics.stage2ProviderRouteType, 'image_to_video');
assert.equal(walkingDiagnostics.rawReferenceVisualInputsSentToStage2, false);
assert.equal(walkingDiagnostics.privateUrlsRedacted, true);
assert.equal(JSON.stringify(walkingDiagnostics).includes('assets.example'), false);

const portraitReferencePlan = buildKlingCreateReferencePlan({
  body: {
    prompt: 'A close-up portrait in soft cinematic light.',
    referenceImageUrls: {
      frontFaceUrl: 'https://assets.example/front.jpg',
      leftAngleUrl: 'https://assets.example/left.jpg',
      rightAngleUrl: 'https://assets.example/right.jpg',
      fullBodyUrl: 'https://assets.example/full.jpg',
    },
  },
  primaryReference: 'https://assets.example/front.jpg',
  exactLikenessReady: true,
});
assert.equal(portraitReferencePlan?.primaryReferenceRole, 'front_angle');
assert.equal(portraitReferencePlan?.framingIntent, 'portrait_closeup');

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
assert.match(createVideoSource, /Trying Kling Reference Beta render\.\.\./);
assert.match(createVideoSource, /Saving to Drafts/);
assert.match(createVideoSource, /isClearlySafeKlingPrompt\(currentPrompt\)/);
assert.match(createVideoSource, /isKlingComplexityError\(message\)/);
assert.match(createVideoSource, /identityOnlyKlingFallbackActive/);
assert.match(createVideoSource, /allowIdentityOnlyKlingFallback: Boolean\(options\.allowIdentityOnlyKlingFallback\)/);
assert.match(createVideoSource, /Using identity-only Kling fallback\. This uses your saved identity references without staging a scene anchor\./);
assert.match(createVideoSource, /Kling Reference Beta scene created with scene-anchor identity planning\./);
assert.match(createVideoSource, /stage2ProviderRouteType/);
assert.match(createVideoSource, /Scene-anchor mode could not start this render/);
assert.match(createVideoSource, /Scene-anchor mode returned an unreadable result/);
assert.match(createVideoSource, /renderFailure/);
assert.match(createVideoSource, /normalizeRenderFailure/);
assert.match(createVideoSource, /Copy debug summary/);
assert.match(createVideoSource, /stage2ErrorMessageRedacted/);
assert.match(createVideoSource, /sceneAnchorErrorMessageRedacted/);

const aiCastExperienceSource = readFileSync(join(process.cwd(), 'src/lib/aiCastExperience.ts'), 'utf8');
assert.match(aiCastExperienceSource, /Image-to-video stage/);

const generateVideoSource = readFileSync(join(process.cwd(), 'api/lumora/generate-video.ts'), 'utf8');
assert.match(generateVideoSource, /KLING_SCENE_ANCHOR_VIDEO_MODEL/);
assert.match(generateVideoSource, /buildKlingSceneAnchorImageToVideoPayload/);
assert.match(generateVideoSource, /reference_image_urls/);
assert.match(generateVideoSource, /fal-ai\/vidu\/q2\/reference-to-image/);
assert.match(generateVideoSource, /scene_anchor_input_schema/);
assert.match(generateVideoSource, /scene_anchor_output_parse_failed/);
assert.match(generateVideoSource, /fal_kling_scene_anchor_image_to_video/);
assert.match(generateVideoSource, /Scene anchor video model is not configured\./);
assert.match(generateVideoSource, /rawReferenceVisualInputsSentToStage2: false/);

const studioListSource = readFileSync(join(process.cwd(), 'src/components/StudioList.tsx'), 'utf8');
assert.match(studioListSource, /Kling Reference Beta/);

const continueStorySource = readFileSync(join(process.cwd(), 'src/lib/continueStory.ts'), 'utf8');
assert.match(continueStorySource, /exactLikenessRoute/);
assert.match(continueStorySource, /lumora_remix_render_engine/);
assert.match(continueStorySource, /kling_reference/);
assert.match(continueStorySource, /klingReferenceDiagnostics/);

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
    id: 'draft-1',
    title: 'Garden walk',
    prompt: 'A peaceful garden walk.',
    characterName: 'Self character',
    isDefaultSelfCharacter: true,
    generationMode: 'kling-exact-likeness-reference',
    exactLikenessRoute: 'kling_reference',
    referenceImageUrl: 'https://assets.example/full.jpg',
    referenceImageUrls: {
      frontFace: 'https://assets.example/front.jpg',
      leftAngle: 'https://assets.example/left.jpg',
      rightAngle: 'https://assets.example/right.jpg',
      fullBody: 'https://assets.example/full.jpg',
    },
    additionalReferenceImageUrls: [
      'https://assets.example/front.jpg',
      'https://assets.example/left.jpg',
      'https://assets.example/right.jpg',
    ],
    klingReferenceDiagnostics: walkingDiagnostics,
  }, 'unit-test');
  const payload = JSON.parse(storage.get('lumora_remix_project') ?? '{}') as Record<string, unknown>;
  assert.equal(payload.exactLikenessRoute, 'kling_reference');
  assert.equal((payload.klingReferenceDiagnostics as Record<string, unknown>).primaryReferenceRole, 'full_body');
  assert.equal((payload.klingReferenceDiagnostics as Record<string, unknown>).startFrameSource, 'scene_anchor');
  assert.equal((payload.klingReferenceDiagnostics as Record<string, unknown>).identityReferencesPassedToVideoStage, false);
  assert.equal((payload.klingReferenceDiagnostics as Record<string, unknown>).stage2ProviderRouteType, 'image_to_video');
  assert.match(String(payload.prompt), /medium-full or full-body cinematic staging/i);
  assert.match(String(payload.prompt), /rather than a raw front portrait/i);
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

console.log('createKlingRenderSafety unit tests passed');
