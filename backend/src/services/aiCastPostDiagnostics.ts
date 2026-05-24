import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';

type QueryFn = <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;

export type AiCastPostDiagnosticRow = {
  id?: string | null;
  status?: string | null;
  privacy?: string | null;
  visibility?: string | null;
  videoUrl?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  sourceGenerationId?: string | null;
  sourceGenerationJobId?: string | null;
  sourceProjectId?: string | null;
  sourceType?: string | null;
  isAiGenerated?: boolean | null;
  mediaOrigin?: string | null;
  mediaUsage?: string | null;
};

export const AI_CAST_REQUIRED_POST_COLUMNS = [
  'source_type',
  'is_ai_generated',
  'source_generation_job_id',
  'source_project_id',
  'media_origin',
] as const;

const postColumnsUsed = [
  'id',
  'status',
  'privacy',
  'visibility',
  'video_url',
  'image_url',
  'thumbnail_url',
  'poster_url',
  'source_generation_id',
  'source_generation_job_id',
  'source_project_id',
  'source_type',
  'is_ai_generated',
  'media_origin',
  'published_at',
  'created_at',
] as const;

const mediaAssetColumnsUsed = ['usage', 'public_url', 'signed_url'] as const;

function normalized(value?: string | null) {
  return (value ?? '').trim().toLowerCase();
}

function hasVerifiedVideo(row: AiCastPostDiagnosticRow) {
  return Boolean(row.videoUrl?.trim());
}

function hasGenerationSource(row: AiCastPostDiagnosticRow) {
  return Boolean(
    row.sourceGenerationId ||
    row.sourceGenerationJobId ||
    row.sourceProjectId,
  );
}

function isGeneratedSource(row: AiCastPostDiagnosticRow) {
  return (
    row.isAiGenerated === true ||
    normalized(row.sourceType) === 'lumora_generated' ||
    normalized(row.mediaOrigin) === 'generated' ||
    hasGenerationSource(row)
  );
}

function isPublicPublished(row: AiCastPostDiagnosticRow) {
  const status = normalized(row.status) || 'published';
  const privacy = normalized(row.privacy || row.visibility) || 'public';
  return status === 'published' && privacy === 'public';
}

function isReferenceUsage(usage?: string | null) {
  return normalized(usage).includes('reference');
}

function isVerificationUsage(usage?: string | null) {
  return normalized(usage).includes('verification');
}

export function buildAiCastPostDiagnosticsFromRows(rows: AiCastPostDiagnosticRow[]) {
  const publicRows = rows.filter(isPublicPublished);
  const rawUploadPosts = publicRows.filter((row) => !hasVerifiedVideo(row) || !isGeneratedSource(row));
  const missingGenerationSource = publicRows.filter((row) => !hasGenerationSource(row));
  const referenceMediaPublished = publicRows.filter((row) => isReferenceUsage(row.mediaUsage));
  const verificationMediaPublished = publicRows.filter((row) => isVerificationUsage(row.mediaUsage));
  const violations = new Set([
    ...rawUploadPosts.map((row) => row.id).filter(Boolean),
    ...missingGenerationSource.map((row) => row.id).filter(Boolean),
    ...referenceMediaPublished.map((row) => row.id).filter(Boolean),
    ...verificationMediaPublished.map((row) => row.id).filter(Boolean),
  ]);

  return {
    ok: true,
    publicPostsAllGenerated: violations.size === 0,
    publicPublishedPostsChecked: publicRows.length,
    rawUploadPostsCount: rawUploadPosts.length,
    referenceMediaPublishedCount: referenceMediaPublished.length,
    verificationMediaPublishedCount: verificationMediaPublished.length,
    postsMissingGenerationSourceCount: missingGenerationSource.length,
    violatingPostIdsRedacted: Array.from(violations).slice(0, 10).map((id) => {
      const value = String(id);
      return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : '[post-id-present]';
    }),
  };
}

function redactedMissingColumnName(value: string) {
  return value.includes('.') ? value : `posts.${value}`;
}

function schemaDiagnostic(missing: string[], error?: unknown) {
  return {
    ok: false,
    key: 'aiCastStudio.schema',
    message: 'AI Cast posts migration needs to be applied',
    missing: Array.from(new Set(missing.map(redactedMissingColumnName))).sort(),
    publicPostsAllGenerated: false,
    publicPublishedPostsChecked: null,
    rawUploadPostsCount: null,
    referenceMediaPublishedCount: null,
    verificationMediaPublishedCount: null,
    postsMissingGenerationSourceCount: null,
    error: error ? serializeDiagnosticError(error) : null,
  };
}

export function buildAiCastPostSchemaDiagnostic(missing: string[], error?: unknown) {
  return schemaDiagnostic(missing, error);
}

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function missingAiCastSchemaFromError(error: unknown) {
  const code = errorField(error, 'code');
  const message = [
    error instanceof Error ? error.message : '',
    errorField(error, 'message'),
    errorField(error, 'detail'),
    errorField(error, 'hint'),
  ].filter(Boolean).join(' ');
  const lower = message.toLowerCase();
  const missing = new Set<string>();

  if (code === '42P01' || lower.includes('relation "posts" does not exist')) {
    missing.add('posts');
  }

  if (code === '42703' || lower.includes('could not find') || lower.includes('schema cache')) {
    for (const column of AI_CAST_REQUIRED_POST_COLUMNS) {
      if (lower.includes(column.toLowerCase())) {
        missing.add(`posts.${column}`);
      }
    }
    const quotedColumnMatch = lower.match(/column\s+(?:p\.)?"?([a-z0-9_]+)"?\s+does not exist/);
    if (quotedColumnMatch?.[1]) {
      missing.add(`posts.${quotedColumnMatch[1]}`);
    }
  }

  return Array.from(missing);
}

async function existingColumns(queryFn: QueryFn, tableName: string, columns: readonly string[]) {
  const result = await queryFn<{ columnName: string }>(
    `select column_name as "columnName"
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = any($2::text[])`,
    [tableName, [...columns]],
  );

  return new Set(result.rows.map((row) => row.columnName));
}

function selectPostColumn(columns: Set<string>, column: string, alias: string, fallback: string) {
  return columns.has(column)
    ? `p.${column} as "${alias}"`
    : `${fallback} as "${alias}"`;
}

export async function buildAiCastPostDiagnostics(options: { queryFn?: QueryFn } = {}) {
  const queryFn: QueryFn = options.queryFn ?? ((sql, params) => query(sql, params));
  try {
    const postColumns = await existingColumns(queryFn, 'posts', postColumnsUsed);
    const missingRequiredColumns = AI_CAST_REQUIRED_POST_COLUMNS
      .filter((column) => !postColumns.has(column))
      .map((column) => `posts.${column}`);

    if (missingRequiredColumns.length) {
      return schemaDiagnostic(missingRequiredColumns);
    }

    let mediaAssetColumns = new Set<string>();
    try {
      mediaAssetColumns = await existingColumns(queryFn, 'media_assets', mediaAssetColumnsUsed);
    } catch {
      mediaAssetColumns = new Set<string>();
    }
    const mediaJoinAvailable = mediaAssetColumnsUsed.every((column) => mediaAssetColumns.has(column));
    const mediaUsageSelect = mediaJoinAvailable ? 'm.usage as "mediaUsage"' : 'null::text as "mediaUsage"';
    const mediaJoin = mediaJoinAvailable
      ? `left join media_assets m
           on m.public_url in (p.image_url, p.video_url, p.thumbnail_url, p.poster_url)
           or m.signed_url in (p.image_url, p.video_url, p.thumbnail_url, p.poster_url)`
      : '';
    const createdOrder = postColumns.has('created_at') ? 'p.created_at desc' : 'p.id desc';
    const orderBy = postColumns.has('published_at')
      ? `p.published_at desc nulls last, ${createdOrder}`
      : createdOrder;
    const statusExpression = postColumns.has('status') ? 'p.status' : "'published'";

    const result = await queryFn<AiCastPostDiagnosticRow>(
      `select
         ${selectPostColumn(postColumns, 'id', 'id', 'null::text')},
         ${selectPostColumn(postColumns, 'status', 'status', 'null::text')},
         ${selectPostColumn(postColumns, 'privacy', 'privacy', 'null::text')},
         ${selectPostColumn(postColumns, 'visibility', 'visibility', 'null::text')},
         ${selectPostColumn(postColumns, 'video_url', 'videoUrl', 'null::text')},
         ${selectPostColumn(postColumns, 'image_url', 'imageUrl', 'null::text')},
         ${selectPostColumn(postColumns, 'thumbnail_url', 'thumbnailUrl', 'null::text')},
         ${selectPostColumn(postColumns, 'poster_url', 'posterUrl', 'null::text')},
         ${selectPostColumn(postColumns, 'source_generation_id', 'sourceGenerationId', 'null::text')},
         ${selectPostColumn(postColumns, 'source_generation_job_id', 'sourceGenerationJobId', 'null::text')},
         ${selectPostColumn(postColumns, 'source_project_id', 'sourceProjectId', 'null::text')},
         ${selectPostColumn(postColumns, 'source_type', 'sourceType', 'null::text')},
         ${selectPostColumn(postColumns, 'is_ai_generated', 'isAiGenerated', 'false')},
         ${selectPostColumn(postColumns, 'media_origin', 'mediaOrigin', 'null::text')},
         ${mediaUsageSelect}
       from posts p
       ${mediaJoin}
       where coalesce(${statusExpression}, 'published') = 'published'
         and coalesce(${postColumns.has('privacy') ? 'p.privacy' : 'null'}, ${postColumns.has('visibility') ? 'p.visibility' : 'null'}, 'public') = 'public'
       order by ${orderBy}
       limit 250`,
    );

    return buildAiCastPostDiagnosticsFromRows(result.rows);
  } catch (error) {
    const missing = missingAiCastSchemaFromError(error);
    if (missing.length) {
      return schemaDiagnostic(missing, error);
    }

    return {
      ok: false,
      key: 'aiCastStudio.diagnostics',
      message: 'AI Cast post diagnostics failed',
      publicPostsAllGenerated: false,
      publicPublishedPostsChecked: null,
      rawUploadPostsCount: null,
      referenceMediaPublishedCount: null,
      verificationMediaPublishedCount: null,
      postsMissingGenerationSourceCount: null,
      error: serializeDiagnosticError(error),
    };
  }
}
