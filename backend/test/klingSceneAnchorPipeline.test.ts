import assert from 'node:assert/strict';
import {
  analyzeKlingSceneIntent,
  buildKlingCreateReferencePlan,
  detectKlingEnvironmentIntent,
  detectKlingOutfitIntent,
  klingReferenceDiagnostics,
  prepareKlingCreateReferencePlanForProvider,
} from '../../api/lumora/generate-video';
import { prepareContinueStory } from '../../src/lib/continueStory';

const originalSceneAnchorEnv = {
  KLING_SCENE_ANCHOR_PROVIDER: process.env.KLING_SCENE_ANCHOR_PROVIDER,
  SCENE_ANCHOR_PROVIDER: process.env.SCENE_ANCHOR_PROVIDER,
  OPENAI_SCENE_ANCHOR_ENABLED: process.env.OPENAI_SCENE_ANCHOR_ENABLED,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  REPLICATE_IMAGE_MODEL: process.env.REPLICATE_IMAGE_MODEL,
  REPLICATE_SCENE_ANCHOR_MODEL: process.env.REPLICATE_SCENE_ANCHOR_MODEL,
};

delete process.env.KLING_SCENE_ANCHOR_PROVIDER;
delete process.env.SCENE_ANCHOR_PROVIDER;
delete process.env.OPENAI_SCENE_ANCHOR_ENABLED;
delete process.env.OPENAI_API_KEY;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.REPLICATE_IMAGE_MODEL;
delete process.env.REPLICATE_SCENE_ANCHOR_MODEL;

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
  const environmentIntent = detectKlingEnvironmentIntent(gardenDressPrompt);
  assert.equal(environmentIntent.environmentDetected, true);
  assert.ok(environmentIntent.environmentTermsDetected.includes('flower garden'));

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
  assert.equal(plan.plannedStrategy, 'scene_anchor_still');
  assert.equal(plan.sceneAnchorStrategy, 'scene_anchor_still');
  assert.equal(plan.sceneAnchorGenerated, false);
  assert.equal(plan.sceneAnchorProvider, null);
  assert.equal(plan.sceneAnchorReason, 'scene_anchor_provider_not_configured');
  assert.equal(plan.sceneAnchorRequired, true);
  assert.equal(plan.primaryReferenceRole, 'full_body');
  assert.equal(plan.providerPrimaryReference.role, 'scene_anchor');
  assert.equal(plan.providerPrimaryReference.url, 'https://assets.example/full-body-street-jeans.jpg');
  assert.equal(plan.primaryInputType, 'scene_anchor_still');
  assert.equal(plan.providerAdditionalReferences.length, 0);
  assert.deepEqual(plan.validationReferences.map((reference) => reference.role), ['scene_anchor']);
  assert.equal(plan.userSpecifiedOutfit, true);
  assert.deepEqual(plan.outfitTermsDetected, ['flowing ivory dress']);
  assert.ok(plan.environmentTermsDetected.includes('flower garden'));
  assert.equal(plan.referenceOutfitCarryoverSuppressed, true);
  assert.equal(plan.compositionCarryoverSuppressed, true);
  assert.ok(plan.riskyReferenceArtifacts.includes('sidewalk_or_street'));
  assert.match(plan.providerPrompt, /identity references for character identity only/i);
  assert.match(plan.providerPrompt, /requested outfit and environment dominant/i);
  assert.match(plan.providerPrompt, /Animate from the scene anchor still as the primary composition input/i);
  assert.match(plan.sceneAnchorPrompt, /full-body or three-quarter full-body cinematic scene anchor/i);
  assert.match(plan.sceneAnchorPrompt, /flowing ivory dress/i);
  assert.match(plan.sceneAnchorPrompt, /flower garden/i);
  assert.match(plan.sceneAnchorPrompt, /free of chair backs, furniture, studio backdrop, seated pose, tight portrait crop/i);
  assert.match(plan.promptGuidance, /Prioritize the user-requested outfit over reference clothing: flowing ivory dress/i);
  assert.match(plan.promptGuidance, /Build a new scene matching the requested environment, outfit, lighting, and cinematic mood/i);
  assert.match(plan.promptGuidance, /leaving source-photo furniture, seat-back shapes, studio framing, and seated posture out/i);

  const materializedPlan = await prepareKlingCreateReferencePlanForProvider({
    plan: buildKlingCreateReferencePlan({
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
    }),
    userId: 'unit-test-user',
    sceneAnchorGenerator: async (asset) => {
      assert.match(asset.prompt, /Create a new scene anchor still/i);
      assert.match(asset.prompt, /flowing ivory dress/i);
      assert.equal(asset.identityReferences.length, 4);
      assert.equal(asset.identityReferences[0].role, 'full_body');
      return { url: 'https://assets.example/generated/garden-scene-anchor.png', provider: 'unit_scene_anchor' };
    },
  });
  assert.ok(materializedPlan);
  assert.equal(materializedPlan.providerPrimaryReference.role, 'scene_anchor');
  assert.equal(materializedPlan.providerPrimaryReference.url, 'https://assets.example/generated/garden-scene-anchor.png');
  assert.equal(materializedPlan.providerAdditionalReferences.length, 4);
  assert.equal(materializedPlan.providerAdditionalReferences[0].role, 'full_body');
  assert.equal(materializedPlan.validationReferences.length, 5);
  assert.equal(materializedPlan.sceneAnchorProvider, 'unit_scene_anchor');
  assert.equal(materializedPlan.sceneAnchorGenerated, true);
  assert.equal(materializedPlan.sceneAnchorReason, 'scene_anchor_generated_and_validated');
  assert.equal(materializedPlan.sceneAnchorValidation?.passed, true);
  assert.equal(materializedPlan.sceneAnchorValidation?.fullBodyVisible, true);
  assert.equal(materializedPlan.sceneAnchorValidation?.outfitMatch, true);
  assert.equal(materializedPlan.frontOnlyFallback, false);
  assert.match(materializedPlan.promptGuidance, /use @Element1 as the primary scene-anchor composition input/i);
  assert.match(materializedPlan.promptGuidance, /@Element2, @Element3, @Element4, @Element5 as secondary identity support only/i);
  assert.doesNotMatch(materializedPlan.promptGuidance, /Use @Element1 as the full-figure identity/i);

  const unavailablePlan = await prepareKlingCreateReferencePlanForProvider({
    plan: buildKlingCreateReferencePlan({
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
    }),
    userId: 'unit-test-user',
  });
  assert.ok(unavailablePlan);
  assert.equal(unavailablePlan.plannedStrategy, 'scene_anchor_still');
  assert.equal(unavailablePlan.sceneAnchorGenerated, false);
  assert.equal(unavailablePlan.sceneAnchorReason, 'scene_anchor_provider_not_configured');
  assert.match(unavailablePlan.sceneAnchorFailureReason ?? '', /paused before using identity-only reference mode/i);
  assert.equal(unavailablePlan.sceneAnchorValidation?.passed, false);

  const diagnostics = klingReferenceDiagnostics({
    plan: materializedPlan,
    referenceStrategy: materializedPlan.plannedStrategy,
    exactLikenessRoute: 'kling_reference',
    providerRoute: 'replicate_kling_image_to_video',
  });
  assert.equal(diagnostics.exactRouteActive, true);
  assert.equal(diagnostics.referenceStrategy, 'scene_anchor_still');
  assert.equal(diagnostics.sceneAnchorStrategy, 'scene_anchor_still');
  assert.equal(diagnostics.sceneAnchorGenerated, true);
  assert.equal(diagnostics.primaryInputType, 'scene_anchor_still');
  assert.equal((diagnostics.sceneAnchorValidation as Record<string, unknown>).passed, true);
  assert.equal(diagnostics.userSpecifiedOutfit, true);
  assert.deepEqual(diagnostics.outfitTermsDetected, ['flowing ivory dress']);
  assert.ok((diagnostics.environmentTermsDetected as string[]).includes('flower garden'));
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
      referenceStrategy: materializedPlan.plannedStrategy,
      sceneAnchorStrategy: materializedPlan.sceneAnchorStrategy,
      sceneAnchorGenerated: materializedPlan.sceneAnchorGenerated,
      sceneAnchorProvider: materializedPlan.sceneAnchorProvider,
      sceneAnchorReason: materializedPlan.sceneAnchorReason,
      sceneAnchorValidation: materializedPlan.sceneAnchorValidation,
      primaryInputType: materializedPlan.primaryInputType,
      sceneIntent: materializedPlan.sceneIntent,
      framingIntent: materializedPlan.framingIntent,
      primaryReferenceRole: materializedPlan.primaryReferenceRole,
      supportingReferenceRoles: materializedPlan.supportingReferenceRoles,
      userSpecifiedOutfit: materializedPlan.userSpecifiedOutfit,
      outfitTermsDetected: materializedPlan.outfitTermsDetected,
      environmentTermsDetected: materializedPlan.environmentTermsDetected,
      referenceOutfitCarryoverSuppressed: materializedPlan.referenceOutfitCarryoverSuppressed,
      compositionCarryoverSuppressed: materializedPlan.compositionCarryoverSuppressed,
      frontOnlyFallback: materializedPlan.frontOnlyFallback,
      klingReferenceDiagnostics: diagnostics,
    }, 'unit-test');
    const payload = JSON.parse(storage.get('lumora_remix_project') ?? '{}') as Record<string, unknown>;
    assert.equal(payload.exactLikenessRoute, 'kling_reference');
    assert.equal(payload.referenceStrategy, 'scene_anchor_still');
    assert.equal(payload.sceneAnchorStrategy, 'scene_anchor_still');
    assert.equal(payload.primaryInputType, 'scene_anchor_still');
    assert.equal((payload.sceneAnchorValidation as Record<string, unknown>).passed, true);
    assert.equal(payload.compositionCarryoverSuppressed, true);
    assert.deepEqual(payload.outfitTermsDetected, ['flowing ivory dress']);
    assert.match(String(payload.prompt), /scene-anchor-first planning/i);
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
  if (typeof originalSceneAnchorEnv.REPLICATE_API_TOKEN === 'string') {
    process.env.REPLICATE_API_TOKEN = originalSceneAnchorEnv.REPLICATE_API_TOKEN;
  }
  if (typeof originalSceneAnchorEnv.REPLICATE_IMAGE_MODEL === 'string') {
    process.env.REPLICATE_IMAGE_MODEL = originalSceneAnchorEnv.REPLICATE_IMAGE_MODEL;
  }
  if (typeof originalSceneAnchorEnv.REPLICATE_SCENE_ANCHOR_MODEL === 'string') {
    process.env.REPLICATE_SCENE_ANCHOR_MODEL = originalSceneAnchorEnv.REPLICATE_SCENE_ANCHOR_MODEL;
  }
}

console.log('klingSceneAnchorPipeline unit tests passed');
