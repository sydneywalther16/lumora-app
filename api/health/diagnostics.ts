import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEnvironmentDiagnostics } from '../../backend/src/lib/envDiagnostics';
import { supabaseAdmin } from '../../backend/src/lib/supabaseAdmin';
import { query } from '../../backend/src/services/db';

function serializeDiagnosticError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (!error || typeof error !== 'object') return { message: String(error) };
  return Object.fromEntries(
    Object.entries(error as Record<string, unknown>).map(([key, value]) => [
      key,
      value && typeof value === 'object' ? JSON.stringify(value) : value,
    ]),
  );
}

async function checkSupabaseTable(tableName: string) {
  if (!supabaseAdmin) {
    return {
      ok: false,
      table: tableName,
      source: 'supabase-service-role',
      error: 'Supabase service role client is not configured.',
    };
  }

  const { count, error } = await supabaseAdmin
    .from(tableName)
    .select('id', { count: 'exact', head: true });

  return {
    ok: !error,
    table: tableName,
    source: 'supabase-service-role',
    count: count ?? null,
    error: error ? serializeDiagnosticError(error) : null,
  };
}

async function checkRlsPolicies() {
  try {
    const result = await query<Record<string, unknown>>(
      `select tablename, policyname, cmd, roles, qual, with_check
       from pg_policies
       where schemaname = 'public'
         and tablename in ('projects', 'generation_jobs')
       order by tablename, policyname`,
    );

    return {
      ok: true,
      source: 'database-url',
      policies: result.rows,
    };
  } catch (error) {
    return {
      ok: false,
      source: 'database-url',
      error: serializeDiagnosticError(error),
    };
  }
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    service: 'lumora-vercel-api',
    checkedAt: new Date().toISOString(),
    ...getEnvironmentDiagnostics(),
    database: {
      serviceRoleConfigured: Boolean(supabaseAdmin),
      tables: await Promise.all([
        checkSupabaseTable('projects'),
        checkSupabaseTable('generation_jobs'),
      ]),
      rlsPolicies: await checkRlsPolicies(),
    },
  }));
}
