create or replace function public.claim_director_video_recovery_authorization(
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
  update public.director_canary_authorizations as target
  set
    status = 'running',
    consumed_at = now(),
    started_at = now(),
    telemetry = coalesce(target.telemetry, '{}'::jsonb)
      || jsonb_build_object('executionCheckpoint', 'authorization_claimed'),
    updated_at = now()
  where target.id = p_authorization_id
    and target.user_id = p_user_id
    and target.scene_hash = p_scene_hash
    and target.idempotency_key = p_idempotency_key
    and target.authorization_mode = 'director_video_recovery_canary'
    and target.status = 'authorized'
    and target.consumed_at is null
    and target.expires_at > now()
    and target.created_at > now() - interval '30 minutes'
    and target.maximum_cost_usd = 1
    and target.maximum_anchor_requests = 0
    and target.maximum_video_requests = 1
    and target.maximum_retry_requests = 0
    and target.maximum_fallback_requests = 0
    and target.maximum_repair_requests = 0
    and not exists (
      select 1
      from public.director_canary_authorizations as other
      where other.user_id = p_user_id
        and other.scene_hash = p_scene_hash
        and other.authorization_mode = 'director_video_recovery_canary'
        and other.status = 'authorized'
        and other.consumed_at is null
        and other.expires_at > now()
        and other.id <> target.id
    )
  returning target.*;
$$;

revoke execute on function public.claim_director_video_recovery_authorization(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_director_video_recovery_authorization(uuid, uuid, text, text)
  to service_role;

comment on function public.claim_director_video_recovery_authorization(uuid, uuid, text, text) is
  'Atomically consumes one exact recovery authorization and records the authorization_claimed checkpoint.';

create or replace function public.terminalize_director_video_recovery_execution(
  p_authorization_id uuid,
  p_failure_category text,
  p_checkpoint text,
  p_failure_reason text,
  p_error_class text,
  p_telemetry jsonb,
  p_estimated_cost_usd numeric,
  p_actual_cost_usd numeric,
  p_job_created boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  authorization_count integer := 0;
  job_count integer := 0;
  terminal_telemetry jsonb;
begin
  if
    p_failure_category is null
    or length(p_failure_category) not between 1 and 80
    or p_checkpoint is null
    or p_checkpoint not in (
      'authorization_claimed',
      'job_created',
      'budget_validated',
      'anchor_loading',
      'anchor_validated',
      'video_request_constructed',
      'provider_request_started',
      'provider_response_received',
      'video_persisted',
      'draft_saved',
      'budget_validation'
    )
    or (p_failure_reason is not null and p_failure_reason not in (
      'unexpected_execution_failure',
      'job_creation_failed',
      'checkpoint_persistence_failed',
      'missing_runtime_cost_symbol'
    ))
    or (p_error_class is not null and p_error_class !~ '^[A-Za-z][A-Za-z0-9]{0,63}$')
    or jsonb_typeof(coalesce(p_telemetry, '{}'::jsonb)) <> 'object'
    or p_job_created is null
  then
    return false;
  end if;

  terminal_telemetry := coalesce(p_telemetry, '{}'::jsonb)
    || jsonb_build_object('executionCheckpoint', p_checkpoint);
  if p_failure_reason is not null then
    terminal_telemetry := terminal_telemetry || jsonb_build_object(
      'executionFailure',
      jsonb_build_object(
        'reason', p_failure_reason,
        'errorClass', coalesce(p_error_class, 'UnknownError')
      )
    );
  end if;

  update public.director_canary_authorizations
  set
    status = 'failed',
    failure_category = p_failure_category,
    telemetry = terminal_telemetry,
    estimated_cost_usd = p_estimated_cost_usd,
    actual_cost_usd = p_actual_cost_usd,
    completed_at = now(),
    updated_at = now()
  where id = p_authorization_id
    and authorization_mode = 'director_video_recovery_canary'
    and status = 'running'
    and consumed_at is not null
    and maximum_cost_usd = 1
    and maximum_anchor_requests = 0
    and maximum_video_requests = 1
    and maximum_retry_requests = 0
    and maximum_fallback_requests = 0
    and maximum_repair_requests = 0;
  get diagnostics authorization_count = row_count;
  if authorization_count <> 1 then
    return false;
  end if;

  if p_job_created then
    update public.generation_jobs
    set
      status = 'failed',
      error_category = p_failure_category,
      scene_metadata = coalesce(scene_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'directorTelemetry', terminal_telemetry,
          'executionCheckpoint', p_checkpoint
        )
        || case
          when p_failure_reason is null then '{}'::jsonb
          else jsonb_build_object(
            'executionFailure',
            jsonb_build_object(
              'reason', p_failure_reason,
              'errorClass', coalesce(p_error_class, 'UnknownError')
            )
          )
        end,
      completed_at = now(),
      updated_at = now()
    where id = p_authorization_id
      and status in ('processing', 'completed');
    get diagnostics job_count = row_count;
    if job_count <> 1 then
      return false;
    end if;
  end if;

  return true;
end;
$$;

revoke execute on function public.terminalize_director_video_recovery_execution(
  uuid, text, text, text, text, jsonb, numeric, numeric, boolean
) from public, anon, authenticated;
grant execute on function public.terminalize_director_video_recovery_execution(
  uuid, text, text, text, text, jsonb, numeric, numeric, boolean
) to service_role;

comment on function public.terminalize_director_video_recovery_execution(
  uuid, text, text, text, text, jsonb, numeric, numeric, boolean
) is 'Fail-closed terminalization for one consumed Director video-recovery authorization; never invokes a media provider.';

create or replace function public.repair_expired_director_video_recovery_orphan(
  p_authorization_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  repaired_count integer := 0;
begin
  update public.director_canary_authorizations as authorization
  set
    status = 'failed',
    failure_category = 'internal_execution_failed',
    telemetry = coalesce(authorization.telemetry, '{}'::jsonb)
      || jsonb_build_object(
        'providerRequestCount', 0,
        'providerRetryCount', 0,
        'providerFallbackCount', 0,
        'repairRequestCount', 0,
        'executionCheckpoint', 'budget_validation',
        'executionFailure', jsonb_build_object(
          'reason', 'missing_runtime_cost_symbol',
          'errorClass', 'ReferenceError'
        )
      ),
    estimated_cost_usd = null,
    actual_cost_usd = null,
    completed_at = now(),
    updated_at = now()
  where authorization.id = p_authorization_id
    and authorization.authorization_mode = 'director_video_recovery_canary'
    and authorization.status = 'running'
    and authorization.expires_at <= now()
    and authorization.consumed_at is not null
    and authorization.maximum_cost_usd = 1
    and authorization.maximum_anchor_requests = 0
    and authorization.maximum_video_requests = 1
    and authorization.maximum_retry_requests = 0
    and authorization.maximum_fallback_requests = 0
    and authorization.maximum_repair_requests = 0
    and authorization.result_project_id is null
    and jsonb_typeof(coalesce(authorization.telemetry, '{}'::jsonb)) = 'object'
    and coalesce(authorization.telemetry ->> 'providerRequestCount', '0') = '0'
    and coalesce(authorization.telemetry ->> 'providerRetryCount', '0') = '0'
    and coalesce(authorization.telemetry ->> 'providerFallbackCount', '0') = '0'
    and coalesce(authorization.telemetry ->> 'repairRequestCount', '0') = '0'
    and not exists (
      select 1
      from public.generation_jobs as job
      where job.id = authorization.id
    )
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'generated-videos'
        and object.name like (
          authorization.user_id::text || '/director/' || authorization.id::text || '/%'
        )
    );
  get diagnostics repaired_count = row_count;
  return repaired_count = 1;
end;
$$;

revoke execute on function public.repair_expired_director_video_recovery_orphan(uuid)
  from public, anon, authenticated;
grant execute on function public.repair_expired_director_video_recovery_orphan(uuid)
  to service_role;

comment on function public.repair_expired_director_video_recovery_orphan(uuid) is
  'Dormant exact-ID repair for an expired zero-provider Director recovery claim with no job, video, or Draft.';
