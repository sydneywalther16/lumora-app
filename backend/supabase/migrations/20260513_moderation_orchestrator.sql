create table if not exists moderation_orchestration_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  character_id text,
  provider text not null,
  prompt_fingerprint text not null,
  categories jsonb not null default '[]'::jsonb,
  preferred_rendering_mode text not null default 'cinematic realism',
  preferred_escalation_level integer not null default 1 check (preferred_escalation_level between 1 and 5),
  preferred_rewrite_strategy text not null default 'minor wording rewrite',
  successful_prompt text,
  failed_count integer not null default 0,
  success_count integer not null default 0,
  last_provider_message text,
  orchestration_path jsonb not null default '[]'::jsonb,
  provider_sensitivity_profile jsonb not null default '{}'::jsonb,
  successful_fallback_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_orchestration_memory_provider_prompt_fingerprint_unique unique (provider, prompt_fingerprint)
);

alter table moderation_orchestration_memory
  add column if not exists user_id uuid,
  add column if not exists character_id text,
  add column if not exists provider text not null default 'seedance',
  add column if not exists prompt_fingerprint text,
  add column if not exists categories jsonb not null default '[]'::jsonb,
  add column if not exists preferred_rendering_mode text not null default 'cinematic realism',
  add column if not exists preferred_escalation_level integer not null default 1,
  add column if not exists preferred_rewrite_strategy text not null default 'minor wording rewrite',
  add column if not exists successful_prompt text,
  add column if not exists failed_count integer not null default 0,
  add column if not exists success_count integer not null default 0,
  add column if not exists last_provider_message text,
  add column if not exists orchestration_path jsonb not null default '[]'::jsonb,
  add column if not exists provider_sensitivity_profile jsonb not null default '{}'::jsonb,
  add column if not exists successful_fallback_path text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table moderation_orchestration_memory
  alter column preferred_rendering_mode set default 'cinematic realism';

update moderation_orchestration_memory
set preferred_rendering_mode = 'cinematic realism'
where preferred_rendering_mode in ('cinematic', 'realistic');

create unique index if not exists moderation_orchestration_memory_provider_fingerprint_idx
  on moderation_orchestration_memory(provider, prompt_fingerprint)
  where prompt_fingerprint is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'moderation_orchestration_memory_provider_prompt_fingerprint_unique'
  ) then
    alter table moderation_orchestration_memory
      add constraint moderation_orchestration_memory_provider_prompt_fingerprint_unique
      unique (provider, prompt_fingerprint);
  end if;
end $$;

create index if not exists moderation_orchestration_memory_user_provider_idx
  on moderation_orchestration_memory(user_id, provider, updated_at desc)
  where user_id is not null;

create index if not exists moderation_orchestration_memory_character_idx
  on moderation_orchestration_memory(character_id, provider, updated_at desc)
  where character_id is not null;

alter table moderation_orchestration_memory enable row level security;

drop policy if exists "moderation_orchestration_memory_select_own" on moderation_orchestration_memory;
drop policy if exists "moderation_orchestration_memory_insert_own" on moderation_orchestration_memory;
drop policy if exists "moderation_orchestration_memory_update_own" on moderation_orchestration_memory;
drop policy if exists "moderation_orchestration_memory_delete_own" on moderation_orchestration_memory;

create policy "moderation_orchestration_memory_select_own" on moderation_orchestration_memory
  for select using (auth.uid() = user_id);

create policy "moderation_orchestration_memory_insert_own" on moderation_orchestration_memory
  for insert with check (auth.uid() = user_id);

create policy "moderation_orchestration_memory_update_own" on moderation_orchestration_memory
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "moderation_orchestration_memory_delete_own" on moderation_orchestration_memory
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on table moderation_orchestration_memory to authenticated, service_role;
