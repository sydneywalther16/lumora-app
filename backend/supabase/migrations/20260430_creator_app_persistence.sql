create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key,
  handle text unique,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  plan_slug text default 'free',
  default_self_character_id text,
  default_self_character_name text,
  default_self_character_avatar text,
  self_reference_image_urls jsonb not null default '{}'::jsonb,
  self_reference_photo_names jsonb not null default '{}'::jsonb,
  self_capture_video_name text,
  self_capture_video_url text,
  self_capture_numbers text,
  self_capture_completed boolean not null default false,
  self_capture_consent boolean not null default false,
  self_capture_captured_at timestamptz,
  self_voice_sample_name text,
  self_voice_sample_url text,
  self_voice_sample_numbers text,
  self_voice_sample_captured_at timestamptz,
  self_voice_sample_consent boolean not null default false,
  creator_self_features jsonb not null default '{}'::jsonb,
  creator_self_style_preferences jsonb not null default '{}'::jsonb,
  self_character_editor_draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles
  add column if not exists username text,
  add column if not exists default_self_character_id text,
  add column if not exists default_self_character_name text,
  add column if not exists default_self_character_avatar text,
  add column if not exists self_reference_image_urls jsonb not null default '{}'::jsonb,
  add column if not exists self_reference_photo_names jsonb not null default '{}'::jsonb,
  add column if not exists self_capture_video_name text,
  add column if not exists self_capture_video_url text,
  add column if not exists self_capture_numbers text,
  add column if not exists self_capture_completed boolean not null default false,
  add column if not exists self_capture_consent boolean not null default false,
  add column if not exists self_capture_captured_at timestamptz,
  add column if not exists self_voice_sample_name text,
  add column if not exists self_voice_sample_url text,
  add column if not exists self_voice_sample_numbers text,
  add column if not exists self_voice_sample_captured_at timestamptz,
  add column if not exists self_voice_sample_consent boolean not null default false,
  add column if not exists creator_self_features jsonb not null default '{}'::jsonb,
  add column if not exists creator_self_style_preferences jsonb not null default '{}'::jsonb,
  add column if not exists self_character_editor_draft jsonb;

update profiles
set username = coalesce(username, handle)
where username is null;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'profiles_username_unique_idx'
  ) then
    create unique index profiles_username_unique_idx on profiles(username)
      where username is not null;
  end if;
end $$;

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null,
  status text not null default 'ready',
  consent_confirmed boolean not null default false,
  visibility text not null default 'private',
  style_preferences jsonb not null default '{}'::jsonb,
  reference_image_urls jsonb not null default '{}'::jsonb,
  reference_photo_names jsonb not null default '{}'::jsonb,
  source_capture_video_url text,
  source_capture_video_name text,
  voice_sample_url text,
  voice_sample_name text,
  voice_sample_numbers text,
  is_self boolean not null default false,
  is_creator_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint characters_status_check
    check (status in ('draft', 'processing', 'ready', 'failed')),
  constraint characters_visibility_check
    check (visibility in ('private', 'approved_only', 'public')),
  constraint characters_fictional_only_check
    check (is_creator_self = false)
);

create index if not exists characters_owner_updated_at_idx
  on characters(owner_user_id, updated_at desc);

create table if not exists self_characters (
  user_id uuid primary key,
  id text not null default 'creator-self',
  name text not null,
  status text not null default 'ready',
  consent_confirmed boolean not null default true,
  visibility text not null default 'private',
  style_preferences jsonb not null default '{}'::jsonb,
  reference_image_urls jsonb not null default '{}'::jsonb,
  reference_photo_names jsonb not null default '{}'::jsonb,
  source_capture_video_url text,
  source_capture_video_name text,
  self_capture_numbers text,
  self_capture_completed boolean not null default false,
  self_capture_consent boolean not null default false,
  self_capture_captured_at timestamptz,
  voice_sample_url text,
  voice_sample_name text,
  voice_sample_numbers text,
  voice_sample_consent boolean not null default false,
  voice_sample_captured_at timestamptz,
  creator_self_features jsonb not null default '{}'::jsonb,
  creator_self_style_preferences jsonb not null default '{}'::jsonb,
  editor_draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint self_characters_id_check check (id = 'creator-self'),
  constraint self_characters_status_check
    check (status in ('draft', 'processing', 'ready', 'failed')),
  constraint self_characters_visibility_check
    check (visibility in ('private', 'approved_only', 'public'))
);

create index if not exists self_characters_updated_at_idx
  on self_characters(updated_at desc);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled concept',
  prompt text not null default '',
  style_preset text not null default 'Lumora',
  status text not null default 'draft',
  cover_asset_url text,
  provider text not null default 'mock',
  output_type text not null default 'video',
  video_url text,
  thumbnail_url text,
  character_id text,
  character_name text,
  character_avatar text,
  is_default_self_character boolean not null default false,
  creator_name text,
  creator_username text,
  creator_avatar text,
  privacy text not null default 'private',
  duration_seconds integer,
  aspect_ratio text,
  error_message text,
  is_posted boolean not null default false,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects
  add column if not exists provider text not null default 'mock',
  add column if not exists output_type text not null default 'video',
  add column if not exists video_url text,
  add column if not exists thumbnail_url text,
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
  add column if not exists error_message text,
  add column if not exists is_posted boolean not null default false,
  add column if not exists posted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_privacy_check'
  ) then
    alter table projects
      add constraint projects_privacy_check
      check (privacy in ('private', 'approved_only', 'public'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_output_type_check'
  ) then
    alter table projects
      add constraint projects_output_type_check
      check (output_type in ('image', 'video'));
  end if;
end $$;

create index if not exists projects_user_status_updated_at_idx
  on projects(user_id, status, updated_at desc);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text,
  prompt text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drafts_user_updated_at_idx
  on drafts(user_id, updated_at desc);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text not null default 'Lumora post',
  caption text,
  prompt text,
  image_url text,
  video_url text,
  thumbnail_url text,
  source_generation_id text,
  privacy text not null default 'private',
  character_id text,
  character_name text,
  character_avatar text,
  is_default_self_character boolean not null default false,
  creator_name text,
  creator_username text,
  creator_avatar text,
  provider text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table posts
  add column if not exists user_id uuid,
  add column if not exists caption text,
  add column if not exists video_url text,
  add column if not exists thumbnail_url text,
  add column if not exists privacy text not null default 'private',
  add column if not exists character_id text,
  add column if not exists character_name text,
  add column if not exists character_avatar text,
  add column if not exists is_default_self_character boolean not null default false,
  add column if not exists creator_name text,
  add column if not exists creator_username text,
  add column if not exists creator_avatar text,
  add column if not exists provider text,
  add column if not exists status text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'posts'
      and column_name = 'source_generation_id'
      and data_type = 'uuid'
  ) then
    alter table posts
      alter column source_generation_id type text
      using source_generation_id::text;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'posts_privacy_check'
  ) then
    alter table posts
      add constraint posts_privacy_check
      check (privacy in ('private', 'approved_only', 'public'));
  end if;
end $$;

create index if not exists posts_user_created_at_idx
  on posts(user_id, created_at desc);
create index if not exists posts_public_created_at_idx
  on posts(created_at desc)
  where privacy = 'public';

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  bucket text not null,
  object_path text not null,
  public_url text,
  signed_url text,
  file_name text,
  content_type text,
  size_bytes bigint,
  usage text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket, object_path)
);

create index if not exists media_assets_user_created_at_idx
  on media_assets(user_id, created_at desc);
create index if not exists media_assets_entity_idx
  on media_assets(entity_type, entity_id);

alter table profiles enable row level security;
alter table characters enable row level security;
alter table self_characters enable row level security;
alter table projects enable row level security;
alter table drafts enable row level security;
alter table posts enable row level security;
alter table media_assets enable row level security;

drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_delete_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete_own" on profiles
  for delete using (auth.uid() = id);

drop policy if exists "characters_owner_all" on characters;
drop policy if exists "characters_public_read" on characters;
drop policy if exists "characters_select_own" on characters;
drop policy if exists "characters_insert_own" on characters;
drop policy if exists "characters_update_own" on characters;
drop policy if exists "characters_delete_own" on characters;
create policy "characters_select_own" on characters
  for select using (auth.uid() = owner_user_id);
create policy "characters_public_read" on characters
  for select using (visibility = 'public');
create policy "characters_insert_own" on characters
  for insert with check (auth.uid() = owner_user_id);
create policy "characters_update_own" on characters
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
create policy "characters_delete_own" on characters
  for delete using (auth.uid() = owner_user_id);

drop policy if exists "self_characters_owner_all" on self_characters;
drop policy if exists "self_characters_select_own" on self_characters;
drop policy if exists "self_characters_insert_own" on self_characters;
drop policy if exists "self_characters_update_own" on self_characters;
drop policy if exists "self_characters_delete_own" on self_characters;
create policy "self_characters_select_own" on self_characters
  for select using (auth.uid() = user_id);
create policy "self_characters_insert_own" on self_characters
  for insert with check (auth.uid() = user_id);
create policy "self_characters_update_own" on self_characters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "self_characters_delete_own" on self_characters
  for delete using (auth.uid() = user_id);

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

drop policy if exists "drafts_owner_all" on drafts;
drop policy if exists "drafts_select_own" on drafts;
drop policy if exists "drafts_insert_own" on drafts;
drop policy if exists "drafts_update_own" on drafts;
drop policy if exists "drafts_delete_own" on drafts;
create policy "drafts_select_own" on drafts
  for select using (auth.uid() = user_id);
create policy "drafts_insert_own" on drafts
  for insert with check (auth.uid() = user_id);
create policy "drafts_update_own" on drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "drafts_delete_own" on drafts
  for delete using (auth.uid() = user_id);

drop policy if exists "posts_owner_all" on posts;
drop policy if exists "posts_public_read" on posts;
drop policy if exists "posts_select_visible" on posts;
drop policy if exists "posts_insert_own" on posts;
drop policy if exists "posts_update_own" on posts;
drop policy if exists "posts_delete_own" on posts;
create policy "posts_select_visible" on posts
  for select using (privacy = 'public' or auth.uid() = user_id);
create policy "posts_insert_own" on posts
  for insert with check (auth.uid() = user_id);
create policy "posts_update_own" on posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "posts_delete_own" on posts
  for delete using (auth.uid() = user_id);

drop policy if exists "media_assets_owner_all" on media_assets;
drop policy if exists "media_assets_select_own" on media_assets;
drop policy if exists "media_assets_insert_own" on media_assets;
drop policy if exists "media_assets_update_own" on media_assets;
drop policy if exists "media_assets_delete_own" on media_assets;
create policy "media_assets_select_own" on media_assets
  for select using (auth.uid() = user_id);
create policy "media_assets_insert_own" on media_assets
  for insert with check (auth.uid() = user_id);
create policy "media_assets_update_own" on media_assets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "media_assets_delete_own" on media_assets
  for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('character-reference-images', 'character-reference-images', false),
  ('self-capture-videos', 'self-capture-videos', false),
  ('voice-samples', 'voice-samples', false),
  ('generated-videos', 'generated-videos', true),
  ('post-thumbnails', 'post-thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "lumora_storage_public_read" on storage.objects;
create policy "lumora_storage_public_read" on storage.objects
  for select using (
    bucket_id in ('avatars', 'generated-videos', 'post-thumbnails')
  );

drop policy if exists "lumora_storage_owner_read" on storage.objects;
create policy "lumora_storage_owner_read" on storage.objects
  for select using (
    bucket_id in (
      'avatars',
      'character-reference-images',
      'self-capture-videos',
      'voice-samples',
      'generated-videos',
      'post-thumbnails'
    )
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lumora_storage_owner_insert" on storage.objects;
create policy "lumora_storage_owner_insert" on storage.objects
  for insert with check (
    bucket_id in (
      'avatars',
      'character-reference-images',
      'self-capture-videos',
      'voice-samples',
      'generated-videos',
      'post-thumbnails'
    )
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lumora_storage_owner_update" on storage.objects;
create policy "lumora_storage_owner_update" on storage.objects
  for update using (
    bucket_id in (
      'avatars',
      'character-reference-images',
      'self-capture-videos',
      'voice-samples',
      'generated-videos',
      'post-thumbnails'
    )
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id in (
      'avatars',
      'character-reference-images',
      'self-capture-videos',
      'voice-samples',
      'generated-videos',
      'post-thumbnails'
    )
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lumora_storage_owner_delete" on storage.objects;
create policy "lumora_storage_owner_delete" on storage.objects
  for delete using (
    bucket_id in (
      'avatars',
      'character-reference-images',
      'self-capture-videos',
      'voice-samples',
      'generated-videos',
      'post-thumbnails'
    )
    and (storage.foldername(name))[1] = auth.uid()::text
  );
