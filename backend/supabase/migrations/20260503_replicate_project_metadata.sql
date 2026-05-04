alter table projects
  add column if not exists final_prompt text,
  add column if not exists engine text;
