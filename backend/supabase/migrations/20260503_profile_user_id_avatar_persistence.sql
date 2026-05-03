alter table profiles
  add column if not exists user_id uuid,
  add column if not exists avatar_url text;

update profiles
set user_id = id
where user_id is null;

alter table profiles
  alter column user_id set not null;

create unique index if not exists profiles_user_id_unique_idx
  on profiles(user_id);

drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_delete_own" on profiles;

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete_own" on profiles
  for delete using (auth.uid() = user_id);
