import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  API_PORT: z.coerce.number().default(8787),
  APP_URL: z.string().url().default('http://localhost:4173'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  OPENAI_VIDEO_MODEL: z.string().default('sora-2'),
  GOOGLE_API_KEY: z.string().min(1).optional(),
  RUNWAY_API_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  NOTIFICATION_FROM: z.string().email().default('alerts@lumora.app'),
});

export const env = envSchema.parse(process.env);
