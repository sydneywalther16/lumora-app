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
  'profiles',
  'projects',
  'generation_jobs',
  'posts',
  'follows',
  'character_profiles',
  'continuity_memory_states',
] as const;

const requiredGenerationJobColumns = [
  'status',
  'character_id',
  'scene_execution_id',
  'scene_id',
  'clip_order',
  'scene_metadata',
] as const;

const feedProjectColumns = [
  'status',
  'published_at',
  'thumbnail_url',
  'poster_url',
  'privacy',
  'visibility',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
] as const;

const feedPostColumns = [
  'status',
  'published_at',
  'thumbnail_url',
  'poster_url',
  'privacy',
  'visibility',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
] as const;

const characterProfileColumns = [
  'owner_user_id',
  'reference_image_urls',
  'thumbnail_url',
  'is_self',
  'created_at',
  'updated_at',
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
    .select('*', { count: 'exact', head: true });

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

async function checkAnyColumnExists(
  tableName: string,
  columnNames: readonly string[],
  name: string,
  label: string,
  remediation: string,
): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ columnName: string; dataType: string; udtName: string }>(
      `select column_name as "columnName", data_type as "dataType", udt_name as "udtName"
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = any($2::text[])
       order by array_position($2::text[], column_name)`,
      [tableName, columnNames],
    );
    const ok = result.rows.length > 0;

    return {
      ok,
      name,
      label,
      table: tableName,
      source: 'database-url',
      details: {
        acceptedColumns: columnNames,
        presentColumns: result.rows,
      },
      remediation: ok ? undefined : remediation,
    };
  } catch (error) {
    return {
      ok: false,
      name,
      label,
      table: tableName,
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

async function checkPublishedPostsQuery(): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ count: number }>(
      `select count(*)::int as count
       from posts
       where status = 'published'
         and coalesce(privacy, visibility, 'public') = 'public'`,
    );

    return {
      ok: true,
      name: 'query.posts.published-profile',
      label: 'published profile posts query works',
      table: 'posts',
      source: 'database-url',
      count: result.rows[0]?.count ?? 0,
    };
  } catch (error) {
    return {
      ok: false,
      name: 'query.posts.published-profile',
      label: 'published profile posts query works',
      table: 'posts',
      source: 'database-url',
      error: serializeDiagnosticError(error),
      remediation: 'Run the Feed/Drafts and Profile Characters UI migrations.',
    };
  }
}

async function checkProfileStatsQuery(): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{
      totalLikesReceived: number;
      characterProfilesCount: number;
      followsTableExists: boolean;
    }>(
      `select
         coalesce((select sum(like_count)::int from posts where status = 'published'), 0) as "totalLikesReceived",
         coalesce((select count(*)::int from character_profiles), 0) as "characterProfilesCount",
         to_regclass('public.follows') is not null as "followsTableExists"`,
    );

    return {
      ok: true,
      name: 'query.profile.stats',
      label: 'profile stats query works',
      source: 'database-url',
      details: result.rows[0] ?? {},
    };
  } catch (error) {
    return {
      ok: false,
      name: 'query.profile.stats',
      label: 'profile stats query works',
      source: 'database-url',
      error: serializeDiagnosticError(error),
      remediation: 'Run the Feed/Drafts, Character Profiles, and Profile Characters UI migrations.',
    };
  }
}

async function checkOwnProfileRlsPolicies(): Promise<SchemaDiagnosticCheck> {
  try {
    const result = await query<{ policyCount: number }>(
      `select count(*)::int as "policyCount"
       from pg_policies
       where schemaname = 'public'
         and tablename in ('profiles', 'character_profiles')
         and (
           coalesce(qual, '') like '%auth.uid()%'
           or coalesce(with_check, '') like '%auth.uid()%'
         )`,
    );
    const policyCount = result.rows[0]?.policyCount ?? 0;

    return {
      ok: policyCount >= 2,
      name: 'rls.profile-own-data',
      label: 'RLS own profile data policies exist',
      source: 'database-url',
      count: policyCount,
      remediation: policyCount >= 2 ? undefined : 'Apply the profile persistence and Character Profiles migrations.',
    };
  } catch (error) {
    return {
      ok: false,
      name: 'rls.profile-own-data',
      label: 'RLS own profile data policies exist',
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
         and tablename in ('profiles', 'projects', 'posts', 'follows', 'generation_jobs', 'character_profiles', 'continuity_memory_states')
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
  const feedProjectColumnChecks = await Promise.all(
    feedProjectColumns.map((column) => checkColumnExists('projects', column)),
  );
  const feedPostColumnChecks = await Promise.all(
    feedPostColumns.map((column) => checkColumnExists('posts', column)),
  );
  const characterProfileColumnChecks = await Promise.all(
    characterProfileColumns.map((column) => checkColumnExists('character_profiles', column)),
  );
  const mediaFallbackChecks = await Promise.all([
    checkAnyColumnExists(
      'character_profiles',
      ['thumbnail_url', 'reference_image_urls', 'reference_images'],
      'column-any.character_profiles.thumbnail-or-reference',
      'character_profiles thumbnail or reference fallback exists',
      'Run the Profile Characters UI migration.',
    ),
    checkAnyColumnExists(
      'generation_jobs',
      ['thumbnail_url', 'poster_url', 'result_asset_url'],
      'column-any.generation_jobs.thumbnail-poster-equivalent',
      'generation_jobs thumbnail/poster equivalent exists',
      'Run the base generation migrations.',
    ),
  ]);
  const publishedPostsQuery = await checkPublishedPostsQuery();
  const profileStatsQuery = await checkProfileStatsQuery();
  const ownProfileRlsPolicies = await checkOwnProfileRlsPolicies();
  const indexChecks = await Promise.all([
    checkIndexExists('generation_jobs_character_id_text_idx'),
    checkIndexExists('generation_jobs_scene_execution_idx'),
    checkIndexExists('generation_jobs_scene_id_idx'),
    checkIndexExists('character_profiles_owner_character_id_idx'),
    checkIndexExists('continuity_memory_states_user_updated_idx'),
    checkIndexExists('continuity_memory_states_character_idx'),
    checkIndexExists('projects_user_drafts_idx'),
    checkIndexExists('posts_public_published_idx'),
    checkIndexExists('follows_follower_idx'),
    checkIndexExists('follows_following_idx'),
    checkIndexExists('character_profiles_owner_self_created_idx'),
    checkIndexExists('posts_user_published_profile_idx'),
  ]);
  const serviceRoleAccess = await Promise.all(requiredTables.map(checkServiceRoleAccess));
  const rlsPolicies = await checkRlsPolicies();
  const schemaChecks = [
    ...tableChecks,
    ...generationJobColumnChecks,
    ...feedProjectColumnChecks,
    ...feedPostColumnChecks,
    ...characterProfileColumnChecks,
    ...mediaFallbackChecks,
    publishedPostsQuery,
    profileStatsQuery,
    ownProfileRlsPolicies,
    ...indexChecks,
  ];

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
