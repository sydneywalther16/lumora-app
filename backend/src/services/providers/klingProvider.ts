import { env } from '../../lib/env';
import { getAlternateProviderStatus, type AlternateExactLikenessProviderStatus } from '../alternateLikenessProviderMemory';

export type KlingReadinessStatus =
  | 'not_configured'
  | 'configured_not_implemented'
  | 'configured_ready_for_canary'
  | 'canary_succeeded'
  | 'canary_failed';

export function getKlingProviderReadiness(input: {
  statuses?: AlternateExactLikenessProviderStatus[] | null;
} = {}) {
  const configured = Boolean(env.KLING_ENABLED && env.KLING_API_KEY && env.KLING_REFERENCE_MODEL);
  const stored = getAlternateProviderStatus(input.statuses, 'kling_reference');
  const status: KlingReadinessStatus = !configured
    ? 'not_configured'
    : stored?.status === 'canary_succeeded'
      ? 'canary_succeeded'
      : stored?.status === 'canary_failed'
        ? 'canary_failed'
        : 'configured_not_implemented';

  return {
    provider: 'kling_reference',
    displayName: 'Kling reference route',
    configured,
    enabled: env.KLING_ENABLED,
    apiKeyConfigured: Boolean(env.KLING_API_KEY),
    model: env.KLING_MODEL ?? null,
    referenceModel: env.KLING_REFERENCE_MODEL ?? null,
    status,
    implemented: false,
    canarySucceeded: status === 'canary_succeeded',
    canaryFailed: status === 'canary_failed',
    recommendedNextAction: !configured
      ? 'Set KLING_ENABLED=true, KLING_API_KEY, and KLING_REFERENCE_MODEL to evaluate Kling.'
      : status === 'canary_succeeded'
        ? 'Kling canary succeeded; router may use it for exact likeness.'
        : status === 'canary_failed'
          ? 'Inspect the last Kling canary failure before production routing.'
          : 'Kling is configured, but Lumora has not mapped a trusted reference-video payload yet.',
  };
}

export async function startKlingSelfLikenessCanary() {
  const readiness = getKlingProviderReadiness();
  if (!readiness.configured) {
    return {
      ok: false,
      provider: 'kling',
      route: 'kling_reference',
      configured: false,
      readinessStatus: readiness.status,
      canaryStatus: readiness.status,
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory: 'not_configured',
      recommendedNextAction: readiness.recommendedNextAction,
    };
  }

  return {
    ok: false,
    provider: 'kling',
    route: 'kling_reference',
    configured: true,
    readinessStatus: 'configured_not_implemented',
    canaryStatus: 'configured_not_implemented',
    outputUrlPresent: false,
    verifiedVideoPresent: false,
    failureCategory: 'configured_not_implemented',
    recommendedNextAction: 'Kling is configured, but Lumora needs a verified official reference/image-to-video payload mapping before running paid canaries.',
  };
}
