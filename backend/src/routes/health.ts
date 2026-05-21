import { Router } from 'express';
import { getEnvironmentDiagnostics } from '../lib/envDiagnostics';
import { buildAssetPersistenceDiagnostics } from '../services/assetPersistence';
import { buildProviderFallbackDiagnostics } from '../services/providerFallbackOrchestrator';
import { buildLastRenderDiagnostics } from '../services/renderDiagnostics';
import { buildAsyncRenderJobDiagnostics } from '../services/renderJobPoller';
import { buildDatabaseDiagnostics } from '../services/schemaDiagnostics';
import { buildReferenceCleanupDiagnostics } from '../services/referenceCleanup';
import { buildRenderSuccessDiagnostics } from '../services/renderSuccessEngine';
import { buildRenderReliabilityDiagnostics } from '../services/sceneOptimization';

export const healthRouter = Router();

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
