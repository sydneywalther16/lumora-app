-- Keep generated video previews separate from cast/reference imagery.
-- Existing reference images remain intact; only bad main-preview metadata is cleared.

alter table if exists generation_jobs
  add column if not exists video_url text,
  add column if not exists poster_url text,
  add column if not exists thumbnail_source text;

alter table if exists posts
  add column if not exists video_url text,
  add column if not exists poster_url text,
  add column if not exists thumbnail_source text;

alter table if exists projects
  add column if not exists poster_url text,
  add column if not exists thumbnail_source text;

alter table if exists media_assets
  add column if not exists source_kind text;

update generation_jobs
set
  video_url = coalesce(video_url, output_url, result_asset_url),
  thumbnail_source = coalesce(thumbnail_source, 'video_output')
where output_type = 'video'
  and coalesce(video_url, output_url, result_asset_url) is not null;

update projects
set
  thumbnail_url = case
    when thumbnail_url is not null
      and thumbnail_url in (reference_image_url, character_avatar)
      then null
    else thumbnail_url
  end,
  poster_url = case
    when poster_url is not null
      and poster_url in (reference_image_url, character_avatar)
      then null
    else poster_url
  end,
  thumbnail_source = coalesce(thumbnail_source, 'video_output'),
  updated_at = now()
where output_type = 'video'
  and coalesce(video_url, cover_asset_url) is not null
  and (
    (thumbnail_url is not null and thumbnail_url in (reference_image_url, character_avatar))
    or (poster_url is not null and poster_url in (reference_image_url, character_avatar))
  );

update posts
set
  thumbnail_url = case
    when thumbnail_url is not null
      and thumbnail_url in (character_avatar, creator_avatar)
      then null
    else thumbnail_url
  end,
  poster_url = case
    when poster_url is not null
      and poster_url in (character_avatar, creator_avatar)
      then null
    else poster_url
  end,
  thumbnail_source = coalesce(thumbnail_source, 'video_output'),
  updated_at = now()
where video_url is not null
  and (
    (thumbnail_url is not null and thumbnail_url in (character_avatar, creator_avatar))
    or (poster_url is not null and poster_url in (character_avatar, creator_avatar))
  );
