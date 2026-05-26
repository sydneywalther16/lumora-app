import { env } from '../lib/env';
import {
  getAlternateProviderStatus,
  type AlternateExactLikenessProviderStatus,
} from './alternateLikenessProviderMemory';
import {
  getOpenAISoraProviderReadiness,
  type OpenAISoraProviderReadiness,
  type SelfProviderCharacterDiagnostics,
} from './providers/openaiSoraProvider';
import { type FalAccountStatus } from './providers/falAccountDiagnostics';
import { getKlingProviderReadiness } from './providers/klingProvider';
import { getRunwayProviderReadiness } from './providers/runwayProvider';
import { type SelfVerificationVideoDiagnostics } from './selfVerificationVideo';

export type LikenessProviderId =
  | 'seedance_text_guidance'
  | 'seedance_video_reference'
  | 'seedance_reference_images'
  | 'openai_sora_character'
  | 'kling_reference'
  | 'runway_gen4_reference'
  | 'lumora_identity_pack';

export type LikenessCanaryStatus =
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'needs_canary'
  | 'not_tested'
  | 'not_required'
  | 'not_configured'
  | 'configured_not_implemented'
  | 'configured_ready_for_canary'
  | 'canary_succeeded'
  | 'canary_failed'
  | 'research_only'
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
  readinessStatus: LikenessCanaryStatus;
  lastSuccessAt: string | null;
  lastFailureCategory: string | null;
  deprecated: boolean;
  shutdownDate: string | null;
  implementationStatus: 'ready' | 'available' | 'configured_not_implemented' | 'configured_ready_for_canary' | 'not_configured' | 'blocked' | 'billing_required' | 'fallback' | 'research_only';
  recommendedNextAction: string;
};

function routeTimestamp(route: Record<string, unknown> | null | undefined) {
  return typeof route?.lastTestedAt === 'string' ? route.lastTestedAt : null;
}

function routeFailure(route: Record<string, unknown> | null | undefined) {
  return typeof route?.failureCategory === 'string' ? route.failureCategory : null;
}

function seedanceReferenceModerationBlocked(summary: ReferenceRouteSummaryLike) {
  return summary.failureCategory === 'reference_moderation_block' ||
    summary.knownBlockedReferenceRoutes.some((route) => routeFailure(route) === 'reference_moderation_block');
}

function seedanceReferenceCanaryStatus(summary: ReferenceRouteSummaryLike): LikenessCanaryStatus {
  if (summary.knownSuccessfulReferenceRoutes.length > 0) return 'succeeded';
  if (seedanceReferenceModerationBlocked(summary)) return 'failed_blocked';
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
  selfVerificationVideo?: SelfVerificationVideoDiagnostics | null;
  referenceRouteSummary: ReferenceRouteSummaryLike;
  alternateProviderStatuses?: AlternateExactLikenessProviderStatus[];
  falAccountStatus?: FalAccountStatus | null;
}): LikenessProviderRegistryEntry[] {
  const openAI = input.openAISoraReadiness ?? getOpenAISoraProviderReadiness();
  const summary = input.referenceRouteSummary;
  const successfulSeedanceRoute = summary.knownSuccessfulReferenceRoutes[0] ?? null;
  const blockedSeedanceRoute = summary.knownBlockedReferenceRoutes[0] ?? null;
  const seedanceReferenceSucceeded = summary.knownSuccessfulReferenceRoutes.length > 0;
  const seedanceReferenceBlockedBySafety = seedanceReferenceModerationBlocked(summary);
  const seedanceReferenceStatus = seedanceReferenceCanaryStatus(summary);
  const openAICharacterCanaryStatus = openAICanaryStatus(input.selfProviderCharacter);
  const openAIExactReady = Boolean(
    openAI.openaiCharacterConfigured &&
    openAI.characterVideoUsageMapped &&
    input.selfProviderCharacter?.selfProviderCharacterIdPresent &&
    input.selfProviderCharacter?.selfProviderCharacterStatus === 'ready' &&
    openAICharacterCanaryStatus === 'succeeded',
  );
  const runwayStatus = getAlternateProviderStatus(input.alternateProviderStatuses, 'runway_gen4_reference');
  const klingStatus = getAlternateProviderStatus(input.alternateProviderStatuses, 'kling_reference');
  const runwayReadiness = getRunwayProviderReadiness({
    canaryStatus: runwayStatus?.status ?? null,
    lastFailureCategory: runwayStatus?.lastFailureCategory ?? null,
  });
  const klingReadiness = getKlingProviderReadiness({
    statuses: input.alternateProviderStatuses,
    falAccountStatus: input.falAccountStatus,
  });
  const runwayExactReady = runwayReadiness.status === 'canary_succeeded';
  const klingExactReady = klingReadiness.status === 'canary_succeeded';
  const videoReferenceStatus = input.selfVerificationVideo?.seedanceVideoReferenceCanaryStatus ?? 'not_tested';
  const videoReferenceBlocked = videoReferenceStatus === 'failed_blocked' ||
    videoReferenceStatus === 'blocked' ||
    input.selfVerificationVideo?.seedanceVideoReferenceLastFailureCategory === 'video_reference_moderation_block';
  const videoReferenceReady = videoReferenceStatus === 'canary_succeeded' || videoReferenceStatus === 'succeeded';
  const videoReferenceConfigured = Boolean(env.REPLICATE_API_TOKEN && input.selfVerificationVideo?.selfVerificationVideoPresent);

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
      readinessStatus: 'not_required',
      lastSuccessAt: null,
      lastFailureCategory: null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: 'fallback',
      recommendedNextAction: 'Use as stable fallback with soft self guidance.',
    },
    {
      id: 'seedance_video_reference',
      displayName: 'Seedance verification video reference',
      configured: videoReferenceConfigured,
      supportsExactLikeness: videoReferenceReady,
      supportsReferenceImages: false,
      supportsStoredCharacters: false,
      requiresConsent: true,
      requiresCanary: true,
      canaryStatus: input.selfVerificationVideo?.selfVerificationVideoPresent
        ? videoReferenceBlocked ? 'failed_blocked' : videoReferenceStatus
        : 'not_configured',
      readinessStatus: input.selfVerificationVideo?.selfVerificationVideoPresent
        ? videoReferenceBlocked ? 'blocked' : videoReferenceStatus
        : 'not_configured',
      lastSuccessAt: videoReferenceReady ? input.selfVerificationVideo?.verificationLastTestedAt ?? null : null,
      lastFailureCategory: videoReferenceReady
        ? null
        : input.selfVerificationVideo?.seedanceVideoReferenceLastFailureCategory ?? videoReferenceStatus,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: videoReferenceReady
        ? 'ready'
        : videoReferenceBlocked
          ? 'blocked'
        : videoReferenceConfigured
          ? videoReferenceStatus === 'configured_not_implemented'
            ? 'configured_not_implemented'
            : 'available'
          : 'not_configured',
      recommendedNextAction: videoReferenceReady
        ? 'Use Seedance verification video reference route.'
        : videoReferenceBlocked
          ? 'Seedance video reference is blocked by provider safety. Configure Runway/Kling likeness canary or use soft self guidance.'
        : videoReferenceStatus === 'retry_later'
          ? 'Retry Seedance video reference canary later.'
        : videoReferenceStatus === 'input_needs_repair'
          ? 'Normalize verification video or try a schema variant.'
        : input.selfVerificationVideo?.selfVerificationVideoPresent
          ? input.selfVerificationVideo.recommendedNextAction
          : 'Record self verification video before testing video references.',
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
      canaryStatus: seedanceReferenceStatus,
      readinessStatus: seedanceReferenceBlockedBySafety ? 'blocked' : seedanceReferenceStatus,
      lastSuccessAt: routeTimestamp(successfulSeedanceRoute),
      lastFailureCategory: routeFailure(blockedSeedanceRoute) ?? summary.failureCategory,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: seedanceReferenceSucceeded
        ? 'ready'
        : seedanceReferenceBlockedBySafety || summary.seedanceReferenceRoutesBlocked
          ? 'blocked'
          : Boolean(env.REPLICATE_API_TOKEN)
            ? 'available'
            : 'not_configured',
      recommendedNextAction: seedanceReferenceSucceeded
        ? 'Use the successful Seedance reference route.'
        : seedanceReferenceBlockedBySafety || summary.seedanceReferenceRoutesBlocked
          ? 'Configure Runway/Kling likeness canary or use soft self guidance.'
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
      readinessStatus: openAICharacterCanaryStatus,
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
      configured: klingReadiness.configured,
      supportsExactLikeness: klingExactReady,
      supportsReferenceImages: klingReadiness.configured,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: true,
      canaryStatus: klingReadiness.status,
      readinessStatus: klingReadiness.status,
      lastSuccessAt: klingStatus?.lastSuccessAt ?? null,
      lastFailureCategory: klingStatus?.lastFailureCategory ?? null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: klingExactReady
        ? 'ready'
        : klingReadiness.configured
          ? klingReadiness.status === 'configured_not_implemented'
            ? 'configured_not_implemented'
            : klingReadiness.status === 'blocked'
              ? 'blocked'
              : klingReadiness.status === 'billing_required'
                ? 'billing_required'
                : 'configured_ready_for_canary'
          : 'not_configured',
      recommendedNextAction: klingReadiness.recommendedNextAction,
    },
    {
      id: 'runway_gen4_reference',
      displayName: 'Runway Gen-4 reference route',
      configured: runwayReadiness.configured,
      supportsExactLikeness: runwayExactReady,
      supportsReferenceImages: runwayReadiness.configured,
      supportsStoredCharacters: false,
      requiresConsent: false,
      requiresCanary: true,
      canaryStatus: runwayReadiness.status,
      readinessStatus: runwayReadiness.status,
      lastSuccessAt: runwayStatus?.lastSuccessAt ?? null,
      lastFailureCategory: runwayStatus?.lastFailureCategory ?? null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: runwayExactReady
        ? 'ready'
        : runwayReadiness.configured
          ? 'configured_ready_for_canary'
          : 'not_configured',
      recommendedNextAction: runwayReadiness.recommendedNextAction,
    },
    {
      id: 'lumora_identity_pack',
      displayName: 'Lumora Identity Pack',
      configured: false,
      supportsExactLikeness: false,
      supportsReferenceImages: false,
      supportsStoredCharacters: true,
      requiresConsent: true,
      requiresCanary: true,
      canaryStatus: 'research_only',
      readinessStatus: 'research_only',
      lastSuccessAt: null,
      lastFailureCategory: null,
      deprecated: false,
      shutdownDate: null,
      implementationStatus: 'research_only',
      recommendedNextAction: 'Research-only future private identity adapter; do not route production renders here.',
    },
  ];
}
