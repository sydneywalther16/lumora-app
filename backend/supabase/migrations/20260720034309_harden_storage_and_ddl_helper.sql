revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;

drop policy if exists lumora_assets_public_read on storage.objects;

drop policy if exists lumora_assets_owner_read on storage.objects;
create policy lumora_assets_owner_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'lumora-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select app_private.is_active_auth_user())
);
