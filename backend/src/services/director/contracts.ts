import { z } from 'zod';
import type { CreativeBrainScenePlan } from '../creativeBrain';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

const providerLeakPattern =
  /\b(?:nano banana|gemini omni|gemini|veo|seedance|firefly|replicate|provider payload|api error)\b/i;
const hiddenInstructionPattern =
  /\b(?:reference_images|previous_interaction_id|identity wrapper|continuity locks?|system prompt|provider)\b/i;

export const directorShotSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  action: z.string().min(1),
  cameraPlan: z.string().min(1),
  durationSeconds: z.number().min(1).max(5),
});

export const directorPlanSchema = z.object({
  sceneSummary: z.string().min(1),
  castDescription: z.string().min(1),
  wardrobe: z.string().min(1),
  environment: z.string().min(1),
  lighting: z.string().min(1),
  action: z.string().min(1),
  cameraPlan: z.string().min(1),
  continuityLocks: z.array(z.string().min(1)).min(1),
  publicCaption: z.string().min(1).max(160),
  syntheticDisclosure: z.literal('Synthetic portrayal'),
  shots: z.array(directorShotSchema).min(1).max(3),
});

export type DirectorShot = z.infer<typeof directorShotSchema>;
export type DirectorPlan = z.infer<typeof directorPlanSchema>;

export type DirectorPlanInput = {
  sceneIdea: string;
  castDescription: string;
  wardrobe?: string | null;
  environment?: string | null;
  lighting?: string | null;
};

export type UserOwnedFrontReference = {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  ownershipConfirmed: true;
  role: 'front_face';
  hashPrefix: string;
};

export function sanitizeDirectorPublicCaption(value: string): string {
  const firstSentence = compact(value)
    .split(/[.!?]+/)
    .map(compact)
    .find((part) => part.length > 0 && !hiddenInstructionPattern.test(part));
  const caption = firstSentence ? `${firstSentence.replace(/[.?!]+$/g, '')}.` : 'A cinematic scene is ready.';
  return caption.length <= 160 ? caption : `${caption.slice(0, 156).trimEnd()}...`;
}

export function assertProviderNeutralPublicCaption(value: string): string {
  const caption = sanitizeDirectorPublicCaption(value);
  if (providerLeakPattern.test(caption) || hiddenInstructionPattern.test(caption)) {
    return 'A cinematic scene is ready.';
  }
  return caption;
}

export function directorPlanFromCreativeBrain(
  input: DirectorPlanInput,
  creativePlan: CreativeBrainScenePlan,
): DirectorPlan {
  const sourceShots = creativePlan.shotList.slice(0, 3);
  const totalDuration = 4;
  const durationSeconds = Math.max(1, Number((totalDuration / Math.max(sourceShots.length, 1)).toFixed(2)));
  const sceneSummary = compact(input.sceneIdea);
  const action = compact(sourceShots.map((shot) => shot.subjectAction).join('; ')) || sceneSummary;
  const cameraPlan = compact(
    sourceShots.map((shot) => `${shot.cameraFraming}; ${shot.cameraMovement}`).join(' | '),
  );

  return directorPlanSchema.parse({
    sceneSummary,
    castDescription: compact(input.castDescription),
    wardrobe: compact(input.wardrobe ?? '') || 'Keep the planned wardrobe consistent across every shot.',
    environment:
      compact(input.environment ?? '') ||
      compact(creativePlan.environmentDescription) ||
      'A coherent cinematic environment.',
    lighting: compact(input.lighting ?? '') || compact(creativePlan.cinematicTone) || 'Natural cinematic lighting.',
    action,
    cameraPlan: cameraPlan || 'Steady cinematic camera movement.',
    continuityLocks: [
      ...creativePlan.continuityNotes,
      'Keep cast identity, wardrobe, lighting direction, and environment continuous.',
      'Keep the portrayal visibly disclosed as synthetic.',
    ].map(compact).filter(Boolean),
    publicCaption: assertProviderNeutralPublicCaption(sceneSummary),
    syntheticDisclosure: 'Synthetic portrayal',
    shots: sourceShots.map((shot, index) => ({
      id: shot.id || `shot-${index + 1}`,
      summary: compact(shot.description),
      action: compact(shot.subjectAction),
      cameraPlan: compact(`${shot.cameraFraming}; ${shot.cameraMovement}`),
      durationSeconds,
    })),
  });
}

export function buildDirectorPlanningInstructions(input: DirectorPlanInput) {
  return [
    'Transform the scene idea through the existing Creative Brain JSON planning schema.',
    'The Director will normalize the result into its strict public contract and retain at most three shots.',
    'Keep publicCaption separate from internal camera, provider, identity, and continuity instructions.',
    'Set syntheticDisclosure exactly to "Synthetic portrayal".',
    `Scene idea: ${compact(input.sceneIdea)}`,
    `Cast: ${compact(input.castDescription)}`,
    `Wardrobe: ${compact(input.wardrobe ?? '') || 'derive safely from the scene'}`,
    `Environment: ${compact(input.environment ?? '') || 'derive from the scene'}`,
    `Lighting: ${compact(input.lighting ?? '') || 'derive from the scene'}`,
  ].join('\n');
}
