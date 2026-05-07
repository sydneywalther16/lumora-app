insert into storage.buckets (id, name, public)
values ('character-reference-images', 'character-reference-images', true)
on conflict (id) do update
set public = true;

drop policy if exists "character_reference_images_public_read" on storage.objects;
create policy "character_reference_images_public_read" on storage.objects
  for select using (bucket_id = 'character-reference-images');

drop policy if exists "character_reference_images_owner_insert" on storage.objects;
create policy "character_reference_images_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'character-reference-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "character_reference_images_owner_update" on storage.objects;
create policy "character_reference_images_owner_update" on storage.objects
  for update using (
    bucket_id = 'character-reference-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'character-reference-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "character_reference_images_owner_delete" on storage.objects;
create policy "character_reference_images_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'character-reference-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
