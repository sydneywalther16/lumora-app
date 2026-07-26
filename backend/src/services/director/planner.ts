import {
  createCreativeBrainPlan,
  type CreativeBrainPlanResult,
} from '../creativeBrain';
import {
  buildDirectorPlanningInstructions,
  directorPlanFromCreativeBrain,
  type DirectorPlan,
  type DirectorPlanInput,
} from './contracts';

export type DirectorPlanningResult = {
  plan: DirectorPlan;
  reasoning: {
    provider: CreativeBrainPlanResult['provider'];
    model: string;
    attempts: number;
    planId: string;
  };
};

export async function createDirectorPlan(input: DirectorPlanInput): Promise<DirectorPlanningResult> {
  const creative = await createCreativeBrainPlan({
    prompt: buildDirectorPlanningInstructions(input),
    characterMetadata: {
      castDescription: input.castDescription,
      syntheticDisclosure: 'Synthetic portrayal',
      maximumShots: 3,
    },
    styleTheme: 'provider-neutral cinematic Director plan',
  });

  return {
    plan: directorPlanFromCreativeBrain(input, creative.plan),
    reasoning: {
      provider: creative.provider,
      model: creative.model,
      attempts: creative.attempts,
      planId: creative.id,
    },
  };
}
