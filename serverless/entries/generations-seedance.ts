import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkRateLimit, sendRateLimitHeaders } from '../../serverless/_lib/rateLimit';
import { createSeedanceGeneration } from '../../backend/src/services/generationService';
import {
  isSeedanceModerationError,
  type SeedanceInputMode,
} from '../../backend/src/services/providers/seedanceProvider';

type SeedanceRequest = IncomingMessage & {
  body?: unknown;
};

type SeedanceRequestBody = {
  prompt?: unknown;
  title?: unknown;
  userId?: unknown;
  stylePreset?: unknown;
  quality?: unknown;
  engine?: unknown;
  duration?: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  generateAudio?: unknown;
  maxProviderRequests?: unknown;
  characterId?: unknown;
  characterName?: unknown;
  characterAvatar?: unknown;
  isDefaultSelfCharacter?: unknown;
  renderPreference?: unknown;
  referenceImages?: unknown;
  firstFrameImage?: unknown;
  inputMode?: unknown;
};

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

function qualityValue(body: SeedanceRequestBody) {
  if (body.engine === 'seedance-quality' || body.quality === 'quality') return 'quality';
  return 'fast';
}

function inputModeValue(value: unknown): SeedanceInputMode | null {
  return value === 'text_to_video' ||
    value === 'image_to_video_first_frame' ||
    value === 'multimodal_reference'
    ? value
    : null;
}

function firstFrameImageValue(value: unknown) {
  return referenceImagesValue(value == null ? [] : [value])[0] ?? null;
}

function renderPreferenceValue(value: unknown) {
  return value === 'cinematic_quality' || value === 'success_first' || value === 'balanced'
    ? value
    : 'balanced';
}

function durationValue(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.min(10, Math.max(2, Math.round(duration))) : null;
}

function aspectRatioValue(value: unknown) {
  return value === '9:16' || value === '16:9' || value === '1:1' ? value : null;
}

function resolutionValue(value: unknown) {
  return value === '480p' || value === '720p' || value === '1080p' ? value : null;
}

function maxProviderRequestsValue(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(3, Math.max(1, Math.round(count))) : 1;
}

function stylePrompt(value: unknown, prompt: string) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const promptLower = prompt.toLowerCase();

  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
    .filter((style) => !promptLower.includes(style.toLowerCase()))
    .join(', ');
}

async function readBody(req: SeedanceRequest): Promise<SeedanceRequestBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as SeedanceRequestBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as SeedanceRequestBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as SeedanceRequestBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as SeedanceRequestBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Seedance generation failed.';
}

export default async function handler(req: SeedanceRequest, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rateLimit = checkRateLimit({
    req,
    keyPrefix: 'generation-seedance',
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

  let body: SeedanceRequestBody;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid JSON body.', details: errorMessage(error) });
    return;
  }

  const prompt = stringValue(body.prompt);
  if (!prompt) {
    sendJson(res, 400, { error: 'Seedance generation requires a prompt.' });
    return;
  }

  const inputMode = inputModeValue(body.inputMode);
  const selectedStyle = inputMode === 'image_to_video_first_frame'
    ? ''
    : stylePrompt(body.stylePreset, prompt);
  const finalPrompt = selectedStyle ? `${prompt}\n\nStyle: ${selectedStyle}` : prompt;
  const quality = qualityValue(body);
  const firstFrameImage = firstFrameImageValue(body.firstFrameImage);
  const referenceImages = inputMode === 'image_to_video_first_frame'
    ? []
    : referenceImagesValue(body.referenceImages);

  try {
    const result = await createSeedanceGeneration({
      prompt: finalPrompt,
      quality,
      userId: stringValue(body.userId),
      title: stringValue(body.title),
      characterId: stringValue(body.characterId),
      characterName: stringValue(body.characterName),
      characterAvatar: stringValue(body.characterAvatar),
      isDefaultSelfCharacter: booleanValue(body.isDefaultSelfCharacter),
      renderPreference: renderPreferenceValue(body.renderPreference),
      referenceImages,
      firstFrameImage,
      inputMode,
      durationSeconds: durationValue(body.duration),
      aspectRatio: aspectRatioValue(body.aspectRatio),
      resolution: resolutionValue(body.resolution),
      generateAudio: booleanValue(body.generateAudio),
      maxProviderRequests: maxProviderRequestsValue(body.maxProviderRequests),
    });
    const { rawOutput: _rawOutput, ...publicResult } = result;

    sendJson(res, 200, {
      ...publicResult,
      characterId: stringValue(body.characterId),
      characterName: stringValue(body.characterName),
      characterAvatar: stringValue(body.characterAvatar),
      isDefaultSelfCharacter: booleanValue(body.isDefaultSelfCharacter),
      displayEngine: publicResult.inputMode === 'image_to_video_first_frame'
        ? 'Seedance Fast — first-frame animation'
        : quality === 'quality'
          ? 'Seedance Quality'
          : 'Seedance Fast',
      generationMode: publicResult.inputMode === 'image_to_video_first_frame'
        ? 'seedance-image-to-video-first-frame'
        : publicResult.multimodalReferenceMode
          ? 'seedance-multimodal-reference'
          : 'seedance-text-to-video',
    });
  } catch (error) {
    const message = errorMessage(error);
    if (isSeedanceModerationError(error)) {
      console.warn('SEEDANCE MODERATION RESPONSE:', {
        quality,
        inputMode: error.diagnostics.inputMode,
        providerStatus: error.diagnostics.providerStatus,
        providerRequestCount: error.diagnostics.providerRequestCount,
        providerRetryCount: error.diagnostics.providerRetryCount,
        providerFallbackCount: error.diagnostics.providerFallbackCount,
      });
      const firstFrameModeration = error.diagnostics.inputMode === 'image_to_video_first_frame';
      const safeMessage = firstFrameModeration
        ? 'Seedance provider moderation paused this image-to-video first-frame animation. Your scene text is preserved.'
        : 'Seedance provider moderation paused this render.';
      sendJson(res, error.statusCode, {
        id: null,
        jobId: null,
        status: 'failed',
        engine: quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
        provider: 'replicate',
        prompt: finalPrompt,
        outputUrl: '',
        videoUrl: '',
        error: safeMessage,
        message: safeMessage,
        moderation: true,
        suggestion: error.suggestion,
        suggestedPrompt: error.suggestedPrompt,
        sanitizedPrompt: error.sanitizedPrompt,
        moderationDiagnostics: error.diagnostics,
        referenceImages: error.referenceImages,
        referenceImageCount: error.referenceImages.length,
        multimodalReferenceMode: error.diagnostics.inputMode === 'multimodal_reference',
        promptAdaptationApplied: error.diagnostics.promptAdaptationApplied,
        providerRequestCount: error.diagnostics.providerRequestCount,
        providerRetryCount: error.diagnostics.providerRetryCount,
        providerFallbackCount: error.diagnostics.providerFallbackCount,
        inputMode: error.diagnostics.inputMode,
        generationMode: firstFrameModeration
          ? 'seedance-image-to-video-first-frame'
          : error.referenceImages.length > 0
            ? 'seedance-multimodal-reference'
            : 'seedance-text-to-video',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    sendJson(res, 500, {
      id: null,
      jobId: null,
      status: 'failed',
      engine: quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
      provider: 'replicate',
      prompt: finalPrompt,
      outputUrl: '',
      videoUrl: '',
      error: message,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}
