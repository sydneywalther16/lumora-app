import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  continuityMemoryFields,
  getContinuityMemory,
  saveContinuityMemoryPatch,
} from '../../backend/src/services/memoryEngine';
import { checkRateLimit, sendRateLimitHeaders } from '../../serverless/_lib/rateLimit';

type ContinuityMemoryRequest = IncomingMessage & {
  body?: unknown;
};

type ContinuityMemoryRequestBody = {
  userId?: unknown;
  projectId?: unknown;
  characterId?: unknown;
  state?: unknown;
  lockedFields?: unknown;
};

const continuityMemoryScopeSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
});

const continuityMemoryStatePatchSchema = z.object(
  Object.fromEntries(continuityMemoryFields.map((field) => [field, z.string().optional()])) as Record<
    typeof continuityMemoryFields[number],
    z.ZodOptional<z.ZodString>
  >,
).partial();

const continuityMemoryLocksPatchSchema = z.object(
  Object.fromEntries(continuityMemoryFields.map((field) => [field, z.boolean().optional()])) as Record<
    typeof continuityMemoryFields[number],
    z.ZodOptional<z.ZodBoolean>
  >,
).partial();

const continuityMemoryPatchSchema = continuityMemoryScopeSchema.extend({
  state: continuityMemoryStatePatchSchema.optional(),
  lockedFields: continuityMemoryLocksPatchSchema.optional(),
});

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req: ContinuityMemoryRequest): Promise<ContinuityMemoryRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as ContinuityMemoryRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as ContinuityMemoryRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ContinuityMemoryRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ContinuityMemoryRequestBody;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Continuity Memory request failed.';
}

function queryPayload(req: IncomingMessage) {
  const url = new URL(req.url ?? '/api/creative-brain/memory', 'http://localhost');
  return {
    userId: url.searchParams.get('userId') ?? undefined,
    projectId: url.searchParams.get('projectId'),
    characterId: url.searchParams.get('characterId'),
  };
}

export default async function handler(req: ContinuityMemoryRequest, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rateLimit = checkRateLimit({
    req,
    keyPrefix: 'continuity-memory',
    windowMs: 60_000,
    maxRequests: 30,
  });
  sendRateLimitHeaders(res, {
    limit: 30,
    remaining: rateLimit.remaining,
    resetAt: rateLimit.resetAt,
    retryAfter: rateLimit.ok ? undefined : rateLimit.retryAfter,
  });
  if (!rateLimit.ok) {
    sendJson(res, 429, {
      status: 'failed',
      error: 'Too many Continuity Memory requests. Please wait before trying again.',
      retryAfter: rateLimit.retryAfter,
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const parsed = continuityMemoryScopeSchema.safeParse(queryPayload(req));
      if (!parsed.success) {
        sendJson(res, 400, {
          status: 'failed',
          error: 'Invalid Continuity Memory query.',
          details: parsed.error.issues,
        });
        return;
      }

      const memory = await getContinuityMemory({
        userId: parsed.data.userId,
        projectId: parsed.data.projectId ?? null,
        characterId: parsed.data.characterId ?? null,
      });
      sendJson(res, 200, { memory });
      return;
    }

    const body = await readBody(req);
    const parsed = continuityMemoryPatchSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, {
        status: 'failed',
        error: 'Invalid Continuity Memory patch.',
        details: parsed.error.issues,
      });
      return;
    }

    const memory = await saveContinuityMemoryPatch({
      userId: parsed.data.userId,
      projectId: parsed.data.projectId ?? null,
      characterId: parsed.data.characterId ?? null,
      state: parsed.data.state ?? null,
      lockedFields: parsed.data.lockedFields ?? null,
    });
    sendJson(res, 200, { memory });
  } catch (error) {
    console.error('VERCEL CONTINUITY MEMORY FAILED:', { error });
    sendJson(res, 500, {
      status: 'failed',
      error: errorMessage(error),
      createdAt: new Date().toISOString(),
    });
  }
}
