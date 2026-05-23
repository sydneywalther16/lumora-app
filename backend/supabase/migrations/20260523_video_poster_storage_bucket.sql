-- Ensure the shared Lumora asset bucket exists for generated video posters.
-- Poster objects are written under: {user_id}/video-posters/{entityKind}/{id}.jpg

insert into storage.buckets (id, name, public)
values ('lumora-assets', 'lumora-assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "lumora_assets_public_read" on storage.objects;
create policy "lumora_assets_public_read" on storage.objects
  for select using (bucket_id = 'lumora-assets');

drop policy if exists "lumora_assets_owner_insert" on storage.objects;
create policy "lumora_assets_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'lumora-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lumora_assets_owner_update" on storage.objects;
create policy "lumora_assets_owner_update" on storage.objects
  for update using (
    bucket_id = 'lumora-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'lumora-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lumora_assets_owner_delete" on storage.objects;
create policy "lumora_assets_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'lumora-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
