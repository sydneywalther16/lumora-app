import { Pool } from 'pg';
import { env } from '../lib/env';

export const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL }) : null;

export async function query<T = any>(text: string, params: unknown[] = []) {
  if (!pool) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL to use this service, or run without database-backed routes.',
    );
  }

  const result = await pool.query<T>(text, params);
  return result;
}
