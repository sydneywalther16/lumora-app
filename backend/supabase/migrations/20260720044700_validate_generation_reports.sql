drop policy if exists content_reports_insert_own on public.content_reports;

create policy content_reports_insert_own
on public.content_reports
for insert
to authenticated
with check (
  reporter_user_id = (select auth.uid())
  and status = 'pending'
  and (select app_private.is_active_auth_user())
  and (
    (
      content_type = 'post'
      and post_id is not null
      and content_reports.content_id = content_reports.post_id::text
      and exists (
        select 1
        from public.posts as reported_post
        where reported_post.id = content_reports.post_id
          and reported_post.status = 'published'
          and coalesce(reported_post.privacy, reported_post.visibility, 'private') = 'public'
      )
    )
    or (
      content_type = 'generation'
      and post_id is null
      and content_reports.content_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1
        from public.generation_jobs as reported_generation
        where reported_generation.id = content_reports.content_id::uuid
          and reported_generation.user_id = (select auth.uid())
      )
    )
  )
);
