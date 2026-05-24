alter table character_profiles
  add column if not exists verification_video_normalized_url text,
  add column if not exists verification_video_normalized_asset_id text,
  add column if not exists verification_video_normalized_at timestamptz,
  add column if not exists verification_video_normalized_status text,
  add column if not exists verification_video_metadata jsonb;

create index if not exists character_profiles_verification_video_normalized_idx
  on character_profiles(owner_user_id, verification_video_normalized_status, verification_video_normalized_at);

do $$
begin
  if to_regclass('public.self_characters') is not null then
    execute $sql$
      alter table self_characters
        add column if not exists verification_video_normalized_url text,
        add column if not exists verification_video_normalized_asset_id text,
        add column if not exists verification_video_normalized_at timestamptz,
        add column if not exists verification_video_normalized_status text,
        add column if not exists verification_video_metadata jsonb
    $sql$;

    execute $sql$
      create index if not exists self_characters_verification_video_normalized_idx
        on self_characters(user_id, verification_video_normalized_status, verification_video_normalized_at)
    $sql$;
  end if;
end $$;
