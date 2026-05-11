import { env } from './env';

export type EnvironmentDiagnostics = {
  ok: boolean;
  mode: string;
  configured: Record<string, boolean>;
  missingRecommended: string[];
  generationProviders: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'placeholder';
  }>;
};

export function getEnvironmentDiagnostics(): EnvironmentDiagnostics {
  const configured = {
    database: Boolean(env.DATABASE_URL),
    supabaseAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    replicate: Boolean(env.REPLICATE_API_TOKEN),
    googleVeo: Boolean(env.GOOGLE_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    redis: Boolean(env.REDIS_URL),
  };

  const missingRecommended = [
    ['DATABASE_URL', configured.database],
    ['SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY', configured.supabaseAdmin],
    ['REPLICATE_API_TOKEN', configured.replicate],
    ['STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET', configured.stripe],
  ].flatMap(([name, ready]) => (ready ? [] : [String(name)]));

  return {
    ok: missingRecommended.length === 0,
    mode: process.env.NODE_ENV ?? 'development',
    configured,
    missingRecommended,
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
