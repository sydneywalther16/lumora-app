do $$
begin
  if to_regclass('public.character_profiles') is not null then
    execute $sql$
      alter table character_profiles
        add column if not exists verification_video_url text,
        add column if not exists verification_video_asset_id text,
        add column if not exists verification_audio_present boolean default false,
        add column if not exists verification_consent_at timestamptz,
        add column if not exists verification_status text,
        add column if not exists verification_prompt text,
        add column if not exists verification_last_tested_at timestamptz,
        add column if not exists video_reference_route_status text,
        add column if not exists video_reference_provider text
    $sql$;

    execute $sql$
      update character_profiles
      set
        verification_video_url = source_capture_video_url,
        verification_consent_at = coalesce(verification_consent_at, updated_at, now()),
        verification_status = coalesce(nullif(verification_status, ''), 'uploaded'),
        verification_prompt = coalesce(
          nullif(verification_prompt, ''),
          'Look forward at the camera, say 3 pairs of two-digit numbers, turn your head slightly right, turn your head slightly left, return to center, keep a neutral expression, stay fully clothed, use clear lighting, and do not use filters.'
        ),
        video_reference_route_status = coalesce(nullif(video_reference_route_status, ''), 'not_tested'),
        video_reference_provider = coalesce(nullif(video_reference_provider, ''), 'seedance'),
        updated_at = now()
      where
        nullif(source_capture_video_url, '') is not null
        and nullif(coalesce(verification_video_url, verification_video_asset_id, ''), '') is null
        and (coalesce((to_jsonb(character_profiles)->>'is_self')::boolean, false) = true or character_id = 'creator-self')
        and coalesce(consent_confirmed, false) = true
    $sql$;
  end if;

  if to_regclass('public.self_characters') is not null then
    execute $sql$
      alter table self_characters
        add column if not exists verification_video_url text,
        add column if not exists verification_video_asset_id text,
        add column if not exists verification_audio_present boolean default false,
        add column if not exists verification_consent_at timestamptz,
        add column if not exists verification_status text,
        add column if not exists verification_prompt text,
        add column if not exists verification_last_tested_at timestamptz,
        add column if not exists video_reference_route_status text,
        add column if not exists video_reference_provider text
    $sql$;

    execute $sql$
      update self_characters
      set
        verification_video_url = source_capture_video_url,
        verification_consent_at = coalesce(verification_consent_at, self_capture_captured_at, updated_at, now()),
        verification_status = coalesce(nullif(verification_status, ''), 'uploaded'),
        verification_prompt = coalesce(
          nullif(verification_prompt, ''),
          'Look forward at the camera, say 3 pairs of two-digit numbers, turn your head slightly right, turn your head slightly left, return to center, keep a neutral expression, stay fully clothed, use clear lighting, and do not use filters.'
        ),
        video_reference_route_status = coalesce(nullif(video_reference_route_status, ''), 'not_tested'),
        video_reference_provider = coalesce(nullif(video_reference_provider, ''), 'seedance'),
        updated_at = now()
      where
        nullif(source_capture_video_url, '') is not null
        and nullif(coalesce(verification_video_url, verification_video_asset_id, ''), '') is null
        and (coalesce(self_capture_consent, false) = true or coalesce(self_capture_completed, false) = true)
    $sql$;
  end if;
end $$;
