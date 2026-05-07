insert into storage.buckets (id, name, public)
values ('character-reference-images', 'character-reference-images', true)
on conflict (id) do update
set public = true;

drop policy if exists "character_reference_images_public_read" on storage.objects;
create policy "character_reference_images_public_read" on storage.objects
  for select using (bucket_id = 'character-reference-images');

drop policy if exists "character_reference_images_authenticated_insert" on storage.objects;
create policy "character_reference_images_authenticated_insert" on storage.objects
  for insert with check (
    bucket_id = 'character-reference-images'
    and auth.uid() is not null
  );

drop policy if exists "character_reference_images_authenticated_update" on storage.objects;
create policy "character_reference_images_authenticated_update" on storage.objects
  for update using (
    bucket_id = 'character-reference-images'
    and auth.uid() is not null
  ) with check (
    bucket_id = 'character-reference-images'
    and auth.uid() is not null
  );
