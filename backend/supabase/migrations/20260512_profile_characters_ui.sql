create extension if not exists "pgcrypto";

alter table profiles
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists followers_count integer not null default 0;

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
  thumbnail_url text,
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
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table character_profiles
  add column if not exists thumbnail_url text,
  add column if not exists is_self boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update character_profiles
set
  is_self = coalesce(is_self, false) or coalesce(character_id = 'creator-self', false),
  thumbnail_url = coalesce(
    nullif(thumbnail_url, ''),
    nullif(reference_image_urls->>'frontFaceUrl', ''),
    nullif(reference_image_urls->>'frontFace', ''),
    nullif(reference_image_urls->>'manualReferenceImageUrl', ''),
    nullif(reference_images->>'frontFaceUrl', ''),
    nullif(reference_images->>'frontFace', ''),
    nullif(reference_images->>'manualReferenceImageUrl', '')
  ),
  display_name = coalesce(nullif(display_name, ''), name),
  character_id = coalesce(nullif(character_id, ''), id::text);

do $$
begin
  if to_regclass('public.characters') is not null then
    execute $sql$
      alter table characters
        add column if not exists thumbnail_url text,
        add column if not exists is_self boolean not null default false,
        add column if not exists created_at timestamptz not null default now(),
        add column if not exists updated_at timestamptz not null default now()
    $sql$;

    execute $sql$
      update characters
      set
        thumbnail_url = coalesce(
          nullif(thumbnail_url, ''),
          nullif(reference_image_urls->>'frontFaceUrl', ''),
          nullif(reference_image_urls->>'frontFace', ''),
          nullif(reference_image_urls->>'manualReferenceImageUrl', '')
        ),
        display_name = coalesce(nullif(display_name, ''), name)
    $sql$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.self_characters') is not null then
    execute $sql$
      alter table self_characters
        add column if not exists thumbnail_url text,
        add column if not exists created_at timestamptz not null default now(),
        add column if not exists updated_at timestamptz not null default now()
    $sql$;

    execute $sql$
      update self_characters
      set thumbnail_url = coalesce(
        nullif(thumbnail_url, ''),
        nullif(reference_image_urls->>'frontFaceUrl', ''),
        nullif(reference_image_urls->>'frontFace', ''),
        nullif(reference_image_urls->>'manualReferenceImageUrl', '')
      )
    $sql$;
  end if;
end $$;

create index if not exists character_profiles_owner_self_created_idx
  on character_profiles(owner_user_id, is_self desc, created_at desc);

create index if not exists character_profiles_owner_created_idx
  on character_profiles(owner_user_id, created_at desc);

create index if not exists posts_user_published_profile_idx
  on posts(user_id, published_at desc, created_at desc)
  where status = 'published';

grant select, insert, update, delete on table character_profiles to authenticated, service_role;
grant select, insert, update, delete on table profiles to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) then
    execute 'alter table profiles enable row level security';
    execute 'drop policy if exists "profiles_select_own" on profiles';
    execute 'drop policy if exists "profiles_insert_own" on profiles';
    execute 'drop policy if exists "profiles_update_own" on profiles';
    execute 'drop policy if exists "profiles_delete_own" on profiles';
    execute 'create policy "profiles_select_own" on profiles for select using (auth.uid() = user_id)';
    execute 'create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = user_id)';
    execute 'create policy "profiles_update_own" on profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id)';
    execute 'create policy "profiles_delete_own" on profiles for delete using (auth.uid() = user_id)';
  end if;
end $$;

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
