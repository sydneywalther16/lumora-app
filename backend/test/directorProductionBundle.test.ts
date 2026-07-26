import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/lumora';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-disabled';
process.env.REPLICATE_API_TOKEN = 'test-disabled';
process.env.GOOGLE_API_KEY = 'test-disabled';
process.env.FAL_KEY = 'test-disabled';
process.env.KLING_API_KEY = 'test-disabled';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('Unexpected external request during Director production-bundle dry run.');
};

try {
  const { default: handler } = await import(
    `${pathToFileURL(join(process.cwd(), 'api/health/diagnostics.js')).href}?director-bundle=${Date.now()}`
  );
  let statusCode = 0;
  let responseBody = '';
  const responseHeaders = new Map<string, string>();

  await handler(
    { method: 'GET' },
    {
      set statusCode(value: number) {
        statusCode = value;
      },
      get statusCode() {
        return statusCode;
      },
      setHeader(name: string, value: string) {
        responseHeaders.set(name.toLowerCase(), value);
      },
      end(value: string) {
        responseBody = value;
      },
    },
  );

  assert.equal(statusCode, 200);
  assert.equal(responseHeaders.get('content-type'), 'application/json');
  const body = JSON.parse(responseBody);
  assert.equal(body.director.mode, 'dry_run');
  assert.equal(body.director.paidExecutionEnabled, false);
  assert.equal(body.director.providerSdkCallAllowed, false);
  assert.equal(body.director.plan.shots.length <= 3, true);
  assert.equal(body.director.progressStates.length, 6);
  assert.equal(body.director.projectedRequests.sceneAnchor, 1);
  assert.equal(body.director.projectedRequests.primaryVideo, 1);
  assert.equal(body.director.actualTelemetry.providerRequestCount, 0);
  assert.equal(body.director.actualTelemetry.providerRetryCount, 0);
  assert.equal(body.director.actualTelemetry.providerFallbackCount, 0);
  assert.equal(body.director.actualTelemetry.repairRequestCount, 0);
  assert.equal(body.director.actualTelemetry.billableMetric, null);
  assert.equal(body.director.disclosure, 'Synthetic portrayal');
  assert.equal(body.director.publicCaptionSeparated, true);

  const directorJson = JSON.stringify(body.director);
  assert.doesNotMatch(directorJson, /https?:\/\//i);
  assert.doesNotMatch(directorJson, /bearer\s|signed[_ -]?url|api[_ -]?key|authorization header/i);

  const endpointCount = readdirSync(join(process.cwd(), 'api'), { recursive: true })
    .map(String)
    .filter((file) => /\.(?:ts|js)$/.test(file))
    .length;
  assert.equal(endpointCount, 12);

  console.log('Director production bundle dry-run tests passed');
} finally {
  globalThis.fetch = originalFetch;
}
