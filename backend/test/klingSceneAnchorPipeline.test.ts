import assert from 'node:assert/strict';
import {
  analyzeKlingSceneIntent,
  buildKlingCreateReferencePlan,
  detectKlingOutfitIntent,
  klingReferenceDiagnostics,
} from '../../api/lumora/generate-video';
import { prepareContinueStory } from '../../src/lib/continueStory';

const originalSceneAnchorEnv = {
  KLING_SCENE_ANCHOR_PROVIDER: process.env.KLING_SCENE_ANCHOR_PROVIDER,
  SCENE_ANCHOR_PROVIDER: process.env.SCENE_ANCHOR_PROVIDER,
  OPENAI_SCENE_ANCHOR_ENABLED: process.env.OPENAI_SCENE_ANCHOR_ENABLED,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

delete process.env.KLING_SCENE_ANCHOR_PROVIDER;
delete process.env.SCENE_ANCHOR_PROVIDER;
delete process.env.OPENAI_SCENE_ANCHOR_ENABLED;
delete process.env.OPENAI_API_KEY;

try {
  const gardenDressPrompt =
    'Peaceful flower garden at golden hour, wearing a flowing ivory dress, full-body cinematic walking shot.';
  const sceneIntent = analyzeKlingSceneIntent(gardenDressPrompt);
  assert.ok(sceneIntent.sceneIntent.includes('walking'));
  assert.ok(sceneIntent.sceneIntent.includes('open_space_environment'));
  assert.equal(sceneIntent.framingIntent, 'walking_full_body');
  assert.equal(sceneIntent.compositionNeutralized, true);

  const outfitIntent = detectKlingOutfitIntent(gardenDressPrompt);
  assert.equal(outfitIntent.userSpecifiedOutfit, true);
  assert.deepEqual(outfitIntent.outfitTermsDetected, ['flowing ivory dress']);

  const plan = buildKlingCreateReferencePlan({
    body: {
      prompt: gardenDressPrompt,
      referenceImageUrls: {
        frontFaceUrl: 'https://assets.example/front.jpg',
        leftAngleUrl: 'https://assets.example/left.jpg',
        rightAngleUrl: 'https://assets.example/right.jpg',
        fullBodyUrl: 'https://assets.example/full-body-street-jeans.jpg',
      },
    },
    primaryReference: 'https://assets.example/front.jpg',
    exactLikenessReady: true,
  });
  assert.ok(plan);
  assert.equal(plan.plannedStrategy, 'composite_identity_sheet');
  assert.equal(plan.sceneAnchorStrategy, 'composite_identity_sheet');
  assert.equal(plan.sceneAnchorGenerated, false);
  assert.equal(plan.sceneAnchorProvider, null);
  assert.equal(plan.sceneAnchorReason, 'scene_anchor_provider_not_configured');
  assert.equal(plan.primaryReferenceRole, 'full_body');
  assert.equal(plan.providerPrimaryReference.role, 'identity_sheet');
  assert.match(plan.providerPrimaryReference.url, /^data:image\/svg\+xml;base64,/);
  assert.equal(plan.providerAdditionalReferences.length, 0);
  assert.deepEqual(plan.validationReferences.map((reference) => reference.role), [
    'full_body',
    'front_angle',
    'side_angle_left',
    'side_angle_right',
  ]);
  assert.equal(plan.userSpecifiedOutfit, true);
  assert.deepEqual(plan.outfitTermsDetected, ['flowing ivory dress']);
  assert.equal(plan.referenceOutfitCarryoverSuppressed, true);
  assert.equal(plan.compositionCarryoverSuppressed, true);
  assert.ok(plan.riskyReferenceArtifacts.includes('sidewalk_or_street'));
  assert.match(plan.providerPrompt, /identity references for character identity only/i);
  assert.match(plan.providerPrompt, /requested outfit and environment dominant/i);
  assert.match(plan.promptGuidance, /Prioritize the user-requested outfit over reference clothing: flowing ivory dress/i);
  assert.match(plan.promptGuidance, /Build a new scene matching the requested environment, outfit, lighting, and cinematic mood/i);
  assert.match(plan.promptGuidance, /leaving source-photo furniture, seat-back shapes, studio framing, and seated posture out/i);

  const diagnostics = klingReferenceDiagnostics({
    plan,
    referenceStrategy: plan.plannedStrategy,
    exactLikenessRoute: 'kling_reference',
    providerRoute: 'replicate_kling_image_to_video',
  });
  assert.equal(diagnostics.exactRouteActive, true);
  assert.equal(diagnostics.referenceStrategy, 'composite_identity_sheet');
  assert.equal(diagnostics.sceneAnchorStrategy, 'composite_identity_sheet');
  assert.equal(diagnostics.sceneAnchorGenerated, false);
  assert.equal(diagnostics.userSpecifiedOutfit, true);
  assert.deepEqual(diagnostics.outfitTermsDetected, ['flowing ivory dress']);
  assert.equal(diagnostics.referenceOutfitCarryoverSuppressed, true);
  assert.equal(diagnostics.compositionCarryoverSuppressed, true);
  assert.equal(diagnostics.privateUrlsRedacted, true);
  assert.equal(JSON.stringify(diagnostics).includes('assets.example'), false);

  const portraitPlan = buildKlingCreateReferencePlan({
    body: {
      prompt: 'A soft close-up portrait with gentle light.',
      referenceImageUrls: {
        frontFaceUrl: 'https://assets.example/front.jpg',
        leftAngleUrl: 'https://assets.example/left.jpg',
        fullBodyUrl: 'https://assets.example/full-body.jpg',
      },
    },
    primaryReference: 'https://assets.example/front.jpg',
    exactLikenessReady: true,
  });
  assert.ok(portraitPlan);
  assert.equal(portraitPlan.plannedStrategy, 'direct_identity_references');
  assert.equal(portraitPlan.primaryReferenceRole, 'front_angle');
  assert.equal(portraitPlan.providerPrimaryReference.role, 'front_angle');
  assert.equal(portraitPlan.providerPrimaryReference.url, 'https://assets.example/front.jpg');

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
      id: 'draft-kling-scene-anchor',
      title: 'Garden walk',
      prompt: gardenDressPrompt,
      isDefaultSelfCharacter: true,
      generationMode: 'kling-exact-likeness-reference',
      exactLikenessRoute: 'kling_reference',
      referenceStrategy: plan.plannedStrategy,
      sceneAnchorStrategy: plan.sceneAnchorStrategy,
      sceneAnchorGenerated: plan.sceneAnchorGenerated,
      sceneAnchorProvider: plan.sceneAnchorProvider,
      sceneAnchorReason: plan.sceneAnchorReason,
      sceneIntent: plan.sceneIntent,
      framingIntent: plan.framingIntent,
      primaryReferenceRole: plan.primaryReferenceRole,
      supportingReferenceRoles: plan.supportingReferenceRoles,
      userSpecifiedOutfit: plan.userSpecifiedOutfit,
      outfitTermsDetected: plan.outfitTermsDetected,
      referenceOutfitCarryoverSuppressed: plan.referenceOutfitCarryoverSuppressed,
      compositionCarryoverSuppressed: plan.compositionCarryoverSuppressed,
      klingReferenceDiagnostics: diagnostics,
    }, 'unit-test');
    const payload = JSON.parse(storage.get('lumora_remix_project') ?? '{}') as Record<string, unknown>;
    assert.equal(payload.exactLikenessRoute, 'kling_reference');
    assert.equal(payload.referenceStrategy, 'composite_identity_sheet');
    assert.equal(payload.sceneAnchorStrategy, 'composite_identity_sheet');
    assert.equal(payload.compositionCarryoverSuppressed, true);
    assert.deepEqual(payload.outfitTermsDetected, ['flowing ivory dress']);
    assert.match(String(payload.prompt), /identity guidance rather than portrait composition/i);
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
} finally {
  if (typeof originalSceneAnchorEnv.KLING_SCENE_ANCHOR_PROVIDER === 'string') {
    process.env.KLING_SCENE_ANCHOR_PROVIDER = originalSceneAnchorEnv.KLING_SCENE_ANCHOR_PROVIDER;
  }
  if (typeof originalSceneAnchorEnv.SCENE_ANCHOR_PROVIDER === 'string') {
    process.env.SCENE_ANCHOR_PROVIDER = originalSceneAnchorEnv.SCENE_ANCHOR_PROVIDER;
  }
  if (typeof originalSceneAnchorEnv.OPENAI_SCENE_ANCHOR_ENABLED === 'string') {
    process.env.OPENAI_SCENE_ANCHOR_ENABLED = originalSceneAnchorEnv.OPENAI_SCENE_ANCHOR_ENABLED;
  }
  if (typeof originalSceneAnchorEnv.OPENAI_API_KEY === 'string') {
    process.env.OPENAI_API_KEY = originalSceneAnchorEnv.OPENAI_API_KEY;
  }
}

console.log('klingSceneAnchorPipeline unit tests passed');
