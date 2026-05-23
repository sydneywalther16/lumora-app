import { env } from '../lib/env';
import {
  getOpenAISoraProviderReadiness,
  type OpenAISoraProviderReadiness,
  type SelfProviderCharacterDiagnostics,
} from './providers/openaiSoraProvider';

export type LikenessProviderId =
  | 'seedance_text_guidance'
  | 'seedance_reference_images'
  | 'openai_sora_character'
  | 'kling_reference'
  | 'runway_gen4_reference';

export type LikenessCanaryStatus =
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'needs_canary'
  | 'not_tested'
  | 'not_required'
  | 'not_configured'
  | 'configured_not_implemented'
  | 'unavailable'
  | string;

type ReferenceRouteSummaryLike = {
  state: 'succeeded' | 'failed' | 'unknown';
  failureCategory: string | null;
  seedanceReferenceRoutesBlocked: boolean;
  knownSuccessfulReferenceRoutes: Array<Record<string, unknown>>;
  knownBlockedReferenceRoutes: Array<Record<string, unknown>>;
};

export type LikenessProviderRegistryEntry = {
  id: LikenessProviderId;
  displayName: string;
  configured: boolean;
  supportsExactLikeness: boolean;
  supportsReferenceImages: boolean;
  supportsStoredCharacters: boolean;
  requiresConsent: boolean;
  requiresCanary: boolean;
  canaryStatus: LikenessCanaryStatus;
  lastSuccessAt: string | null;
  lastFailureCategory: string | null;
  deprecated: boolean;
  shutdownDate: string | null;
  implementationStatus: 'ready' | 'available' | 'configured_not_implemented' | 'not_configured' | 'blocked' | 'fallback';
  recommendedNextAction: string;
};

function routeTimestamp(route: Record<string, unknown> | null | undefined) {
  return typeof route?.lastTestedAt === 'string' ? route.lastTestedAt : null;
}

function routeFailure(route: Record<string, unknown> | null | undefined) {
  return typeof route?.failureCategory === 'string' ? route.failureCategory : null;
}

function seedanceReferenceCanaryStatus(summary: ReferenceRouteSummaryLike): LikenessCanaryStatus {
  if (summary.knownSuccessfulReferenceRoutes.length > 0) return 'succeeded';
  if (summary.seedanceReferenceRoutesBlocked) return 'blocked';
  if (summary.knownBlockedReferenceRoutes.length > 0 || summary.state === 'failed') return 'failed';
  return 'not_tested';
}

function openAICanaryStatus(identity?: SelfProviderCharacterDiagnostics | null): LikenessCanaryStatus {
  if (identity?.likenessProviderStatus === 'canary_succeeded') return 'succeeded';
  if (identity?.likenessProviderStatus === 'character_created_needs_canary') return 'needs_canary';
  if (identity?.likenessProviderStatus === 'character_created_usage_unmapped') return 'unavailable';
  if (identity?.likenessProviderStatus) return identity.likenessProviderStatus;
  return 'not_tested';
}

export function buildLikenessProviderRegistry(input: {
  openAISoraReadiness?: OpenAISoraProviderReadiness;
  selfProviderCharacter?: SelfProviderCharacterDiagnostics | null;
  referenceRouteSummary: ReferenceRouteSummaryLike;
}): LikenessProviderRegistryEntry[] {
  const openAI = input.openAISoraReadiness ?? getOpenAISoraProviderReadiness();
  const summary = input.referenceRouteSummary;
  const successfulSeedanceRoute = summary.knownSuccessfulReferenceRoutes[0] ?? null;
  const blockedSeedanceRoute = summary.knownBlockedReferenceRoutes[0] ?? null;
  const seedanceReferenceSucceeded = summary.knownSuccessfulReferenceRoutes.length > 0;
  const openAICharacterCanaryStatus = openAICanaryStatus(input.selfProviderCharacter);
  const openAIExactReady = Boolean(
    openAI.openaiCharacterConfigured &&
    openAI.characterVideoUsageMapped &&
    input.selfProviderCharacter?.selfProviderCharacterIdPresent &&
    input.selfProviderCharacter?.selfProviderCharacterStatus === 'ready' &&
    openAICharacterCanaryStatus === 'succeeded',
  );
  const klingConfigured = Boolean(env.KLING_ENABLED && env.KLING_API_KEY && env.KLING_REFERENCE_MODEL);
  const runwayConfigured = Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY);

  return [
    {
      id: 'seedance_text_guidance',
      displayName: 'Seedance text guidance',
      configured: Boolean(env.REPLICATE_API_TOKEN),
      supportsExactLikeness: false,
      supportsReferenceImages: false,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: false,
      canaryStatus: 'not_required',
      lastSuccessAt: null,
      lastFailureCategory: null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: 'fallback',
      recommendedNextAction: 'Use as stable fallback with soft self guidance.',
    },
    {
      id: 'seedance_reference_images',
      displayName: 'Seedance photo reference',
      configured: Boolean(env.REPLICATE_API_TOKEN),
      supportsExactLikeness: seedanceReferenceSucceeded,
      supportsReferenceImages: true,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: true,
      canaryStatus: seedanceReferenceCanaryStatus(summary),
      lastSuccessAt: routeTimestamp(successfulSeedanceRoute),
      lastFailureCategory: routeFailure(blockedSeedanceRoute) ?? summary.failureCategory,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: seedanceReferenceSucceeded
        ? 'ready'
        : summary.seedanceReferenceRoutesBlocked
          ? 'blocked'
          : Boolean(env.REPLICATE_API_TOKEN)
            ? 'available'
            : 'not_configured',
      recommendedNextAction: seedanceReferenceSucceeded
        ? 'Use the successful Seedance reference route.'
        : summary.seedanceReferenceRoutesBlocked
          ? 'Do not auto-retry blocked Seedance self references.'
          : 'Run a reference matrix canary before automatic likeness routing.',
    },
    {
      id: 'openai_sora_character',
      displayName: 'OpenAI/Sora character',
      configured: openAI.openaiCharacterConfigured,
      supportsExactLikeness: openAIExactReady,
      supportsReferenceImages: false,
      supportsStoredCharacters: openAI.characterCreationSupported,
      requiresConsent: true,
      requiresCanary: true,
      canaryStatus: openAICharacterCanaryStatus,
      lastSuccessAt: input.selfProviderCharacter?.providerCharacterLastVerifiedAt ?? null,
      lastFailureCategory: openAICharacterCanaryStatus !== 'succeeded' && openAICharacterCanaryStatus !== 'not_tested'
        ? openAICharacterCanaryStatus
        : null,
      deprecated: openAI.openaiVideosDeprecated,
      shutdownDate: openAI.shutdownDate,
      implementationStatus: !openAI.openaiCharacterConfigured
        ? 'not_configured'
        : !openAI.characterVideoUsageMapped
          ? 'configured_not_implemented'
          : openAIExactReady
            ? 'ready'
            : 'available',
      recommendedNextAction: openAI.recommendedNextAction,
    },
    {
      id: 'kling_reference',
      displayName: 'Kling reference route',
      configured: klingConfigured,
      supportsExactLikeness: false,
      supportsReferenceImages: klingConfigured,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: true,
      canaryStatus: klingConfigured ? 'configured_not_implemented' : 'not_configured',
      lastSuccessAt: null,
      lastFailureCategory: null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: klingConfigured ? 'configured_not_implemented' : 'not_configured',
      recommendedNextAction: klingConfigured
        ? 'Implement and canary-test Kling reference routing before production use.'
        : 'Set KLING_ENABLED, KLING_API_KEY, and KLING_REFERENCE_MODEL to evaluate Kling.',
    },
    {
      id: 'runway_gen4_reference',
      displayName: 'Runway Gen-4 reference route',
      configured: runwayConfigured,
      supportsExactLikeness: false,
      supportsReferenceImages: runwayConfigured,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: true,
      canaryStatus: runwayConfigured ? 'configured_not_implemented' : 'not_configured',
      lastSuccessAt: null,
      lastFailureCategory: null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: runwayConfigured ? 'configured_not_implemented' : 'not_configured',
      recommendedNextAction: runwayConfigured
        ? 'Implement and canary-test Runway reference routing before production use.'
        : 'Set RUNWAY_ENABLED and RUNWAY_API_KEY to evaluate Runway.',
    },
  ];
}
