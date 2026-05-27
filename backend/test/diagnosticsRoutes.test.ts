import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { env } from '../src/lib/env';
import { healthRouter } from '../src/routes/health';

env.ENABLE_RENDER_PROBE = false;

const app = express();
app.use(express.json());
app.use(healthRouter);

const server = app.listen(0);
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, init);
}

try {
  const referenceCanary = await request('/api/diagnostics/seedance-reference-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(referenceCanary.status, 403);
  assert.match((await referenceCanary.json()).error, /Render probe disabled/);

  const videoReferenceCanary = await request('/api/diagnostics/seedance-video-reference-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(videoReferenceCanary.status, 403);
  assert.match((await videoReferenceCanary.json()).error, /Render probe disabled/);

  const matrixCanary = await request('/api/diagnostics/seedance-reference-matrix/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(matrixCanary.status, 403);
  assert.match((await matrixCanary.json()).error, /Render probe disabled/);

  const textCanary = await request('/api/diagnostics/seedance-canary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(textCanary.status, 403);
  assert.match((await textCanary.json()).error, /Render probe disabled/);

  const soraCanary = await request('/api/diagnostics/sora-character-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(soraCanary.status, 403);
  assert.match((await soraCanary.json()).error, /Render probe disabled/);

  const exactCanary = await request('/api/diagnostics/exact-likeness-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(exactCanary.status, 403);
  assert.match((await exactCanary.json()).error, /Render probe disabled/);

  const runwayCanary = await request('/api/diagnostics/runway-likeness-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(runwayCanary.status, 403);
  assert.match((await runwayCanary.json()).error, /Render probe disabled/);

  const klingCanary = await request('/api/diagnostics/kling-likeness-canary/self', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(klingCanary.status, 403);
  assert.match((await klingCanary.json()).error, /Render probe disabled/);

  const klingRecover = await request('/api/diagnostics/kling-likeness-canary/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(klingRecover.status, 403);
  assert.match((await klingRecover.json()).error, /Kling recovery disabled/);

  const klingShape = await request('/api/diagnostics/kling-provider-shape');
  assert.equal(klingShape.status, 403);
  assert.match((await klingShape.json()).error, /Kling provider shape diagnostics disabled/);

  const renderLast = await request('/api/diagnostics/render-last');
  assert.equal(renderLast.status, 200);

  const inventory = await request('/api/diagnostics/canary-routes');
  assert.equal(inventory.status, 200);
  const inventoryBody = await inventory.json();
  assert.equal(inventoryBody.basePath, '/api/diagnostics');
  assert.equal(inventoryBody.textCanaryRouteMounted, true);
  assert.equal(inventoryBody.referenceCanaryRouteMounted, true);
  assert.equal(inventoryBody.referenceMatrixRouteMounted, true);
  assert.equal(inventoryBody.videoReferenceCanaryRouteMounted, true);
  assert.equal(inventoryBody.soraCharacterCanaryRouteMounted, true);
  assert.equal(inventoryBody.exactLikenessCanaryRouteMounted, true);
  assert.equal(inventoryBody.klingProviderShapeRouteMounted, true);
  assert.equal(inventoryBody.klingCanaryRecoverRouteMounted, true);
  assert.equal(inventoryBody.runwayLikenessCanaryRouteMounted, true);
  assert.equal(inventoryBody.klingLikenessCanaryRouteMounted, true);
  assert.equal(inventoryBody.renderLastRouteMounted, true);
  assert.equal(inventoryBody.renderPathCompareRouteMounted, true);
  assert.equal(inventoryBody.routes.referenceCanary, 'POST /api/diagnostics/seedance-reference-canary/self');
  assert.equal(inventoryBody.routes.referenceMatrix, 'POST /api/diagnostics/seedance-reference-matrix/self');
  assert.equal(inventoryBody.routes.videoReferenceCanary, 'POST /api/diagnostics/seedance-video-reference-canary/self');
  assert.equal(inventoryBody.routes.soraCharacterCanary, 'POST /api/diagnostics/sora-character-canary/self');
  assert.equal(inventoryBody.routes.exactLikenessCanary, 'POST /api/diagnostics/exact-likeness-canary/self');
  assert.equal(inventoryBody.routes.klingProviderShape, 'GET /api/diagnostics/kling-provider-shape');
  assert.equal(inventoryBody.routes.klingLikenessCanaryRecover, 'POST /api/diagnostics/kling-likeness-canary/recover');
  assert.equal(inventoryBody.routes.runwayLikenessCanary, 'POST /api/diagnostics/runway-likeness-canary/self');
  assert.equal(inventoryBody.routes.klingLikenessCanary, 'POST /api/diagnostics/kling-likeness-canary/self');

  console.log('diagnostics route smoke tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
