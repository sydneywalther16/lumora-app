import { query } from './db';

export async function listProjectsForUser(userId: string) {
  const result = await query(
    `select id, title, status, updated_at as "updatedAt", style_preset as "stylePreset"
     from projects
     where user_id = $1
     order by updated_at desc
     limit 50`,
    [userId],
  );

  return result.rows;
}

export async function createProjectForUser(input: {
  userId: string;
  title: string;
  prompt: string;
  stylePreset: string;
}) {
  const result = await query(
    `insert into projects (user_id, title, prompt, style_preset, status)
     values ($1, $2, $3, $4, 'draft')
     returning id, title, status, updated_at as "updatedAt", style_preset as "stylePreset"`,
    [input.userId, input.title, input.prompt, input.stylePreset],
  );

  return result.rows[0];
}
