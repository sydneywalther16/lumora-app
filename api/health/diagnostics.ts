import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEnvironmentDiagnostics } from '../../backend/src/lib/envDiagnostics';
import { buildDatabaseDiagnostics } from '../../backend/src/services/schemaDiagnostics';

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    service: 'lumora-vercel-api',
    checkedAt: new Date().toISOString(),
    ...getEnvironmentDiagnostics(),
    database: await buildDatabaseDiagnostics(),
  }));
}
