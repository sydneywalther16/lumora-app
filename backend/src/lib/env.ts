import 'dotenv/config';
import { z } from 'zod';

const booleanEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  API_PORT: z.coerce.number().default(8787),
  APP_URL: z.string().url().default('http://localhost:4173'),
  WEB_ORIGIN: z.string().optional(),
  DEMO_MODE: booleanEnv.default(false),
  BILLING_ENABLED: booleanEnv.default(false),
  REQUIRE_STRIPE: booleanEnv.default(false),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  OPENAI_CHAT_MODEL: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  OPENAI_VIDEO_ENABLED: booleanEnv.default(false),
  OPENAI_VIDEO_MODEL: z.string().default('sora-2'),
  OPENAI_VIDEO_CHARACTER_ENABLED: booleanEnv.default(false),
  OPENAI_VIDEO_SIZE: z.string().default('720x1280'),
  OPENAI_VIDEO_SECONDS: z.coerce.number().int().refine((value) => [4, 8, 12].includes(value), {
    message: 'OPENAI_VIDEO_SECONDS must be 4, 8, or 12.',
  }).default(4),
  DEBUG_PROVIDER_PROMPTS: booleanEnv.default(false),
  GOOGLE_API_KEY: z.string().min(1).optional(),
  FAL_ADMIN_KEY: z.string().min(1).optional(),
  FAL_KEY: z.string().min(1).optional(),
  KLING_ENABLED: booleanEnv.default(false),
  KLING_PROVIDER: z.string().default('fal'),
  KLING_API_KEY: z.string().min(1).optional(),
  KLING_MODEL: z.string().min(1).optional(),
  KLING_REFERENCE_MODEL: z.string().min(1).default('fal-ai/kling-video/o1/standard/reference-to-video'),
  KLING_ELEMENTS_MODEL: z.string().min(1).optional(),
  KLING_SCENE_ANCHOR_VIDEO_MODEL: z.string().min(1).optional(),
  SCENE_ANCHOR_ENABLED: booleanEnv.default(false),
  SCENE_ANCHOR_PROVIDER: z.string().default('fal'),
  SCENE_ANCHOR_MODEL: z.string().min(1).optional(),
  SCENE_ANCHOR_FALLBACK_MODE: z.string().default('pause'),
  RUNWAY_ENABLED: booleanEnv.default(false),
  RUNWAY_API_KEY: z.string().min(1).optional(),
  RUNWAY_MODEL: z.string().min(1).optional(),
  RUNWAY_REFERENCE_MODEL: z.string().min(1).optional(),
  REPLICATE_API_TOKEN: z.string().min(1).optional(),
  REPLICATE_WEBHOOK_SECRET: z.string().min(1).optional(),
  RENDER_SUCCESS_MAX_PAID_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  RENDER_SUCCESS_AUTO_RETRY: booleanEnv.default(true),
  ENABLE_RENDER_PROBE: booleanEnv.default(false),
  RESEND_API_KEY: z.string().min(1).optional(),
  NOTIFICATION_FROM: z.string().email().default('alerts@example.com'),
});

export const env = envSchema.parse(process.env);
