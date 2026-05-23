import { Router } from 'express';
import { z } from 'zod';
import { env } from '../lib/env';
import { getEnvironmentDiagnostics } from '../lib/envDiagnostics';
import { buildAssetPersistenceDiagnostics } from '../services/assetPersistence';
import { buildProviderFallbackDiagnostics } from '../services/providerFallbackOrchestrator';
import { buildLastRenderDiagnostics } from '../services/renderDiagnostics';
import { buildAsyncRenderJobDiagnostics } from '../services/renderJobPoller';
import { buildDatabaseDiagnostics } from '../services/schemaDiagnostics';
import { buildReferenceCleanupDiagnostics } from '../services/referenceCleanup';
import { startSeedanceReferenceMatrixCanary } from '../services/referenceMatrixCanary';
import { buildRenderSuccessDiagnostics } from '../services/renderSuccessEngine';
import { buildRenderReliabilityDiagnostics } from '../services/sceneOptimization';
import {
  alternateLikenessProvidersConfigured,
  buildAlternateLikenessProviderCanaryStatus,
} from '../services/likenessProviderCanary';
import { exactLikenessCanaryCandidate, resolveExactLikenessRoute } from '../services/exactLikenessRouter';
import {
  getOpenAISoraProviderReadiness,
  startOpenAISoraSelfCharacterCanary,
} from '../services/providers/openaiSoraProvider';
import { buildVideoThumbnailDiagnostics, repairVideoThumbnails } from '../services/videoThumbnailRepair';
import {
  backfillGeneratedVideoPosters,
  getPosterBackfillRuntimeDiagnostics,
  getPosterGenerationAvailability,
} from '../services/generatedVideoPosterService';
import {
  buildRenderPathCompareDiagnostics,
  getSeedanceCanaryStatus,
  getReferenceRouteSummary,
  SelfReferenceCanarySelectionError,
  startSeedanceCanary,
  startSeedanceReferenceCanary,
  startSeedanceSelfReferenceCanary,
} from '../services/seedanceCanary';

export const healthRouter = Router();
const canarySchema = z.object({
  userId: z.string().optional().nullable(),
  saveAsDraft: z.boolean().optional().default(false),
});
const referenceCanarySchema = canarySchema.extend({
  characterId: z.string().min(1),
});
const referenceMatrixSchema = canarySchema.extend({
  referenceRole: z.enum(['front_angle', 'side_angle_left', 'side_angle_right', 'full_body', 'all']).optional().default('all'),
  variant: z.enum(['reference_images', 'image_to_video', 'text_only']).optional().default('reference_images'),
  maxPaidAttempts: z.coerce.number().int().min(1).max(5).optional().default(1),
  confirmBroadTest: z.boolean().optional().default(false),
});
const videoPosterBackfillSchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional().default(10),
  onlyLatest: z.boolean().optional().default(false),
  entityKind: z.enum(['generation_job', 'post', 'project', 'all']).optional().default('all'),
});

const canaryRouteInventory = {
  textCanaryRouteMounted: true,
  referenceCanaryRouteMounted: true,
  referenceMatrixRouteMounted: true,
  soraCharacterCanaryRouteMounted: true,
  exactLikenessCanaryRouteMounted: true,
  renderLastRouteMounted: true,
  renderPathCompareRouteMounted: true,
};

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lumora-api' });
});

healthRouter.get('/api/health/diagnostics', async (_req, res) => {
  const posterGenerationAvailability = await getPosterGenerationAvailability();
  const posterBackfillRuntime = getPosterBackfillRuntimeDiagnostics();
  const exactLikeness = await resolveExactLikenessRoute();
  res.json({
    service: 'lumora-api',
    checkedAt: new Date().toISOString(),
    ...getEnvironmentDiagnostics(),
    database: await buildDatabaseDiagnostics(),
    assetPersistence: await buildAssetPersistenceDiagnostics(),
    referenceCleanup: await buildReferenceCleanupDiagnostics(),
    providerFallback: await buildProviderFallbackDiagnostics(),
    renderSuccessEngine: await buildRenderSuccessDiagnostics(),
    referenceRouteStatus: await getReferenceRouteSummary({}),
    exactLikenessRouter: exactLikeness,
    likenessProviderRegistry: exactLikeness.providerRegistry,
    openaiSoraProvider: getOpenAISoraProviderReadiness(),
    likenessProviderCanary: {
      textSelfGuidanceAvailable: true,
      alternateLikenessProvidersConfigured: alternateLikenessProvidersConfigured().map((provider) => provider.provider),
      alternateLikenessProviderCanaryStatus: buildAlternateLikenessProviderCanaryStatus(),
    },
    renderReliability: await buildRenderReliabilityDiagnostics(),
    asyncRenderJobs: await buildAsyncRenderJobDiagnostics(),
    videoThumbnails: await buildVideoThumbnailDiagnostics({ posterGenerationAvailability, posterBackfillRuntime }),
  });
});

healthRouter.get('/api/diagnostics/render-last', async (_req, res) => {
  res.json(await buildLastRenderDiagnostics());
});

healthRouter.get('/api/diagnostics/media-thumbnails', async (_req, res) => {
  const posterGenerationAvailability = await getPosterGenerationAvailability();
  const posterBackfillRuntime = getPosterBackfillRuntimeDiagnostics();
  res.json(await buildVideoThumbnailDiagnostics({ posterGenerationAvailability, posterBackfillRuntime }));
});

healthRouter.post('/api/diagnostics/repair-video-thumbnails', async (_req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Media thumbnail repair disabled. Set ENABLE_RENDER_PROBE=true to run the diagnostic repair.',
    });
    return;
  }

  res.json(await repairVideoThumbnails());
});

healthRouter.post('/api/diagnostics/backfill-video-posters', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Video poster backfill disabled. Set ENABLE_RENDER_PROBE=true to run the diagnostic backfill.',
    });
    return;
  }

  const payload = videoPosterBackfillSchema.parse(req.body ?? {});
  res.json(await backfillGeneratedVideoPosters(payload));
});

healthRouter.get('/api/diagnostics/canary-routes', (_req, res) => {
  res.json({
    ok: true,
    basePath: '/api/diagnostics',
    routes: {
      textCanary: 'POST /api/diagnostics/seedance-canary',
      referenceCanary: 'POST /api/diagnostics/seedance-reference-canary/self',
      referenceMatrix: 'POST /api/diagnostics/seedance-reference-matrix/self',
      soraCharacterCanary: 'POST /api/diagnostics/sora-character-canary/self',
      exactLikenessCanary: 'POST /api/diagnostics/exact-likeness-canary/self',
      renderLast: 'GET /api/diagnostics/render-last',
      renderPathCompare: 'GET /api/diagnostics/render-path-compare',
    },
    ...canaryRouteInventory,
  });
});

healthRouter.post('/api/diagnostics/exact-likeness-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid exact-likeness canary.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  const routerChoice = await resolveExactLikenessRoute({ userId, characterId: null });
  const candidate = exactLikenessCanaryCandidate(routerChoice);

  if (!candidate) {
    res.status(200).json({
      ok: false,
      provider: routerChoice.provider,
      route: routerChoice.route,
      configured: routerChoice.providerRegistry.some((entry) => entry.configured),
      canaryStatus: routerChoice.canaryStatus,
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory: 'no_exact_likeness_canary_candidate',
      recommendedNextAction: routerChoice.recommendedNextAction,
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits when a supported route is enabled.',
    });
    return;
  }

  if (candidate.status === 'configured_not_implemented') {
    res.status(501).json({
      ok: false,
      provider: candidate.provider,
      route: candidate.route,
      configured: true,
      canaryStatus: candidate.status,
      outputUrlPresent: false,
      verifiedVideoPresent: false,
      failureCategory: 'configured_not_implemented',
      recommendedNextAction: 'Implement and canary-test this provider before production routing.',
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits when a supported route is enabled.',
    });
    return;
  }

  if (candidate.route === 'openai_sora_character') {
    const status = await startOpenAISoraSelfCharacterCanary({ userId, characterId: null });
    res.status(status.ok ? 202 : (status as { error?: string }).error === 'character_video_usage_unmapped' ? 200 : 501).json({
      ...status,
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits when a supported route is enabled.',
    });
    return;
  }

  if (candidate.route === 'seedance_reference') {
    try {
      const status = await startSeedanceSelfReferenceCanary({
        userId,
        saveAsDraft: false,
      });
      res.status(202).json({
        ...status,
        exactLikenessRouterChoice: routerChoice,
        warning: 'This may consume provider credits.',
      });
    } catch (error) {
      if (error instanceof SelfReferenceCanarySelectionError) {
        res.status(error.statusCode).json({
          error: error.message,
          ...error.payload,
          exactLikenessRouterChoice: routerChoice,
        });
        return;
      }
      throw error;
    }
    return;
  }

  res.status(501).json({
    ok: false,
    provider: candidate.provider,
    route: candidate.route,
    configured: true,
    canaryStatus: candidate.status,
    outputUrlPresent: false,
    verifiedVideoPresent: false,
    failureCategory: 'exact_likeness_provider_not_implemented',
    recommendedNextAction: 'Configure a supported exact likeness provider or continue using soft self guidance.',
    exactLikenessRouterChoice: routerChoice,
    warning: 'This may consume provider credits when a supported route is enabled.',
  });
});

healthRouter.post('/api/diagnostics/seedance-reference-matrix/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid canary.',
    });
    return;
  }

  const payload = referenceMatrixSchema.parse(req.body ?? {});
  if (payload.maxPaidAttempts > 1 && !payload.confirmBroadTest) {
    res.status(400).json({
      error: 'broad_reference_matrix_requires_confirmation',
      message: 'MaxPaidAttempts greater than 1 may consume multiple provider credits. Set confirmBroadTest=true to run a broader matrix.',
    });
    return;
  }
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  const result = await startSeedanceReferenceMatrixCanary({
    userId,
    saveAsDraft: payload.saveAsDraft,
    referenceRole: payload.referenceRole,
    variant: payload.variant,
    maxPaidAttempts: payload.maxPaidAttempts,
  });
  res.status(result.ok ? 202 : 404).json(result);
});

healthRouter.post('/api/diagnostics/seedance-canary', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid canary.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const status = await startSeedanceCanary({
    userId: payload.userId ?? null,
    saveAsDraft: payload.saveAsDraft,
  });
  res.status(202).json(status);
});

healthRouter.post('/api/diagnostics/seedance-reference-canary', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid canary.',
    });
    return;
  }

  const payload = referenceCanarySchema.parse(req.body ?? {});
  if (!payload.userId) {
    res.status(400).json({ error: 'Reference canary requires userId and characterId.' });
    return;
  }
  const status = await startSeedanceReferenceCanary({
    userId: payload.userId,
    characterId: payload.characterId,
    saveAsDraft: payload.saveAsDraft,
  });
  res.status(202).json(status);
});

healthRouter.post('/api/diagnostics/seedance-reference-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid canary.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  try {
    const status = await startSeedanceSelfReferenceCanary({
      userId,
      saveAsDraft: payload.saveAsDraft,
    });
    res.status(202).json(status);
  } catch (error) {
    if (error instanceof SelfReferenceCanarySelectionError) {
      res.status(error.statusCode).json({
        error: error.message,
        ...error.payload,
      });
      return;
    }
    throw error;
  }
});

healthRouter.post('/api/diagnostics/sora-character-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid canary.',
    });
    return;
  }
  if (!env.OPENAI_VIDEO_ENABLED || !env.OPENAI_VIDEO_CHARACTER_ENABLED) {
    res.status(403).json({
      error: 'OpenAI video character canary disabled. Set OPENAI_VIDEO_ENABLED=true and OPENAI_VIDEO_CHARACTER_ENABLED=true to run a paid canary.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const status = await startOpenAISoraSelfCharacterCanary({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    characterId: null,
  });
  res.status(status.ok ? 202 : (status as { error?: string }).error === 'character_video_usage_unmapped' ? 200 : 501).json({
    ...status,
    warning: 'This may consume provider credits when a supported route is enabled.',
  });
});

healthRouter.get('/api/diagnostics/seedance-canary/:id', async (req, res) => {
  const status = await getSeedanceCanaryStatus(String(req.params.id));
  if (!status) {
    res.status(404).json({ error: 'Seedance canary job not found.' });
    return;
  }
  res.json(status);
});

healthRouter.get('/api/diagnostics/render-path-compare', async (_req, res) => {
  res.json(await buildRenderPathCompareDiagnostics());
});
