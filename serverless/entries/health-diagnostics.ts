import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildProductionHealthDiagnostics } from '../../backend/src/services/productionHealthDiagnostics';

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, {
      ok: false,
      error: 'method_not_allowed',
      secretsRedacted: true,
      privateUrlsRedacted: true,
    });
  }

  return sendJson(res, 200, await buildProductionHealthDiagnostics());
}
