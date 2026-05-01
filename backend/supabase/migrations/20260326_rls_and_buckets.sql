insert into plans (slug, name, monthly_price_cents)
values
  ('free', 'Free', 0),
  ('pro', 'Pro', 1900)
on conflict (slug) do nothing;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table generation_jobs enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table billing_customers enable row level security;

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

create policy "projects_own_all" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "generation_jobs_own_all" on generation_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notifications_own_all" on notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_subscriptions_own_all" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "billing_customers_own_select" on billing_customers
  for select using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('lumora-assets', 'lumora-assets', true)
on conflict (id) do nothing;
