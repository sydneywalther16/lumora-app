import { randomUUID } from 'node:crypto';
import { query } from '../services/db';

async function seed() {
  const userId = randomUUID();

  await query(
    `insert into profiles (id, user_id, handle, display_name, bio, plan_slug)
     values ($1, $1, 'lumora_demo', 'Lumora Demo', 'Demo creator profile', 'free')
     on conflict do nothing`,
    [userId],
  );

  await query(
    `insert into projects (user_id, title, prompt, style_preset, status)
     values ($1, 'Golden Hour Street Shoot', 'Cinematic influencer street portrait at sunset', 'editorial', 'draft')`,
    [userId],
  );

  await query(
    `insert into notifications (user_id, type, title, body)
     values ($1, 'system', 'Welcome to Lumora', 'Your starter data has been created.')`,
    [userId],
  );

  console.log('Seed complete for demo user:', userId);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
