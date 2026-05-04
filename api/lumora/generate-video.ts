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

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function isReplicateFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('replicate') ||
    message.includes('replicate_api_token') ||
    (
      error instanceof ProviderError &&
      error.provider === 'replicate'
    )
  );
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
    console.error('LUMORA GENERATE ERROR:', error);

    if (error instanceof ProviderError) {
      const details = safeJsonValue(error.payload);

      if (isReplicateFailure(error)) {
        return sendJsonResponse(res, 500, {
          error: 'Replicate failed',
          suggestion: 'Check billing or API token',
          details,
          provider: error.provider,
          model: error.model,
          stack: error.stack ?? null,
        });
      }

      return sendJsonResponse(res, 500, {
        error: error.message,
        details,
        provider: error.provider,
        model: error.model,
        stack: error.stack ?? null,
        rawOutput: details,
      });
    }

    if (errorMessage(error) === 'Missing REPLICATE_API_TOKEN') {
      return sendJsonResponse(res, 500, {
        error: 'Missing REPLICATE_API_TOKEN',
        suggestion: 'Check billing or API token',
        stack: errorStack(error),
      });
    }

    if (isReplicateFailure(error)) {
      return sendJsonResponse(res, 500, {
        error: 'Replicate failed',
        suggestion: 'Check billing or API token',
        details: errorMessage(error),
        stack: errorStack(error),
      });
    }

    return sendJsonResponse(res, 500, {
      error: errorMessage(error),
      stack: errorStack(error),
      details: safeJsonValue(error),
    });
  }
}
