import type { DirectorPlan } from './contracts';
import { DIRECTOR_PROGRESS_STATES } from './progress';
import {
  buildXaiCharacterPlatePayload,
  buildXaiImageToVideoHeroPayload,
  buildXaiReferenceToVideoPayload,
  redactXaiImagineRequest,
  type XaiHeroVideoResolution,
  type XaiPrivateMediaReference,
  type XaiStandardVideoResolution,
} from '../providers/xaiImagine';

export type XaiAiCastRoute = 'direct_reference' | 'character_plate' | 'premium_hero';
export type XaiAiCastTier = 'test' | 'standard' | 'premium';

export const XAI_IMAGINE_PRICING_USD = Object.freeze({
  auditedAt: '2026-08-01',
  imageQuality: {
    inputImage: 0.01,
    output1K: 0.05,
    output2K: 0.07,
  },
  standardVideo: {
    inputImage: 0.002,
    inputVideoSecond: 0.01,
    outputSecond480p: 0.05,
    outputSecond720p: 0.07,
  },
  heroVideo15: {
    inputImage: 0.01,
    outputSecond480p: 0.08,
    outputSecond720p: 0.14,
    outputSecond1080p: 0.25,
  },
});

export type XaiRouteEstimate = {
  route: XaiAiCastRoute;
  projectedCostUsd: number;
  referenceCount: number;
  paidStages: 1 | 2;
  retryCount: 0;
  fallbackCount: 0;
  repairCount: 0;
};

function money(value: number) {
  return Number(value.toFixed(4));
}

function standardVideoOutputRate(resolution: XaiStandardVideoResolution) {
  return resolution === '720p'
    ? XAI_IMAGINE_PRICING_USD.standardVideo.outputSecond720p
    : XAI_IMAGINE_PRICING_USD.standardVideo.outputSecond480p;
}

function heroVideoOutputRate(resolution: XaiHeroVideoResolution) {
  if (resolution === '1080p') return XAI_IMAGINE_PRICING_USD.heroVideo15.outputSecond1080p;
  if (resolution === '720p') return XAI_IMAGINE_PRICING_USD.heroVideo15.outputSecond720p;
  return XAI_IMAGINE_PRICING_USD.heroVideo15.outputSecond480p;
}

export function estimateXaiAiCastRoute(input: {
  route: XaiAiCastRoute;
  referenceCount: number;
  durationSeconds: number;
  standardResolution?: XaiStandardVideoResolution;
  heroResolution?: XaiHeroVideoResolution;
  plateResolution?: '1K' | '2K';
}): XaiRouteEstimate {
  if (!Number.isInteger(input.referenceCount) || input.referenceCount < 1) {
    throw new Error('At least one reference is required for cost estimation.');
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('A positive video duration is required for cost estimation.');
  }
  if (input.route === 'direct_reference') {
    if (input.referenceCount > 7) throw new Error('Direct reference video supports at most seven images.');
    const cost =
      input.referenceCount * XAI_IMAGINE_PRICING_USD.standardVideo.inputImage +
      input.durationSeconds * standardVideoOutputRate(input.standardResolution ?? '480p');
    return {
      route: input.route,
      projectedCostUsd: money(cost),
      referenceCount: input.referenceCount,
      paidStages: 1,
      retryCount: 0,
      fallbackCount: 0,
      repairCount: 0,
    };
  }
  if (input.route === 'character_plate') {
    if (input.referenceCount > 3) throw new Error('A character plate supports at most three source images.');
    const plateOutput = input.plateResolution === '2K'
      ? XAI_IMAGINE_PRICING_USD.imageQuality.output2K
      : XAI_IMAGINE_PRICING_USD.imageQuality.output1K;
    const cost =
      input.referenceCount * XAI_IMAGINE_PRICING_USD.imageQuality.inputImage +
      plateOutput +
      XAI_IMAGINE_PRICING_USD.standardVideo.inputImage +
      input.durationSeconds * standardVideoOutputRate(input.standardResolution ?? '720p');
    return {
      route: input.route,
      projectedCostUsd: money(cost),
      referenceCount: input.referenceCount,
      paidStages: 2,
      retryCount: 0,
      fallbackCount: 0,
      repairCount: 0,
    };
  }
  if (input.referenceCount !== 1) {
    throw new Error('Premium hero image-to-video accepts exactly one source image.');
  }
  const cost =
    XAI_IMAGINE_PRICING_USD.heroVideo15.inputImage +
    input.durationSeconds * heroVideoOutputRate(input.heroResolution ?? '1080p');
  return {
    route: input.route,
    projectedCostUsd: money(cost),
    referenceCount: 1,
    paidStages: 1,
    retryCount: 0,
    fallbackCount: 0,
    repairCount: 0,
  };
}

export function selectXaiAiCastRoute(input: {
  tier: XaiAiCastTier;
  explicitlySelected: boolean;
  referenceCount: number;
}): XaiAiCastRoute {
  if (!input.explicitlySelected) {
    throw new Error('A paid alternate provider route must be selected explicitly; automatic paid fallback is disabled.');
  }
  if (input.tier === 'test') {
    if (input.referenceCount < 1 || input.referenceCount > 7) {
      throw new Error('The test route accepts one to seven references.');
    }
    return 'direct_reference';
  }
  if (input.tier === 'standard') {
    if (input.referenceCount < 1 || input.referenceCount > 3) {
      throw new Error('The standard character-plate route accepts one to three references.');
    }
    return 'character_plate';
  }
  if (input.referenceCount !== 1) {
    throw new Error('The premium hero route accepts one canonical source image.');
  }
  return 'premium_hero';
}

export function buildXaiComparisonHarness(input: {
  referenceCount: number;
  durationSeconds?: number;
  currentGoogleProjectedCostUsd?: number | null;
}) {
  const durationSeconds = input.durationSeconds ?? 4;
  const rows = [
    input.referenceCount <= 7
      ? {
          id: 'grok_direct_reference' as const,
          eligible: true,
          ...estimateXaiAiCastRoute({
            route: 'direct_reference',
            referenceCount: input.referenceCount,
            durationSeconds,
            standardResolution: '480p',
          }),
          identityGuidance: 'Up to seven same-identity private image references.',
          latencyProfile: 'One asynchronous paid stage.',
          persistence: 'Private file output plus immediate Lumora-controlled persistence.',
          responseParsing: 'Poll request_id to done/failed/expired; read file_output privately.',
        }
      : {
          id: 'grok_direct_reference' as const,
          eligible: false,
          reason: 'More than seven references.',
        },
    input.referenceCount <= 3
      ? {
          id: 'grok_character_plate' as const,
          eligible: true,
          ...estimateXaiAiCastRoute({
            route: 'character_plate',
            referenceCount: input.referenceCount,
            durationSeconds,
            standardResolution: '720p',
            plateResolution: '1K',
          }),
          identityGuidance: 'Up to three same-identity private images consolidated into a canonical plate.',
          latencyProfile: 'Two sequential paid stages.',
          persistence: 'Private plate and video outputs plus Lumora-controlled persistence.',
          responseParsing: 'Read image data/file_output, then poll video request_id.',
        }
      : {
          id: 'grok_character_plate' as const,
          eligible: false,
          reason: 'More than three character-plate inputs.',
        },
    input.referenceCount === 1
      ? {
          id: 'grok_premium_hero' as const,
          eligible: true,
          ...estimateXaiAiCastRoute({
            route: 'premium_hero',
            referenceCount: 1,
            durationSeconds,
            heroResolution: '1080p',
          }),
          identityGuidance: 'Exactly one canonical source image; no multi-reference mode.',
          latencyProfile: 'One premium asynchronous paid stage.',
          persistence: 'Private video output plus immediate Lumora-controlled persistence.',
          responseParsing: 'Poll request_id to done/failed/expired; read file_output privately.',
        }
      : {
          id: 'grok_premium_hero' as const,
          eligible: false,
          reason: 'Premium hero requires exactly one source image.',
        },
  ];
  return {
    mode: 'comparison_only' as const,
    providerRequestsMade: 0,
    automaticPaidFallback: false,
    currentGoogle: {
      projectedCostUsd: input.currentGoogleProjectedCostUsd ?? null,
      measuredInThisHarness: false,
    },
    rows,
  };
}

export function prepareXaiAiCastDryRun(input: {
  tier: XaiAiCastTier;
  explicitlySelected: boolean;
  userId: string;
  references: XaiPrivateMediaReference[];
  plan: DirectorPlan;
  durationSeconds?: number;
}) {
  const route = selectXaiAiCastRoute({
    tier: input.tier,
    explicitlySelected: input.explicitlySelected,
    referenceCount: input.references.length,
  });
  const durationSeconds = input.durationSeconds ?? 4;
  const requests = route === 'direct_reference'
    ? [buildXaiReferenceToVideoPayload({
        userId: input.userId,
        references: input.references,
        plan: input.plan,
        durationSeconds,
        resolution: '480p',
      })]
    : route === 'character_plate'
      ? (() => {
          const plate = buildXaiCharacterPlatePayload({
            userId: input.userId,
            references: input.references,
            plan: input.plan,
            resolution: '1K',
          });
          const identityId = input.references.find((reference) => reference.identityId)?.identityId ?? null;
          const plateReference: XaiPrivateMediaReference = {
            ...input.references[0],
            fileId: 'file_dry-run-character-plate',
            mediaType: 'image',
            mimeType: 'image/jpeg',
            identityId,
          };
          return [plate, buildXaiReferenceToVideoPayload({
            userId: input.userId,
            references: [plateReference],
            plan: input.plan,
            durationSeconds,
            resolution: '720p',
          })];
        })()
      : [buildXaiImageToVideoHeroPayload({
          userId: input.userId,
          source: input.references[0],
          plan: input.plan,
          durationSeconds,
          resolution: '1080p',
        })];
  const estimate = estimateXaiAiCastRoute({
    route,
    referenceCount: input.references.length,
    durationSeconds,
    standardResolution: route === 'direct_reference' ? '480p' : '720p',
    heroResolution: '1080p',
    plateResolution: '1K',
  });
  return {
    mode: 'dry_run' as const,
    paidExecutionEnabled: false,
    providerRequestsMade: 0,
    automaticRetryRequests: 0,
    automaticFallbackRequests: 0,
    automaticRepairRequests: 0,
    route,
    tier: input.tier,
    estimate,
    progressStates: DIRECTOR_PROGRESS_STATES,
    publicCaption: input.plan.publicCaption,
    syntheticDisclosure: input.plan.syntheticDisclosure,
    preparedRequests: requests,
    safeDiagnostics: requests.map(redactXaiImagineRequest),
  };
}
