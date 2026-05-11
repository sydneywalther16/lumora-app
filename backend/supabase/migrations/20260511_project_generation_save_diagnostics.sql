alter table projects
  add column if not exists caption text,
  add column if not exists final_prompt text,
  add column if not exists provider text not null default 'mock',
  add column if not exists engine text,
  add column if not exists display_engine text,
  add column if not exists model text,
  add column if not exists generation_mode text,
  add column if not exists identity_id text,
  add column if not exists keyframe_url text,
  add column if not exists output_type text not null default 'video',
  add column if not exists video_url text,
  add column if not exists cover_asset_url text,
  add column if not exists thumbnail_url text,
  add column if not exists reference_image_url text,
  add column if not exists reference_image_urls jsonb not null default '{}'::jsonb,
  add column if not exists additional_reference_image_urls jsonb,
  add column if not exists likeness_feedback jsonb,
  add column if not exists character_id text,
  add column if not exists character_name text,
  add column if not exists character_avatar text,
  add column if not exists is_default_self_character boolean not null default false,
  add column if not exists creator_name text,
  add column if not exists creator_username text,
  add column if not exists creator_avatar text,
  add column if not exists privacy text not null default 'private',
  add column if not exists duration_seconds integer,
  add column if not exists aspect_ratio text,
  add column if not exists error_message text;

alter table generation_jobs
  add column if not exists duration_seconds integer,
  add column if not exists aspect_ratio text,
  add column if not exists privacy text not null default 'private',
  add column if not exists result_asset_url text,
  add column if not exists error_message text;

alter table projects enable row level security;
alter table generation_jobs enable row level security;

drop policy if exists "projects_own_all" on projects;
drop policy if exists "projects_select_own" on projects;
drop policy if exists "projects_insert_own" on projects;
drop policy if exists "projects_update_own" on projects;
drop policy if exists "projects_delete_own" on projects;
create policy "projects_select_own" on projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on projects
  for delete using (auth.uid() = user_id);

drop policy if exists "generation_jobs_own_all" on generation_jobs;
drop policy if exists "generation_jobs_select_own" on generation_jobs;
drop policy if exists "generation_jobs_insert_own" on generation_jobs;
drop policy if exists "generation_jobs_update_own" on generation_jobs;
drop policy if exists "generation_jobs_delete_own" on generation_jobs;
create policy "generation_jobs_select_own" on generation_jobs
  for select using (auth.uid() = user_id);
create policy "generation_jobs_insert_own" on generation_jobs
  for insert with check (auth.uid() = user_id);
create policy "generation_jobs_update_own" on generation_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "generation_jobs_delete_own" on generation_jobs
  for delete using (auth.uid() = user_id);
