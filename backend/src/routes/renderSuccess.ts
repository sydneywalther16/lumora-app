import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { env } from '../lib/env';
import { createRateLimit } from '../middleware/rateLimit';
import { getCinematicCharacterProfileForUser } from '../services/characterProfiles';
import {
  DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT,
  formatRenderSuccessJobStatus,
  getRenderSuccessJobStatus,
  startRenderSuccessJob,
  type StartRenderSuccessJobInput,
} from '../services/renderSuccessEngine';
import type { SeedanceReferenceImage } from '../services/providers/seedanceProvider';

const probeSchema = z.object({
  userId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  usePrimaryReference: z.boolean().default(false),
  provider: z.enum(['seedance-fast']).default('seedance-fast'),
  duration: z.literal(4).default(4),
  prompt: z.string().optional().default(DEFAULT_SUCCESS_FIRST_PROVIDER_PROMPT),
});

export const renderSuccessRouter = Router();
const renderSuccessRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 6,
  keyPrefix: 'render-success',
});

function bearerToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || value.trim() || null;
}

function isProbeAuthorized(req: Request, userId: string | null) {
  const serviceToken = bearerToken(req.header('authorization')) || req.header('x-lumora-service-key') || null;
  if (env.SUPABASE_SERVICE_ROLE_KEY && serviceToken === env.SUPABASE_SERVICE_ROLE_KEY) return true;
  const ownerHeader = req.header('x-lumora-user-id');
  return Boolean(userId && ownerHeader && ownerHeader === userId);
}

function firstProfileReference(profile: Awaited<ReturnType<typeof getCinematicCharacterProfileForUser>> | null): SeedanceReferenceImage[] {
  if (!profile) return [];
  const urls = profile.referenceImageUrls;
  const candidates: Array<{ url?: string | null; label: string; role: string }> = [
    { url: urls.frontFaceUrl ?? urls.frontFacePath ?? urls.frontFace, label: 'Primary front face', role: 'front_angle' },
    { url: urls.leftAngleUrl ?? urls.leftAnglePath ?? urls.leftAngle, label: 'Left angle', role: 'side_angle' },
    { url: urls.rightAngleUrl ?? urls.rightAnglePath ?? urls.rightAngle, label: 'Right angle', role: 'side_angle' },
    { url: urls.fullBodyUrl ?? urls.fullBodyPath ?? urls.fullBody, label: 'Full body', role: 'full_body' },
  ];
  const first = candidates.find((candidate) => typeof candidate.url === 'string' && /^https?:\/\//i.test(candidate.url));
  return first?.url
    ? [{ url: first.url, label: first.label, role: first.role, token: '[Image1]' }]
    : [];
}

renderSuccessRouter.post('/api/render-success/probe', renderSuccessRateLimit, async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(404).json({ error: 'Render probe is disabled.' });
    return;
  }

  const payload = probeSchema.parse(req.body);
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  if (!isProbeAuthorized(req, userId)) {
    res.status(401).json({ error: 'Render probe requires owner or service authorization.' });
    return;
  }
  if (!userId) {
    res.status(400).json({ error: 'Render probe requires a userId.' });
    return;
  }

  const profile = payload.characterId && payload.usePrimaryReference
    ? await getCinematicCharacterProfileForUser(userId, payload.characterId).catch(() => null)
    : null;
  const input: StartRenderSuccessJobInput = {
    prompt: payload.prompt,
    title: 'Render probe',
    userId,
    characterId: payload.characterId ?? null,
    characterName: profile?.displayName ?? null,
    characterAvatar: null,
    isDefaultSelfCharacter: false,
    referenceImages: payload.usePrimaryReference ? firstProfileReference(profile) : [],
    allowDemoFallback: false,
    maxPaidAttempts: 1,
    maxTotalAttempts: 1,
    forceProbe: true,
  };
  const { job } = await startRenderSuccessJob(input);
  const status = await getRenderSuccessJobStatus(job.id);
  const formatted = status ?? formatRenderSuccessJobStatus(job);

  res.status(202).json({
    warning: 'Render probe may consume provider credits.',
    attemptId: formatted.renderSuccess?.attemptTier ?? null,
    jobId: formatted.jobId,
    providerPredictionId: formatted.providerPredictionId ?? null,
    status: formatted.status,
    attemptTier: formatted.renderSuccess?.attemptTier ?? null,
    finalOutputUrl: formatted.status === 'completed' ? formatted.outputUrl : null,
    progressLabel: formatted.progressLabel,
  });
});
