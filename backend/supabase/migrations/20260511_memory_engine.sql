create table if not exists continuity_memory_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid references projects(id) on delete cascade,
  character_id text,
  memory_scope text not null,
  state jsonb not null default '{}'::jsonb,
  locked_fields jsonb not null default '{}'::jsonb,
  continuity_confidence numeric not null default 0.5,
  drift_alerts jsonb not null default '[]'::jsonb,
  scene_memory_summaries jsonb not null default '[]'::jsonb,
  previous_scene_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, memory_scope)
);

create index if not exists continuity_memory_states_user_updated_idx
  on continuity_memory_states(user_id, updated_at desc);

create index if not exists continuity_memory_states_project_idx
  on continuity_memory_states(project_id)
  where project_id is not null;

create index if not exists continuity_memory_states_character_idx
  on continuity_memory_states(character_id)
  where character_id is not null;

alter table continuity_memory_states enable row level security;

drop policy if exists "continuity_memory_states_select_own" on continuity_memory_states;
drop policy if exists "continuity_memory_states_insert_own" on continuity_memory_states;
drop policy if exists "continuity_memory_states_update_own" on continuity_memory_states;
drop policy if exists "continuity_memory_states_delete_own" on continuity_memory_states;
create policy "continuity_memory_states_select_own" on continuity_memory_states
  for select using (auth.uid() = user_id);
create policy "continuity_memory_states_insert_own" on continuity_memory_states
  for insert with check (auth.uid() = user_id);
create policy "continuity_memory_states_update_own" on continuity_memory_states
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "continuity_memory_states_delete_own" on continuity_memory_states
  for delete using (auth.uid() = user_id);
