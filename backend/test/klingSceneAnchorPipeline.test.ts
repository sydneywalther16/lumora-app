import assert from 'node:assert/strict';
import {
  analyzeKlingSceneIntent,
  buildFalSceneAnchorPayload,
  buildKlingCreateReferencePlan,
  buildKlingSceneAnchorImageToVideoPayload,
  buildKlingVideoStageRequestInput,
  createFalSceneAnchorStill,
  detectKlingEnvironmentIntent,
  detectKlingOutfitIntent,
  klingReferenceDiagnostics,
  parseSceneAnchorImageOutput,
  planFalSceneAnchorReferences,
  prepareKlingCreateReferencePlanForProvider,
  sceneAnchorProviderStatus,
} from '../../api/lumora/generate-video';
import { prepareContinueStory } from '../../src/lib/continueStory';

const originalSceneAnchorEnv = {
  SCENE_ANCHOR_ENABLED: process.env.SCENE_ANCHOR_ENABLED,
  SCENE_ANCHOR_PROVIDER: process.env.SCENE_ANCHOR_PROVIDER,
  SCENE_ANCHOR_MODEL: process.env.SCENE_ANCHOR_MODEL,
  SCENE_ANCHOR_FALLBACK_MODE: process.env.SCENE_ANCHOR_FALLBACK_MODE,
  KLING_SCENE_ANCHOR_VIDEO_MODEL: process.env.KLING_SCENE_ANCHOR_VIDEO_MODEL,
  FAL_KEY: process.env.FAL_KEY,
  KLING_API_KEY: process.env.KLING_API_KEY,
};

delete process.env.SCENE_ANCHOR_ENABLED;
delete process.env.SCENE_ANCHOR_PROVIDER;
delete process.env.SCENE_ANCHOR_MODEL;
delete process.env.SCENE_ANCHOR_FALLBACK_MODE;
delete process.env.KLING_SCENE_ANCHOR_VIDEO_MODEL;
delete process.env.FAL_KEY;
delete process.env.KLING_API_KEY;

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
  assert.equal(plan.sceneAnchorProvider, 'fal');
  assert.equal(plan.sceneAnchorReason, 'scene_anchor_provider_disabled');
  assert.equal(plan.sceneAnchorFailureCategory, 'scene_anchor_provider_disabled');
  assert.equal(plan.sceneAnchorRequired, true);
  assert.equal(plan.sceneAnchorPersisted, false);
  assert.equal(plan.primaryReferenceRole, 'full_body');
  assert.equal(plan.providerPrimaryReference.role, 'scene_anchor');
  assert.equal(plan.providerPrimaryReference.url, 'https://assets.example/full-body-street-jeans.jpg');
  assert.equal(plan.primaryInputType, 'scene_anchor_still');
  assert.equal(plan.primaryVideoInputType, 'scene_anchor');
  assert.equal(plan.primaryVideoInputSource, 'scene_anchor');
  assert.equal(plan.identityReferencesPassedToVideoStage, false);
  assert.equal(plan.identityReferenceCount, 4);
  assert.equal(plan.identityReferenceMode, 'stage1_only');
  assert.equal(plan.startFrameSource, 'scene_anchor');
  assert.equal(plan.posterFrameSource, 'video_frame');
  assert.equal(plan.firstFrameSource, 'scene_anchor');
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

  process.env.FAL_KEY = 'fal-test-key';
  process.env.KLING_SCENE_ANCHOR_VIDEO_MODEL = 'fal-ai/kling-video/v2.1/master/image-to-video';
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
      return {
        url: 'https://assets.example/generated/garden-scene-anchor.png',
        provider: 'unit_scene_anchor',
        rawOutput: {
          payloadShape: {
            fieldNames: ['aspect_ratio', 'prompt', 'reference_image_urls'],
            referenceImageUrlCount: 3,
            privateUrlsRedacted: true,
          },
          referencePlan: {
            plannedReferenceCount: 4,
            submittedReferenceCount: 3,
            submittedReferenceRoles: ['front_angle', 'full_body', 'side_angle_left'],
            droppedReferenceRoles: ['side_angle_right'],
            providerReferenceLimit: 3,
            privateUrlsRedacted: true,
          },
          outputParsed: true,
        },
      };
    },
  });
  assert.ok(materializedPlan);
  assert.equal(materializedPlan.providerPrimaryReference.role, 'scene_anchor');
  assert.equal(materializedPlan.providerPrimaryReference.url, 'https://assets.example/generated/garden-scene-anchor.png');
  assert.equal(materializedPlan.providerAdditionalReferences.length, 0);
  assert.equal(materializedPlan.validationReferences.length, 1);
  assert.equal(materializedPlan.primaryVideoInputType, 'scene_anchor');
  assert.equal(materializedPlan.primaryVideoInputSource, 'scene_anchor');
  assert.equal(materializedPlan.identityReferencesPassedToVideoStage, false);
  assert.equal(materializedPlan.identityReferenceCount, 4);
  assert.equal(materializedPlan.identityReferenceMode, 'stage1_only');
  assert.equal(materializedPlan.startFrameSource, 'scene_anchor');
  assert.equal(materializedPlan.posterFrameSource, 'video_frame');
  assert.equal(materializedPlan.firstFrameSource, 'scene_anchor');
  assert.equal(materializedPlan.stage2ProviderModel, 'fal-ai/kling-video/v2.1/master/image-to-video');
  assert.equal(materializedPlan.stage2ProviderRouteType, 'image_to_video');
  assert.equal(materializedPlan.rawReferenceVisualInputsSentToStage2, false);
  assert.equal(materializedPlan.sceneAnchorProvider, 'unit_scene_anchor');
  assert.equal(materializedPlan.sceneAnchorGenerated, true);
  assert.equal(materializedPlan.sceneAnchorPersisted, true);
  assert.equal(materializedPlan.sceneAnchorFailureCategory, null);
  assert.equal(materializedPlan.sceneAnchorReason, 'scene_anchor_generated_and_validated');
  assert.equal(materializedPlan.sceneAnchorValidation?.passed, true);
  assert.equal(materializedPlan.sceneAnchorValidation?.fullBodyVisible, true);
  assert.equal(materializedPlan.sceneAnchorValidation?.outfitMatch, true);
  assert.equal(materializedPlan.frontOnlyFallback, false);
  assert.match(materializedPlan.promptGuidance, /animate this exact staged scene/i);
  assert.match(materializedPlan.promptGuidance, /Begin directly from the provided scene anchor/i);
  assert.match(materializedPlan.promptGuidance, /Do not transition from a portrait\/reference image/i);
  assert.doesNotMatch(materializedPlan.promptGuidance, /@Element2, @Element3, @Element4, @Element5 as secondary identity support/i);
  assert.doesNotMatch(materializedPlan.promptGuidance, /Use @Element1 as the full-figure identity/i);

  const videoStageInput = buildKlingVideoStageRequestInput({
    prompt: materializedPlan.promptGuidance,
    startImageUrl: materializedPlan.providerPrimaryReference.url,
    additionalReferences: materializedPlan.references.map((reference) => reference.url),
    identityReferencesPassedToVideoStage: materializedPlan.identityReferencesPassedToVideoStage,
  });
  assert.equal(videoStageInput.start_image, 'https://assets.example/generated/garden-scene-anchor.png');
  assert.equal('reference_images' in videoStageInput, false);

  const sceneAnchorI2vPayload = buildKlingSceneAnchorImageToVideoPayload({
    model: materializedPlan.stage2ProviderModel ?? '',
    prompt: materializedPlan.promptGuidance,
    sceneAnchorUrl: materializedPlan.providerPrimaryReference.url,
    duration: 5,
  });
  assert.deepEqual(Object.keys(sceneAnchorI2vPayload).sort(), ['duration', 'image_url', 'prompt']);
  assert.equal(sceneAnchorI2vPayload.image_url, 'https://assets.example/generated/garden-scene-anchor.png');
  assert.equal('reference_images' in sceneAnchorI2vPayload, false);
  assert.equal('image_urls' in sceneAnchorI2vPayload, false);
  assert.equal('elements' in sceneAnchorI2vPayload, false);
  assert.equal('start_image_url' in sceneAnchorI2vPayload, false);

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
  assert.equal(unavailablePlan.sceneAnchorReason, 'scene_anchor_provider_disabled');
  assert.equal(unavailablePlan.sceneAnchorFailureCategory, 'scene_anchor_provider_disabled');
  assert.match(unavailablePlan.sceneAnchorFailureReason ?? '', /Scene-anchor provider is not configured/i);
  assert.equal(unavailablePlan.sceneAnchorValidation?.passed, false);

  const failedSchemaPlan = await prepareKlingCreateReferencePlanForProvider({
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
    sceneAnchorGenerator: async () => {
      throw Object.assign(new Error('Provider rejected payload shape at [redacted-url].'), {
        failureCategory: 'scene_anchor_model_schema_unmapped',
        falHttpStatus: 422,
        falErrorType: 'validation_error',
        falErrorMessage: 'unknown field image_urls',
        sceneAnchorPayloadShapeSummary: {
          fieldNames: ['aspect_ratio', 'prompt', 'reference_image_urls'],
          referenceImageUrlCount: 3,
          privateUrlsRedacted: true,
        },
        sceneAnchorReferencePlan: {
          plannedReferenceCount: 4,
          submittedReferenceCount: 3,
          submittedReferenceRoles: ['front_angle', 'full_body', 'side_angle_left'],
          droppedReferenceRoles: ['side_angle_right'],
          providerReferenceLimit: 3,
          privateUrlsRedacted: true,
        },
      });
    },
  });
  assert.ok(failedSchemaPlan);
  assert.equal(failedSchemaPlan.sceneAnchorFailureCategory, 'scene_anchor_model_schema_unmapped');
  assert.equal(failedSchemaPlan.sceneAnchorHttpStatus, 422);
  assert.equal(failedSchemaPlan.sceneAnchorErrorType, 'validation_error');
  assert.match(failedSchemaPlan.sceneAnchorErrorMessage ?? '', /unknown field/);
  assert.deepEqual(failedSchemaPlan.sceneAnchorPayloadFieldNames, ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal(failedSchemaPlan.sceneAnchorSubmittedReferenceCount, 3);
  assert.deepEqual(failedSchemaPlan.sceneAnchorDroppedReferenceRoles, ['side_angle_right']);

  process.env.SCENE_ANCHOR_ENABLED = 'true';
  process.env.SCENE_ANCHOR_PROVIDER = 'fal';
  delete process.env.SCENE_ANCHOR_MODEL;
  process.env.FAL_KEY = 'fal-test-key';
  const missingModel = sceneAnchorProviderStatus();
  assert.equal(missingModel.sceneAnchorEnabled, true);
  assert.equal(missingModel.configured, false);
  assert.equal(missingModel.reason, 'scene_anchor_provider_not_configured');

  const viduPayload = buildFalSceneAnchorPayload({
    model: 'fal-ai/vidu/reference-to-image',
    prompt: 'Scene anchor prompt',
    identityReferences: materializedPlan.references,
  });
  assert.deepEqual(Object.keys(viduPayload).sort(), ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal((viduPayload.reference_image_urls as string[]).length, 3);
  assert.equal(JSON.stringify(viduPayload).includes('assets.example'), true);
  assert.equal('image_urls' in viduPayload, false);
  assert.equal('elements' in viduPayload, false);
  const viduReferencePlan = planFalSceneAnchorReferences({
    model: 'fal-ai/vidu/reference-to-image',
    identityReferences: materializedPlan.references,
  });
  assert.equal(viduReferencePlan.plannedReferenceCount, 4);
  assert.equal(viduReferencePlan.submittedReferenceCount, 3);
  assert.deepEqual(viduReferencePlan.submittedReferenceRoles, ['front_angle', 'full_body', 'side_angle_left']);
  assert.deepEqual(viduReferencePlan.droppedReferenceRoles, ['side_angle_right']);
  assert.equal(viduReferencePlan.providerReferenceLimit, 3);

  const parsedTopLevelImage = parseSceneAnchorImageOutput({
    image: {
      content_type: 'image/png',
      url: 'https://fal.example/output.png',
    },
  });
  assert.equal(parsedTopLevelImage?.url, 'https://fal.example/output.png');
  const parsedImagesArray = parseSceneAnchorImageOutput({
    output: {
      images: [
        {
          mime_type: 'image/png',
          url: 'https://fal.example/output-from-array',
        },
      ],
    },
  });
  assert.equal(parsedImagesArray?.url, 'https://fal.example/output-from-array');

  process.env.SCENE_ANCHOR_MODEL = 'fal-ai/vidu/reference-to-image';
  const submitBody = {
    request_id: 'scene-anchor-request-1',
    status_url: 'https://queue.fal.run/fal-ai/vidu/reference-to-image/requests/scene-anchor-request-1/status',
    response_url: 'https://queue.fal.run/fal-ai/vidu/reference-to-image/requests/scene-anchor-request-1/response',
  };
  let submitSeen = false;
  let persistedSeen = false;
  const falGenerated = await createFalSceneAnchorStill({
    prompt: 'Scene anchor prompt',
    identityReferences: materializedPlan.references,
    attempt: 1,
    userId: 'unit-test-user',
    sleepFn: async () => undefined,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        submitSeen = true;
        assert.equal(url, 'https://queue.fal.run/fal-ai/vidu/reference-to-image');
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        assert.ok(Array.isArray(body.reference_image_urls));
        assert.equal((body.reference_image_urls as unknown[]).length, 3);
        assert.equal('image_urls' in body, false);
        return new Response(JSON.stringify(submitBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'COMPLETED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/response')) {
        return new Response(JSON.stringify({
          image: {
            content_type: 'image/png',
            url: 'https://fal.example/scene-anchor.png',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://fal.example/scene-anchor.png') {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    uploader: async (asset) => {
      persistedSeen = true;
      assert.equal(asset.folder, 'kling-scene-anchors');
      assert.equal(asset.contentType, 'image/png');
      return { publicUrl: 'https://assets.example/persisted/scene-anchor.png' };
    },
  });
  assert.equal(submitSeen, true);
  assert.equal(persistedSeen, true);
  assert.equal(falGenerated.url, 'https://assets.example/persisted/scene-anchor.png');
  assert.equal(falGenerated.provider, 'fal');
  assert.equal(falGenerated.persisted, true);
  const falRawOutput = falGenerated.rawOutput as Record<string, unknown>;
  const falReferencePlan = falRawOutput.referencePlan as Record<string, unknown>;
  assert.equal(falReferencePlan.submittedReferenceCount, 3);
  assert.deepEqual(falReferencePlan.droppedReferenceRoles, ['side_angle_right']);

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
  assert.equal(diagnostics.sceneAnchorPersisted, true);
  assert.equal(diagnostics.sceneAnchorFailureCategory, null);
  assert.deepEqual(diagnostics.sceneAnchorPayloadFieldNames, ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal(diagnostics.sceneAnchorReferenceCount, 4);
  assert.equal(diagnostics.sceneAnchorSubmittedReferenceCount, 3);
  assert.deepEqual(diagnostics.sceneAnchorDroppedReferenceRoles, ['side_angle_right']);
  assert.equal(diagnostics.sceneAnchorProviderReferenceLimit, 3);
  assert.equal(diagnostics.sceneAnchorOutputParsed, true);
  assert.equal(diagnostics.primaryInputType, 'scene_anchor_still');
  assert.equal(diagnostics.primaryVideoInputType, 'scene_anchor');
  assert.equal(diagnostics.primaryVideoInputSource, 'scene_anchor');
  assert.equal(diagnostics.identityReferencesPassedToVideoStage, false);
  assert.equal(diagnostics.identityReferenceCount, 4);
  assert.equal(diagnostics.identityReferenceMode, 'stage1_only');
  assert.equal(diagnostics.startFrameSource, 'scene_anchor');
  assert.equal(diagnostics.posterFrameSource, 'video_frame');
  assert.equal(diagnostics.firstFrameSource, 'scene_anchor');
  assert.equal(diagnostics.stage2ProviderModel, 'fal-ai/kling-video/v2.1/master/image-to-video');
  assert.equal(diagnostics.stage2ProviderRouteType, 'image_to_video');
  assert.equal(diagnostics.rawReferenceVisualInputsSentToStage2, false);
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
      primaryVideoInputType: materializedPlan.primaryVideoInputType,
      primaryVideoInputSource: materializedPlan.primaryVideoInputSource,
      identityReferencesPassedToVideoStage: materializedPlan.identityReferencesPassedToVideoStage,
      identityReferenceCount: materializedPlan.identityReferenceCount,
      identityReferenceMode: materializedPlan.identityReferenceMode,
      startFrameSource: materializedPlan.startFrameSource,
      posterFrameSource: materializedPlan.posterFrameSource,
      firstFrameSource: materializedPlan.firstFrameSource,
      stage2ProviderModel: materializedPlan.stage2ProviderModel,
      stage2ProviderRouteType: materializedPlan.stage2ProviderRouteType,
      rawReferenceVisualInputsSentToStage2: materializedPlan.rawReferenceVisualInputsSentToStage2,
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
    assert.equal(payload.primaryVideoInputType, 'scene_anchor');
    assert.equal(payload.primaryVideoInputSource, 'scene_anchor');
    assert.equal(payload.identityReferencesPassedToVideoStage, false);
    assert.equal(payload.identityReferenceMode, 'stage1_only');
    assert.equal(payload.startFrameSource, 'scene_anchor');
    assert.equal(payload.stage2ProviderModel, 'fal-ai/kling-video/v2.1/master/image-to-video');
    assert.equal(payload.stage2ProviderRouteType, 'image_to_video');
    assert.equal(payload.rawReferenceVisualInputsSentToStage2, false);
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
  for (const [key, value] of Object.entries(originalSceneAnchorEnv)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

console.log('klingSceneAnchorPipeline unit tests passed');
