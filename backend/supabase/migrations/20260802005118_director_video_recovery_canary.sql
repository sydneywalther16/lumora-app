alter table public.director_canary_authorizations
  add column if not exists authorization_mode text not null default 'director_full_canary',
  add column if not exists source_authorization_id uuid references public.director_canary_authorizations(id) on delete restrict,
  add column if not exists anchor_media_artifact_id text,
  add column if not exists anchor_storage_bucket text,
  add column if not exists anchor_storage_object text,
  add column if not exists anchor_content_sha256 text,
  add column if not exists anchor_mime_type text,
  add column if not exists anchor_byte_length integer;

alter table public.director_canary_authorizations
  drop constraint if exists director_canary_authorizations_cost_cap_check,
  drop constraint if exists director_canary_authorizations_request_caps_check,
  drop constraint if exists director_canary_authorizations_mode_check,
  drop constraint if exists director_canary_authorizations_recovery_anchor_check;

alter table public.director_canary_authorizations
  add constraint director_canary_authorizations_mode_check
    check (authorization_mode in ('director_full_canary', 'director_video_recovery_canary')),
  add constraint director_canary_authorizations_cost_cap_check
    check (
      (
        authorization_mode = 'director_full_canary'
        and maximum_cost_usd > 0
        and maximum_cost_usd <= 2
      )
      or (authorization_mode = 'director_video_recovery_canary' and maximum_cost_usd = 1)
    ),
  add constraint director_canary_authorizations_request_caps_check
    check (
      (
        (
          authorization_mode = 'director_full_canary'
          and maximum_anchor_requests = 1
          and maximum_video_requests = 1
        )
        or (
          authorization_mode = 'director_video_recovery_canary'
          and maximum_anchor_requests = 0
          and maximum_video_requests = 1
        )
      )
      and maximum_retry_requests = 0
      and maximum_fallback_requests = 0
      and maximum_repair_requests = 0
    ),
  add constraint director_canary_authorizations_recovery_anchor_check
    check (
      (
        authorization_mode = 'director_full_canary'
        and source_authorization_id is null
        and anchor_media_artifact_id is null
        and anchor_storage_bucket is null
        and anchor_storage_object is null
        and anchor_content_sha256 is null
        and anchor_mime_type is null
        and anchor_byte_length is null
      )
      or (
        authorization_mode = 'director_video_recovery_canary'
        and source_authorization_id is not null
        and source_authorization_id <> id
        and length(anchor_media_artifact_id) between 1 and 160
        and anchor_storage_bucket = 'lumora-assets'
        and length(anchor_storage_object) between 1 and 512
        and anchor_content_sha256 ~ '^[a-f0-9]{64}$'
        and anchor_mime_type in ('image/jpeg', 'image/png', 'image/webp')
        and anchor_byte_length > 0
        and anchor_byte_length <= 20971520
      )
    );

create index if not exists director_canary_authorizations_recovery_lookup_idx
  on public.director_canary_authorizations (user_id, scene_hash, authorization_mode, status, expires_at desc);

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
  'Atomically consumes one exact video-only recovery authorization without permitting another anchor request.';
