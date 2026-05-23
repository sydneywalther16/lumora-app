-- Normalize completed video preview metadata before poster backfill runs.
-- This migration does not create posters; it only ensures video-backed rows no
-- longer look unset when they are correctly using video preview fallback.

update generation_jobs
set
  video_url = coalesce(video_url, output_url, result_asset_url),
  thumbnail_source = coalesce(thumbnail_source, 'video_output')
where output_type = 'video'
  and coalesce(video_url, output_url, result_asset_url) is not null
  and poster_url is null;

update projects
set
  thumbnail_source = coalesce(thumbnail_source, 'video_output'),
  updated_at = now()
where output_type = 'video'
  and coalesce(video_url, cover_asset_url) is not null
  and poster_url is null;

update posts
set
  thumbnail_source = coalesce(thumbnail_source, 'video_output'),
  updated_at = now()
where video_url is not null
  and poster_url is null;
