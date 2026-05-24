import { getReferenceRouteSummary } from './seedanceCanary';
import {
  buildLikenessProviderRegistry,
  type LikenessProviderRegistryEntry,
} from './likenessProviderRegistry';
import { getAlternateExactLikenessProviderStatuses } from './alternateLikenessProviderMemory';
import { getSelfVerificationVideoDiagnostics } from './selfVerificationVideo';
import {
  getOpenAISoraProviderReadiness,
  getSelfProviderCharacterDiagnostics,
  type OpenAISoraProviderReadiness,
  type SelfProviderCharacterDiagnostics,
} from './providers/openaiSoraProvider';

export type ExactLikenessRoute =
  | 'openai_sora_character'
  | 'kling_reference'
  | 'runway_reference'
  | 'seedance_video_reference'
  | 'seedance_reference'
  | 'seedance_text_guidance';

export type ExactLikenessProvider = 'openai_sora' | 'kling' | 'runway' | 'seedance';
export type ExactLikenessConfidence = 'high' | 'medium' | 'low' | 'fallback';

type ReferenceRouteSummaryLike = Awaited<ReturnType<typeof getReferenceRouteSummary>>;

export type ExactLikenessRouterResult = {
  route: ExactLikenessRoute;
  provider: ExactLikenessProvider;
  confidence: ExactLikenessConfidence;
  exactLikeness: boolean;
  reason: string;
  requiredSetup: string[];
  canaryStatus: string | null;
  fallbackRoute: 'seedance_text_guidance';
  providerRegistry: LikenessProviderRegistryEntry[];
  recommendedNextAction: string;
};

function registryEntry(registry: LikenessProviderRegistryEntry[], id: LikenessProviderRegistryEntry['id']) {
  return registry.find((entry) => entry.id === id) ?? null;
}

function hasOpenAIExactRoute(input: {
  readiness: OpenAISoraProviderReadiness;
  identity: SelfProviderCharacterDiagnostics;
}) {
  return Boolean(
    input.readiness.openaiCharacterConfigured &&
    input.readiness.characterVideoUsageMapped &&
    input.identity.selfProviderCharacterIdPresent &&
    input.identity.selfProviderCharacterStatus === 'ready' &&
    input.identity.likenessProviderStatus === 'canary_succeeded',
  );
}

function openAIRequiredSetup(input: {
  readiness: OpenAISoraProviderReadiness;
  identity: SelfProviderCharacterDiagnostics;
}) {
  const setup: string[] = [];
  if (!input.readiness.openaiVideoEnabled) setup.push('enable OPENAI_VIDEO_ENABLED');
  if (!input.readiness.openaiCharacterEnabled) setup.push('enable OPENAI_VIDEO_CHARACTER_ENABLED');
  if (!input.readiness.openaiApiKeyConfigured) setup.push('set OPENAI_API_KEY');
  if (!input.identity.selfProviderCharacterIdPresent) setup.push('create provider self character with consent video');
  if (!input.readiness.characterVideoUsageMapped) setup.push('map documented character video usage field');
  if (input.identity.selfProviderCharacterIdPresent && input.identity.likenessProviderStatus !== 'canary_succeeded') {
    setup.push('run successful exact likeness canary');
  }
  return setup;
}

export function chooseExactLikenessRoute(input: {
  openAISoraReadiness: OpenAISoraProviderReadiness;
  selfProviderCharacter: SelfProviderCharacterDiagnostics;
  referenceRouteSummary: ReferenceRouteSummaryLike;
  providerRegistry?: LikenessProviderRegistryEntry[];
}): ExactLikenessRouterResult {
  const registry = input.providerRegistry ?? buildLikenessProviderRegistry({
    openAISoraReadiness: input.openAISoraReadiness,
    selfProviderCharacter: input.selfProviderCharacter,
    referenceRouteSummary: input.referenceRouteSummary,
  });
  const openAI = registryEntry(registry, 'openai_sora_character');

  if (hasOpenAIExactRoute({
    readiness: input.openAISoraReadiness,
    identity: input.selfProviderCharacter,
  })) {
    return {
      route: 'openai_sora_character',
      provider: 'openai_sora',
      confidence: 'high',
      exactLikeness: true,
      reason: 'OpenAI/Sora provider character exists, character video usage is mapped, and the canary succeeded.',
      requiredSetup: [],
      canaryStatus: input.selfProviderCharacter.soraCharacterCanaryStatus ?? 'succeeded',
      fallbackRoute: 'seedance_text_guidance',
      providerRegistry: registry,
      recommendedNextAction: 'Use exact self character route.',
    };
  }

  const seedanceVideoReference = registryEntry(registry, 'seedance_video_reference');
  if (
    seedanceVideoReference?.configured &&
    seedanceVideoReference.supportsExactLikeness &&
    (seedanceVideoReference.canaryStatus === 'canary_succeeded' || seedanceVideoReference.canaryStatus === 'succeeded')
  ) {
    return {
      route: 'seedance_video_reference',
      provider: 'seedance',
      confidence: 'high',
      exactLikeness: true,
      reason: 'Seedance verification video reference route has a successful canary.',
      requiredSetup: [],
      canaryStatus: seedanceVideoReference.canaryStatus,
      fallbackRoute: 'seedance_text_guidance',
      providerRegistry: registry,
      recommendedNextAction: 'Use Seedance video reference route for self-character likeness.',
    };
  }

  const runway = registryEntry(registry, 'runway_gen4_reference');
  if (runway?.configured && runway.supportsExactLikeness && runway.canaryStatus === 'canary_succeeded') {
    return {
      route: 'runway_reference',
      provider: 'runway',
      confidence: 'high',
      exactLikeness: true,
      reason: 'Runway reference route is configured and has a successful canary.',
      requiredSetup: [],
      canaryStatus: runway.canaryStatus,
      fallbackRoute: 'seedance_text_guidance',
      providerRegistry: registry,
      recommendedNextAction: 'Use Runway exact likeness route.',
    };
  }

  const kling = registryEntry(registry, 'kling_reference');
  if (kling?.configured && kling.supportsExactLikeness && kling.canaryStatus === 'canary_succeeded') {
    return {
      route: 'kling_reference',
      provider: 'kling',
      confidence: 'high',
      exactLikeness: true,
      reason: 'Kling reference route is configured and has a successful canary.',
      requiredSetup: [],
      canaryStatus: kling.canaryStatus,
      fallbackRoute: 'seedance_text_guidance',
      providerRegistry: registry,
      recommendedNextAction: 'Use Kling exact likeness route.',
    };
  }

  const seedanceReference = registryEntry(registry, 'seedance_reference_images');
  if (
    seedanceReference?.configured &&
    seedanceReference.canaryStatus === 'succeeded' &&
    input.referenceRouteSummary.knownSuccessfulReferenceRoutes.length > 0 &&
    !input.referenceRouteSummary.seedanceReferenceRoutesBlocked
  ) {
    return {
      route: 'seedance_reference',
      provider: 'seedance',
      confidence: 'medium',
      exactLikeness: true,
      reason: 'A Seedance reference route has succeeded before and is not blocked.',
      requiredSetup: [],
      canaryStatus: seedanceReference.canaryStatus,
      fallbackRoute: 'seedance_text_guidance',
      providerRegistry: registry,
      recommendedNextAction: 'Use the successful Seedance reference route.',
    };
  }

  const setup = openAIRequiredSetup({
    readiness: input.openAISoraReadiness,
    identity: input.selfProviderCharacter,
  });
  const blocked = input.referenceRouteSummary.seedanceReferenceRoutesBlocked;
  const configuredButUnsupported = registry.filter((entry) => (
    entry.configured && entry.implementationStatus === 'configured_not_implemented'
  ));
  const reason = blocked
    ? 'No exact likeness route is ready; Seedance self reference routes are blocked, so Lumora uses soft text guidance.'
    : configuredButUnsupported.length
      ? 'Configured exact likeness providers still need implementation or a successful canary, so Lumora uses soft text guidance.'
      : 'No canary-proven exact likeness provider is available, so Lumora uses soft text guidance.';

  return {
    route: 'seedance_text_guidance',
    provider: 'seedance',
    confidence: 'fallback',
    exactLikeness: false,
    reason,
    requiredSetup: setup,
    canaryStatus: seedanceVideoReference?.canaryStatus ?? openAI?.canaryStatus ?? null,
    fallbackRoute: 'seedance_text_guidance',
    providerRegistry: registry,
    recommendedNextAction: seedanceVideoReference?.canaryStatus === 'retry_later'
      ? 'Retry Seedance video reference canary later.'
      : blocked
      ? 'Continue using Seedance text-first and configure an alternate likeness provider.'
      : seedanceVideoReference?.recommendedNextAction ?? setup[0] ?? 'Run a canary for a configured exact likeness provider.',
  };
}

export async function resolveExactLikenessRoute(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}) {
  const openAISoraReadiness = getOpenAISoraProviderReadiness();
  const [selfProviderCharacter, referenceRouteSummary, selfVerificationVideo] = await Promise.all([
    getSelfProviderCharacterDiagnostics(input),
    getReferenceRouteSummary(input),
    getSelfVerificationVideoDiagnostics(input),
  ]);
  const providerRegistry = buildLikenessProviderRegistry({
    openAISoraReadiness,
    selfProviderCharacter,
    selfVerificationVideo,
    referenceRouteSummary,
    alternateProviderStatuses: await getAlternateExactLikenessProviderStatuses(input),
  });

  return chooseExactLikenessRoute({
    openAISoraReadiness,
    selfProviderCharacter,
    referenceRouteSummary,
    providerRegistry,
  });
}

export function exactLikenessCanaryCandidate(input: ExactLikenessRouterResult) {
  const seedanceVideoReference = registryEntry(input.providerRegistry, 'seedance_video_reference');
  if (
    seedanceVideoReference?.configured &&
    seedanceVideoReference.canaryStatus !== 'succeeded' &&
    seedanceVideoReference.canaryStatus !== 'canary_succeeded'
  ) {
    return {
      provider: 'seedance',
      route: 'seedance_video_reference' as const,
      status: seedanceVideoReference.canaryStatus,
    };
  }

  const runway = registryEntry(input.providerRegistry, 'runway_gen4_reference');
  if (runway?.configured && runway.readinessStatus === 'configured_ready_for_canary') {
    return {
      provider: 'runway',
      route: 'runway_reference' as const,
      status: 'configured_ready_for_canary',
    };
  }

  const kling = registryEntry(input.providerRegistry, 'kling_reference');
  if (kling?.configured && kling.readinessStatus === 'configured_ready_for_canary') {
    return {
      provider: 'kling',
      route: 'kling_reference' as const,
      status: 'configured_ready_for_canary',
    };
  }

  const openAI = registryEntry(input.providerRegistry, 'openai_sora_character');
  if (
    openAI?.configured &&
    openAI.implementationStatus === 'available' &&
    openAI.canaryStatus !== 'succeeded'
  ) {
    return {
      provider: 'openai_sora',
      route: 'openai_sora_character' as const,
      status: 'needs_canary',
    };
  }

  const seedanceReference = registryEntry(input.providerRegistry, 'seedance_reference_images');
  if (
    seedanceReference?.configured &&
    seedanceReference.canaryStatus === 'not_tested' &&
    seedanceReference.implementationStatus === 'available'
  ) {
    return {
      provider: 'seedance',
      route: 'seedance_reference' as const,
      status: 'needs_canary',
    };
  }

  const configuredUnsupported = input.providerRegistry.find((entry) => (
    entry.configured && entry.implementationStatus === 'configured_not_implemented'
  ));
  if (configuredUnsupported) {
    return {
      provider: configuredUnsupported.id,
      route: configuredUnsupported.id,
      status: 'configured_not_implemented',
    };
  }

  return null;
}
