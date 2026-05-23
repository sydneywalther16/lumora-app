alter table character_profiles
  add column if not exists provider_identity_provider text,
  add column if not exists provider_character_id text,
  add column if not exists provider_character_status text,
  add column if not exists provider_character_created_at timestamptz,
  add column if not exists provider_character_last_verified_at timestamptz,
  add column if not exists likeness_provider_status text,
  add column if not exists likeness_consent_at timestamptz,
  add column if not exists provider_character_source_asset_id text;

create index if not exists character_profiles_provider_identity_idx
  on character_profiles(owner_user_id, provider_identity_provider, provider_character_status);

do $$
begin
  if to_regclass('public.self_characters') is not null then
    execute $sql$
      alter table self_characters
        add column if not exists provider_identity_provider text,
        add column if not exists provider_character_id text,
        add column if not exists provider_character_status text,
        add column if not exists provider_character_created_at timestamptz,
        add column if not exists provider_character_last_verified_at timestamptz,
        add column if not exists likeness_provider_status text,
        add column if not exists likeness_consent_at timestamptz,
        add column if not exists provider_character_source_asset_id text
    $sql$;

    execute $sql$
      create index if not exists self_characters_provider_identity_idx
        on self_characters(user_id, provider_identity_provider, provider_character_status)
    $sql$;
  end if;
end $$;
