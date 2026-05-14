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
  'moderation_orchestration_memory',
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

const moderationMemoryColumns = [
  'preferred_rendering_mode',
  'preferred_escalation_level',
  'provider_sensitivity_profile',
  'successful_fallback_path',
  'orchestration_path',
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

async function checkCharacterDeletionCleanupDiagnostics(): Promise<SchemaDiagnosticCheck[]> {
  try {
    const result = await query<{
      characterProfilesCount: number;
      orphanedMemoryEntries: number;
      orphanedModerationMemoryEntries: number;
      orphanedGenerationReferences: number;
    }>(
      `select
         coalesce((select count(*)::int from character_profiles), 0) as "characterProfilesCount",
         coalesce((
           select count(*)::int
           from continuity_memory_states cms
           where cms.character_id is not null
             and not exists (
               select 1
               from character_profiles cp
               where cp.owner_user_id = cms.user_id
                 and (cp.character_id = cms.character_id or cp.id::text = cms.character_id)
             )
         ), 0) as "orphanedMemoryEntries",
         coalesce((
           select count(*)::int
           from moderation_orchestration_memory mom
           where mom.character_id is not null
             and mom.user_id is not null
             and not exists (
               select 1
               from character_profiles cp
               where cp.owner_user_id = mom.user_id
                 and (cp.character_id = mom.character_id or cp.id::text = mom.character_id)
             )
         ), 0) as "orphanedModerationMemoryEntries",
         coalesce((
           select count(*)::int
           from generation_jobs gj
           where gj.character_id is not null
             and not exists (
               select 1
               from character_profiles cp
               where cp.owner_user_id = gj.user_id
                 and (cp.character_id = gj.character_id or cp.id::text = gj.character_id)
             )
         ), 0) as "orphanedGenerationReferences"`,
    );
    const details = result.rows[0] ?? {
      characterProfilesCount: 0,
      orphanedMemoryEntries: 0,
      orphanedModerationMemoryEntries: 0,
      orphanedGenerationReferences: 0,
    };

    return [
      {
        ok: details.orphanedMemoryEntries === 0 && details.orphanedModerationMemoryEntries === 0,
        name: 'query.characters.deletion-cleanup',
        label: 'deleted character cleanup validation',
        source: 'database-url',
        details,
        remediation: details.orphanedMemoryEntries === 0 && details.orphanedModerationMemoryEntries === 0
          ? undefined
          : 'Run character cleanup for orphaned continuity or orchestration memory rows.',
      },
      {
        ok: details.orphanedMemoryEntries === 0,
        name: 'query.characters.orphaned-continuity-memory',
        label: 'orphaned continuity memory check',
        source: 'database-url',
        count: details.orphanedMemoryEntries,
        remediation: details.orphanedMemoryEntries === 0 ? undefined : 'Delete continuity_memory_states rows for removed character profiles when safe.',
      },
      {
        ok: details.orphanedModerationMemoryEntries === 0,
        name: 'query.characters.orphaned-orchestration-memory',
        label: 'orphaned orchestration memory check',
        source: 'database-url',
        count: details.orphanedModerationMemoryEntries,
        remediation: details.orphanedModerationMemoryEntries === 0 ? undefined : 'Delete moderation_orchestration_memory rows for removed character profiles when safe.',
      },
      {
        ok: true,
        name: 'query.characters.orphaned-generation-references',
        label: 'orphaned generation references tracked',
        source: 'database-url',
        count: details.orphanedGenerationReferences,
        details: {
          preservedHistoryReferences: details.orphanedGenerationReferences,
          note: 'Historical generation references may remain so old videos and scene snapshots keep rendering.',
        },
      },
    ];
  } catch (error) {
    const failedCheck = {
      ok: false,
      source: 'database-url' as const,
      error: serializeDiagnosticError(error),
      remediation: 'Apply Character Profiles, Memory Engine, Scene Executor, and Moderation Orchestrator migrations.',
    };

    return [
      {
        ...failedCheck,
        name: 'query.characters.deletion-cleanup',
        label: 'deleted character cleanup validation',
      },
      {
        ...failedCheck,
        name: 'query.characters.orphaned-continuity-memory',
        label: 'orphaned continuity memory check',
      },
      {
        ...failedCheck,
        name: 'query.characters.orphaned-orchestration-memory',
        label: 'orphaned orchestration memory check',
      },
      {
        ...failedCheck,
        name: 'query.characters.orphaned-generation-references',
        label: 'orphaned generation references tracked',
      },
    ];
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
         and tablename in ('profiles', 'projects', 'posts', 'follows', 'generation_jobs', 'character_profiles', 'continuity_memory_states', 'moderation_orchestration_memory')
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
  const moderationMemoryColumnChecks = await Promise.all(
    moderationMemoryColumns.map((column) => checkColumnExists('moderation_orchestration_memory', column)),
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
  const characterDeletionCleanupDiagnostics = await checkCharacterDeletionCleanupDiagnostics();
  const ownProfileRlsPolicies = await checkOwnProfileRlsPolicies();
  const indexChecks = await Promise.all([
    checkIndexExists('generation_jobs_character_id_text_idx'),
    checkIndexExists('generation_jobs_scene_execution_idx'),
    checkIndexExists('generation_jobs_scene_id_idx'),
    checkIndexExists('character_profiles_owner_character_id_idx'),
    checkIndexExists('continuity_memory_states_user_updated_idx'),
    checkIndexExists('continuity_memory_states_character_idx'),
    checkIndexExists('moderation_orchestration_memory_user_provider_idx'),
    checkIndexExists('moderation_orchestration_memory_character_idx'),
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
    ...moderationMemoryColumnChecks,
    ...mediaFallbackChecks,
    publishedPostsQuery,
    profileStatsQuery,
    ...characterDeletionCleanupDiagnostics,
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
