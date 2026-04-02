import { Pool } from 'pg';
import { env } from '../lib/env';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function query<T = any>(text: string, params: unknown[] = []) {
  const result = await pool.query<T>(text, params);
  return result;
}
