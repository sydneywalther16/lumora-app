-- Creator Experience event scaffolding.
-- Privacy-safe product-quality events only. Do not store prompts, image contents, secrets, or raw provider payloads here.

create table if not exists public.creator_experience_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  route text null,
  created_at timestamptz not null default now()
);

alter table public.creator_experience_events
  add column if not exists user_id uuid null references auth.users(id) on delete set null;

alter table public.creator_experience_events
  add column if not exists event_name text not null default 'unknown';

alter table public.creator_experience_events
  add column if not exists properties jsonb not null default '{}'::jsonb;

alter table public.creator_experience_events
  add column if not exists route text null;

alter table public.creator_experience_events
  add column if not exists created_at timestamptz not null default now();

create index if not exists creator_experience_events_user_created_idx
  on public.creator_experience_events (user_id, created_at desc);

create index if not exists creator_experience_events_name_created_idx
  on public.creator_experience_events (event_name, created_at desc);

alter table public.creator_experience_events enable row level security;

drop policy if exists creator_experience_events_insert_own_or_anonymous on public.creator_experience_events;
create policy creator_experience_events_insert_own_or_anonymous
  on public.creator_experience_events
  for insert
  with check (user_id is null or auth.uid() = user_id);

drop policy if exists creator_experience_events_select_own on public.creator_experience_events;
create policy creator_experience_events_select_own
  on public.creator_experience_events
  for select
  using (auth.uid() = user_id);

drop policy if exists creator_experience_events_no_client_update on public.creator_experience_events;
create policy creator_experience_events_no_client_update
  on public.creator_experience_events
  for update
  using (false)
  with check (false);

drop policy if exists creator_experience_events_no_client_delete on public.creator_experience_events;
create policy creator_experience_events_no_client_delete
  on public.creator_experience_events
  for delete
  using (false);
