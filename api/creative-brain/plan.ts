import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createCreativeBrainPlan,
  CreativeBrainConfigurationError,
} from '../../backend/src/services/creativeBrain';
import { checkRateLimit, sendRateLimitHeaders } from '../_lib/rateLimit';

type CreativeBrainRequest = IncomingMessage & {
  body?: unknown;
};

type CreativeBrainRequestBody = {
  prompt?: unknown;
  characterMetadata?: unknown;
  styleTheme?: unknown;
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req: CreativeBrainRequest): Promise<CreativeBrainRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as CreativeBrainRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as CreativeBrainRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as CreativeBrainRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as CreativeBrainRequestBody;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Creative Brain failed to create a scene plan.';
}

export default async function handler(req: CreativeBrainRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rateLimit = checkRateLimit({
    req,
    keyPrefix: 'creative-brain',
    windowMs: 60_000,
    maxRequests: 20,
  });
  sendRateLimitHeaders(res, {
    limit: 20,
    remaining: rateLimit.remaining,
    resetAt: rateLimit.resetAt,
    retryAfter: rateLimit.ok ? undefined : rateLimit.retryAfter,
  });
  if (!rateLimit.ok) {
    sendJson(res, 429, {
      status: 'failed',
      error: 'Too many Creative Brain requests. Please wait before trying again.',
      retryAfter: rateLimit.retryAfter,
    });
    return;
  }

  let body: CreativeBrainRequestBody;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid JSON body.', details: errorMessage(error) });
    return;
  }

  const prompt = stringValue(body.prompt);
  if (!prompt) {
    sendJson(res, 400, { error: 'Creative Brain requires a prompt.' });
    return;
  }

  try {
    const result = await createCreativeBrainPlan({
      prompt,
      characterMetadata: recordValue(body.characterMetadata),
      styleTheme: stringValue(body.styleTheme),
    });
    sendJson(res, 200, result);
  } catch (error) {
    console.error('VERCEL CREATIVE BRAIN PLAN FAILED:', {
      prompt,
      error,
    });
    sendJson(res, error instanceof CreativeBrainConfigurationError ? error.statusCode : 500, {
      status: 'failed',
      error: errorMessage(error),
      createdAt: new Date().toISOString(),
    });
  }
}
