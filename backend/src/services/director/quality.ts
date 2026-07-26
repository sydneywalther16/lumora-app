import { z } from 'zod';

export const directorQualityScoreSchema = z.object({
  playableVideo: z.boolean(),
  identityConsistency: z.number().min(0).max(100),
  promptAdherence: z.number().min(0).max(100),
  motionStability: z.number().min(0).max(100),
  anatomyQuality: z.number().min(0).max(100),
  wardrobeContinuity: z.number().min(0).max(100),
  visualArtifacts: z.number().min(0).max(100),
  overallScore: z.number().min(0).max(100),
  acceptable: z.boolean(),
  localizedRepairIssue: z.string().nullable(),
  failureCategories: z.array(z.enum([
    'not_playable',
    'identity_drift',
    'prompt_mismatch',
    'unstable_motion',
    'anatomy_defect',
    'wardrobe_discontinuity',
    'visual_artifact',
    'provider_moderation',
    'unknown',
  ])),
});

export type DirectorQualityScore = z.infer<typeof directorQualityScoreSchema>;

export function evaluateDirectorQualityLocally(input: Omit<
  DirectorQualityScore,
  'overallScore' | 'acceptable'
>): DirectorQualityScore {
  const scores = [
    input.identityConsistency,
    input.promptAdherence,
    input.motionStability,
    input.anatomyQuality,
    input.wardrobeContinuity,
    input.visualArtifacts,
  ];
  const overallScore = input.playableVideo
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  const acceptable = input.playableVideo &&
    overallScore >= 70 &&
    input.failureCategories.every((category) => !['provider_moderation', 'not_playable'].includes(category));

  return directorQualityScoreSchema.parse({
    ...input,
    overallScore,
    acceptable,
  });
}

export function canOfferExplicitRepair(score: DirectorQualityScore) {
  return score.playableVideo &&
    score.acceptable &&
    Boolean(score.localizedRepairIssue?.trim()) &&
    score.failureCategories.length <= 1;
}
