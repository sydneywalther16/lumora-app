create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key,
  handle text unique,
  display_name text,
  bio text,
  avatar_url text,
  plan_slug text default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  stripe_price_id text,
  monthly_price_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  prompt text not null,
  style_preset text not null,
  status text not null default 'draft',
  cover_asset_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid references projects(id) on delete cascade,
  provider text not null,
  provider_job_id text,
  output_type text not null,
  prompt text not null,
  status text not null default 'queued',
  result_asset_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  user_id uuid primary key,
  subscription_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_customers (
  user_id uuid primary key,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text,
  plan_slug text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_updated_at_idx on projects(user_id, updated_at desc);
create index if not exists generation_jobs_user_id_created_at_idx on generation_jobs(user_id, created_at desc);
create index if not exists notifications_user_id_created_at_idx on notifications(user_id, created_at desc);
