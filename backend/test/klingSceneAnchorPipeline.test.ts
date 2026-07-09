import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  persistSceneAnchorProviderImage,
  sceneAnchorAssetStorageMissingConfig,
  uploadSceneAnchorAsset,
} from '../../serverless/lumora/sceneAnchorAssetStorage';
import {
  analyzeKlingSceneIntent,
  buildFalSceneAnchorPayload,
  buildKlingCreateReferencePlan,
  buildKlingSceneAnchorImageToVideoPayload,
  buildKlingVideoStageRequestInput,
  buildKlingStage2RenderFailure,
  buildSceneAnchorRenderFailure,
  createFalSceneAnchorStill,
  detectKlingEnvironmentIntent,
  detectKlingOutfitIntent,
  FAL_VIDU_Q2_REFERENCE_TO_IMAGE_PROMPT_MAX,
  klingReferenceDiagnostics,
  parseSceneAnchorImageOutput,
  planFalSceneAnchorReferences,
  prepareFalSceneAnchorRequest,
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
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

delete process.env.SCENE_ANCHOR_ENABLED;
delete process.env.SCENE_ANCHOR_PROVIDER;
delete process.env.SCENE_ANCHOR_MODEL;
delete process.env.SCENE_ANCHOR_FALLBACK_MODE;
delete process.env.KLING_SCENE_ANCHOR_VIDEO_MODEL;
delete process.env.FAL_KEY;
delete process.env.KLING_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

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
          promptDiagnostics: {
            sceneAnchorPromptLength: asset.prompt.length,
            sceneAnchorPromptLimit: 1200,
            sceneAnchorPromptCompressed: false,
            sceneAnchorPromptTruncated: false,
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
  assert.equal(materializedPlan.sceneAnchorPromptLimit, 1200);
  assert.equal(materializedPlan.sceneAnchorPromptCompressed, false);
  assert.equal(materializedPlan.sceneAnchorPromptTruncated, false);
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
  assert.equal(sceneAnchorI2vPayload.duration, '5');
  assert.equal('reference_images' in sceneAnchorI2vPayload, false);
  assert.equal('image_urls' in sceneAnchorI2vPayload, false);
  assert.equal('elements' in sceneAnchorI2vPayload, false);
  assert.equal('start_image_url' in sceneAnchorI2vPayload, false);

  const sceneAnchorI2vLongPayload = buildKlingSceneAnchorImageToVideoPayload({
    model: materializedPlan.stage2ProviderModel ?? '',
    prompt: materializedPlan.promptGuidance,
    sceneAnchorUrl: materializedPlan.providerPrimaryReference.url,
    duration: 8,
  });
  assert.equal(sceneAnchorI2vLongPayload.duration, '10');

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
        failureCategory: 'scene_anchor_input_schema',
        falHttpStatus: 422,
        falErrorType: 'validation_error',
        falErrorMessage: 'unknown field image_urls',
        sceneAnchorPayloadShapeSummary: {
          fieldNames: ['aspect_ratio', 'prompt', 'reference_image_urls'],
          referenceImageUrlCount: 3,
          privateUrlsRedacted: true,
        },
        sceneAnchorPromptDiagnostics: {
          sceneAnchorPromptLength: 1510,
          sceneAnchorPromptLimit: 1200,
          sceneAnchorPromptCompressed: true,
          sceneAnchorPromptTruncated: true,
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
  assert.equal(failedSchemaPlan.sceneAnchorFailureCategory, 'scene_anchor_input_schema');
  assert.equal(failedSchemaPlan.sceneAnchorHttpStatus, 422);
  assert.equal(failedSchemaPlan.sceneAnchorErrorType, 'validation_error');
  assert.match(failedSchemaPlan.sceneAnchorErrorMessage ?? '', /unknown field/);
  assert.equal(failedSchemaPlan.sceneAnchorPromptLength, 1510);
  assert.equal(failedSchemaPlan.sceneAnchorPromptLimit, 1200);
  assert.equal(failedSchemaPlan.sceneAnchorPromptCompressed, true);
  assert.equal(failedSchemaPlan.sceneAnchorPromptTruncated, true);
  assert.deepEqual(failedSchemaPlan.sceneAnchorPayloadFieldNames, ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal(failedSchemaPlan.sceneAnchorSubmittedReferenceCount, 3);
  assert.deepEqual(failedSchemaPlan.sceneAnchorDroppedReferenceRoles, ['side_angle_right']);
  const schemaRenderFailure = buildSceneAnchorRenderFailure({
    plan: failedSchemaPlan,
    category: 'scene_anchor_input_schema',
  });
  assert.equal(schemaRenderFailure.route, 'kling_reference');
  assert.equal(schemaRenderFailure.provider, 'kling');
  assert.equal(schemaRenderFailure.stage, 'scene_anchor');
  assert.equal(schemaRenderFailure.category, 'scene_anchor_input_schema');
  assert.match(schemaRenderFailure.safeTitle, /payload shape/i);
  assert.equal(schemaRenderFailure.sceneAnchorHttpStatus, 422);
  assert.equal(schemaRenderFailure.sceneAnchorPromptLength, 1510);
  assert.equal(schemaRenderFailure.sceneAnchorPromptLimit, 1200);
  assert.equal(schemaRenderFailure.sceneAnchorPromptCompressed, true);
  assert.equal(schemaRenderFailure.sceneAnchorPromptTruncated, true);
  assert.deepEqual(schemaRenderFailure.sceneAnchorPayloadFieldNames, ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal(schemaRenderFailure.sceneAnchorSubmittedReferenceCount, 3);
  assert.deepEqual(schemaRenderFailure.sceneAnchorDroppedReferenceRoles, ['side_angle_right']);
  assert.equal(schemaRenderFailure.privateUrlsRedacted, true);
  assert.equal(schemaRenderFailure.secretsRedacted, true);

  const promptTooLongRenderFailure = buildSceneAnchorRenderFailure({
    plan: {
      ...failedSchemaPlan,
      sceneAnchorErrorMessage: 'body.prompt string_too_long: prompt must be at most 1500 characters https://assets.example/private.png',
      sceneAnchorPromptLength: 1510,
      sceneAnchorPromptLimit: 1200,
      sceneAnchorPromptCompressed: true,
      sceneAnchorPromptTruncated: true,
    },
    category: 'scene_anchor_input_schema',
  });
  assert.match(promptTooLongRenderFailure.safeTitle, /prompt exceeded/i);
  assert.match(promptTooLongRenderFailure.safeMessage, /prompt length/i);
  assert.match(promptTooLongRenderFailure.recommendedNextAction, /prompt length/i);
  assert.equal(promptTooLongRenderFailure.sceneAnchorPromptLength, 1510);
  assert.equal(promptTooLongRenderFailure.sceneAnchorPromptLimit, 1200);
  assert.match(promptTooLongRenderFailure.sceneAnchorErrorMessageRedacted ?? '', /\[redacted-url\]/);
  assert.doesNotMatch(JSON.stringify(promptTooLongRenderFailure), /https:\/\/assets\.example\/private/);

  process.env.SCENE_ANCHOR_ENABLED = 'true';
  process.env.SCENE_ANCHOR_PROVIDER = 'fal';
  process.env.SCENE_ANCHOR_MODEL = 'fal-ai/vidu/q2/reference-to-image';
  const assetPersistRenderFailure = buildSceneAnchorRenderFailure({
    plan: {
      ...materializedPlan,
      sceneAnchorGenerated: false,
      sceneAnchorFailureCategory: 'scene_anchor_asset_persist',
      sceneAnchorPersisted: false,
      sceneAnchorOutputParsed: true,
      sceneAnchorErrorMessage: 'Scene anchor was generated, but Lumora could not persist it for Kling. Missing config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. https://provider.example/private.png?token=secret',
      assetPersistErrorType: 'scene_anchor_storage_config_missing',
      assetPersistErrorMessageRedacted: 'Scene anchor was generated, but Lumora could not persist it for Kling. Missing config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. [redacted-url]',
      assetPersistMissingConfig: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
    category: 'scene_anchor_asset_persist',
  });
  assert.equal(assetPersistRenderFailure.stage, 'persist_asset');
  assert.equal(assetPersistRenderFailure.category, 'scene_anchor_asset_persist');
  assert.equal(assetPersistRenderFailure.safeTitle, 'Scene anchor could not be saved for animation.');
  assert.equal(assetPersistRenderFailure.safeMessage, 'The scene anchor was generated, but the Create runtime is missing Supabase storage configuration.');
  assert.equal(assetPersistRenderFailure.recommendedNextAction, 'Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel, redeploy, then retry.');
  assert.equal(assetPersistRenderFailure.sceneAnchorProvider, materializedPlan.sceneAnchorProvider);
  assert.equal(assetPersistRenderFailure.sceneAnchorModel, 'fal-ai/vidu/q2/reference-to-image');
  assert.equal(assetPersistRenderFailure.sceneAnchorOutputParsed, true);
  assert.equal(assetPersistRenderFailure.sceneAnchorPersisted, false);
  assert.equal(assetPersistRenderFailure.assetPersistErrorType, 'scene_anchor_storage_config_missing');
  assert.deepEqual(assetPersistRenderFailure.missingConfig, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  assert.match(assetPersistRenderFailure.assetPersistErrorMessageRedacted ?? '', /SUPABASE_URL/);
  assert.equal(assetPersistRenderFailure.privateUrlsRedacted, true);
  assert.equal(assetPersistRenderFailure.secretsRedacted, true);
  assert.doesNotMatch(JSON.stringify(assetPersistRenderFailure), /provider\.example\/private|token=secret/);

  const preparedAssetPersistFailurePlan = await prepareKlingCreateReferencePlanForProvider({
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
      throw Object.assign(
        new Error('Scene anchor was generated, but Lumora could not persist it for Kling. https://provider.example/private.png?token=secret Bearer service-role-secret-value-should-not-leak'),
        {
          failureCategory: 'scene_anchor_asset_persist',
          sceneAnchorOutputParsed: true,
          assetPersistErrorType: 'scene_anchor_storage_upload_failed',
          assetPersistErrorMessageRedacted: 'Scene anchor was generated, but Lumora could not persist it for Kling. [redacted-url] [redacted-auth]',
          missingConfig: [],
          sceneAnchorPayloadShapeSummary: {
            fieldNames: ['aspect_ratio', 'prompt', 'reference_image_urls'],
            referenceImageUrlCount: 3,
            privateUrlsRedacted: true,
          },
          sceneAnchorPromptDiagnostics: {
            sceneAnchorPromptLength: 900,
            sceneAnchorPromptLimit: 1200,
            sceneAnchorPromptCompressed: false,
            sceneAnchorPromptTruncated: false,
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
          privateUrlsRedacted: true,
          secretsRedacted: true,
        },
      );
    },
  });
  assert.ok(preparedAssetPersistFailurePlan);
  assert.equal(preparedAssetPersistFailurePlan.sceneAnchorGenerated, false);
  assert.equal(preparedAssetPersistFailurePlan.sceneAnchorFailureCategory, 'scene_anchor_asset_persist');
  assert.equal(preparedAssetPersistFailurePlan.sceneAnchorReason, 'scene_anchor_asset_persist');
  assert.equal(preparedAssetPersistFailurePlan.sceneAnchorOutputParsed, true);
  assert.equal(preparedAssetPersistFailurePlan.sceneAnchorPersisted, false);
  assert.equal(preparedAssetPersistFailurePlan.assetPersistErrorType, 'scene_anchor_storage_upload_failed');
  assert.equal(preparedAssetPersistFailurePlan.assetPersistMissingConfig, null);
  assert.doesNotMatch(JSON.stringify(preparedAssetPersistFailurePlan), /provider\.example\/private|token=secret|service-role-secret-value-should-not-leak/);
  const preparedAssetPersistFailure = buildSceneAnchorRenderFailure({
    plan: preparedAssetPersistFailurePlan,
    category: 'scene_anchor_asset_persist',
  });
  assert.equal(preparedAssetPersistFailure.stage, 'persist_asset');
  assert.equal(preparedAssetPersistFailure.category, 'scene_anchor_asset_persist');
  assert.equal(preparedAssetPersistFailure.safeTitle, 'Scene anchor could not be saved for animation.');
  assert.equal(preparedAssetPersistFailure.safeMessage, 'Lumora could not save the scene anchor for Kling. Save this draft or try the identity-only fallback.');
  assert.equal(preparedAssetPersistFailure.sceneAnchorOutputParsed, true);
  assert.equal(preparedAssetPersistFailure.sceneAnchorPersisted, false);
  assert.equal(preparedAssetPersistFailure.assetPersistErrorType, 'scene_anchor_storage_upload_failed');
  assert.equal(preparedAssetPersistFailure.missingConfig, null);
  assert.match(preparedAssetPersistFailure.recommendedNextAction, /Vercel-safe asset persistence/i);
  assert.doesNotMatch(JSON.stringify(preparedAssetPersistFailure), /provider\.example\/private|token=secret|service-role-secret-value-should-not-leak/);

  const preparedAdapterLoadFailurePlan = await prepareKlingCreateReferencePlanForProvider({
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
      throw Object.assign(
        new Error('Asset storage adapter could not be loaded from https://provider.example/private.png?token=secret with Bearer service-role-secret-value-should-not-leak'),
        {
          failureCategory: 'scene_anchor_asset_persist',
          sceneAnchorOutputParsed: true,
          assetPersistErrorType: 'scene_anchor_storage_adapter_load_failed',
          assetPersistErrorMessageRedacted: 'Asset storage adapter could not be loaded from [redacted-url] with [redacted-auth]',
          missingConfig: [],
          privateUrlsRedacted: true,
          secretsRedacted: true,
        },
      );
    },
  });
  assert.ok(preparedAdapterLoadFailurePlan);
  assert.equal(preparedAdapterLoadFailurePlan.sceneAnchorFailureCategory, 'scene_anchor_asset_persist');
  assert.equal(preparedAdapterLoadFailurePlan.sceneAnchorPersisted, false);
  assert.equal(preparedAdapterLoadFailurePlan.sceneAnchorOutputParsed, true);
  assert.equal(preparedAdapterLoadFailurePlan.assetPersistErrorType, 'scene_anchor_storage_adapter_load_failed');
  const preparedAdapterLoadFailure = buildSceneAnchorRenderFailure({
    plan: preparedAdapterLoadFailurePlan,
    category: 'scene_anchor_asset_persist',
  });
  assert.equal(preparedAdapterLoadFailure.stage, 'persist_asset');
  assert.equal(preparedAdapterLoadFailure.category, 'scene_anchor_asset_persist');
  assert.equal(preparedAdapterLoadFailure.assetPersistErrorType, 'scene_anchor_storage_adapter_load_failed');
  assert.match(preparedAdapterLoadFailure.recommendedNextAction, /Vercel-safe asset persistence/i);
  assert.doesNotMatch(JSON.stringify(preparedAdapterLoadFailure), /provider\.example\/private|token=secret|service-role-secret-value-should-not-leak/);

  const outputParseFailurePlan = {
    ...failedSchemaPlan,
    sceneAnchorFailureCategory: 'scene_anchor_output_parse_failed' as const,
    sceneAnchorErrorMessage: 'response contained image object but no readable URL',
    sceneAnchorOutputParsed: false,
  };
  const outputParseRenderFailure = buildSceneAnchorRenderFailure({
    plan: outputParseFailurePlan,
    category: 'scene_anchor_output_parse_failed',
  });
  assert.equal(outputParseRenderFailure.stage, 'parse_output');
  assert.equal(outputParseRenderFailure.category, 'scene_anchor_output_parse_failed');
  assert.match(outputParseRenderFailure.safeMessage, /could not read the image output/i);
  assert.equal(outputParseRenderFailure.sceneAnchorOutputParsed, false);

  const stage2SchemaFailure = buildKlingStage2RenderFailure({
    plan: materializedPlan,
    error: Object.assign(new Error('invalid input: unknown field reference_images https://assets.example/private.png'), {
      failureCategory: 'scene_anchor_input_schema',
      falHttpStatus: 422,
      falErrorType: 'validation_error',
      falErrorMessage: 'invalid field reference_images https://assets.example/private.png',
    }),
  });
  assert.equal(stage2SchemaFailure.stage, 'kling_image_to_video');
  assert.equal(stage2SchemaFailure.category, 'kling_scene_anchor_video_input_schema');
  assert.equal(stage2SchemaFailure.safeTitle, 'Kling could not start from the scene anchor.');
  assert.equal(
    stage2SchemaFailure.safeMessage,
    'Kling could not start from the scene anchor. Save this draft or try the identity-only fallback.',
  );
  assert.equal(stage2SchemaFailure.stage2HttpStatus, 422);
  assert.match(stage2SchemaFailure.stage2ErrorMessageRedacted ?? '', /\[redacted-url\]/);
  assert.doesNotMatch(JSON.stringify(stage2SchemaFailure), /https:\/\/assets\.example\/private/);

  process.env.SCENE_ANCHOR_ENABLED = 'true';
  process.env.SCENE_ANCHOR_PROVIDER = 'fal';
  delete process.env.SCENE_ANCHOR_MODEL;
  process.env.FAL_KEY = 'fal-test-key';
  const missingModel = sceneAnchorProviderStatus();
  assert.equal(missingModel.sceneAnchorEnabled, true);
  assert.equal(missingModel.configured, false);
  assert.equal(missingModel.reason, 'scene_anchor_provider_not_configured');

  const generateSource = readFileSync('api/lumora/generate-video.ts', 'utf8');
  assert.match(generateSource, /sceneAnchorAssetStorage/);
  assert.match(generateSource, /import\(['"]\.\.\/\.\.\/serverless\/lumora\/sceneAnchorAssetStorage\.js['"]\)/);
  assert.doesNotMatch(generateSource, /backend\/src\/services\/storageService|backend\\\\src\\\\services\\\\storageService/);
  assert.doesNotMatch(generateSource, /import\(['"]\.\.\/\.\.\/backend\/src\/services\/storageService['"]\)/);

  assert.deepEqual(sceneAnchorAssetStorageMissingConfig({} as NodeJS.ProcessEnv), [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  await assert.rejects(
    () => uploadSceneAnchorAsset({
      userId: 'unit-test-user',
      fileName: 'missing-env.png',
      contentType: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
      envSource: {} as NodeJS.ProcessEnv,
    }),
    (error) => {
      const record = error as Record<string, unknown>;
      assert.equal(record.failureCategory, 'scene_anchor_asset_persist');
      assert.equal(record.assetPersistErrorType, 'scene_anchor_storage_config_missing');
      assert.deepEqual(record.missingConfig, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
      assert.match(String(record.assetPersistErrorMessageRedacted), /SUPABASE_URL/);
      assert.doesNotMatch(JSON.stringify(record), /service-role-secret|provider\.example\/private/);
      return true;
    },
  );

  let missingEnvProviderDownloadAttempted = false;
  await assert.rejects(
    () => persistSceneAnchorProviderImage({
      userId: 'unit-test-user',
      imageUrl: 'https://provider.example/private-missing-env.png?token=secret',
      envSource: {} as NodeJS.ProcessEnv,
      fetchImpl: async () => {
        missingEnvProviderDownloadAttempted = true;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      },
    }),
    (error) => {
      const record = error as Record<string, unknown>;
      const serialized = JSON.stringify(record);
      assert.equal(record.failureCategory, 'scene_anchor_asset_persist');
      assert.equal(record.assetPersistErrorType, 'scene_anchor_storage_config_missing');
      assert.deepEqual(record.missingConfig, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
      assert.match(String(record.assetPersistErrorMessageRedacted), /Create runtime is missing Supabase storage configuration/i);
      assert.doesNotMatch(serialized, /provider\.example\/private-missing-env|token=secret/);
      return true;
    },
  );
  assert.equal(missingEnvProviderDownloadAttempted, false);

  await assert.rejects(
    () => uploadSceneAnchorAsset({
      userId: 'unit-test-user',
      fileName: 'module-load.png',
      contentType: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
      envSource: {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value-should-not-leak',
      } as NodeJS.ProcessEnv,
      supabaseModuleLoader: async () => {
        throw new Error('Cannot find module @supabase/supabase-js for https://provider.example/private.png?token=secret with Bearer service-role-secret-value-should-not-leak');
      },
    }),
    (error) => {
      const record = error as Record<string, unknown>;
      const serialized = JSON.stringify(record);
      assert.equal(record.failureCategory, 'scene_anchor_asset_persist');
      assert.equal(record.assetPersistErrorType, 'scene_anchor_supabase_module_load_failed');
      assert.deepEqual(record.missingConfig, []);
      assert.match(String(record.assetPersistErrorMessageRedacted), /\[redacted-url\]/);
      assert.match(String(record.assetPersistErrorMessageRedacted), /\[redacted-auth\]/);
      assert.doesNotMatch(serialized, /provider\.example\/private|token=secret|service-role-secret-value-should-not-leak/);
      return true;
    },
  );

  const uploadCalls: Array<{
    bucket: string;
    objectPath: string;
    size: number;
    contentType: string;
  }> = [];
  const signedUrlCalls: string[] = [];
  const publicUrlCalls: string[] = [];
  const mockedStorageClient = {
    storage: {
      from(bucket: string) {
        return {
          upload: async (objectPath: string, body: unknown, options: { contentType?: string }) => {
            uploadCalls.push({
              bucket,
              objectPath,
              size: Buffer.isBuffer(body) ? body.length : 0,
              contentType: options.contentType ?? '',
            });
            return { error: null };
          },
          getPublicUrl: (objectPath: string) => {
            publicUrlCalls.push(objectPath);
            return {
              data: {
                publicUrl: `https://demo.supabase.co/storage/v1/object/public/${bucket}/${objectPath}`,
              },
            };
          },
          createSignedUrl: async (objectPath: string) => {
            signedUrlCalls.push(objectPath);
            return {
              data: {
                signedUrl: `https://demo.supabase.co/storage/v1/object/sign/${bucket}/${objectPath}?signature=storage-test-signature`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
  const persistedSceneAnchor = await persistSceneAnchorProviderImage({
    userId: 'unit-test-user',
    imageUrl: 'https://provider.example/private-scene-anchor.png?token=secret',
    storageClient: mockedStorageClient as never,
    fetchImpl: async (input) => {
      assert.equal(String(input), 'https://provider.example/private-scene-anchor.png?token=secret');
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
  });
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].bucket, 'lumora-assets');
  assert.equal(uploadCalls[0].contentType, 'image/png');
  assert.equal(uploadCalls[0].size, 4);
  assert.match(uploadCalls[0].objectPath, /unit-test-user\/kling-scene-anchors\/.+kling-scene-anchor\.png/);
  assert.deepEqual(signedUrlCalls, [uploadCalls[0].objectPath]);
  assert.deepEqual(publicUrlCalls, []);
  assert.match(persistedSceneAnchor.url, /^https:\/\/demo\.supabase\.co\/storage\/v1\/object\/sign\/lumora-assets\//);
  assert.match(persistedSceneAnchor.url, /signature=storage-test-signature/);
  assert.equal(persistedSceneAnchor.privateUrlsRedacted, true);
  assert.doesNotMatch(JSON.stringify(persistedSceneAnchor), /provider\.example\/private-scene-anchor|token=secret/);

  const failedUploadStorageClient = {
    storage: {
      from(bucket: string) {
        return {
          upload: async () => ({
            error: Object.assign(
              new Error('upload failed for https://provider.example/private-upload.png?token=secret with Bearer service-role-secret-value-should-not-leak'),
              { name: 'StorageApiError' },
            ),
          }),
          getPublicUrl: () => ({
            data: {
              publicUrl: `https://demo.supabase.co/storage/v1/object/public/${bucket}/unused.png`,
            },
          }),
          createSignedUrl: async () => ({
            data: null,
            error: null,
          }),
        };
      },
    },
  };
  await assert.rejects(
    () => persistSceneAnchorProviderImage({
      userId: 'unit-test-user',
      imageUrl: 'https://provider.example/private-upload.png?token=secret',
      storageClient: failedUploadStorageClient as never,
      fetchImpl: async () => new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    }),
    (error) => {
      const record = error as Record<string, unknown>;
      const serialized = JSON.stringify(record);
      assert.equal(record.failureCategory, 'scene_anchor_asset_persist');
      assert.equal(record.assetPersistErrorType, 'StorageApiError');
      assert.match(String(record.assetPersistErrorMessageRedacted), /upload failed/i);
      assert.match(String(record.assetPersistErrorMessageRedacted), /\[redacted-url\]/);
      assert.match(String(record.assetPersistErrorMessageRedacted), /\[redacted-auth\]/);
      assert.doesNotMatch(serialized, /provider\.example\/private-upload|token=secret|service-role-secret-value-should-not-leak/);
      return true;
    },
  );

  await assert.rejects(
    () => persistSceneAnchorProviderImage({
      userId: 'unit-test-user',
      imageUrl: 'https://provider.example/private-fail.png?token=secret',
      storageClient: mockedStorageClient as never,
      fetchImpl: async () => {
        throw new Error('download failed for https://provider.example/private-fail.png?token=secret with Bearer service-role-secret');
      },
    }),
    (error) => {
      const serialized = JSON.stringify(error);
      assert.equal((error as Record<string, unknown>).failureCategory, 'scene_anchor_asset_download_failed');
      assert.doesNotMatch(serialized, /provider\.example\/private-fail|token=secret|service-role-secret/);
      assert.match(serialized, /\[redacted-url\]/);
      assert.match(serialized, /\[redacted-auth\]/);
      return true;
    },
  );

  process.env.SCENE_ANCHOR_MODEL = 'fal-ai/vidu/q2/reference-to-image';
  const longGardenPrompt = [
    gardenDressPrompt,
    Array.from({ length: 60 }, (_, index) =>
      `Scene detail ${index + 1}: peaceful flower garden paths, open grass, warm light, drifting petals, relaxed natural walking posture, flowing ivory dress.`
    ).join(' '),
  ].join(' ');
  const viduPlan = buildKlingCreateReferencePlan({
    body: {
      prompt: longGardenPrompt,
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
  assert.ok(viduPlan);
  assert.ok(viduPlan.sceneAnchorPrompt.length < FAL_VIDU_Q2_REFERENCE_TO_IMAGE_PROMPT_MAX);
  assert.match(viduPlan.sceneAnchorPrompt, /Use references for identity only/i);
  assert.match(viduPlan.sceneAnchorPrompt, /flowing ivory dress/i);
  assert.match(viduPlan.sceneAnchorPrompt, /flower garden/i);
  assert.doesNotMatch(viduPlan.sceneAnchorPrompt, /Scene request:\s*Scene prompt/i);
  assert.doesNotMatch(viduPlan.sceneAnchorPrompt, /Create a new scene anchor/i);

  const viduPayload = buildFalSceneAnchorPayload({
    model: 'fal-ai/vidu/q2/reference-to-image',
    prompt: 'Scene anchor prompt',
    identityReferences: materializedPlan.references,
  });
  assert.deepEqual(Object.keys(viduPayload).sort(), ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.equal((viduPayload.reference_image_urls as string[]).length, 3);
  assert.equal(JSON.stringify(viduPayload).includes('assets.example'), true);
  assert.equal('image_urls' in viduPayload, false);
  assert.equal('elements' in viduPayload, false);
  const viduReferencePlan = planFalSceneAnchorReferences({
    model: 'fal-ai/vidu/q2/reference-to-image',
    identityReferences: materializedPlan.references,
  });
  assert.equal(viduReferencePlan.plannedReferenceCount, 4);
  assert.equal(viduReferencePlan.submittedReferenceCount, 3);
  assert.deepEqual(viduReferencePlan.submittedReferenceRoles, ['front_angle', 'full_body', 'side_angle_left']);
  assert.deepEqual(viduReferencePlan.droppedReferenceRoles, ['side_angle_right']);
  assert.equal(viduReferencePlan.providerReferenceLimit, 3);

  const overlongSceneAnchorPrompt = [
    'Create a new scene anchor still for a Kling exact-likeness video render.',
    `Scene request:${' '}Scene prompt: Peaceful flower garden at golden hour wearing a flowing ivory dress.`,
    Array.from({ length: 120 }, (_, index) =>
      `Long scene note ${index + 1}: visible flowers, open grass, warm sunset light, relaxed walking pose, clean unobstructed silhouette, identity references only.`
    ).join(' '),
    'Use the saved self-character references only for identity traits: face identity, hair color and style, skin tone, eye area, body proportions, and silhouette.',
  ].join(' ');
  const preparedLongViduRequest = prepareFalSceneAnchorRequest({
    model: 'fal-ai/vidu/q2/reference-to-image',
    prompt: overlongSceneAnchorPrompt,
    identityReferences: materializedPlan.references,
  });
  const preparedLongViduPayload = preparedLongViduRequest.payload as Record<string, unknown>;
  const preparedLongViduPrompt = String(preparedLongViduPayload.prompt ?? '');
  assert.deepEqual(Object.keys(preparedLongViduPayload).sort(), ['aspect_ratio', 'prompt', 'reference_image_urls']);
  assert.ok(preparedLongViduPrompt.length <= FAL_VIDU_Q2_REFERENCE_TO_IMAGE_PROMPT_MAX);
  assert.ok(preparedLongViduPrompt.length <= (preparedLongViduRequest.promptDiagnostics.sceneAnchorPromptLimit ?? FAL_VIDU_Q2_REFERENCE_TO_IMAGE_PROMPT_MAX));
  assert.equal(preparedLongViduRequest.promptDiagnostics.sceneAnchorPromptCompressed, true);
  assert.equal(preparedLongViduRequest.promptDiagnostics.privateUrlsRedacted, true);
  assert.equal(preparedLongViduRequest.referencePlan.submittedReferenceCount, 3);
  assert.doesNotMatch(preparedLongViduPrompt, /Scene request:\s*Scene prompt/i);
  assert.doesNotMatch(preparedLongViduPrompt, /Create a new scene anchor/i);

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

  process.env.SCENE_ANCHOR_MODEL = 'fal-ai/vidu/q2/reference-to-image';
  const submitBody = {
    request_id: 'scene-anchor-request-1',
    status_url: 'https://queue.fal.run/fal-ai/vidu/q2/reference-to-image/requests/scene-anchor-request-1/status',
    response_url: 'https://queue.fal.run/fal-ai/vidu/q2/reference-to-image/requests/scene-anchor-request-1/response',
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
        assert.equal(url, 'https://queue.fal.run/fal-ai/vidu/q2/reference-to-image');
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body).sort(), ['aspect_ratio', 'prompt', 'reference_image_urls']);
        assert.ok(String(body.prompt ?? '').length <= FAL_VIDU_Q2_REFERENCE_TO_IMAGE_PROMPT_MAX);
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
  const falPromptDiagnostics = falRawOutput.promptDiagnostics as Record<string, unknown>;
  assert.equal(falPromptDiagnostics.sceneAnchorPromptLength, 'Scene anchor prompt'.length);
  assert.equal(falPromptDiagnostics.sceneAnchorPromptLimit, 1200);
  assert.equal(falPromptDiagnostics.sceneAnchorPromptCompressed, false);
  assert.equal(falPromptDiagnostics.sceneAnchorPromptTruncated, false);
  assert.equal(falPromptDiagnostics.privateUrlsRedacted, true);
  const falReferencePlan = falRawOutput.referencePlan as Record<string, unknown>;
  assert.equal(falReferencePlan.submittedReferenceCount, 3);
  assert.deepEqual(falReferencePlan.droppedReferenceRoles, ['side_angle_right']);

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let missingStorageSubmitSeen = false;
  let missingStorageImageDownloadSeen = false;
  await assert.rejects(
    () => createFalSceneAnchorStill({
      prompt: 'Scene anchor prompt',
      identityReferences: materializedPlan.references,
      attempt: 1,
      userId: 'unit-test-user',
      sleepFn: async () => undefined,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (init?.method === 'POST') {
          missingStorageSubmitSeen = true;
          return new Response(JSON.stringify({
            request_id: 'scene-anchor-request-missing-storage',
            status_url: 'https://queue.fal.run/fal-ai/vidu/q2/reference-to-image/requests/scene-anchor-request-missing-storage/status',
            response_url: 'https://queue.fal.run/fal-ai/vidu/q2/reference-to-image/requests/scene-anchor-request-missing-storage/response',
          }), {
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
              url: 'https://fal.example/missing-storage-scene-anchor.png?token=secret',
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.startsWith('https://fal.example/missing-storage-scene-anchor.png')) {
          missingStorageImageDownloadSeen = true;
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    }),
    (error) => {
      const record = error as Record<string, unknown>;
      const serialized = JSON.stringify(record);
      assert.equal(record.failureCategory, 'scene_anchor_asset_persist');
      assert.equal(record.sceneAnchorOutputParsed, true);
      assert.equal(record.assetPersistErrorType, 'scene_anchor_storage_config_missing');
      assert.deepEqual(record.missingConfig, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
      assert.match(String(record.assetPersistErrorMessageRedacted), /Create runtime is missing Supabase storage configuration/i);
      assert.doesNotMatch(serialized, /missing-storage-scene-anchor\.png\?token=secret|service-role-secret-value-should-not-leak/);
      return true;
    },
  );
  assert.equal(missingStorageSubmitSeen, true);
  assert.equal(missingStorageImageDownloadSeen, false);

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
  assert.equal(diagnostics.sceneAnchorPromptLimit, 1200);
  assert.equal(diagnostics.sceneAnchorPromptCompressed, false);
  assert.equal(diagnostics.sceneAnchorPromptTruncated, false);
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
