import { buildNanoBananaPayload, buildOmniFlashPayload } from './adapters';
import { DEFAULT_DIRECTOR_BUDGET } from './budget';
import {
  assertProviderNeutralPublicCaption,
  directorPlanSchema,
  type DirectorPlan,
  type UserOwnedFrontReference,
} from './contracts';
import { DIRECTOR_PROGRESS_STATES } from './progress';
import { selectDirectorRoute } from './routing';

export const DIRECTOR_DRY_RUN_SCENE =
  'She walks through a candlelit mansion and pauses after hearing a sound behind her.';

export const DIRECTOR_CANARY_PRICING = Object.freeze({
  currency: 'USD',
  effectiveDate: '2026-07-26',
  sceneAnchor1kOutputUsd: 0.067,
  primaryVideo720pPerSecondUsd: 0.10,
  primaryVideoDurationSeconds: 4,
  maximumInputAllowanceUsd: 0.01,
  source: 'Google Gemini Developer API standard pricing',
});

function buildLocalDryRunPlan(sceneIdea: string): DirectorPlan {
  const scene = sceneIdea.replace(/\s+/g, ' ').trim() || DIRECTOR_DRY_RUN_SCENE;
  return directorPlanSchema.parse({
    sceneSummary: scene,
    castDescription: 'One adult synthetic cast member derived from one user-owned Front face reference.',
    wardrobe: 'A continuity-locked evening outfit appropriate for the mansion setting.',
    environment: 'A candlelit mansion interior with a quiet corridor and deep background shadows.',
    lighting: 'Warm candlelight with controlled shadow detail and a soft edge light.',
    action: 'Walk through the corridor, hear a sound from behind, pause, and listen.',
    cameraPlan: 'One steady tracking move followed by a gentle hold when the cast member pauses.',
    continuityLocks: [
      'Preserve the same synthetic cast identity throughout.',
      'Keep wardrobe, candle direction, mansion geography, and screen direction continuous.',
      'Do not imply that the synthetic portrayal is a real photograph or recording.',
    ],
    publicCaption: assertProviderNeutralPublicCaption(scene),
    syntheticDisclosure: 'Synthetic portrayal',
    shots: [
      {
        id: 'shot-1',
        summary: 'The cast member walks into the candlelit corridor.',
        action: 'Walk forward at a natural pace.',
        cameraPlan: 'Steady medium tracking shot.',
        durationSeconds: 1.5,
      },
      {
        id: 'shot-2',
        summary: 'A sound is heard from behind.',
        action: 'Slow and begin to react without turning fully.',
        cameraPlan: 'Continue the same tracking axis with no cut.',
        durationSeconds: 1.25,
      },
      {
        id: 'shot-3',
        summary: 'The cast member pauses and listens.',
        action: 'Hold a subtle alert expression and remain still.',
        cameraPlan: 'Settle into a gentle locked hold.',
        durationSeconds: 1.25,
      },
    ],
  });
}

function redactMediaData(payload: ReturnType<typeof buildNanoBananaPayload> | ReturnType<typeof buildOmniFlashPayload>) {
  return {
    ...payload,
    input: Array.isArray(payload.input)
      ? payload.input.map((part) => (
          typeof part === 'object' && part && 'type' in part && part.type === 'image'
            ? {
                type: 'image',
                mime_type: 'image/jpeg',
                data: '[redacted-reference-bytes]',
              }
            : part
        ))
      : payload.input,
  };
}

export function buildDirectorProductionDryRun(sceneIdea = DIRECTOR_DRY_RUN_SCENE) {
  const plan = buildLocalDryRunPlan(sceneIdea);
  const reference: UserOwnedFrontReference = {
    data: '[redacted-reference-bytes]',
    mimeType: 'image/jpeg',
    ownershipConfirmed: true,
    role: 'front_face',
    hashPrefix: '[redacted]',
  };
  const anchorPayload = redactMediaData(buildNanoBananaPayload({
    reference,
    plan,
  }));
  const omniPayload = redactMediaData(buildOmniFlashPayload({
    anchor: {
      data: '[redacted-scene-anchor-bytes]',
      mimeType: 'image/jpeg',
    },
    plan,
    durationSeconds: DIRECTOR_CANARY_PRICING.primaryVideoDurationSeconds as 4,
    aspectRatio: '9:16',
  }));
  const projectedVideoCost =
    DIRECTOR_CANARY_PRICING.primaryVideo720pPerSecondUsd *
    DIRECTOR_CANARY_PRICING.primaryVideoDurationSeconds;
  const projectedMaximumCostUsd = Number((
    DIRECTOR_CANARY_PRICING.sceneAnchor1kOutputUsd +
    projectedVideoCost +
    DIRECTOR_CANARY_PRICING.maximumInputAllowanceUsd
  ).toFixed(3));
  const anchorPromptPart = Array.isArray(anchorPayload.input)
    ? anchorPayload.input[1]
    : null;
  const anchorPromptText =
    anchorPromptPart &&
    typeof anchorPromptPart === 'object' &&
    'text' in anchorPromptPart &&
    typeof anchorPromptPart.text === 'string'
      ? anchorPromptPart.text
      : '';

  return {
    enabled: true,
    mode: 'dry_run' as const,
    paidExecutionEnabled: false,
    authorizationRecorded: false,
    providerSdkCallAllowed: false,
    plan,
    routing: selectDirectorRoute({
      intent: 'personal_ai_cast',
      hasPersonalIdentityImage: true,
    }),
    progressStates: [...DIRECTOR_PROGRESS_STATES],
    proposedProviderSequence: [
      { order: 1, role: 'scene_anchor', requestCount: 1 },
      { order: 2, role: 'primary_video', requestCount: 1 },
    ],
    proposedAnchorPayload: anchorPayload,
    proposedOmniPayload: omniPayload,
    projectedRequests: {
      sceneAnchor: 1,
      primaryVideo: 1,
      retry: 0,
      fallback: 0,
      repair: 0,
    },
    actualTelemetry: {
      providerRequestCount: 0,
      providerRetryCount: 0,
      providerFallbackCount: 0,
      repairRequestCount: 0,
      billableMetric: null,
    },
    projectedBudget: {
      ...DEFAULT_DIRECTOR_BUDGET,
      pricing: DIRECTOR_CANARY_PRICING,
      projectedMaximumCostUsd,
    },
    disclosure: plan.syntheticDisclosure,
    publicCaption: plan.publicCaption,
    publicCaptionSeparated: plan.publicCaption !== anchorPromptText,
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}
