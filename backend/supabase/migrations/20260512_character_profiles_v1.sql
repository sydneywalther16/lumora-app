create table if not exists character_profiles (
  id uuid primary key default gen_random_uuid(),
  character_id text,
  owner_user_id uuid not null,
  name text not null,
  display_name text,
  status text not null default 'draft',
  consent_confirmed boolean not null default false,
  visibility text not null default 'private',
  style_preferences jsonb not null default '{}'::jsonb,
  reference_image_urls jsonb not null default '{}'::jsonb,
  reference_images jsonb not null default '{}'::jsonb,
  source_capture_video_url text,
  voice_sample_url text,
  appearance_summary text not null default '',
  wardrobe_tendencies text not null default '',
  emotional_tendencies text not null default '',
  soundtrack_tendencies text not null default '',
  cinematic_style text not null default '',
  continuity_state jsonb not null default '{}'::jsonb,
  memory_snapshots jsonb not null default '[]'::jsonb,
  relationship_memory jsonb not null default '{}'::jsonb,
  appearance_drift jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table character_profiles
  add column if not exists character_id text,
  add column if not exists display_name text,
  add column if not exists reference_images jsonb not null default '{}'::jsonb,
  add column if not exists appearance_summary text not null default '',
  add column if not exists wardrobe_tendencies text not null default '',
  add column if not exists emotional_tendencies text not null default '',
  add column if not exists soundtrack_tendencies text not null default '',
  add column if not exists cinematic_style text not null default '',
  add column if not exists continuity_state jsonb not null default '{}'::jsonb,
  add column if not exists memory_snapshots jsonb not null default '[]'::jsonb,
  add column if not exists relationship_memory jsonb not null default '{}'::jsonb,
  add column if not exists appearance_drift jsonb not null default '[]'::jsonb;

update character_profiles
set
  character_id = coalesce(character_id, id::text),
  display_name = coalesce(nullif(display_name, ''), name),
  reference_images = case
    when reference_images = '{}'::jsonb then reference_image_urls
    else reference_images
  end,
  appearance_summary = coalesce(nullif(appearance_summary, ''), style_preferences->>'appearanceSummary', ''),
  wardrobe_tendencies = coalesce(nullif(wardrobe_tendencies, ''), style_preferences->>'fashionStyle', ''),
  emotional_tendencies = coalesce(nullif(emotional_tendencies, ''), style_preferences->>'characterVibe', ''),
  soundtrack_tendencies = coalesce(nullif(soundtrack_tendencies, ''), style_preferences->>'soundtrackTendencies', ''),
  cinematic_style = coalesce(nullif(cinematic_style, ''), style_preferences->>'cinematicStyle', ''),
  continuity_state = case
    when continuity_state = '{}'::jsonb then jsonb_strip_nulls(jsonb_build_object(
      'characterAppearance', coalesce(nullif(appearance_summary, ''), style_preferences->>'appearanceSummary'),
      'wardrobe', coalesce(nullif(wardrobe_tendencies, ''), style_preferences->>'fashionStyle'),
      'emotionalTone', coalesce(nullif(emotional_tendencies, ''), style_preferences->>'characterVibe'),
      'soundtrackMood', coalesce(nullif(soundtrack_tendencies, ''), style_preferences->>'soundtrackTendencies'),
      'cameraStyle', coalesce(nullif(cinematic_style, ''), style_preferences->>'cinematicStyle')
    ))
    else continuity_state
  end;

alter table characters
  add column if not exists display_name text,
  add column if not exists appearance_summary text not null default '',
  add column if not exists wardrobe_tendencies text not null default '',
  add column if not exists emotional_tendencies text not null default '',
  add column if not exists soundtrack_tendencies text not null default '',
  add column if not exists cinematic_style text not null default '',
  add column if not exists continuity_state jsonb not null default '{}'::jsonb,
  add column if not exists memory_snapshots jsonb not null default '[]'::jsonb,
  add column if not exists relationship_memory jsonb not null default '{}'::jsonb,
  add column if not exists appearance_drift jsonb not null default '[]'::jsonb;

update characters
set
  display_name = coalesce(nullif(display_name, ''), name),
  appearance_summary = coalesce(nullif(appearance_summary, ''), style_preferences->>'appearanceSummary', ''),
  wardrobe_tendencies = coalesce(nullif(wardrobe_tendencies, ''), style_preferences->>'fashionStyle', ''),
  emotional_tendencies = coalesce(nullif(emotional_tendencies, ''), style_preferences->>'characterVibe', ''),
  soundtrack_tendencies = coalesce(nullif(soundtrack_tendencies, ''), style_preferences->>'soundtrackTendencies', ''),
  cinematic_style = coalesce(nullif(cinematic_style, ''), style_preferences->>'cinematicStyle', ''),
  continuity_state = case
    when continuity_state = '{}'::jsonb then jsonb_strip_nulls(jsonb_build_object(
      'characterAppearance', coalesce(nullif(appearance_summary, ''), style_preferences->>'appearanceSummary'),
      'wardrobe', coalesce(nullif(wardrobe_tendencies, ''), style_preferences->>'fashionStyle'),
      'emotionalTone', coalesce(nullif(emotional_tendencies, ''), style_preferences->>'characterVibe'),
      'soundtrackMood', coalesce(nullif(soundtrack_tendencies, ''), style_preferences->>'soundtrackTendencies'),
      'cameraStyle', coalesce(nullif(cinematic_style, ''), style_preferences->>'cinematicStyle')
    ))
    else continuity_state
  end;

create index if not exists character_profiles_owner_character_id_idx
  on character_profiles(owner_user_id, character_id);

create index if not exists character_profiles_memory_updated_idx
  on character_profiles(owner_user_id, updated_at desc)
  where memory_snapshots <> '[]'::jsonb;

create index if not exists characters_cinematic_profile_idx
  on characters(owner_user_id, updated_at desc);

alter table generation_jobs
  add column if not exists character_id text;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'generation_jobs'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%character_id%'
  loop
    execute format('alter table generation_jobs drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table generation_jobs
  alter column character_id type text using character_id::text;

create index if not exists generation_jobs_character_id_text_idx
  on generation_jobs(character_id);

alter table character_profiles enable row level security;

drop policy if exists "character_profiles_select_own" on character_profiles;
drop policy if exists "character_profiles_insert_own" on character_profiles;
drop policy if exists "character_profiles_update_own" on character_profiles;
drop policy if exists "character_profiles_delete_own" on character_profiles;
create policy "character_profiles_select_own" on character_profiles
  for select using (auth.uid() = owner_user_id);
create policy "character_profiles_insert_own" on character_profiles
  for insert with check (auth.uid() = owner_user_id);
create policy "character_profiles_update_own" on character_profiles
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
create policy "character_profiles_delete_own" on character_profiles
  for delete using (auth.uid() = owner_user_id);
