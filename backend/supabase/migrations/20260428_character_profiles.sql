create table if not exists character_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null,
  status text not null default 'draft',
  consent_confirmed boolean not null default false,
  visibility text not null default 'private',
  style_preferences jsonb not null default '{}'::jsonb,
  reference_image_urls jsonb not null default '{}'::jsonb,
  source_capture_video_url text,
  voice_sample_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_profiles_status_check
    check (status in ('draft', 'processing', 'ready', 'failed')),
  constraint character_profiles_visibility_check
    check (visibility in ('private', 'approved_only', 'public')),
  constraint character_profiles_consent_required_check
    check (consent_confirmed = true)
);

create index if not exists character_profiles_owner_updated_at_idx
  on character_profiles(owner_user_id, updated_at desc);

alter table generation_jobs
  add column if not exists character_id uuid references character_profiles(id) on delete set null,
  add column if not exists duration_seconds integer,
  add column if not exists aspect_ratio text,
  add column if not exists privacy text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'generation_jobs_privacy_check'
  ) then
    alter table generation_jobs
      add constraint generation_jobs_privacy_check
      check (privacy in ('private', 'approved_only', 'public'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'generation_jobs_aspect_ratio_check'
  ) then
    alter table generation_jobs
      add constraint generation_jobs_aspect_ratio_check
      check (aspect_ratio is null or aspect_ratio in ('9:16', '16:9', '1:1'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'generation_jobs_duration_seconds_check'
  ) then
    alter table generation_jobs
      add constraint generation_jobs_duration_seconds_check
      check (duration_seconds is null or duration_seconds between 2 and 30);
  end if;
end $$;

create index if not exists generation_jobs_character_id_idx
  on generation_jobs(character_id);

alter table character_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'character_profiles'
      and policyname = 'character_profiles_own_all'
  ) then
    create policy "character_profiles_own_all" on character_profiles
      for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
  end if;
end $$;
