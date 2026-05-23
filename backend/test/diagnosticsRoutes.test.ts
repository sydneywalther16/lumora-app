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

  const renderLast = await request('/api/diagnostics/render-last');
  assert.equal(renderLast.status, 200);

  const inventory = await request('/api/diagnostics/canary-routes');
  assert.equal(inventory.status, 200);
  const inventoryBody = await inventory.json();
  assert.equal(inventoryBody.basePath, '/api/diagnostics');
  assert.equal(inventoryBody.textCanaryRouteMounted, true);
  assert.equal(inventoryBody.referenceCanaryRouteMounted, true);
  assert.equal(inventoryBody.referenceMatrixRouteMounted, true);
  assert.equal(inventoryBody.soraCharacterCanaryRouteMounted, true);
  assert.equal(inventoryBody.exactLikenessCanaryRouteMounted, true);
  assert.equal(inventoryBody.renderLastRouteMounted, true);
  assert.equal(inventoryBody.renderPathCompareRouteMounted, true);
  assert.equal(inventoryBody.routes.referenceCanary, 'POST /api/diagnostics/seedance-reference-canary/self');
  assert.equal(inventoryBody.routes.referenceMatrix, 'POST /api/diagnostics/seedance-reference-matrix/self');
  assert.equal(inventoryBody.routes.soraCharacterCanary, 'POST /api/diagnostics/sora-character-canary/self');
  assert.equal(inventoryBody.routes.exactLikenessCanary, 'POST /api/diagnostics/exact-likeness-canary/self');

  console.log('diagnostics route smoke tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
