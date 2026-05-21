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
import { buildRenderSuccessDiagnostics } from '../services/renderSuccessEngine';
import { buildRenderReliabilityDiagnostics } from '../services/sceneOptimization';
import {
  buildRenderPathCompareDiagnostics,
  getSeedanceCanaryStatus,
  startSeedanceCanary,
  startSeedanceReferenceCanary,
} from '../services/seedanceCanary';

export const healthRouter = Router();
const canarySchema = z.object({
  userId: z.string().optional().nullable(),
  saveAsDraft: z.boolean().optional().default(false),
});
const referenceCanarySchema = canarySchema.extend({
  characterId: z.string().min(1),
});

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lumora-api' });
});

healthRouter.get('/api/health/diagnostics', async (_req, res) => {
  res.json({
    service: 'lumora-api',
    checkedAt: new Date().toISOString(),
    ...getEnvironmentDiagnostics(),
    database: await buildDatabaseDiagnostics(),
    assetPersistence: await buildAssetPersistenceDiagnostics(),
    referenceCleanup: await buildReferenceCleanupDiagnostics(),
    providerFallback: await buildProviderFallbackDiagnostics(),
    renderSuccessEngine: await buildRenderSuccessDiagnostics(),
    renderReliability: await buildRenderReliabilityDiagnostics(),
    asyncRenderJobs: await buildAsyncRenderJobDiagnostics(),
  });
});

healthRouter.get('/api/diagnostics/render-last', async (_req, res) => {
  res.json(await buildLastRenderDiagnostics());
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
