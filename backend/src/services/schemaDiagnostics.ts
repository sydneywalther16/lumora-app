import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';

export type SchemaDiagnosticCheck = {
  ok: boolean;
  name: string;
  label: string;
  source: 'database-url' | 'supabase-service-role';
  table?: string;
  column?: string;
  count?: number | null;
  details?: Record<string, unknown>;
  error?: unknown;
  remediation?: string;
};

const requiredTables = [
  'projects',
  'generation_jobs',
  'character_profiles',
  'continuity_memory_states',
] as const;

const requiredGenerationJobColumns = [
  'character_id',
  'scene_execution_id',
  'scene_id',
  'clip_order',
  'scene_metadata',
] as const;

export function serializeDiagnosticError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }

  return Object.fromEntries(
    Object.entries(error as Record<string, unknown>).map(([key, value]) => [
      key,
      value && typeof value === 'object' ? JSON.stringify(value) : value,
    ]),
  );
}

async function checkSupabaseTable(tableName: typeof requiredTables[number]): Promise<SchemaDiagnosticCheck> {
  if (!supabaseAdmin) {
    return {
      ok: false,
      name: `supabase-read.${tableName}`,
      label: `${tableName} readable`,
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
    name: `supabase-read.${tableName}`,
    label: `${tableName} readable`,
    table: tableName,
    source: 'supabase-service-role',
    count: count ?? null,
    error: error ? serializeDiagnosticError(error) : null,
    remediation: error ? 'Apply the latest Supabase migrations and verify SUPABASE_SERVICE_ROLE_KEY.' : undefined,
  };
}

async function checkTableExists(tableName: typeof requiredTables[number]): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ exists: boolean }>(
      `select exists (
         select 1
         from information_schema.tables
         where table_schema = 'public'
           and table_name = $1
       ) as "exists"`,
      [tableName],
    );
    const exists = Boolean(result.rows[0]?.exists);

    return {
      ok: exists,
      name: `table.${tableName}`,
      label: `${tableName} table exists`,
      table: tableName,
      source: 'database-url',
      remediation: exists ? undefined : 'Apply the latest Supabase migration in docs/DEPLOY_FAST.md.',
    };
  } catch (error) {
    return {
      ok: false,
      name: `table.${tableName}`,
      label: `${tableName} table exists`,
      table: tableName,
      source: 'database-url',
      error: serializeDiagnosticError(error),
    };
  }
}

async function checkColumnExists(tableName: string, columnName: string): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ exists: boolean; dataType: string | null; udtName: string | null }>(
      `select
         exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = $1
             and column_name = $2
         ) as "exists",
         (
           select data_type
           from information_schema.columns
           where table_schema = 'public'
             and table_name = $1
             and column_name = $2
           limit 1
         ) as "dataType",
         (
           select udt_name
           from information_schema.columns
           where table_schema = 'public'
             and table_name = $1
             and column_name = $2
           limit 1
         ) as "udtName"`,
      [tableName, columnName],
    );
    const row = result.rows[0];
    const exists = Boolean(row?.exists);

    return {
      ok: exists,
      name: `column.${tableName}.${columnName}`,
      label: `${tableName}.${columnName} exists`,
      table: tableName,
      column: columnName,
      source: 'database-url',
      details: exists ? { dataType: row?.dataType ?? null, udtName: row?.udtName ?? null } : undefined,
      remediation: exists ? undefined : 'Run the Character Profiles schema repair migration.',
    };
  } catch (error) {
    return {
      ok: false,
      name: `column.${tableName}.${columnName}`,
      label: `${tableName}.${columnName} exists`,
      table: tableName,
      column: columnName,
      source: 'database-url',
      error: serializeDiagnosticError(error),
    };
  }
}

async function checkIndexExists(indexName: string): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ exists: boolean }>(
      `select to_regclass($1) is not null as "exists"`,
      [`public.${indexName}`],
    );
    const exists = Boolean(result.rows[0]?.exists);

    return {
      ok: exists,
      name: `index.${indexName}`,
      label: `${indexName} index exists`,
      source: 'database-url',
      remediation: exists ? undefined : 'Run the Character Profiles schema repair migration.',
    };
  } catch (error) {
    return {
      ok: false,
      name: `index.${indexName}`,
      label: `${indexName} index exists`,
      source: 'database-url',
      error: serializeDiagnosticError(error),
    };
  }
}

async function checkServiceRoleAccess(tableName: typeof requiredTables[number]): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{
      tableExists: boolean;
      canSelect: boolean;
      canInsert: boolean;
      canUpdate: boolean;
    }>(
      `with target as (
         select to_regclass($1::text) as table_regclass
       )
       select
         table_regclass is not null as "tableExists",
         case when table_regclass is null then false else has_table_privilege('service_role', table_regclass, 'select') end as "canSelect",
         case when table_regclass is null then false else has_table_privilege('service_role', table_regclass, 'insert') end as "canInsert",
         case when table_regclass is null then false else has_table_privilege('service_role', table_regclass, 'update') end as "canUpdate"
       from target`,
      [`public.${tableName}`],
    );
    const row = result.rows[0];
    const ok = Boolean(row?.tableExists && row.canSelect && row.canInsert && row.canUpdate);

    return {
      ok,
      name: `service-role-access.${tableName}`,
      label: `service_role can read/write ${tableName}`,
      table: tableName,
      source: 'database-url',
      details: {
        tableExists: Boolean(row?.tableExists),
        canSelect: Boolean(row?.canSelect),
        canInsert: Boolean(row?.canInsert),
        canUpdate: Boolean(row?.canUpdate),
      },
      remediation: ok ? undefined : 'Verify Supabase grants and service role permissions after applying migrations.',
    };
  } catch (error) {
    return {
      ok: false,
      name: `service-role-access.${tableName}`,
      label: `service_role can read/write ${tableName}`,
      table: tableName,
      source: 'database-url',
      error: serializeDiagnosticError(error),
    };
  }
}

async function checkRlsPolicies() {
  try {
    const result = await query<Record<string, unknown>>(
      `select tablename, policyname, cmd, roles, qual, with_check
       from pg_policies
       where schemaname = 'public'
         and tablename in ('projects', 'generation_jobs', 'character_profiles', 'continuity_memory_states')
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

export async function buildDatabaseDiagnostics() {
  const tables = await Promise.all(requiredTables.map(checkSupabaseTable));
  const tableChecks = await Promise.all(requiredTables.map(checkTableExists));
  const generationJobColumnChecks = await Promise.all(
    requiredGenerationJobColumns.map((column) => checkColumnExists('generation_jobs', column)),
  );
  const indexChecks = await Promise.all([
    checkIndexExists('generation_jobs_character_id_text_idx'),
    checkIndexExists('generation_jobs_scene_execution_idx'),
    checkIndexExists('generation_jobs_scene_id_idx'),
    checkIndexExists('character_profiles_owner_character_id_idx'),
    checkIndexExists('continuity_memory_states_user_updated_idx'),
    checkIndexExists('continuity_memory_states_character_idx'),
  ]);
  const serviceRoleAccess = await Promise.all(requiredTables.map(checkServiceRoleAccess));
  const rlsPolicies = await checkRlsPolicies();
  const schemaChecks = [...tableChecks, ...generationJobColumnChecks, ...indexChecks];

  return {
    ok:
      tables.every((check) => check.ok) &&
      schemaChecks.every((check) => check.ok) &&
      serviceRoleAccess.every((check) => check.ok) &&
      rlsPolicies.ok,
    serviceRoleConfigured: Boolean(supabaseAdmin),
    tables,
    schemaChecks,
    serviceRoleAccess,
    rlsPolicies,
  };
}
