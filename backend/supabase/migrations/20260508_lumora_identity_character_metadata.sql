alter table projects
  add column if not exists identity_id text,
  add column if not exists keyframe_url text,
  add column if not exists reference_image_urls jsonb not null default '{}'::jsonb,
  add column if not exists likeness_feedback jsonb;

alter table self_characters
  add column if not exists identity_profile jsonb;

update self_characters
set identity_profile = style_preferences -> 'identityProfile'
where identity_profile is null
  and style_preferences ? 'identityProfile';
