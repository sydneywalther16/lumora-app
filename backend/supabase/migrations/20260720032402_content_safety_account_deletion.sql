create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.is_active_auth_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
  );
$$;

revoke all on function app_private.is_active_auth_user() from public, anon;
grant execute on function app_private.is_active_auth_user() to authenticated, service_role;

create table if not exists public.user_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_user_id_idx
  on public.user_blocks (blocked_user_id);

alter table public.user_blocks enable row level security;

drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own
on public.user_blocks
for select
to authenticated
using ((select auth.uid()) = blocker_user_id);

drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own
on public.user_blocks
for insert
to authenticated
with check (
  (select auth.uid()) = blocker_user_id
  and blocker_user_id <> blocked_user_id
  and (select app_private.is_active_auth_user())
);

drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own
on public.user_blocks
for delete
to authenticated
using ((select auth.uid()) = blocker_user_id);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users(id) on delete set null,
  content_type text not null,
  content_id text not null,
  post_id uuid references public.posts(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint content_reports_content_type_check
    check (content_type in ('post', 'generation')),
  constraint content_reports_content_id_check
    check (char_length(content_id) between 1 and 128),
  constraint content_reports_reason_check
    check (reason in (
      'ai_safety',
      'harassment',
      'hate',
      'sexual_content',
      'violence',
      'privacy',
      'spam',
      'copyright',
      'other'
    )),
  constraint content_reports_details_check
    check (details is null or char_length(details) <= 2000),
  constraint content_reports_status_check
    check (status in ('pending', 'reviewing', 'actioned', 'dismissed'))
);

create unique index if not exists content_reports_reporter_content_unique_idx
  on public.content_reports (reporter_user_id, content_type, content_id)
  where reporter_user_id is not null;

create index if not exists content_reports_post_id_idx
  on public.content_reports (post_id)
  where post_id is not null;

create index if not exists content_reports_status_created_at_idx
  on public.content_reports (status, created_at desc);

alter table public.content_reports enable row level security;

drop policy if exists content_reports_select_own on public.content_reports;
create policy content_reports_select_own
on public.content_reports
for select
to authenticated
using ((select auth.uid()) = reporter_user_id);

drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own
on public.content_reports
for insert
to authenticated
with check (
  reporter_user_id = (select auth.uid())
  and status = 'pending'
  and (select app_private.is_active_auth_user())
  and (
    (
      content_type = 'post'
      and post_id is not null
      and content_reports.content_id = content_reports.post_id::text
      and exists (
        select 1
        from public.posts as reported_post
        where reported_post.id = content_reports.post_id
          and reported_post.status = 'published'
          and coalesce(reported_post.privacy, reported_post.visibility, 'private') = 'public'
      )
    )
    or (
      content_type = 'generation'
      and post_id is null
    )
  )
);

revoke all on table public.user_blocks from anon, authenticated;
grant select, insert, delete on table public.user_blocks to authenticated;
grant all on table public.user_blocks to service_role;

revoke all on table public.content_reports from anon, authenticated;
grant select, insert on table public.content_reports to authenticated;
grant all on table public.content_reports to service_role;

do $$
declare
  fk record;
begin
  for fk in
    select *
    from (values
      ('billing_customers', 'user_id', 'billing_customers_user_id_auth_fkey'),
      ('character_profiles', 'owner_user_id', 'character_profiles_owner_user_id_auth_fkey'),
      ('characters', 'owner_user_id', 'characters_owner_user_id_auth_fkey'),
      ('continuity_memory_states', 'user_id', 'continuity_memory_states_user_id_auth_fkey'),
      ('drafts', 'user_id', 'drafts_user_id_auth_fkey'),
      ('follows', 'follower_user_id', 'follows_follower_user_id_auth_fkey'),
      ('follows', 'following_user_id', 'follows_following_user_id_auth_fkey'),
      ('generation_jobs', 'user_id', 'generation_jobs_user_id_auth_fkey'),
      ('media_assets', 'user_id', 'media_assets_user_id_auth_fkey'),
      ('moderation_orchestration_memory', 'user_id', 'moderation_orchestration_memory_user_id_auth_fkey'),
      ('notifications', 'user_id', 'notifications_user_id_auth_fkey'),
      ('posts', 'user_id', 'posts_user_id_auth_fkey'),
      ('profiles', 'user_id', 'profiles_user_id_auth_fkey'),
      ('projects', 'user_id', 'projects_user_id_auth_fkey'),
      ('push_subscriptions', 'user_id', 'push_subscriptions_user_id_auth_fkey'),
      ('self_characters', 'user_id', 'self_characters_user_id_auth_fkey')
    ) as constraints_to_add(table_name, column_name, constraint_name)
  loop
    if not exists (
      select 1
      from pg_constraint
      where conname = fk.constraint_name
        and conrelid = format('public.%I', fk.table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete cascade not valid',
        fk.table_name,
        fk.constraint_name,
        fk.column_name
      );
    end if;
  end loop;
end $$;

create index if not exists billing_customers_user_id_auth_idx on public.billing_customers (user_id);
create index if not exists character_profiles_owner_user_id_auth_idx on public.character_profiles (owner_user_id);
create index if not exists characters_owner_user_id_auth_idx on public.characters (owner_user_id);
create index if not exists continuity_memory_states_user_id_auth_idx on public.continuity_memory_states (user_id);
create index if not exists drafts_user_id_auth_idx on public.drafts (user_id);
create index if not exists follows_follower_user_id_auth_idx on public.follows (follower_user_id);
create index if not exists follows_following_user_id_auth_idx on public.follows (following_user_id);
create index if not exists generation_jobs_user_id_auth_idx on public.generation_jobs (user_id);
create index if not exists media_assets_user_id_auth_idx on public.media_assets (user_id);
create index if not exists moderation_orchestration_memory_user_id_auth_idx on public.moderation_orchestration_memory (user_id);
create index if not exists notifications_user_id_auth_idx on public.notifications (user_id);
create index if not exists posts_user_id_auth_idx on public.posts (user_id);
create index if not exists profiles_user_id_auth_idx on public.profiles (user_id);
create index if not exists projects_user_id_auth_idx on public.projects (user_id);
create index if not exists push_subscriptions_user_id_auth_idx on public.push_subscriptions (user_id);
create index if not exists self_characters_user_id_auth_idx on public.self_characters (user_id);

drop policy if exists lumora_storage_owner_insert on storage.objects;
create policy lumora_storage_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = any (array[
    'avatars',
    'character-reference-images',
    'self-capture-videos',
    'voice-samples',
    'generated-videos',
    'post-thumbnails'
  ])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_storage_owner_read on storage.objects;
create policy lumora_storage_owner_read
on storage.objects
for select
to authenticated
using (
  bucket_id = any (array[
    'avatars',
    'character-reference-images',
    'self-capture-videos',
    'voice-samples',
    'generated-videos',
    'post-thumbnails'
  ])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_storage_owner_update on storage.objects;
create policy lumora_storage_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = any (array[
    'avatars',
    'character-reference-images',
    'self-capture-videos',
    'voice-samples',
    'generated-videos',
    'post-thumbnails'
  ])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
)
with check (
  bucket_id = any (array[
    'avatars',
    'character-reference-images',
    'self-capture-videos',
    'voice-samples',
    'generated-videos',
    'post-thumbnails'
  ])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_storage_owner_delete on storage.objects;
create policy lumora_storage_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = any (array[
    'avatars',
    'character-reference-images',
    'self-capture-videos',
    'voice-samples',
    'generated-videos',
    'post-thumbnails'
  ])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_assets_owner_insert on storage.objects;
create policy lumora_assets_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'lumora-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_assets_owner_update on storage.objects;
create policy lumora_assets_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'lumora-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
)
with check (
  bucket_id = 'lumora-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

drop policy if exists lumora_assets_owner_delete on storage.objects;
create policy lumora_assets_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'lumora-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);

create or replace function public.delete_account_data(target_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '30s', true);

  update public.content_reports
  set reporter_user_id = null
  where reporter_user_id = target_user_id;

  delete from public.user_blocks
  where blocker_user_id = target_user_id
     or blocked_user_id = target_user_id;

  delete from public.follows
  where follower_user_id = target_user_id
     or following_user_id = target_user_id;

  delete from public.posts where user_id = target_user_id;
  delete from public.generation_jobs where user_id = target_user_id;
  delete from public.continuity_memory_states where user_id = target_user_id;
  delete from public.projects where user_id = target_user_id;
  delete from public.drafts where user_id = target_user_id;
  delete from public.media_assets where user_id = target_user_id;
  delete from public.character_profiles where owner_user_id = target_user_id;
  delete from public.characters where owner_user_id = target_user_id;
  delete from public.self_characters where user_id = target_user_id;
  delete from public.moderation_orchestration_memory where user_id = target_user_id;
  delete from public.render_success_memory where user_id = target_user_id;
  delete from public.creator_experience_events where user_id = target_user_id;
  delete from public.notifications where user_id = target_user_id;
  delete from public.push_subscriptions where user_id = target_user_id;
  delete from public.billing_customers where user_id = target_user_id;
  delete from public.profiles
  where user_id = target_user_id
     or id = target_user_id;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;
