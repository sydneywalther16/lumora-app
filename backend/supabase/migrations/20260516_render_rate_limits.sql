-- Lumora Render Rate Limit Tracking
-- Keeps Replicate cooldowns resumable without starting duplicate paid renders.

alter table generation_jobs
  add column if not exists retry_after_seconds integer,
  add column if not exists retry_available_at timestamptz,
  add column if not exists rate_limited_at timestamptz;

create index if not exists generation_jobs_rate_limited_idx
  on generation_jobs(retry_available_at, updated_at desc)
  where status = 'rate_limited' or error_category = 'rate_limited';

grant select, insert, update, delete on table generation_jobs to authenticated, service_role;
