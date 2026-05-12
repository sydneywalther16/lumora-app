alter table generation_jobs
  add column if not exists scene_execution_id text,
  add column if not exists scene_id text,
  add column if not exists clip_order integer,
  add column if not exists scene_metadata jsonb not null default '{}'::jsonb;

create index if not exists generation_jobs_scene_execution_idx
  on generation_jobs(scene_execution_id, clip_order);

create index if not exists generation_jobs_scene_id_idx
  on generation_jobs(scene_id);
