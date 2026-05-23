import { env } from './env';
import { getOpenAISoraProviderReadiness } from '../services/providers/openaiSoraProvider';

export type EnvironmentDiagnostics = {
  ok: boolean;
  mode: string;
  configured: Record<string, boolean>;
  missingRequired: string[];
  missingRecommended: string[];
  billing: {
    enabled: boolean;
    required: boolean;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'missing_required';
    missing: string[];
    blocking: boolean;
  };
  generationProviders: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'placeholder';
  }>;
};

export function getEnvironmentDiagnostics(): EnvironmentDiagnostics {
  const openAISora = getOpenAISoraProviderReadiness();
  const stripeMissing = [
    ['STRIPE_SECRET_KEY', Boolean(env.STRIPE_SECRET_KEY)],
    ['STRIPE_WEBHOOK_SECRET', Boolean(env.STRIPE_WEBHOOK_SECRET)],
  ].flatMap(([name, ready]) => (ready ? [] : [String(name)]));
  const stripeReady = stripeMissing.length === 0;
  const billingRequired = env.BILLING_ENABLED || env.REQUIRE_STRIPE;
  const billing = {
    enabled: env.BILLING_ENABLED,
    required: billingRequired,
    ready: stripeReady,
    status: stripeReady
      ? 'ready'
      : billingRequired
        ? 'missing_required'
        : 'not_configured',
    missing: stripeMissing,
    blocking: billingRequired && !stripeReady,
  } satisfies EnvironmentDiagnostics['billing'];

  const configured = {
    database: Boolean(env.DATABASE_URL),
    supabaseAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    replicate: Boolean(env.REPLICATE_API_TOKEN),
    googleVeo: Boolean(env.GOOGLE_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    openaiVideo: openAISora.routeReady,
    klingReference: Boolean(env.KLING_ENABLED && env.KLING_API_KEY && env.KLING_REFERENCE_MODEL),
    runwayReference: Boolean(env.RUNWAY_ENABLED && env.RUNWAY_API_KEY && (env.RUNWAY_REFERENCE_MODEL ?? env.RUNWAY_MODEL)),
    stripe: stripeReady,
    billing: billing.enabled,
    redis: Boolean(env.REDIS_URL),
  };

  const missingRequired = [
    ['DATABASE_URL', configured.database],
    ['SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY', configured.supabaseAdmin],
    ['REPLICATE_API_TOKEN', configured.replicate],
    ['STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET', !billing.blocking],
  ].flatMap(([name, ready]) => (ready ? [] : [String(name)]));
  const missingRecommended = [
    ...missingRequired,
    ...(!billing.required && !billing.ready
      ? [`Stripe billing not configured (${stripeMissing.join(' + ')})`]
      : []),
  ];

  return {
    ok: missingRequired.length === 0,
    mode: process.env.NODE_ENV ?? 'development',
    configured,
    missingRequired,
    missingRecommended,
    billing,
    generationProviders: [
      {
        id: 'seedance-fast',
        ready: configured.replicate,
        status: configured.replicate ? 'ready' : 'not_configured',
      },
      {
        id: 'seedance-quality',
        ready: configured.replicate,
        status: configured.replicate ? 'ready' : 'not_configured',
      },
      {
        id: 'veo-experimental',
        ready: configured.googleVeo,
        status: configured.googleVeo ? 'ready' : 'placeholder',
      },
      {
        id: 'openai-sora-character',
        ready: openAISora.routeReady,
        status: openAISora.routeReady ? 'ready' : env.OPENAI_VIDEO_ENABLED ? 'placeholder' : 'not_configured',
      },
      {
        id: 'kling-reference',
        ready: false,
        status: configured.klingReference ? 'placeholder' : 'not_configured',
      },
      {
        id: 'runway-gen4-reference',
        ready: false,
        status: configured.runwayReference ? 'placeholder' : 'not_configured',
      },
      {
        id: 'demo-mode',
        ready: true,
        status: 'ready',
      },
    ],
  };
}

export function logEnvironmentDiagnostics() {
  const diagnostics = getEnvironmentDiagnostics();
  console.info('LUMORA ENVIRONMENT DIAGNOSTICS:', diagnostics);

  if (diagnostics.missingRecommended.length) {
    console.warn('LUMORA MISSING RECOMMENDED ENV:', diagnostics.missingRecommended);
  }
}
