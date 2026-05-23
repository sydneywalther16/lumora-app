alter table character_profiles
  add column if not exists verification_video_url text,
  add column if not exists verification_video_asset_id text,
  add column if not exists verification_audio_present boolean default false,
  add column if not exists verification_consent_at timestamptz,
  add column if not exists verification_status text,
  add column if not exists verification_prompt text,
  add column if not exists verification_last_tested_at timestamptz,
  add column if not exists video_reference_route_status text,
  add column if not exists video_reference_provider text;

create index if not exists character_profiles_verification_video_idx
  on character_profiles(owner_user_id, verification_status, video_reference_route_status);

do $$
begin
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
      create index if not exists self_characters_verification_video_idx
        on self_characters(user_id, verification_status, video_reference_route_status)
    $sql$;
  end if;
end $$;
