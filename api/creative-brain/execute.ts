import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { creativeBrainScenePlanSchema } from '../../backend/src/services/creativeBrain';
import { executeScenePlan } from '../../backend/src/services/sceneExecutor';
import { checkRateLimit, sendRateLimitHeaders } from '../_lib/rateLimit';

type SceneExecutorRequest = IncomingMessage & {
  body?: unknown;
};

type SceneExecutorRequestBody = {
  scenePlan?: unknown;
  userId?: unknown;
  projectId?: unknown;
  characterId?: unknown;
  characterMetadata?: unknown;
  referenceImages?: unknown;
  quality?: unknown;
  renderPreference?: unknown;
  privacy?: unknown;
};

const seedanceReferenceImageSchema = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    label: z.string().optional(),
    role: z.string().optional(),
    token: z.string().optional(),
  }),
]);

const executeScenePlanRequestSchema = z.object({
  scenePlan: creativeBrainScenePlanSchema,
  userId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  characterMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
  referenceImages: z.array(seedanceReferenceImageSchema).optional(),
  quality: z.enum(['fast', 'quality']).default('fast'),
  renderPreference: z.enum(['cinematic_quality', 'balanced', 'success_first']).default('balanced'),
  privacy: z.enum(['private', 'approved_only', 'public']).default('private'),
});

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readBody(req: SceneExecutorRequest): Promise<SceneExecutorRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as SceneExecutorRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as SceneExecutorRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as SceneExecutorRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as SceneExecutorRequestBody;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Scene Executor failed to render the storyboard.';
}

function seedanceReferenceImages(
  value: Array<z.infer<typeof seedanceReferenceImageSchema>> | undefined,
) {
  return (value ?? []).map((reference, index) => {
    if (typeof reference === 'string') {
      return {
        url: reference,
        label: `Reference image ${index + 1}`,
        role: 'reference',
        token: `[Image${index + 1}]`,
      };
    }

    return {
      url: reference.url,
      label: reference.label,
      role: reference.role,
      token: reference.token ?? `[Image${index + 1}]`,
    };
  });
}

export default async function handler(req: SceneExecutorRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rateLimit = checkRateLimit({
    req,
    keyPrefix: 'scene-executor',
    windowMs: 60_000,
    maxRequests: 4,
  });
  sendRateLimitHeaders(res, {
    limit: 4,
    remaining: rateLimit.remaining,
    resetAt: rateLimit.resetAt,
    retryAfter: rateLimit.ok ? undefined : rateLimit.retryAfter,
  });
  if (!rateLimit.ok) {
    sendJson(res, 429, {
      status: 'failed',
      error: 'Too many scene execution requests. Please wait before trying again.',
      retryAfter: rateLimit.retryAfter,
    });
    return;
  }

  let body: SceneExecutorRequestBody;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { status: 'failed', error: 'Invalid JSON body.', details: errorMessage(error) });
    return;
  }

  const parsed = executeScenePlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(res, 400, {
      status: 'failed',
      error: 'Invalid scene execution request.',
      details: parsed.error.issues,
    });
    return;
  }

  try {
    const result = await executeScenePlan({
      scenePlan: parsed.data.scenePlan,
      userId: parsed.data.userId,
      projectId: parsed.data.projectId ?? null,
      characterId: parsed.data.characterId ?? null,
      characterMetadata: parsed.data.characterMetadata ?? null,
      referenceImages: seedanceReferenceImages(parsed.data.referenceImages),
      quality: parsed.data.quality,
      renderPreference: parsed.data.renderPreference,
      privacy: parsed.data.privacy,
    });

    sendJson(res, 200, result);
  } catch (error) {
    console.error('VERCEL SCENE EXECUTOR FAILED:', {
      userId: parsed.data.userId,
      shotCount: parsed.data.scenePlan.shotList.length,
      referenceImageCount: parsed.data.referenceImages?.length ?? 0,
      error,
    });
    sendJson(res, 500, {
      status: 'failed',
      error: errorMessage(error),
      clips: [],
      createdAt: new Date().toISOString(),
    });
  }
}
