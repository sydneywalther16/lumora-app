import { env } from '../lib/env';
import { SEEDANCE_FAST_MODEL } from './providers/seedanceProvider';
import {
  getReferenceRouteSummary,
  listSelfReferenceMatrixCandidates,
  persistReferenceRouteResult,
  startSeedanceCanary,
  startSeedanceReferenceCanaryForMatrix,
  type SeedanceReferenceMatrixVariant,
  type SelfReferenceMatrixCandidate,
} from './seedanceCanary';

export type ReferenceMatrixRole = 'front_angle' | 'side_angle_left' | 'side_angle_right' | 'full_body' | 'all';

export type StartReferenceMatrixCanaryInput = {
  userId?: string | null;
  referenceRole?: ReferenceMatrixRole;
  variant?: SeedanceReferenceMatrixVariant;
  maxPaidAttempts?: number | null;
  saveAsDraft?: boolean;
};

function clampMaxPaidAttempts(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(Number(value))));
}

function candidateSummary(candidate: SelfReferenceMatrixCandidate) {
  return {
    userIdPresent: Boolean(candidate.userId),
    characterId: candidate.characterId,
    role: candidate.referenceRole,
    label: candidate.referenceLabel,
    host: candidate.diagnostics.host,
    savedToLumora: candidate.diagnostics.savedToLumora,
    source: candidate.diagnostics.source,
  };
}

function unsupportedImageToVideoResult(candidate: SelfReferenceMatrixCandidate) {
  return {
    candidate: candidateSummary(candidate),
    canaryVariant: 'image_to_video',
    provider: 'seedance-fast',
    providerModel: SEEDANCE_FAST_MODEL,
    providerPredictionIdExists: false,
    providerStatus: 'unsupported_variant',
    lifecycleStatus: 'failed',
    status: 'failed',
    outputUrlPresent: false,
    parsedOutputUrlPresent: false,
    errorCategory: 'reference_input_schema',
    providerErrorCategory: 'reference_input_schema',
    providerErrorSummary: 'Seedance schema currently supports reference_images; image-to-video first-frame fields are not configured.',
    nextAction: 'use_reference_images_or_text_only',
    message: 'Seedance image-to-video reference variant is not configured in the current provider schema.',
  };
}

export async function startSeedanceReferenceMatrixCanary(input: StartReferenceMatrixCanaryInput) {
  const referenceRole = input.referenceRole ?? 'all';
  const variant = input.variant ?? 'reference_images';
  const maxPaidAttempts = clampMaxPaidAttempts(input.maxPaidAttempts);

  if (variant === 'text_only') {
    const status = await startSeedanceCanary({
      userId: input.userId ?? null,
      saveAsDraft: input.saveAsDraft,
    });
    return {
      ok: true,
      variant,
      referenceRole,
      maxPaidAttempts,
      attemptsStarted: 1,
      candidates: [],
      results: [status],
      recommendedNextAction: status.nextAction,
    };
  }

  const matrix = await listSelfReferenceMatrixCandidates({
    userId: input.userId ?? null,
    referenceRole,
  });
  const candidates = matrix.candidates.slice(0, maxPaidAttempts);

  if (!candidates.length) {
    return {
      ok: false,
      error: 'no_saved_self_reference',
      message: 'No saved Lumora self reference found for the requested matrix role.',
      sourcesChecked: matrix.sourcesChecked,
      sourceErrors: matrix.sourceErrors,
      referenceRole,
      variant,
      maxPaidAttempts,
      candidates: [],
      results: [],
      recommendedNextAction: 'Open Create or Characters and re-save the self reference photos to Lumora storage, then rerun the reference matrix.',
    };
  }

  const results = [];
  for (const candidate of candidates) {
    if (variant === 'image_to_video') {
      await persistReferenceRouteResult({
        userId: candidate.userId,
        characterId: candidate.characterId,
        referenceRole: candidate.referenceRole,
        referenceLabel: candidate.referenceLabel,
        provider: 'seedance-fast',
        providerModel: SEEDANCE_FAST_MODEL,
        variant,
        succeeded: false,
        failureCategory: 'reference_input_schema',
        providerErrorCategory: 'reference_input_schema',
        outputUrlPresent: false,
      });
      results.push(unsupportedImageToVideoResult(candidate));
      continue;
    }

    const status = await startSeedanceReferenceCanaryForMatrix({
      userId: candidate.userId,
      characterId: candidate.characterId,
      reference: candidate.reference,
      selectedReference: candidate.diagnostics,
      saveAsDraft: input.saveAsDraft,
    });
    results.push({
      candidate: candidateSummary(candidate),
      ...status,
    });
  }

  return {
    ok: true,
    variant,
    referenceRole,
    maxPaidAttempts,
    attemptsStarted: results.length,
    sourcesChecked: matrix.sourcesChecked,
    sourceErrors: matrix.sourceErrors,
    candidates: candidates.map(candidateSummary),
    results,
    recommendedNextAction: results.some((result) => result.lifecycleStatus === 'completed' && result.parsedOutputUrlPresent)
      ? 'use_successful_reference_route'
      : 'try_next_reference_role_or_text_only',
  };
}

export async function buildReferenceProviderReadinessDiagnostics(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}) {
  const routeSummary = await getReferenceRouteSummary(input);
  return {
    seedance: {
      configured: Boolean(env.REPLICATE_API_TOKEN),
      referenceCapable: true,
      canaryTested: routeSummary.allReferenceRouteResults.length > 0,
      lastReferenceResult: routeSummary.allReferenceRouteResults[0] ?? null,
    },
    veo: {
      configured: Boolean(env.GOOGLE_API_KEY),
      referenceCapable: false,
      canaryTested: false,
      lastReferenceResult: null,
    },
    runway: {
      configured: Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY && (env.RUNWAY_REFERENCE_MODEL ?? env.RUNWAY_MODEL)),
      referenceCapable: Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY && (env.RUNWAY_REFERENCE_MODEL ?? env.RUNWAY_MODEL)),
      canaryTested: false,
      lastReferenceResult: null,
    },
    klingReference: {
      configured: Boolean(env.KLING_ENABLED && env.KLING_API_KEY && env.KLING_REFERENCE_MODEL),
      referenceCapable: false,
      canaryTested: false,
      lastReferenceResult: null,
    },
  };
}
