import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';

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

export async function buildAiCastPostDiagnostics() {
  try {
    const result = await query<AiCastPostDiagnosticRow>(
      `select
         p.id::text as "id",
         p.status,
         p.privacy,
         p.visibility,
         p.video_url as "videoUrl",
         p.image_url as "imageUrl",
         p.thumbnail_url as "thumbnailUrl",
         p.poster_url as "posterUrl",
         p.source_generation_id as "sourceGenerationId",
         p.source_generation_job_id as "sourceGenerationJobId",
         p.source_project_id as "sourceProjectId",
         p.source_type as "sourceType",
         p.is_ai_generated as "isAiGenerated",
         p.media_origin as "mediaOrigin",
         m.usage as "mediaUsage"
       from posts p
       left join media_assets m
         on m.public_url in (p.image_url, p.video_url, p.thumbnail_url, p.poster_url)
         or m.signed_url in (p.image_url, p.video_url, p.thumbnail_url, p.poster_url)
       where p.status = 'published'
         and coalesce(p.privacy, p.visibility, 'public') = 'public'
       order by p.published_at desc nulls last, p.created_at desc
       limit 250`,
    );

    return buildAiCastPostDiagnosticsFromRows(result.rows);
  } catch (error) {
    return {
      ok: false,
      publicPostsAllGenerated: false,
      rawUploadPostsCount: null,
      referenceMediaPublishedCount: null,
      verificationMediaPublishedCount: null,
      postsMissingGenerationSourceCount: null,
      error: serializeDiagnosticError(error),
    };
  }
}
