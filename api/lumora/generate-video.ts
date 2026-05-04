import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  errorMessage,
  generateVideoFromBody,
  ProviderError,
  readGenerateBody,
  safeJsonValue,
  sendJsonResponse,
} from '../../src/server/videoGeneration';

type GenerateVideoRequest = IncomingMessage & {
  body?: unknown;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: GenerateVideoRequest, res: ServerResponse) {
  try {
    console.info('LUMORA GENERATE START', { method: req.method });

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJsonResponse(res, 405, { error: 'Method not allowed' });
    }

    let body;

    try {
      body = await readGenerateBody(req);
    } catch (error) {
      console.warn('Invalid /api/lumora/generate-video JSON body', error);
      return sendJsonResponse(res, 400, { error: 'Invalid JSON body.' });
    }

    console.info('LUMORA PROVIDER', {
      provider: textValue(body.provider) || null,
      engine: textValue(body.engine) || null,
    });

    const result = await generateVideoFromBody(body);
    return sendJsonResponse(res, 200, result);
  } catch (error) {
    console.error('LUMORA GENERATE ERROR', error);

    if (error instanceof ProviderError) {
      const details = safeJsonValue(error.payload);
      return sendJsonResponse(res, error.statusCode, {
        error: error.message,
        details,
        provider: error.provider,
        model: error.model,
        rawOutput: details,
      });
    }

    return sendJsonResponse(res, 500, {
      error: errorMessage(error),
      details: safeJsonValue(error),
    });
  }
}
