-- Lumora Render Success Engine v1
-- Tracks automated success-first render ladders, attempt jobs, and winning recipes.

alter table public.generation_jobs
  add column if not exists render_success_group_id uuid,
  add column if not exists render_success_parent_job_id uuid references public.generation_jobs(id) on delete cascade,
  add column if not exists render_success_role text,
  add column if not exists render_success_attempt_tier integer,
  add column if not exists render_success_prompt_style text,
  add column if not exists render_success_reference_count integer,
  add column if not exists render_success_paid boolean not null default false;

create index if not exists generation_jobs_render_success_group_idx
  on public.generation_jobs(render_success_group_id, render_success_role, render_success_attempt_tier)
  where render_success_group_id is not null;

create index if not exists generation_jobs_render_success_active_idx
  on public.generation_jobs(user_id, updated_at desc)
  where render_success_role = 'master'
    and status in ('queued', 'rendering', 'processing', 'rate_limited');

create index if not exists generation_jobs_render_success_attempt_status_idx
  on public.generation_jobs(render_success_attempt_tier, status, updated_at desc)
  where render_success_role = 'attempt';

create table if not exists public.render_success_memory (
  id uuid primary key default gen_random_uuid(),
  memory_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  character_id text,
  provider text not null,
  provider_model text,
  render_mode text,
  render_feel text,
  safe_style text,
  attempt_tier integer,
  prompt_fingerprint text not null,
  prompt_style text,
  reference_strategy text,
  reference_count integer not null default 0,
  duration integer,
  aspect_ratio text,
  style_mode text,
  complexity_score integer not null default 0,
  reference_quality_score integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  moderation_failure_count integer not null default 0,
  timeout_failure_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_successful_stage text,
  last_failure_category text,
  notes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.render_success_memory
  add column if not exists memory_key text,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists character_id text,
  add column if not exists provider text,
  add column if not exists provider_model text,
  add column if not exists render_mode text,
  add column if not exists render_feel text,
  add column if not exists safe_style text,
  add column if not exists attempt_tier integer,
  add column if not exists prompt_fingerprint text,
  add column if not exists prompt_style text,
  add column if not exists reference_strategy text,
  add column if not exists reference_count integer not null default 0,
  add column if not exists duration integer,
  add column if not exists aspect_ratio text,
  add column if not exists style_mode text,
  add column if not exists complexity_score integer not null default 0,
  add column if not exists reference_quality_score integer not null default 0,
  add column if not exists success_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists moderation_failure_count integer not null default 0,
  add column if not exists timeout_failure_count integer not null default 0,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_successful_stage text,
  add column if not exists last_failure_category text,
  add column if not exists notes jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.render_success_memory
set
  memory_key = coalesce(memory_key, 'render-success:' || coalesce(user_id::text, 'anonymous') || ':' || coalesce(character_id, 'no-character') || ':' || coalesce(provider, 'unknown') || ':' || coalesce(prompt_fingerprint, id::text)),
  provider = coalesce(provider, 'unknown'),
  prompt_fingerprint = coalesce(prompt_fingerprint, md5(coalesce(metadata::text, notes::text, id::text))),
  render_feel = coalesce(render_feel, render_mode),
  style_mode = coalesce(style_mode, safe_style),
  notes = coalesce(notes, '{}'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where memory_key is null
   or provider is null
   or prompt_fingerprint is null
   or notes is null
   or metadata is null
   or created_at is null
   or updated_at is null;

alter table public.render_success_memory
  alter column memory_key set not null,
  alter column provider set not null,
  alter column prompt_fingerprint set not null,
  alter column reference_count set default 0,
  alter column complexity_score set default 0,
  alter column reference_quality_score set default 0,
  alter column success_count set default 0,
  alter column failure_count set default 0,
  alter column moderation_failure_count set default 0,
  alter column timeout_failure_count set default 0,
  alter column notes set default '{}'::jsonb,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

create unique index if not exists render_success_memory_key_idx
  on public.render_success_memory(memory_key);

create index if not exists render_success_memory_recipe_idx
  on public.render_success_memory(user_id, character_id, provider, provider_model, success_count desc, updated_at desc)
  where user_id is not null;

create index if not exists render_success_memory_attempt_idx
  on public.render_success_memory(user_id, character_id, attempt_tier, reference_count, success_count desc)
  where user_id is not null;

alter table public.render_success_memory enable row level security;

drop policy if exists "render_success_memory_select_own" on public.render_success_memory;
drop policy if exists "render_success_memory_insert_own" on public.render_success_memory;
drop policy if exists "render_success_memory_update_own" on public.render_success_memory;
drop policy if exists "render_success_memory_delete_own" on public.render_success_memory;

create policy "render_success_memory_select_own"
  on public.render_success_memory
  for select
  using (auth.uid() = user_id);

create policy "render_success_memory_insert_own"
  on public.render_success_memory
  for insert
  with check (auth.uid() = user_id);

create policy "render_success_memory_update_own"
  on public.render_success_memory
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "render_success_memory_delete_own"
  on public.render_success_memory
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.generation_jobs to authenticated, service_role;
grant select, insert, update, delete on table public.render_success_memory to authenticated, service_role;
