alter table public.director_canary_authorizations
  add column if not exists idempotency_key text,
  add column if not exists consumed_at timestamptz;

update public.director_canary_authorizations
set
  idempotency_key = coalesce(
    nullif(idempotency_key, ''),
    'legacy:' || id::text
  ),
  consumed_at = case
    when status = 'authorized' then null
    else coalesce(consumed_at, started_at, completed_at, updated_at)
  end;

alter table public.director_canary_authorizations
  alter column idempotency_key set not null;

alter table public.director_canary_authorizations
  drop constraint if exists director_canary_authorizations_cost_cap_check,
  drop constraint if exists director_canary_authorizations_request_caps_check,
  drop constraint if exists director_canary_authorizations_expiry_check,
  drop constraint if exists director_canary_authorizations_consumption_check;

alter table public.director_canary_authorizations
  add constraint director_canary_authorizations_cost_cap_check
    check (maximum_cost_usd > 0 and maximum_cost_usd <= 2),
  add constraint director_canary_authorizations_request_caps_check
    check (
      maximum_anchor_requests = 1
      and maximum_video_requests = 1
      and maximum_retry_requests = 0
      and maximum_fallback_requests = 0
      and maximum_repair_requests = 0
    ),
  add constraint director_canary_authorizations_expiry_check
    check (
      status in ('completed', 'failed')
      or (
        expires_at > created_at
        and expires_at <= created_at + interval '30 minutes'
      )
    ),
  add constraint director_canary_authorizations_consumption_check
    check (
      (status = 'authorized' and consumed_at is null)
      or (status <> 'authorized' and consumed_at is not null)
    );

create unique index if not exists director_canary_authorizations_idempotency_key_idx
  on public.director_canary_authorizations (idempotency_key);

alter table public.director_canary_authorizations enable row level security;

revoke all on table public.director_canary_authorizations from public, anon, authenticated;
grant select, insert, update on table public.director_canary_authorizations to service_role;

create or replace function public.claim_director_canary_authorization(
  p_authorization_id uuid,
  p_user_id uuid,
  p_scene_hash text,
  p_idempotency_key text
)
returns setof public.director_canary_authorizations
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.director_canary_authorizations
  set
    status = 'running',
    consumed_at = now(),
    started_at = now(),
    updated_at = now()
  where id = p_authorization_id
    and user_id = p_user_id
    and scene_hash = p_scene_hash
    and idempotency_key = p_idempotency_key
    and status = 'authorized'
    and consumed_at is null
    and expires_at > now()
    and created_at > now() - interval '30 minutes'
    and maximum_cost_usd = 2
    and maximum_anchor_requests = 1
    and maximum_video_requests = 1
    and maximum_retry_requests = 0
    and maximum_fallback_requests = 0
    and maximum_repair_requests = 0
  returning *;
$$;

revoke execute on function public.claim_director_canary_authorization(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_director_canary_authorization(uuid, uuid, text, text)
  to service_role;

comment on function public.claim_director_canary_authorization(uuid, uuid, text, text) is
  'Atomically consumes one exact, unexpired Lumora Director production canary authorization.';
