alter table projects
  add column if not exists status text not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists posted_at timestamptz,
  add column if not exists thumbnail_url text,
  add column if not exists poster_url text,
  add column if not exists reference_image_url text,
  add column if not exists keyframe_url text,
  add column if not exists privacy text not null default 'private',
  add column if not exists visibility text not null default 'private',
  add column if not exists is_posted boolean not null default false,
  add column if not exists view_count integer not null default 0,
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0,
  add column if not exists share_count integer not null default 0;

update projects
set
  visibility = coalesce(nullif(visibility, ''), privacy, 'private'),
  poster_url = coalesce(
    case when nullif(poster_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(poster_url, '') !~* '^data:video' then nullif(poster_url, '') end,
    case when nullif(thumbnail_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(thumbnail_url, '') !~* '^data:video' then nullif(thumbnail_url, '') end,
    nullif(reference_image_url, ''),
    nullif(keyframe_url, '')
  ),
  thumbnail_url = coalesce(
    case when nullif(thumbnail_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(thumbnail_url, '') !~* '^data:video' then nullif(thumbnail_url, '') end,
    case when nullif(poster_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(poster_url, '') !~* '^data:video' then nullif(poster_url, '') end,
    nullif(reference_image_url, ''),
    nullif(keyframe_url, '')
  ),
  published_at = case
    when published_at is null and (is_posted = true or status = 'published') then coalesce(posted_at, updated_at, created_at)
    else published_at
  end,
  posted_at = case
    when posted_at is null and (is_posted = true or status = 'published') then coalesce(published_at, updated_at, created_at)
    else posted_at
  end,
  status = case
    when status = 'published' or is_posted = true then 'published'
    when status in ('archived', 'private') then status
    else 'draft'
  end;

alter table posts
  add column if not exists user_id uuid,
  add column if not exists status text not null default 'published',
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists thumbnail_url text,
  add column if not exists poster_url text,
  add column if not exists privacy text not null default 'public',
  add column if not exists visibility text not null default 'public',
  add column if not exists view_count integer not null default 0,
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0,
  add column if not exists share_count integer not null default 0;

update posts
set
  status = coalesce(nullif(status, ''), 'published'),
  published_at = coalesce(published_at, created_at),
  visibility = coalesce(nullif(visibility, ''), privacy, 'public'),
  poster_url = coalesce(
    case when nullif(poster_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(poster_url, '') !~* '^data:video' then nullif(poster_url, '') end,
    case when nullif(thumbnail_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(thumbnail_url, '') !~* '^data:video' then nullif(thumbnail_url, '') end,
    nullif(image_url, '')
  ),
  thumbnail_url = coalesce(
    case when nullif(thumbnail_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(thumbnail_url, '') !~* '^data:video' then nullif(thumbnail_url, '') end,
    case when nullif(poster_url, '') !~* '\.(mp4|mov|webm|m4v)(\?|#|$)' and nullif(poster_url, '') !~* '^data:video' then nullif(poster_url, '') end,
    nullif(image_url, '')
  ),
  privacy = coalesce(nullif(privacy, ''), 'public')
where status is null or status <> 'draft';

create table if not exists follows (
  follower_user_id uuid not null,
  following_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, following_user_id)
);

create index if not exists projects_user_drafts_idx
  on projects(user_id, updated_at desc)
  where status = 'draft' and is_posted = false;

create index if not exists projects_published_idx
  on projects(published_at desc, updated_at desc)
  where status = 'published';

create index if not exists posts_public_published_idx
  on posts(published_at desc, created_at desc)
  where status = 'published' and privacy = 'public';

create index if not exists posts_engagement_idx
  on posts((view_count + like_count * 4 + comment_count * 3 + share_count * 5) desc);

create index if not exists follows_follower_idx
  on follows(follower_user_id, following_user_id);

create index if not exists follows_following_idx
  on follows(following_user_id, follower_user_id);

alter table projects enable row level security;
alter table posts enable row level security;
alter table follows enable row level security;

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

drop policy if exists "posts_owner_all" on posts;
drop policy if exists "posts_public_read" on posts;
drop policy if exists "posts_select_visible" on posts;
drop policy if exists "posts_insert_own" on posts;
drop policy if exists "posts_update_own" on posts;
drop policy if exists "posts_delete_own" on posts;
create policy "posts_public_published_read" on posts
  for select using (status = 'published' and privacy = 'public');
create policy "posts_select_own" on posts
  for select using (auth.uid() = user_id);
create policy "posts_insert_own" on posts
  for insert with check (auth.uid() = user_id);
create policy "posts_update_own" on posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "posts_delete_own" on posts
  for delete using (auth.uid() = user_id);

drop policy if exists "follows_select_public" on follows;
drop policy if exists "follows_insert_own" on follows;
drop policy if exists "follows_delete_own" on follows;
create policy "follows_select_public" on follows
  for select using (true);
create policy "follows_insert_own" on follows
  for insert with check (auth.uid() = follower_user_id);
create policy "follows_delete_own" on follows
  for delete using (auth.uid() = follower_user_id);

grant select, insert, update, delete on table projects to authenticated, service_role;
grant select, insert, update, delete on table posts to authenticated, service_role;
grant select, insert, update, delete on table follows to authenticated, service_role;
