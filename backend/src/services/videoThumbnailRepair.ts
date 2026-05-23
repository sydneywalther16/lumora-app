import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';

type PosterGenerationAvailabilitySummary = {
  available: boolean;
  method?: string;
  reason?: string | null;
} | null;

function countValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function buildVideoThumbnailDiagnostics(input: {
  posterGenerationAvailability?: PosterGenerationAvailabilitySummary;
} = {}) {
  try {
    const counts = await query<Record<string, unknown>>(
      `select
         (select count(*)::int
          from (
            select coalesce(video_url, output_url, result_asset_url) as video_url
            from generation_jobs
            where output_type = 'video'
              and status in ('completed', 'saved')
            union all
            select coalesce(video_url, cover_asset_url) as video_url
            from projects
            where output_type = 'video'
              and status in ('completed', 'draft', 'published')
            union all
            select video_url
            from posts
            where video_url is not null
          ) completed
          where video_url is not null) as "completedVideosWithOutputCount",
         (select count(*)::int
          from (
            select coalesce(video_url, output_url, result_asset_url) as video_url, poster_url
            from generation_jobs
            where output_type = 'video'
              and status in ('completed', 'saved')
            union all
            select coalesce(video_url, cover_asset_url) as video_url, poster_url
            from projects
            where output_type = 'video'
              and status in ('completed', 'draft', 'published')
            union all
            select video_url, poster_url
            from posts
            where video_url is not null
          ) completed
          where video_url is not null
            and poster_url is null) as "completedVideosMissingPosterCount",
         (select count(*)::int
          from projects
          where output_type = 'video'
            and coalesce(video_url, cover_asset_url) is not null
            and thumbnail_url is not null
            and thumbnail_url in (reference_image_url, character_avatar)) as "completedVideosUsingCharacterThumbnailCount",
         (select count(*)::int
         from posts
         where video_url is not null
           and thumbnail_url is not null
           and thumbnail_url in (character_avatar, creator_avatar)) as "postsUsingCharacterThumbnailAsMainPreviewCount",
         (select count(*)::int
          from (
            select coalesce(video_url, output_url, result_asset_url) as video_url, poster_url, thumbnail_url, thumbnail_source
            from generation_jobs
            where output_type = 'video'
              and status in ('completed', 'saved')
            union all
            select coalesce(video_url, cover_asset_url) as video_url, poster_url, thumbnail_url, thumbnail_source
            from projects
            where output_type = 'video'
              and status in ('completed', 'draft', 'published')
            union all
            select video_url, poster_url, thumbnail_url, thumbnail_source
            from posts
            where video_url is not null
          ) completed
          where video_url is not null
            and (poster_url is not null or (thumbnail_url is not null and thumbnail_source = 'generated_poster'))) as "completedVideosUsingGeneratedPosterCount",
         (select count(*)::int
          from (
            select coalesce(video_url, output_url, result_asset_url) as video_url, poster_url, thumbnail_url, thumbnail_source
            from generation_jobs
            where output_type = 'video'
              and status in ('completed', 'saved')
            union all
            select coalesce(video_url, cover_asset_url) as video_url, poster_url, thumbnail_url, thumbnail_source
            from projects
            where output_type = 'video'
              and status in ('completed', 'draft', 'published')
            union all
            select video_url, poster_url, thumbnail_url, thumbnail_source
            from posts
            where video_url is not null
          ) completed
          where video_url is not null
            and poster_url is null
            and not (thumbnail_url is not null and thumbnail_source = 'generated_poster')) as "completedVideosUsingVideoFallbackCount",
         (select count(*)::int
          from (
            select coalesce(video_url, output_url, result_asset_url) as video_url, poster_url, thumbnail_url
            from generation_jobs
            where output_type = 'video'
              and status in ('completed', 'saved')
            union all
            select coalesce(video_url, cover_asset_url) as video_url, poster_url, thumbnail_url
            from projects
            where output_type = 'video'
              and status in ('completed', 'draft', 'published')
            union all
            select video_url, poster_url, thumbnail_url
            from posts
            where video_url is not null
          ) completed
          where video_url is null
            and poster_url is null
            and thumbnail_url is null) as "completedVideosUsingPlaceholderCount"`,
    );

    const breakdown = await query<Record<string, unknown>>(
      `select coalesce(thumbnail_source, 'unset') as "thumbnailSource", count(*)::int as count
       from (
         select thumbnail_source from generation_jobs where output_type = 'video' and coalesce(video_url, output_url, result_asset_url) is not null
         union all
         select thumbnail_source from projects where output_type = 'video' and coalesce(video_url, cover_asset_url) is not null
         union all
         select thumbnail_source from posts where video_url is not null
       ) sources
       group by coalesce(thumbnail_source, 'unset')
       order by count desc`,
    );

    const latest = await query<Record<string, unknown>>(
      `select
         id,
         has_video as "hasVideoOutput",
         has_poster as "hasPoster",
         has_thumbnail as "hasThumbnail",
         case
           when has_poster then 'generated_poster'
           when has_video then 'video_output'
           when has_thumbnail then 'thumbnail_without_video'
           else 'placeholder'
         end as "latestVideoPreviewSource"
       from (
         select
           id,
           coalesce(video_url, output_url, result_asset_url) is not null as has_video,
           poster_url is not null as has_poster,
           thumbnail_url is not null as has_thumbnail,
           coalesce(updated_at, created_at) as sort_at
         from generation_jobs
         where output_type = 'video'
         union all
         select
           id,
           coalesce(video_url, cover_asset_url) is not null as has_video,
           poster_url is not null as has_poster,
           thumbnail_url is not null as has_thumbnail,
           coalesce(updated_at, created_at) as sort_at
         from projects
         where output_type = 'video'
         union all
         select
           id,
           video_url is not null as has_video,
           poster_url is not null as has_poster,
           thumbnail_url is not null as has_thumbnail,
           coalesce(updated_at, published_at, created_at) as sort_at
         from posts
       ) media
       order by sort_at desc nulls last
       limit 1`,
    );

    const row = counts.rows[0] ?? {};
    return {
      ok: true,
      completedVideosWithOutputCount: countValue(row.completedVideosWithOutputCount),
      completedVideosMissingPosterCount: countValue(row.completedVideosMissingPosterCount),
      completedVideosUsingCharacterThumbnailCount: countValue(row.completedVideosUsingCharacterThumbnailCount),
      postsUsingCharacterThumbnailAsMainPreviewCount: countValue(row.postsUsingCharacterThumbnailAsMainPreviewCount),
      staleCharacterThumbnailCount:
        countValue(row.completedVideosUsingCharacterThumbnailCount) +
        countValue(row.postsUsingCharacterThumbnailAsMainPreviewCount),
      posterGenerationAvailable: input.posterGenerationAvailability?.available ?? false,
      posterGenerationMethod: input.posterGenerationAvailability?.method ?? 'unavailable',
      posterGenerationUnavailableReason: input.posterGenerationAvailability?.reason ?? null,
      completedVideosUsingVideoFallbackCount: countValue(row.completedVideosUsingVideoFallbackCount),
      completedVideosUsingGeneratedPosterCount: countValue(row.completedVideosUsingGeneratedPosterCount),
      completedVideosUsingPlaceholderCount: countValue(row.completedVideosUsingPlaceholderCount),
      thumbnailSourceBreakdown: breakdown.rows.map((entry) => ({
        thumbnailSource: stringValue(entry.thumbnailSource) ?? 'unset',
        count: countValue(entry.count),
      })),
      latestVideoPreviewSource: latest.rows[0] ? {
        id: stringValue(latest.rows[0].id),
        hasVideoOutput: latest.rows[0].hasVideoOutput === true,
        hasPoster: latest.rows[0].hasPoster === true,
        hasThumbnail: latest.rows[0].hasThumbnail === true,
        source: stringValue(latest.rows[0].latestVideoPreviewSource),
      } : null,
      latestPosterUrlPresent: latest.rows[0]?.hasPoster === true,
      latestVideoUrlPresent: latest.rows[0]?.hasVideoOutput === true,
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeDiagnosticError(error),
    };
  }
}

export async function repairVideoThumbnails() {
  const projects = await query<Record<string, unknown>>(
    `update projects
     set
       thumbnail_url = case
         when thumbnail_url is not null and thumbnail_url in (reference_image_url, character_avatar) then null
         else thumbnail_url
       end,
       poster_url = case
         when poster_url is not null and poster_url in (reference_image_url, character_avatar) then null
         else poster_url
       end,
       thumbnail_source = coalesce(thumbnail_source, 'video_output'),
       updated_at = now()
     where output_type = 'video'
       and coalesce(video_url, cover_asset_url) is not null
       and (
         (thumbnail_url is not null and thumbnail_url in (reference_image_url, character_avatar))
         or (poster_url is not null and poster_url in (reference_image_url, character_avatar))
       )
     returning id`,
  );

  const posts = await query<Record<string, unknown>>(
    `update posts
     set
       thumbnail_url = case
         when thumbnail_url is not null and thumbnail_url in (character_avatar, creator_avatar) then null
         else thumbnail_url
       end,
       poster_url = case
         when poster_url is not null and poster_url in (character_avatar, creator_avatar) then null
         else poster_url
       end,
       thumbnail_source = coalesce(thumbnail_source, 'video_output'),
       updated_at = now()
     where video_url is not null
       and (
         (thumbnail_url is not null and thumbnail_url in (character_avatar, creator_avatar))
         or (poster_url is not null and poster_url in (character_avatar, creator_avatar))
       )
     returning id`,
  );

  return {
    ok: true,
    repairedProjects: projects.rowCount ?? projects.rows.length,
    repairedPosts: posts.rowCount ?? posts.rows.length,
  };
}
