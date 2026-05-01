"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    API_PORT: zod_1.z.coerce.number().default(8787),
    APP_URL: zod_1.z.string().url().default('http://localhost:4173'),
    SUPABASE_URL: zod_1.z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().min(1),
    SUPABASE_JWT_SECRET: zod_1.z.string().min(1).optional(),
    DATABASE_URL: zod_1.z.string().min(1),
    REDIS_URL: zod_1.z.string().min(1).optional(),
    STRIPE_SECRET_KEY: zod_1.z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: zod_1.z.string().min(1).optional(),
    OPENAI_API_KEY: zod_1.z.string().min(1).optional(),
    OPENAI_IMAGE_MODEL: zod_1.z.string().default('gpt-image-1'),
    OPENAI_VIDEO_MODEL: zod_1.z.string().default('sora-2'),
    RESEND_API_KEY: zod_1.z.string().min(1).optional(),
    NOTIFICATION_FROM: zod_1.z.string().email().default('alerts@lumora.app'),
});
exports.env = envSchema.parse(process.env);
