import type { DirectorPlan, DirectorShot, UserOwnedFrontReference } from './contracts';
import type { GoogleInteractionPayload, GoogleMediaExecutionContext } from './googleMedia';
import { executeGoogleMediaInteraction } from './googleMedia';
import type { DirectorBudgetDecision, DirectorCostTelemetry } from './budget';
import { assertPaidOperationAuthorized } from './budget';
import type { DirectorQualityScore } from './quality';
import { canOfferExplicitRepair } from './quality';

export const NANO_BANANA_2_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_OMNI_FLASH_MODEL = 'gemini-omni-flash-preview';

function sceneAnchorPrompt(plan: DirectorPlan) {
  return [
    'Create a provider-safe cinematic scene anchor for a clearly synthetic portrayal.',
    'Use the user-owned front reference only to preserve the planned cast identity.',
    'Do not present the result as a real photograph or documentary evidence.',
    `Synthetic disclosure: ${plan.syntheticDisclosure}.`,
    `Scene plan JSON: ${JSON.stringify(plan)}`,
  ].join('\n');
}

export function buildNanoBananaPayload(input: {
  reference: UserOwnedFrontReference;
  plan: DirectorPlan;
  aspectRatio?: '9:16' | '16:9' | '1:1';
}): GoogleInteractionPayload {
  if (!input.reference.ownershipConfirmed || input.reference.role !== 'front_face') {
    throw new Error('Director scene anchors require one confirmed user-owned Front face reference.');
  }

  return {
    model: NANO_BANANA_2_MODEL,
    store: false,
    background: false,
    response_modalities: ['image'],
    input: [
      {
        type: 'image',
        data: input.reference.data,
        mime_type: input.reference.mimeType,
      },
      {
        type: 'text',
        text: sceneAnchorPrompt(input.plan),
      },
    ],
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: input.aspectRatio ?? '9:16',
      image_size: '1K',
    },
  };
}

function primaryVideoPrompt(plan: DirectorPlan, shot: DirectorShot, durationSeconds: 3 | 4 | 5) {
  return [
    `Create exactly one ${durationSeconds}-second 720p video candidate in a single continuous shot.`,
    `Animate this synthetic cinematic scene: ${shot.summary}`,
    `Action: ${shot.action}`,
    `Camera: ${shot.cameraPlan}`,
    `Continuity: ${plan.continuityLocks.join('; ')}`,
    `Wardrobe: ${plan.wardrobe}`,
    `Environment: ${plan.environment}`,
    `Lighting: ${plan.lighting}`,
    'Keep movement natural, anatomy stable, and the portrayal clearly synthetic.',
    'No dialogue, music, ambient sound, or other audio.',
  ].join('\n');
}

export function buildOmniFlashPayload(input: {
  anchor: { data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' };
  plan: DirectorPlan;
  shot?: DirectorShot;
  durationSeconds?: 3 | 4 | 5;
  aspectRatio?: '9:16' | '16:9';
  store?: boolean;
}): GoogleInteractionPayload {
  const shot = input.shot ?? input.plan.shots[0];
  if (!shot) throw new Error('Director primary video requires one planned shot.');
  const durationSeconds = input.durationSeconds ?? 4;

  return {
    model: GEMINI_OMNI_FLASH_MODEL,
    store: input.store ?? true,
    background: false,
    input: [
      {
        type: 'image',
        data: input.anchor.data,
        mime_type: input.anchor.mimeType,
      },
      {
        type: 'text',
        text: primaryVideoPrompt(input.plan, shot, durationSeconds),
      },
    ],
    response_format: {
      type: 'video',
      aspect_ratio: input.aspectRatio ?? '9:16',
      delivery: 'uri',
    },
    generation_config: {
      video_config: {
        task: 'image_to_video',
      },
    },
  };
}

export function buildOmniRepairPayload(input: {
  previousInteractionId: string;
  localizedEdit: string;
}): GoogleInteractionPayload {
  if (!input.previousInteractionId.trim() || !input.localizedEdit.trim()) {
    throw new Error('A repair edit requires the prior interaction and one localized instruction.');
  }
  return {
    model: GEMINI_OMNI_FLASH_MODEL,
    store: true,
    background: false,
    previous_interaction_id: input.previousInteractionId,
    input: [{
      type: 'text',
      text: `Repair only this localized issue while preserving all other approved details: ${input.localizedEdit.trim()}`,
    }],
    response_format: {
      type: 'video',
      delivery: 'uri',
    },
  };
}

export function prepareAuthorizedOmniRepair(input: {
  previousInteractionId: string;
  localizedEdit: string;
  quality: DirectorQualityScore;
  decision: DirectorBudgetDecision;
  telemetry: DirectorCostTelemetry;
}) {
  if (!canOfferExplicitRepair(input.quality)) {
    throw new Error('This output is not eligible for a localized conversational repair.');
  }
  assertPaidOperationAuthorized({
    operation: 'repair_edit',
    decision: input.decision,
    requestsAlreadyMade: input.telemetry.requestsByOperation.repair_edit,
  });
  return buildOmniRepairPayload(input);
}

export const nanoBananaAdapter = {
  model: NANO_BANANA_2_MODEL,
  prepare: buildNanoBananaPayload,
  execute: (payload: GoogleInteractionPayload, context: GoogleMediaExecutionContext) =>
    executeGoogleMediaInteraction(payload, context),
};

export const omniFlashAdapter = {
  model: GEMINI_OMNI_FLASH_MODEL,
  prepare: buildOmniFlashPayload,
  prepareRepair: buildOmniRepairPayload,
  execute: (payload: GoogleInteractionPayload, context: GoogleMediaExecutionContext) =>
    executeGoogleMediaInteraction(payload, context),
};
