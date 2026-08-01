import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CreativeBrainScenePlan } from '../src/services/creativeBrain';
import {
  assertPaidOperationAuthorized,
  buildDirectorAssemblyPlan,
  buildNanoBananaPayload,
  buildOmniFlashPayload,
  buildOmniRepairPayload,
  buildDirectorInternalDiagnostics,
  buildDirectorProductionDryRun,
  canOfferExplicitRepair,
  createDirectorCostTelemetry,
  DEFAULT_DIRECTOR_BUDGET,
  DIRECTOR_PROGRESS_STATES,
  directorPlanFromCreativeBrain,
  evaluateDirectorQualityLocally,
  extractDirectorMediaOutput,
  isProviderNeutralProgressState,
  prepareDirectorDryRun,
  prepareAuthorizedOmniRepair,
  pollDirectorMediaFile,
  recordPaidRequest,
  seedancePersonalReferenceRouteAllowed,
  selectDirectorRoute,
} from '../src/services/director/pipeline';
import { decideAutoStage } from '../../src/lib/aiCastExperience';
import {
  DIRECTOR_PROGRESS_STATES as UI_PROGRESS_STATES,
  isProviderNeutralDirectorProgress,
} from '../../src/lib/directorExperience';

const sceneIdea =
  'She smiles gently, turns toward the sunlight, and gives a small wave. Natural movement, steady camera, soft daylight.';
const creativePlan: CreativeBrainScenePlan = {
  cinematicTone: 'Soft daylight',
  visualStyle: 'Natural cinematic',
  soundtrackMood: 'Silent',
  continuityNotes: ['Keep the same adult cast identity.', 'Keep an ivory jacket consistent.'],
  shotList: [
    {
      id: 'shot-1',
      title: 'Small wave',
      description: 'The cast member turns toward warm window light and waves.',
      cameraFraming: 'Medium portrait',
      cameraMovement: 'Steady camera',
      subjectAction: 'Smile, turn, and give one small wave.',
      environmentFocus: 'Sunlit room',
      durationHint: '4 seconds',
      transition: 'Cut',
    },
    {
      id: 'shot-2',
      title: 'Second',
      description: 'A continuity detail.',
      cameraFraming: 'Close',
      cameraMovement: 'Locked',
      subjectAction: 'Hold a gentle expression.',
      environmentFocus: 'Sunlight',
      durationHint: '2 seconds',
      transition: 'Fade',
    },
    {
      id: 'shot-3',
      title: 'Third',
      description: 'A final continuity detail.',
      cameraFraming: 'Medium',
      cameraMovement: 'Slow drift',
      subjectAction: 'Relax the hand.',
      environmentFocus: 'Room',
      durationHint: '2 seconds',
      transition: 'Fade',
    },
    {
      id: 'shot-4',
      title: 'Must be trimmed',
      description: 'This shot must not survive the three-shot cap.',
      cameraFraming: 'Wide',
      cameraMovement: 'Pan',
      subjectAction: 'Walk.',
      environmentFocus: 'Hall',
      durationHint: '2 seconds',
      transition: 'Cut',
    },
  ],
  cameraFraming: ['Medium portrait'],
  environmentDescription: 'A calm sunlit room.',
  emotionalPacing: 'Gentle',
  sceneTransitions: ['Cut'],
  promptRewrite: sceneIdea,
};

const productionDryRun = buildDirectorProductionDryRun(
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.',
);
assert.equal(productionDryRun.mode, 'dry_run');
assert.equal(productionDryRun.paidExecutionEnabled, false);
assert.equal(productionDryRun.authorizationRecorded, false);
assert.equal(productionDryRun.providerSdkCallAllowed, false);
assert.equal(productionDryRun.plan.shots.length, 3);
assert.equal(productionDryRun.progressStates.length, 6);
assert.equal(productionDryRun.progressStates.every(isProviderNeutralProgressState), true);
assert.equal(productionDryRun.projectedRequests.sceneAnchor, 1);
assert.equal(productionDryRun.projectedRequests.primaryVideo, 1);
assert.equal(productionDryRun.projectedRequests.retry, 0);
assert.equal(productionDryRun.projectedRequests.fallback, 0);
assert.equal(productionDryRun.projectedRequests.repair, 0);
assert.equal(productionDryRun.actualTelemetry.providerRequestCount, 0);
assert.equal(productionDryRun.actualTelemetry.providerRetryCount, 0);
assert.equal(productionDryRun.actualTelemetry.providerFallbackCount, 0);
assert.equal(productionDryRun.actualTelemetry.repairRequestCount, 0);
assert.equal(productionDryRun.actualTelemetry.billableMetric, null);
assert.equal(productionDryRun.projectedBudget.projectedMaximumCostUsd, 0.477);
assert.equal(productionDryRun.disclosure, 'Synthetic portrayal');
assert.equal(productionDryRun.publicCaptionSeparated, true);
assert.equal(
  productionDryRun.publicCaption,
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.',
);
const productionDryRunJson = JSON.stringify(productionDryRun);
assert.doesNotMatch(productionDryRunJson, /https?:\/\//i);
assert.doesNotMatch(productionDryRunJson, /signed[_ -]?url|authorization header|bearer\s|api[_ -]?key/i);
assert.match(productionDryRunJson, /\[redacted-reference-bytes\]/);

const directorPlan = directorPlanFromCreativeBrain({
  sceneIdea,
  castDescription: 'One adult synthetic cast member.',
  wardrobe: 'Ivory jacket.',
  environment: 'A calm sunlit room.',
  lighting: 'Soft daylight.',
}, creativePlan);

assert.equal(directorPlan.shots.length, 3);
assert.equal(directorPlan.publicCaption, 'She smiles gently, turns toward the sunlight, and gives a small wave.');
assert.equal(directorPlan.syntheticDisclosure, 'Synthetic portrayal');
assert.equal(JSON.stringify(directorPlan.publicCaption).includes('continuity'), false);

assert.equal(DIRECTOR_PROGRESS_STATES.every(isProviderNeutralProgressState), true);
assert.equal(UI_PROGRESS_STATES.every(isProviderNeutralDirectorProgress), true);

const reference = {
  data: '<base64-user-owned-front-image>',
  mimeType: 'image/jpeg' as const,
  ownershipConfirmed: true as const,
  role: 'front_face' as const,
  hashPrefix: '4ebc1b72b0fe',
};
const anchorPayload = buildNanoBananaPayload({ reference, plan: directorPlan });
assert.equal(anchorPayload.model, 'gemini-3.1-flash-image');
assert.equal(anchorPayload.input.filter((item) => item.type === 'image').length, 1);
assert.deepEqual(anchorPayload.response_modalities, ['image']);
assert.equal(anchorPayload.response_format && !Array.isArray(anchorPayload.response_format), true);
assert.match(JSON.stringify(anchorPayload), /Synthetic portrayal/);
assert.doesNotMatch(JSON.stringify(anchorPayload), /real photograph[^"]*true/i);

const videoPayload = buildOmniFlashPayload({
  anchor: { data: '<base64-scene-anchor>', mimeType: 'image/jpeg' },
  plan: directorPlan,
  durationSeconds: 4,
  aspectRatio: '9:16',
});
assert.equal(videoPayload.model, 'gemini-omni-flash-preview');
assert.equal(videoPayload.store, true);
assert.equal(videoPayload.input.filter((item) => item.type === 'image').length, 1);
assert.deepEqual(videoPayload.generation_config, { video_config: { task: 'image_to_video' } });
assert.match(JSON.stringify(videoPayload), /4-second 720p/);
assert.match(JSON.stringify(videoPayload), /No dialogue, music, ambient sound, or other audio/);
assert.doesNotMatch(JSON.stringify(videoPayload), /reference_images|identity wrapper/i);

const repairPayload = buildOmniRepairPayload({
  previousInteractionId: 'interaction-local-placeholder',
  localizedEdit: 'Stabilize the left hand.',
});
assert.equal(repairPayload.previous_interaction_id, 'interaction-local-placeholder');
assert.match(JSON.stringify(repairPayload), /Repair only this localized issue/);

const dryRun = prepareDirectorDryRun({
  plan: directorPlan,
  frontReference: reference,
});
assert.equal(dryRun.mode, 'dry_run');
assert.equal(dryRun.automaticProviderRequests, 0);
assert.equal(dryRun.automaticRepairs, 0);
assert.equal(dryRun.telemetry.providerRequestCount, 0);
assert.equal(dryRun.telemetry.providerRetryCount, 0);
assert.equal(dryRun.telemetry.providerFallbackCount, 0);
assert.equal(dryRun.telemetry.events.length, 0);
assert.deepEqual(dryRun.budget, DEFAULT_DIRECTOR_BUDGET);

assert.equal(seedancePersonalReferenceRouteAllowed({
  hasPersonalIdentityImage: true,
  inputMode: 'multimodal_reference',
}), false);
assert.equal(seedancePersonalReferenceRouteAllowed({
  hasPersonalIdentityImage: true,
  inputMode: 'image_to_video_first_frame',
}), false);
assert.equal(seedancePersonalReferenceRouteAllowed({
  hasPersonalIdentityImage: false,
  inputMode: 'text_to_video',
}), true);
assert.equal(selectDirectorRoute({
  intent: 'text_only',
  hasPersonalIdentityImage: false,
}).route, 'seedance_text_only');
assert.equal(selectDirectorRoute({
  intent: 'hero_shot',
  hasPersonalIdentityImage: false,
}).route, 'veo_specialist');
assert.equal(selectDirectorRoute({
  intent: 'personal_ai_cast',
  hasPersonalIdentityImage: true,
}).route, 'director_primary');

const autoPersonal = decideAutoStage({
  hasPrompt: true,
  explicitDemoMode: false,
  exactLikenessReady: true,
  selfCharacterReady: true,
  userPrompt: sceneIdea,
  activeFrontFaceReferenceCount: 1,
  activeOtherReferenceCount: 0,
  referenceLedRouteModerated: true,
  explicitFirstFrameCanaryAuthorized: true,
});
assert.equal(autoPersonal.route, 'director_primary');
assert.equal(autoPersonal.fallbackEngine, null);

const telemetry = createDirectorCostTelemetry();
assert.throws(() => assertPaidOperationAuthorized({
  operation: 'repair_edit',
  requestsAlreadyMade: 0,
}), /recorded budget decision/);
const repairDecision = {
  id: 'decision-local-repair',
  operation: 'repair_edit' as const,
  authorizedBy: 'user' as const,
  maximumRequests: 1,
  recordedAt: '2026-07-26T00:00:00.000Z',
};
const recorded = recordPaidRequest(telemetry, repairDecision, 'repair_edit');
assert.equal(recorded.providerRequestCount, 1);
assert.equal(recorded.repairRequestCount, 1);
assert.equal(recorded.providerRetryCount, 0);
assert.equal(recorded.providerFallbackCount, 0);
assert.equal(recorded.events[0]?.status, 'requested');
assert.throws(() => assertPaidOperationAuthorized({
  operation: 'repair_edit',
  decision: repairDecision,
  requestsAlreadyMade: recorded.requestsByOperation.repair_edit,
}), /budget is exhausted/);

const quality = evaluateDirectorQualityLocally({
  playableVideo: true,
  identityConsistency: 84,
  promptAdherence: 90,
  motionStability: 78,
  anatomyQuality: 76,
  wardrobeContinuity: 91,
  visualArtifacts: 80,
  localizedRepairIssue: 'Minor hand shimmer.',
  failureCategories: ['visual_artifact'],
});
assert.equal(quality.acceptable, true);
assert.equal(canOfferExplicitRepair(quality), true);
assert.doesNotThrow(() => prepareAuthorizedOmniRepair({
  previousInteractionId: 'interaction-local-placeholder',
  localizedEdit: 'Stabilize the left hand.',
  quality,
  decision: repairDecision,
  telemetry,
}));

const assembly = buildDirectorAssemblyPlan({
  clips: [
    { inputPath: '/controlled/shot-1.mp4', trimDurationSeconds: 4 },
    { inputPath: '/controlled/shot-2.mp4', trimDurationSeconds: 3 },
  ],
  outputPath: '/controlled/final.mp4',
  posterPath: '/controlled/poster.jpg',
  captionsPath: '/controlled/captions.srt',
});
assert.equal(assembly.executable, 'ffmpeg');
assert.equal(assembly.features.trimming, true);
assert.equal(assembly.features.shotJoining, true);
assert.equal(assembly.features.audioNormalization, true);
assert.equal(assembly.features.captions, true);
assert.equal(assembly.features.posterExtraction, true);

const extractedOutput = extractDirectorMediaOutput({
  id: 'interaction-local-placeholder',
  status: 'completed',
  output_video: {
    mime_type: 'video/mp4',
    data: Buffer.from('local-video-placeholder').toString('base64'),
  },
}, 'primary_video');
assert.equal(extractedOutput.providerInteractionId, 'interaction-local-placeholder');
assert.equal(extractedOutput.mimeType, 'video/mp4');
assert.equal(extractedOutput.uri, null);
assert.deepEqual(await pollDirectorMediaFile({
  fileName: 'files/local-placeholder',
  getFile: async () => ({ state: 'ACTIVE' }),
  maximumPolls: 1,
}), { state: 'ACTIVE', polls: 1 });

const internalDiagnostics = buildDirectorInternalDiagnostics();
assert.equal(internalDiagnostics.visibility, 'internal_only');
assert.equal(internalDiagnostics.adapters.every((adapter) => adapter.enabled === false), true);

const apiRoot = join(process.cwd(), 'api');
const endpointFiles = readdirSync(apiRoot, { recursive: true })
  .map(String)
  .filter((file) => /\.(?:ts|js)$/.test(file));
assert.equal(endpointFiles.length, 12);

const legacyVeoSource = readFileSync(
  join(process.cwd(), 'backend/src/video/providers/veo.ts'),
  'utf8',
);
assert.match(legacyVeoSource, /@google\/generative-ai/);
const directorGoogleSource = readFileSync(
  join(process.cwd(), 'backend/src/services/director/googleMedia.ts'),
  'utf8',
);
assert.match(directorGoogleSource, /@google\/genai/);
assert.match(directorGoogleSource, /maxRetries: 0/);
const seedanceEntrySource = readFileSync(
  join(process.cwd(), 'serverless/entries/generations-seedance.ts'),
  'utf8',
);
assert.match(seedanceEntrySource, /seedancePersonalReferenceRouteAllowed/);
assert.match(seedanceEntrySource, /providerRequestCount: 0/);
const seedanceBundleSource = readFileSync(
  join(process.cwd(), 'api/generations/seedance.js'),
  'utf8',
);
assert.match(seedanceBundleSource, /Personal AI Cast image routes are disabled for this renderer/);
const createVideoSource = readFileSync(
  join(process.cwd(), 'src/components/CreateVideo.tsx'),
  'utf8',
);
assert.match(createVideoSource, /DIRECTOR_PROGRESS_STATES\.map/);
assert.match(createVideoSource, /provider details inside internal diagnostics/);
assert.doesNotMatch(createVideoSource, /aria-label="Lumora Stage provider override"/);
assert.doesNotMatch(createVideoSource, /generationModerationStages\.map/);

console.log('Lumora Director v1 dry-run tests passed');
