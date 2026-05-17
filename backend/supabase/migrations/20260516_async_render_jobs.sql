-- Lumora Async Render Jobs v1
-- Adds provider prediction tracking for long-running video renders.

alter table generation_jobs
  add column if not exists provider_prediction_id text,
  add column if not exists provider_prediction_url text,
  add column if not exists provider_status text,
  add column if not exists provider_name text,
  add column if not exists provider_model text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists last_polled_at timestamptz,
  add column if not exists retry_count integer not null default 0,
  add column if not exists timeout_at timestamptz,
  add column if not exists output_url text,
  add column if not exists thumbnail_url text,
  add column if not exists error_category text,
  add column if not exists render_mode text,
  add column if not exists provider_fallback_stage text,
  add column if not exists reference_count integer;

create index if not exists generation_jobs_provider_prediction_id_idx
  on generation_jobs(provider_prediction_id)
  where provider_prediction_id is not null;

create index if not exists generation_jobs_async_status_idx
  on generation_jobs(status, updated_at desc)
  where status in ('queued', 'rendering', 'processing', 'paused');

create index if not exists generation_jobs_stuck_render_idx
  on generation_jobs(timeout_at, status)
  where timeout_at is not null and status in ('queued', 'rendering', 'processing');

grant select, insert, update, delete on table generation_jobs to authenticated, service_role;
