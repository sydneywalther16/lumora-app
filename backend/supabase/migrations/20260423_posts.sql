create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text,
  image_url text,
  source_generation_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on posts(created_at desc);
drop index if exists posts_source_generation_id_idx;
create unique index if not exists posts_source_generation_id_unique_idx on posts(source_generation_id);
