import { Router } from 'express';
import { z } from 'zod';
import { env } from '../lib/env';
import { getEnvironmentDiagnostics } from '../lib/envDiagnostics';
import { buildAssetPersistenceDiagnostics } from '../services/assetPersistence';
import { buildAiCastPostDiagnostics } from '../services/aiCastPostDiagnostics';
import { buildProviderFallbackDiagnostics } from '../services/providerFallbackOrchestrator';
import { buildLastRenderDiagnostics, buildSceneAnchorHealthDiagnostics } from '../services/renderDiagnostics';
import { buildAsyncRenderJobDiagnostics } from '../services/renderJobPoller';
import { buildDatabaseDiagnostics, serializeDiagnosticError } from '../services/schemaDiagnostics';
import { buildReferenceCleanupDiagnostics } from '../services/referenceCleanup';
import { startSeedanceReferenceMatrixCanary } from '../services/referenceMatrixCanary';
import { buildRenderSuccessDiagnostics } from '../services/renderSuccessEngine';
import { buildRenderReliabilityDiagnostics } from '../services/sceneOptimization';
import {
  alternateLikenessProvidersConfigured,
  buildAlternateLikenessProviderCanaryStatus,
} from '../services/likenessProviderCanary';
import { repairKlingBillingCanaryMemory } from '../services/alternateLikenessProviderMemory';
import { exactLikenessCanaryCandidate, resolveExactLikenessRoute } from '../services/exactLikenessRouter';
import {
  getOpenAISoraProviderReadiness,
  startOpenAISoraSelfCharacterCanary,
} from '../services/providers/openaiSoraProvider';
import { getFalAccountStatus } from '../services/providers/falAccountDiagnostics';
import {
  buildKlingProviderShapeDiagnostics,
  getKlingProviderReadiness,
  recoverKlingSelfLikenessCanary,
  startKlingSelfLikenessCanary,
} from '../services/providers/klingProvider';
import { getRunwayProviderReadiness, startRunwaySelfLikenessCanary } from '../services/providers/runwayProvider';
import { buildVideoThumbnailDiagnostics, repairVideoThumbnails } from '../services/videoThumbnailRepair';
import {
  backfillGeneratedVideoPosters,
  getPosterBackfillRuntimeDiagnostics,
  getPosterGenerationAvailability,
} from '../services/generatedVideoPosterService';
import {
  buildRenderPathCompareDiagnostics,
  getSeedanceCanaryStatus,
  getLatestSeedanceVideoReferenceCanaryStatus,
  getReferenceRouteSummary,
  SelfReferenceCanarySelectionError,
  startSeedanceCanary,
  startSeedanceReferenceCanary,
  startSeedanceSelfReferenceCanary,
  startSeedanceVideoReferenceCanary,
  buildSeedanceInputSchemaDiagnostics,
  normalizeSeedanceVerificationVideoForDiagnostics,
} from '../services/seedanceCanary';
import {
  getSelfVerificationVideoDiagnostics,
  repairSeedanceVideoReferenceBlockedStatus,
} from '../services/selfVerificationVideo';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import {
  publicSelfCharacterOwnershipDiagnostic,
  resolveSelfCharacterForAuthenticatedUser,
} from '../services/selfCharacterOwnership';

export const healthRouter = Router();
const canarySchema = z.object({
  userId: z.string().optional().nullable(),
  saveAsDraft: z.boolean().optional().default(false),
});
const klingCanarySchema = canarySchema.extend({
  forceRetest: z.boolean().optional().default(false),
  variant: z.enum(['configured', 'o1_reference_to_video', 'o1_standard_reference_to_video', 'elements_standard']).optional().default('configured'),
});
const klingProviderShapeSchema = z.object({
  userId: z.string().optional().nullable(),
  variant: z.enum(['configured', 'o1_reference_to_video', 'o1_standard_reference_to_video', 'elements_standard']).optional().default('configured'),
});
const klingRecoverSchema = canarySchema.extend({
  attemptId: z.string().optional().nullable(),
  providerJobId: z.string().optional().nullable(),
});
const videoReferenceCanarySchema = canarySchema.extend({
  variant: z.enum(['reference_videos_bracket', 'reference_videos_at', 'video_urls_at']).optional().default('reference_videos_bracket'),
  forceNormalize: z.boolean().optional().default(false),
  allowOriginalFallback: z.boolean().optional().default(false),
  forceRetest: z.boolean().optional().default(false),
});
const normalizeVerificationVideoSchema = canarySchema.extend({
  force: z.boolean().optional().default(false),
  forceNormalize: z.boolean().optional().default(false),
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
  videoReferenceCanaryRouteMounted: true,
  seedanceVideoReferenceRepairRouteMounted: true,
  normalizeVerificationVideoRouteMounted: true,
  seedanceInputSchemaRouteMounted: true,
  soraCharacterCanaryRouteMounted: true,
  exactLikenessCanaryRouteMounted: true,
  falAccountStatusRouteMounted: true,
  klingProviderShapeRouteMounted: true,
  klingCanaryRecoverRouteMounted: true,
  klingCanaryRepairRouteMounted: true,
  runwayLikenessCanaryRouteMounted: true,
  klingLikenessCanaryRouteMounted: true,
  renderLastRouteMounted: true,
  renderPathCompareRouteMounted: true,
};

export async function safeHealthDiagnostic<T>(key: string, run: () => T | Promise<T>) {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false,
      key,
      message: `${key} diagnostic failed`,
      error: serializeDiagnosticError(error),
    };
  }
}

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lumora-api' });
});

healthRouter.get('/api/health/diagnostics', async (_req, res) => {
  const checkedAt = new Date().toISOString();
  try {
    const posterGenerationAvailability = await getPosterGenerationAvailability();
    const posterBackfillRuntime = getPosterBackfillRuntimeDiagnostics();
    const falAccountStatus = env.ENABLE_RENDER_PROBE ? await getFalAccountStatus() : null;
    const exactLikeness = await resolveExactLikenessRoute({ falAccountStatus });
    const selfVerificationVideo = await getSelfVerificationVideoDiagnostics();
    const latestSeedanceVideoReferenceCanary = await getLatestSeedanceVideoReferenceCanaryStatus();
    const referenceRouteStatus = await getReferenceRouteSummary({});
    const sceneAnchor = await safeHealthDiagnostic('sceneAnchor', buildSceneAnchorHealthDiagnostics);
    const referenceCleanup = await safeHealthDiagnostic('referenceCleanup', buildReferenceCleanupDiagnostics);
    const referenceCleanupRecord = referenceCleanup && typeof referenceCleanup === 'object'
      ? referenceCleanup as Record<string, unknown>
      : {};
    const obsoleteManualReferenceCount = typeof referenceCleanupRecord.obsoleteExternalReferenceCount === 'number'
      ? referenceCleanupRecord.obsoleteExternalReferenceCount
      : typeof referenceCleanupRecord.manualReferenceOverrideCount === 'number'
        ? referenceCleanupRecord.manualReferenceOverrideCount
      : 0;
    const savedLumoraReferenceCount = typeof referenceCleanupRecord.savedLumoraReferenceCount === 'number'
      ? referenceCleanupRecord.savedLumoraReferenceCount
      : 0;
    const exactLikenessCanaryStatus = exactLikeness.canaryStatus ?? null;
    const runwayProviderEntry = exactLikeness.providerRegistry.find((provider) => provider.id === 'runway_gen4_reference') ?? null;
    const klingProviderEntry = exactLikeness.providerRegistry.find((provider) => provider.id === 'kling_reference') ?? null;
    const recommendedNextAction = selfVerificationVideo.migratedFromOldSelfCapture
      ? 'Migrate old self capture into verification video.'
      : !selfVerificationVideo.selfVerificationVideoPresent
      ? 'Upload self verification video'
      : obsoleteManualReferenceCount > 0
        ? 'Remove old manual reference override'
        : selfVerificationVideo.seedanceVideoReferenceCanaryStatus === 'failed_blocked' ||
          selfVerificationVideo.seedanceVideoReferenceLastFailureCategory === 'video_reference_moderation_block'
          ? exactLikeness.recommendedNextAction
        : exactLikenessCanaryStatus && exactLikenessCanaryStatus !== 'canary_succeeded'
          ? 'Run exact likeness canary'
          : 'Continue using soft self guidance';
    res.json({
      service: 'lumora-api',
      checkedAt,
      ...getEnvironmentDiagnostics(),
      database: await safeHealthDiagnostic('database', buildDatabaseDiagnostics),
      assetPersistence: await safeHealthDiagnostic('assetPersistence', buildAssetPersistenceDiagnostics),
      aiCastPosts: await safeHealthDiagnostic('aiCastStudio', buildAiCastPostDiagnostics),
      referenceCleanup,
      providerFallback: await safeHealthDiagnostic('providerFallback', buildProviderFallbackDiagnostics),
      renderSuccessEngine: await safeHealthDiagnostic('renderSuccessEngine', buildRenderSuccessDiagnostics),
      referenceRouteStatus,
      falAccountStatus,
      selfVerificationVideo,
      selfVerificationVideoPresent: selfVerificationVideo.selfVerificationVideoPresent,
      selfVerificationConsentPresent: selfVerificationVideo.selfVerificationConsentPresent,
      verificationStatus: selfVerificationVideo.verificationStatus,
      oldSelfCapturePresent: selfVerificationVideo.oldSelfCapturePresent,
      migratedFromOldSelfCapture: selfVerificationVideo.migratedFromOldSelfCapture,
      obsoleteManualReferenceCount,
      savedLumoraReferenceCount,
      exactLikenessCanaryStatus,
      recommendedNextAction,
      seedanceVideoReferenceCanaryStatus: selfVerificationVideo.seedanceVideoReferenceCanaryStatus,
      seedanceVideoReferenceLastFailureCategory: selfVerificationVideo.seedanceVideoReferenceLastFailureCategory,
      seedanceVideoReferenceProviderStatus: selfVerificationVideo.seedanceVideoReferenceProviderStatus,
      seedanceVideoReferenceBlocked: selfVerificationVideo.seedanceVideoReferenceCanaryStatus === 'failed_blocked' ||
        selfVerificationVideo.seedanceVideoReferenceLastFailureCategory === 'video_reference_moderation_block',
      seedanceVideoReferenceRetryAvailableAt: latestSeedanceVideoReferenceCanary?.retryAvailableAt ?? null,
      seedanceImageReferenceBlocked: referenceRouteStatus.seedanceReferenceRoutesBlocked,
      exactLikenessRouter: exactLikeness,
      likenessProviderRegistry: exactLikeness.providerRegistry,
      runwayConfigured: Boolean(runwayProviderEntry?.configured),
      runwayReadinessStatus: runwayProviderEntry?.readinessStatus ?? 'not_configured',
      runwayCanaryStatus: runwayProviderEntry?.canaryStatus ?? 'not_configured',
      runwayLastFailureCategory: runwayProviderEntry?.lastFailureCategory ?? null,
      klingConfigured: Boolean(klingProviderEntry?.configured),
      klingReadinessStatus: klingProviderEntry?.readinessStatus ?? 'not_configured',
      klingCanaryStatus: klingProviderEntry?.canaryStatus ?? 'not_configured',
      klingLastFailureCategory: klingProviderEntry?.lastFailureCategory ?? null,
      sceneAnchorEnabled: env.SCENE_ANCHOR_ENABLED,
      sceneAnchorProvider: env.SCENE_ANCHOR_PROVIDER || 'fal',
      sceneAnchorModel: env.SCENE_ANCHOR_MODEL ?? null,
      sceneAnchorConfigured: Boolean(env.SCENE_ANCHOR_ENABLED && env.SCENE_ANCHOR_PROVIDER !== 'none' && env.SCENE_ANCHOR_MODEL),
      sceneAnchorFallbackMode: env.SCENE_ANCHOR_FALLBACK_MODE,
      sceneAnchorPrivateUrlsRedacted: true,
      sceneAnchor,
      exactRouteActive: exactLikeness.route === 'kling_reference' && exactLikeness.exactLikeness,
      exactProvider: exactLikeness.exactLikeness ? exactLikeness.provider : null,
      sceneAnchorStrategy: null,
      lastRenderReferenceStrategy: null,
      primaryVideoInputType: null,
      primaryVideoInputSource: null,
      startFrameSource: null,
      posterFrameSource: null,
      firstFrameSource: null,
      stage2ProviderModel: null,
      stage2ProviderRouteType: null,
      rawReferenceVisualInputsSentToStage2: false,
      identityReferencesPassedToVideoStage: false,
      identityReferenceMode: null,
      audioConfigured: false,
      viralPresetUsed: null,
      promptPolished: false,
      runwayLikenessProvider: runwayProviderEntry ?? getRunwayProviderReadiness(),
      klingLikenessProvider: klingProviderEntry ?? getKlingProviderReadiness(),
      lumoraIdentityPackStatus: 'research_only',
      openaiSoraProvider: getOpenAISoraProviderReadiness(),
      likenessProviderCanary: {
        textSelfGuidanceAvailable: true,
        alternateLikenessProvidersConfigured: alternateLikenessProvidersConfigured().map((provider) => provider.provider),
        alternateLikenessProviderCanaryStatus: buildAlternateLikenessProviderCanaryStatus(),
      },
      renderReliability: await safeHealthDiagnostic('renderReliability', buildRenderReliabilityDiagnostics),
      asyncRenderJobs: await safeHealthDiagnostic('asyncRenderJobs', buildAsyncRenderJobDiagnostics),
      videoThumbnails: await safeHealthDiagnostic(
        'videoThumbnails',
        () => buildVideoThumbnailDiagnostics({ posterGenerationAvailability, posterBackfillRuntime }),
      ),
    });
  } catch (error) {
    res.json({
      service: 'lumora-api',
      checkedAt,
      ok: false,
      ...getEnvironmentDiagnostics(),
      diagnosticsError: {
        ok: false,
        key: 'health.diagnostics',
        message: 'Health diagnostics failed before all checks could run.',
        error: serializeDiagnosticError(error),
      },
      aiCastPosts: await safeHealthDiagnostic('aiCastStudio', buildAiCastPostDiagnostics),
    });
  }
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
      videoReferenceCanary: 'POST /api/diagnostics/seedance-video-reference-canary/self',
      repairSeedanceVideoReferenceStatus: 'POST /api/diagnostics/repair-seedance-video-reference-status',
      normalizeVerificationVideo: 'POST /api/diagnostics/normalize-verification-video/self',
      seedanceInputSchema: 'GET /api/diagnostics/seedance-input-schema',
      soraCharacterCanary: 'POST /api/diagnostics/sora-character-canary/self',
      exactLikenessCanary: 'POST /api/diagnostics/exact-likeness-canary/self',
      falAccountStatus: 'GET /api/diagnostics/fal-account-status',
      klingProviderShape: 'GET /api/diagnostics/kling-provider-shape',
      klingLikenessCanaryRecover: 'POST /api/diagnostics/kling-likeness-canary/recover',
      repairKlingCanaryStatus: 'POST /api/diagnostics/repair-kling-canary-status',
      runwayLikenessCanary: 'POST /api/diagnostics/runway-likeness-canary/self',
      klingLikenessCanary: 'POST /api/diagnostics/kling-likeness-canary/self',
      renderLast: 'GET /api/diagnostics/render-last',
      renderPathCompare: 'GET /api/diagnostics/render-path-compare',
    },
    ...canaryRouteInventory,
  });
});

healthRouter.post('/api/diagnostics/repair-kling-canary-status', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Kling canary repair disabled. Set ENABLE_RENDER_PROBE=true to repair local canary memory.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  res.json(await repairKlingBillingCanaryMemory({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    characterId: null,
  }));
});

healthRouter.get('/api/diagnostics/fal-account-status', async (_req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Fal account diagnostics disabled. Set ENABLE_RENDER_PROBE=true to check the configured fal key safely.',
    });
    return;
  }

  res.json(await getFalAccountStatus());
});

healthRouter.get('/api/diagnostics/kling-provider-shape', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Kling provider shape diagnostics disabled. Set ENABLE_RENDER_PROBE=true to inspect the configured Kling/fal payload shape.',
    });
    return;
  }

  const payload = klingProviderShapeSchema.parse(req.query ?? {});
  res.json(await buildKlingProviderShapeDiagnostics({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    variant: payload.variant,
  }));
});

healthRouter.get('/api/diagnostics/seedance-input-schema', async (_req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Seedance input schema diagnostics disabled. Set ENABLE_RENDER_PROBE=true to inspect provider schema mapping.',
    });
    return;
  }

  res.json(await buildSeedanceInputSchemaDiagnostics());
});

healthRouter.get('/api/diagnostics/self-character-ownership', requireAuth, async (req: AuthedRequest, res) => {
  const resolution = await resolveSelfCharacterForAuthenticatedUser(req.userId!, { createIfMissing: false });
  res.json({
    ok: true,
    ...publicSelfCharacterOwnershipDiagnostic(resolution),
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

  if (candidate.route === 'runway_reference') {
    const status = await startRunwaySelfLikenessCanary({
      userId,
      saveAsDraft: false,
    });
    res.status(status.ok ? 202 : status.failureCategory === 'not_configured' ? 403 : 200).json({
      ...status,
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits when enabled.',
    });
    return;
  }

  if (candidate.route === 'kling_reference') {
    const status = await startKlingSelfLikenessCanary({
      userId,
      saveAsDraft: false,
    });
    res.status(status.ok ? 202 : status.failureCategory === 'configured_not_implemented' ? 501 : status.failureCategory === 'not_configured' ? 403 : 200).json({
      ...status,
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits when enabled.',
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

  if (candidate.route === 'seedance_video_reference') {
    const status = await startSeedanceVideoReferenceCanary({
      userId,
      saveAsDraft: false,
    });
    res.status('ok' in status && status.ok === false ? 200 : 202).json({
      ...status,
      exactLikenessRouterChoice: routerChoice,
      warning: 'This may consume provider credits.',
    });
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

healthRouter.post('/api/diagnostics/runway-likeness-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid Runway likeness canary.',
    });
    return;
  }
  if (!env.RUNWAY_ENABLED) {
    res.status(403).json({
      error: 'Runway likeness canary disabled. Set RUNWAY_ENABLED=true to run a paid canary.',
    });
    return;
  }
  if (!env.RUNWAY_API_KEY) {
    res.status(403).json({
      error: 'Runway API key missing. Set RUNWAY_API_KEY to run a paid canary.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const status = await startRunwaySelfLikenessCanary({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    saveAsDraft: payload.saveAsDraft,
  });
  res.status(status.ok ? 202 : status.failureCategory === 'not_configured' ? 403 : 200).json({
    ...status,
    warning: 'This may consume provider credits.',
  });
});

healthRouter.post('/api/diagnostics/kling-likeness-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid Kling likeness canary.',
    });
    return;
  }
  if (!env.KLING_ENABLED) {
    res.status(403).json({
      error: 'Kling likeness canary disabled. Set KLING_ENABLED=true to run a paid canary.',
    });
    return;
  }
  if (!env.FAL_KEY && !env.KLING_API_KEY) {
    res.status(403).json({
      error: 'Fal API key missing. Set FAL_KEY or KLING_API_KEY to run a paid canary.',
    });
    return;
  }

  const payload = klingCanarySchema.parse(req.body ?? {});
  const status = await startKlingSelfLikenessCanary({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    saveAsDraft: payload.saveAsDraft,
    forceRetest: payload.forceRetest,
    variant: payload.variant,
  });
  res.status(status.ok ? 202 : status.failureCategory === 'configured_not_implemented' ? 501 : status.failureCategory === 'not_configured' ? 403 : 200).json({
    ...status,
    warning: 'This may consume provider credits.',
  });
});

healthRouter.post('/api/diagnostics/kling-likeness-canary/recover', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Kling recovery disabled. Set ENABLE_RENDER_PROBE=true to recover an existing Kling provider job.',
    });
    return;
  }
  if (!env.KLING_ENABLED) {
    res.status(403).json({
      error: 'Kling recovery disabled. Set KLING_ENABLED=true to recover a Kling job.',
    });
    return;
  }
  if (!env.FAL_KEY && !env.KLING_API_KEY) {
    res.status(403).json({
      error: 'Fal API key missing. Set FAL_KEY or KLING_API_KEY to recover a Kling job.',
    });
    return;
  }

  const payload = klingRecoverSchema.parse(req.body ?? {});
  const status = await recoverKlingSelfLikenessCanary({
    userId: payload.userId ?? req.header('x-lumora-user-id') ?? null,
    attemptId: payload.attemptId ?? null,
    providerJobId: payload.providerJobId ?? null,
    saveAsDraft: payload.saveAsDraft,
  });
  res.status(status.ok ? 200 : 200).json(status);
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

healthRouter.post('/api/diagnostics/normalize-verification-video/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Verification video normalization diagnostics disabled. Set ENABLE_RENDER_PROBE=true to normalize private verification media.',
    });
    return;
  }

  const payload = normalizeVerificationVideoSchema.parse(req.body ?? {});
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  const status = await normalizeSeedanceVerificationVideoForDiagnostics({
    userId,
    forceNormalize: payload.forceNormalize || payload.force,
  });
  res.json(status);
});

healthRouter.post('/api/diagnostics/seedance-video-reference-canary/self', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Render probe disabled. Set ENABLE_RENDER_PROBE=true to run a paid video-reference canary.',
    });
    return;
  }

  const payload = videoReferenceCanarySchema.parse(req.body ?? {});
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  const status = await startSeedanceVideoReferenceCanary({
    userId,
    saveAsDraft: payload.saveAsDraft,
    variant: payload.variant,
    forceNormalize: payload.forceNormalize,
    allowOriginalFallback: payload.allowOriginalFallback,
    forceRetest: payload.forceRetest,
  });
  res.status('ok' in status && status.ok === false ? 200 : 202).json({
    ...status,
    warning: 'This may consume provider credits.',
  });
});

healthRouter.post('/api/diagnostics/repair-seedance-video-reference-status', async (req, res) => {
  if (!env.ENABLE_RENDER_PROBE) {
    res.status(403).json({
      error: 'Seedance video-reference status repair disabled. Set ENABLE_RENDER_PROBE=true to repair diagnostic canary memory.',
    });
    return;
  }

  const payload = canarySchema.parse(req.body ?? {});
  const userId = payload.userId ?? req.header('x-lumora-user-id') ?? null;
  const status = await repairSeedanceVideoReferenceBlockedStatus({ userId });
  res.status(status.ok ? 200 : 404).json(status);
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
