alter table posts
  add column if not exists source_type text,
  add column if not exists is_ai_generated boolean not null default false,
  add column if not exists source_generation_job_id text,
  add column if not exists source_project_id text,
  add column if not exists media_origin text;

update posts
set
  source_type = coalesce(source_type, 'lumora_generated'),
  is_ai_generated = true,
  source_generation_job_id = coalesce(source_generation_job_id, source_generation_id::text),
  source_project_id = coalesce(source_project_id, source_generation_id::text),
  media_origin = coalesce(media_origin, 'generated')
where coalesce(video_url, '') <> ''
  and (
    source_generation_id is not null
    or source_generation_job_id is not null
    or source_project_id is not null
    or thumbnail_source in ('generated_poster', 'generated_video', 'video_output')
  );

create index if not exists posts_public_ai_cast_idx
  on posts(published_at desc, created_at desc)
  where status = 'published'
    and privacy = 'public'
    and coalesce(video_url, '') <> ''
    and (is_ai_generated = true or source_type = 'lumora_generated')
    and coalesce(media_origin, 'generated') = 'generated'
    and coalesce(source_generation_id::text, source_generation_job_id, source_project_id, '') <> '';

drop policy if exists "posts_public_published_read" on posts;
create policy "posts_public_published_read" on posts
  for select using (
    status = 'published'
    and privacy = 'public'
    and coalesce(video_url, '') <> ''
    and (is_ai_generated = true or source_type = 'lumora_generated')
    and coalesce(media_origin, 'generated') = 'generated'
    and coalesce(source_generation_id::text, source_generation_job_id, source_project_id, '') <> ''
  );
