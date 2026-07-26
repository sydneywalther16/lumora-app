import { env } from '../lib/env';
import { query } from './db';
import { buildDirectorProductionDryRun } from './director/dryRunDiagnostics';

export type ReferenceRouteReadinessRow = {
  provider: string | null;
  referenceRole: string | null;
  variant: string | null;
  successCount: number | null;
  failureCount: number | null;
  failureCategory: string | null;
};

type SupabaseReferenceRouteReadinessRow = {
  provider?: unknown;
  reference_strategy?: unknown;
  notes?: unknown;
  success_count?: unknown;
  failure_count?: unknown;
  last_failure_category?: unknown;
};

const requiredSeedanceReferenceRoles = [
  'front_angle',
  'full_body',
  'side_angle_left',
  'side_angle_right',
] as const;

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSupabaseReferenceRouteRow(
  row: SupabaseReferenceRouteReadinessRow,
): ReferenceRouteReadinessRow {
  const notes = row.notes && typeof row.notes === 'object' && !Array.isArray(row.notes)
    ? row.notes as Record<string, unknown>
    : {};

  return {
    provider: nullableString(row.provider),
    referenceRole: nullableString(row.reference_strategy),
    variant: nullableString(notes.variant),
    successCount: nullableNumber(row.success_count),
    failureCount: nullableNumber(row.failure_count),
    failureCategory: nullableString(row.last_failure_category),
  };
}

function isSeedanceProvider(provider: string | null) {
  return provider === 'seedance-fast' || provider === 'seedance-quality';
}

export function buildSafeReferenceRouteReadiness(rows: ReferenceRouteReadinessRow[]) {
  const routes = rows.map((row) => ({
    provider: row.provider,
    referenceRole: row.referenceRole,
    variant: row.variant,
    succeeded: (row.successCount ?? 0) > 0 && (row.successCount ?? 0) >= (row.failureCount ?? 0),
    failureCategory: row.failureCategory,
  }));
  const knownSuccessfulReferenceRoutes = routes.filter((route) => route.succeeded);
  const knownBlockedReferenceRoutes = routes.filter((route) => !route.succeeded);
  const blockedReferenceRoles = Array.from(new Set(
    knownBlockedReferenceRoutes
      .filter((route) => isSeedanceProvider(route.provider))
      .map((route) => route.referenceRole)
      .filter((role): role is string => Boolean(role)),
  ));
  const hasSeedanceModerationBlock = knownBlockedReferenceRoutes.some((route) => (
    isSeedanceProvider(route.provider) &&
    route.failureCategory === 'reference_moderation_block'
  ));
  const seedanceImageReferenceBlocked =
    knownSuccessfulReferenceRoutes.length === 0 &&
    hasSeedanceModerationBlock;
  const seedanceReferenceRoutesBlocked =
    knownSuccessfulReferenceRoutes.length === 0 &&
    requiredSeedanceReferenceRoles.every((role) => blockedReferenceRoles.includes(role));
  const best = knownSuccessfulReferenceRoutes[0] ?? null;

  return {
    referenceRouteStatus: {
      state: best ? 'succeeded' as const : knownBlockedReferenceRoutes.length ? 'failed' as const : 'unknown' as const,
      referenceRole: best?.referenceRole ?? null,
      variant: best?.variant ?? null,
      failureCategory: knownBlockedReferenceRoutes[0]?.failureCategory ?? null,
      seedanceReferenceRoutesBlocked,
      blockedReferenceRoles,
      requiredReferenceRoles: [...requiredSeedanceReferenceRoles],
      knownSuccessfulReferenceRoutes,
      knownBlockedReferenceRoutes,
      allReferenceRouteResults: routes,
    },
    seedanceImageReferenceBlocked,
  };
}

export async function fetchSafeReferenceRouteRowsFromSupabase({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}) {
  const url = new URL('/rest/v1/render_success_memory', supabaseUrl);
  url.searchParams.set(
    'select',
    'provider,reference_strategy,notes,success_count,failure_count,last_failure_category',
  );
  url.searchParams.set('render_mode', 'eq.reference_route_canary');
  url.searchParams.set('order', 'updated_at.desc');
  url.searchParams.set('limit', '40');

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error('Supabase readiness query failed.');
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Supabase readiness query returned an invalid response.');
  }

  return payload.map((row) => normalizeSupabaseReferenceRouteRow(
    row && typeof row === 'object' && !Array.isArray(row)
      ? row as SupabaseReferenceRouteReadinessRow
      : {},
  ));
}

export async function readSafeReferenceRouteReadiness() {
  if (!env.DATABASE_URL && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const rows = await fetchSafeReferenceRouteRowsFromSupabase({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return buildSafeReferenceRouteReadiness(rows);
  }

  const result = await query<ReferenceRouteReadinessRow>(
    `select
       provider,
       reference_strategy as "referenceRole",
       notes->>'variant' as "variant",
       success_count as "successCount",
       failure_count as "failureCount",
       last_failure_category as "failureCategory"
     from render_success_memory
     where render_mode = 'reference_route_canary'
     order by greatest(
       coalesce(last_success_at, '-infinity'::timestamptz),
       coalesce(last_failure_at, '-infinity'::timestamptz),
       updated_at
     ) desc
     limit 40`,
  );

  return buildSafeReferenceRouteReadiness(result.rows);
}

function generationProviders() {
  const replicateReady = Boolean(env.REPLICATE_API_TOKEN);
  const klingReady = Boolean(
    env.KLING_ENABLED &&
    env.KLING_REFERENCE_MODEL &&
    (env.FAL_KEY || env.KLING_API_KEY),
  );

  return [
    {
      id: 'seedance-2.0',
      ready: replicateReady,
      status: replicateReady ? 'ready' as const : 'not_configured' as const,
    },
    {
      id: 'seedance-quality',
      ready: replicateReady,
      status: replicateReady ? 'ready' as const : 'not_configured' as const,
    },
    {
      id: 'kling-reference-beta',
      ready: klingReady,
      status: klingReady ? 'ready' as const : 'not_configured' as const,
    },
    {
      id: 'demo-mode',
      ready: true,
      status: 'ready' as const,
    },
  ];
}

export async function buildProductionHealthDiagnostics() {
  const checkedAt = new Date().toISOString();
  const providers = generationProviders();
  const director = buildDirectorProductionDryRun();

  try {
    const readiness = await readSafeReferenceRouteReadiness();
    return {
      service: 'lumora-vercel-api',
      checkedAt,
      ok: providers.some((provider) => provider.id === 'seedance-2.0' && provider.ready),
      mode: process.env.NODE_ENV ?? 'production',
      configured: {
        database: Boolean(env.DATABASE_URL),
        supabaseAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        replicate: Boolean(env.REPLICATE_API_TOKEN),
      },
      missingRequired: env.REPLICATE_API_TOKEN ? [] : ['REPLICATE_API_TOKEN'],
      missingRecommended: env.REPLICATE_API_TOKEN ? [] : ['REPLICATE_API_TOKEN'],
      generationProviders: providers,
      database: {
        ok: true,
        serviceRoleConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        tables: [],
        schemaChecks: [],
      },
      ...readiness,
      director,
      secretsRedacted: true,
      privateUrlsRedacted: true,
    };
  } catch {
    return {
      service: 'lumora-vercel-api',
      checkedAt,
      ok: false,
      mode: process.env.NODE_ENV ?? 'production',
      configured: {
        database: Boolean(env.DATABASE_URL),
        supabaseAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        replicate: Boolean(env.REPLICATE_API_TOKEN),
      },
      missingRequired: env.REPLICATE_API_TOKEN ? [] : ['REPLICATE_API_TOKEN'],
      missingRecommended: ['Reference-route readiness unavailable'],
      generationProviders: providers,
      database: {
        ok: false,
        serviceRoleConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        tables: [],
        schemaChecks: [],
      },
      ...buildSafeReferenceRouteReadiness([]),
      director,
      diagnosticsError: {
        ok: false,
        key: 'referenceRouteStatus',
        message: 'Reference-route readiness is temporarily unavailable.',
      },
      secretsRedacted: true,
      privateUrlsRedacted: true,
    };
  }
}
