import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkRateLimit, sendRateLimitHeaders } from '../_lib/rateLimit';
import { persistCompletedGeneration } from '../../backend/src/services/generationPersistence';
import { createSeedanceGeneration } from '../../backend/src/services/generationService';
import { isSeedanceModerationError } from '../../backend/src/services/providers/seedanceProvider';
import { createVideoGeneration } from '../../backend/src/video';

type GenerationRequest = IncomingMessage & {
  body?: unknown;
};

type GenerationRequestBody = {
  prompt?: unknown;
  title?: unknown;
  userId?: unknown;
  stylePreset?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  engine?: unknown;
  privacy?: unknown;
  characterId?: unknown;
  characterName?: unknown;
  characterAvatar?: unknown;
  isDefaultSelfCharacter?: unknown;
  renderPreference?: unknown;
  referenceImages?: unknown;
};

const supportedEngines = ['seedance-2.0', 'seedance-quality', 'veo', 'runway', 'mock', 'openai'] as const;
type SupportedEngine = typeof supportedEngines[number];

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function referenceImagesValue(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((reference, index) => {
    if (typeof reference === 'string' && /^https?:\/\//i.test(reference.trim())) {
      return [{
        url: reference.trim(),
        label: `Reference image ${index + 1}`,
        role: 'reference',
        token: `[Image${index + 1}]`,
      }];
    }

    if (!reference || typeof reference !== 'object') return [];
    const record = reference as Record<string, unknown>;
    const url = stringValue(record.url);
    if (!url || !/^https?:\/\//i.test(url)) return [];

    return [{
      url,
      label: stringValue(record.label) ?? undefined,
      role: stringValue(record.role) ?? undefined,
      token: stringValue(record.token) ?? `[Image${index + 1}]`,
    }];
  }).map((reference, index) => ({
    ...reference,
    token: `[Image${index + 1}]`,
  }));
}

function engineValue(value: unknown): SupportedEngine {
  return supportedEngines.includes(value as SupportedEngine) ? value as SupportedEngine : 'mock';
}

function aspectRatioValue(value: unknown) {
  return value === '16:9' || value === '1:1' || value === '9:16' ? value : '9:16';
}

function durationValue(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.min(30, Math.max(2, Math.round(duration))) : 8;
}

function renderPreferenceValue(value: unknown) {
  return value === 'cinematic_quality' || value === 'success_first' || value === 'balanced'
    ? value
    : 'balanced';
}

function privacyValue(value: unknown) {
  return value === 'approved_only' || value === 'public' || value === 'private' ? value : 'private';
}

function stylePrompt(value: unknown, prompt: string) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const promptLower = prompt.toLowerCase();

  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
    .filter((style) => !promptLower.includes(style.toLowerCase()))
    .join(', ');
}

async function readBody(req: GenerationRequest): Promise<GenerationRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as GenerationRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as GenerationRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as GenerationRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GenerationRequestBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Generation failed.';
}

export default async function handler(req: GenerationRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rateLimit = checkRateLimit({
    req,
    keyPrefix: 'generation',
    windowMs: 60_000,
    maxRequests: 12,
  });
  sendRateLimitHeaders(res, {
    limit: 12,
    remaining: rateLimit.remaining,
    resetAt: rateLimit.resetAt,
    retryAfter: rateLimit.ok ? undefined : rateLimit.retryAfter,
  });
  if (!rateLimit.ok) {
    sendJson(res, 429, {
      status: 'failed',
      error: 'Too many generation requests. Please wait before trying again.',
      retryAfter: rateLimit.retryAfter,
    });
    return;
  }

  let body: GenerationRequestBody;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { status: 'failed', error: 'Invalid JSON body.', details: errorMessage(error) });
    return;
  }

  const prompt = stringValue(body.prompt);
  if (!prompt) {
    sendJson(res, 400, { status: 'failed', error: 'Generation requires a prompt.' });
    return;
  }

  const engine = engineValue(body.engine);
  const selectedStyle = stylePrompt(body.stylePreset, prompt);
  const finalPrompt = selectedStyle ? `${prompt}\n\nStyle: ${selectedStyle}` : prompt;

  try {
    if (engine === 'seedance-2.0' || engine === 'seedance-quality') {
      const result = await createSeedanceGeneration({
        prompt: finalPrompt,
        quality: engine === 'seedance-quality' ? 'quality' : 'fast',
        userId: stringValue(body.userId),
        title: stringValue(body.title),
        characterId: stringValue(body.characterId),
        characterName: stringValue(body.characterName),
        characterAvatar: stringValue(body.characterAvatar),
        isDefaultSelfCharacter: booleanValue(body.isDefaultSelfCharacter),
        renderPreference: renderPreferenceValue(body.renderPreference),
        referenceImages: referenceImagesValue(body.referenceImages),
      });
      const { rawOutput: _rawOutput, ...publicResult } = result;
      sendJson(res, 200, {
        ...publicResult,
        characterId: stringValue(body.characterId),
        characterName: stringValue(body.characterName),
        characterAvatar: stringValue(body.characterAvatar),
        isDefaultSelfCharacter: booleanValue(body.isDefaultSelfCharacter),
        displayEngine: engine === 'seedance-quality' ? 'Seedance Quality' : 'Seedance Fast',
        generationMode: publicResult.multimodalReferenceMode ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
      });
      return;
    }

    const providerResult = await createVideoGeneration(engine, {
      userId: stringValue(body.userId) ?? 'local',
      prompt: finalPrompt,
      durationSeconds: durationValue(body.duration),
      aspectRatio: aspectRatioValue(body.aspectRatio),
      privacy: privacyValue(body.privacy),
      characterId: stringValue(body.characterId),
      characterName: stringValue(body.characterName),
    });

    if (providerResult.status !== 'completed') {
      sendJson(res, 202, {
        id: providerResult.providerJobId,
        jobId: providerResult.providerJobId,
        status: providerResult.status,
        engine,
        prompt: finalPrompt,
        outputUrl: '',
        videoUrl: '',
        message: providerResult.message,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const persistence = await persistCompletedGeneration({
      userId: stringValue(body.userId),
      id: providerResult.providerJobId,
      title: stringValue(body.title),
      prompt: finalPrompt,
      finalPrompt: providerResult.prompt,
      provider: engine,
      engine,
      videoUrl: providerResult.resultAssetUrl,
      thumbnailUrl: providerResult.resultAssetUrl,
      characterId: stringValue(body.characterId),
      characterName: stringValue(body.characterName),
      characterAvatar: stringValue(body.characterAvatar),
      isDefaultSelfCharacter: booleanValue(body.isDefaultSelfCharacter),
      durationSeconds: durationValue(body.duration),
      aspectRatio: aspectRatioValue(body.aspectRatio),
      privacy: privacyValue(body.privacy),
    });

    sendJson(res, 200, {
      id: providerResult.providerJobId,
      jobId: providerResult.providerJobId,
      status: 'completed',
      engine,
      prompt: finalPrompt,
      outputUrl: persistence.videoUrl,
      videoUrl: persistence.videoUrl,
      projectId: persistence.projectId,
      storagePath: persistence.storagePath,
      warnings: persistence.warnings,
      message: providerResult.message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('VERCEL GENERATION PROVIDER FAILED:', { engine, error });
    const message = errorMessage(error);
    if (isSeedanceModerationError(error)) {
      console.warn('VERCEL SEEDANCE MODERATION RESPONSE:', {
        engine,
        prompt: finalPrompt,
        diagnostics: error.diagnostics,
        exactProviderMessage: error.diagnostics.providerMessage,
      });
      sendJson(res, error.statusCode, {
        id: null,
        jobId: null,
        status: 'failed',
        engine,
        provider: 'replicate',
        prompt: finalPrompt,
        outputUrl: '',
        videoUrl: '',
        error: 'Seedance moderation paused this render after Lumora tried a safer cinematic rewrite.',
        message: 'Seedance moderation paused this render after Lumora tried a safer cinematic rewrite.',
        moderation: true,
        suggestion: error.suggestion,
        suggestedPrompt: error.suggestedPrompt,
        sanitizedPrompt: error.sanitizedPrompt,
        moderationDiagnostics: error.diagnostics,
        referenceImages: error.referenceImages,
        referenceImageCount: error.referenceImages.length,
        multimodalReferenceMode: error.referenceImages.length > 1,
        generationMode: error.referenceImages.length > 0 ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    sendJson(res, 500, {
      id: null,
      jobId: null,
      status: 'failed',
      engine,
      prompt: finalPrompt,
      outputUrl: '',
      videoUrl: '',
      error: message,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}
