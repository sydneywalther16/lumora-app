import { env } from '../lib/env';
import { getOpenAISoraProviderReadiness } from './providers/openaiSoraProvider';

export type AlternateLikenessProvider = 'openai-sora-character' | 'kling-reference' | 'runway' | 'veo';

export type AlternateLikenessProviderStatus = {
  provider: AlternateLikenessProvider;
  configured: boolean;
  referenceCapable: boolean;
  canaryTested: boolean;
  productionRouteEnabled: boolean;
  lastReferenceResult: null;
  status: 'not_configured' | 'configured_needs_test';
};

export function buildAlternateLikenessProviderCanaryStatus(): AlternateLikenessProviderStatus[] {
  const openAISora = getOpenAISoraProviderReadiness();
  const providers: AlternateLikenessProviderStatus[] = [
    {
      provider: 'openai-sora-character',
      configured: openAISora.openaiCharacterConfigured,
      referenceCapable: openAISora.routeReady,
      canaryTested: false,
      productionRouteEnabled: openAISora.routeReady,
      lastReferenceResult: null,
      status: openAISora.routeReady
        ? 'configured_needs_test'
        : openAISora.openaiCharacterConfigured
          ? 'configured_needs_test'
          : 'not_configured',
    },
    {
      provider: 'kling-reference',
      configured: false,
      referenceCapable: false,
      canaryTested: false,
      productionRouteEnabled: false,
      lastReferenceResult: null,
      status: 'not_configured',
    },
    {
      provider: 'runway',
      configured: Boolean(env.RUNWAY_API_KEY),
      referenceCapable: false,
      canaryTested: false,
      productionRouteEnabled: false,
      lastReferenceResult: null,
      status: env.RUNWAY_API_KEY ? 'configured_needs_test' : 'not_configured',
    },
    {
      provider: 'veo',
      configured: Boolean(env.GOOGLE_API_KEY),
      referenceCapable: false,
      canaryTested: false,
      productionRouteEnabled: false,
      lastReferenceResult: null,
      status: env.GOOGLE_API_KEY ? 'configured_needs_test' : 'not_configured',
    },
  ];

  return providers;
}

export function alternateLikenessProvidersConfigured() {
  return buildAlternateLikenessProviderCanaryStatus().filter((provider) => provider.configured);
}

export function hasProductionReadyAlternateLikenessProvider() {
  return buildAlternateLikenessProviderCanaryStatus().some((provider) => (
    provider.configured && provider.referenceCapable && provider.canaryTested && provider.productionRouteEnabled
  ));
}
