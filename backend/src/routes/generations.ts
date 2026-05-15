import { Router } from 'express';
import { z } from 'zod';
import { createRateLimit } from '../middleware/rateLimit';
import { persistCompletedGeneration } from '../services/generationPersistence';
import { createSeedanceGeneration } from '../services/generationService';
import { isAssetPersistenceError } from '../services/assetPersistence';
import { isSeedanceModerationError } from '../services/providers/seedanceProvider';
import { createVideoGeneration } from '../video';

const generationEngines = ['seedance-2.0', 'seedance-quality', 'veo', 'runway', 'mock', 'openai'] as const;
const seedanceReferenceImageSchema = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    label: z.string().optional(),
    role: z.string().optional(),
    token: z.string().optional(),
  }),
]);

const generationSchema = z.object({
  prompt: z.string().min(1),
  title: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  stylePreset: z.union([z.string(), z.array(z.string())]).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  duration: z.coerce.number().int().min(2).max(30).default(8),
  engine: z.enum(generationEngines).default('mock'),
  privacy: z.enum(['private', 'approved_only', 'public']).default('private'),
  characterId: z.string().optional().nullable(),
  characterName: z.string().optional().nullable(),
  characterAvatar: z.string().optional().nullable(),
  isDefaultSelfCharacter: z.boolean().optional().nullable(),
  referenceImages: z.array(seedanceReferenceImageSchema).optional(),
});

const seedanceGenerationSchema = z.object({
  prompt: z.string().min(1),
  title: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  stylePreset: z.union([z.string(), z.array(z.string())]).optional(),
  quality: z.enum(['fast', 'quality']).default('fast'),
  engine: z.enum(['seedance-2.0', 'seedance-quality']).optional(),
  characterId: z.string().optional().nullable(),
  characterName: z.string().optional().nullable(),
  characterAvatar: z.string().optional().nullable(),
  isDefaultSelfCharacter: z.boolean().optional().nullable(),
  referenceImages: z.array(seedanceReferenceImageSchema).optional(),
});

function stylePrompt(value: string | string[] | undefined, prompt: string) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const promptLower = prompt.toLowerCase();
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
    .filter((style) => !promptLower.includes(style.toLowerCase()))
    .join(', ');
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

function firstReferenceThumbnail(
  value: Array<z.infer<typeof seedanceReferenceImageSchema>> | undefined,
  fallback?: string | null,
) {
  const reference = value?.find(Boolean);
  if (!reference) return fallback ?? null;
  return typeof reference === 'string' ? reference : reference.url;
}

export const generationsRouter = Router();
const generationRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 12,
  keyPrefix: 'generation',
});

generationsRouter.get('/', async (_req, res) => {
  res.json({ jobs: [] });
});

generationsRouter.post('/seedance', generationRateLimit, async (req, res) => {
  const payload = seedanceGenerationSchema.parse(req.body);
  const selectedStyle = stylePrompt(payload.stylePreset, payload.prompt);
  const prompt = selectedStyle
    ? `${payload.prompt}\n\nStyle: ${selectedStyle}`
    : payload.prompt;
  const quality = payload.engine === 'seedance-quality' ? 'quality' : payload.quality;

  try {
    const result = await createSeedanceGeneration({
      prompt,
      quality,
      userId: payload.userId ?? null,
      title: payload.title ?? null,
      characterId: payload.characterId ?? null,
      characterName: payload.characterName ?? null,
      characterAvatar: payload.characterAvatar ?? null,
      isDefaultSelfCharacter: payload.isDefaultSelfCharacter ?? null,
      referenceImages: seedanceReferenceImages(payload.referenceImages),
    });
    const { rawOutput: _rawOutput, ...publicResult } = result;

    res.json({
      ...publicResult,
      characterId: payload.characterId ?? null,
      characterName: payload.characterName ?? null,
      characterAvatar: payload.characterAvatar ?? null,
      isDefaultSelfCharacter: payload.isDefaultSelfCharacter ?? null,
      displayEngine: quality === 'quality' ? 'Seedance Quality' : 'Seedance Fast',
      generationMode: publicResult.multimodalReferenceMode ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
      assetPersistence: publicResult.assetPersistence ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Seedance generation failed.';
    if (isAssetPersistenceError(error)) {
      res.status(error.statusCode).json({
        id: null,
        jobId: null,
        status: 'failed',
        engine: quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
        provider: 'replicate',
        prompt,
        outputUrl: '',
        videoUrl: '',
        error: message,
        message,
        assetPersistence: true,
        assetPersistenceDiagnostics: {
          code: error.code,
          sourceUrl: error.sourceUrl ?? null,
          host: error.host ?? null,
        },
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (isSeedanceModerationError(error)) {
      console.warn('SEEDANCE GENERATION MODERATION RESPONSE:', {
        engine: payload.engine ?? 'seedance-2.0',
        quality,
        diagnostics: error.diagnostics,
        exactProviderMessage: error.diagnostics.providerMessage,
      });
      res.status(error.statusCode).json({
        id: null,
        jobId: null,
        status: 'failed',
        engine: quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
        provider: 'replicate',
        prompt,
        outputUrl: '',
        videoUrl: '',
        error: 'Seedance moderation paused this render after Lumora tried moderation-safe cinematic orchestration.',
        message: 'Seedance moderation paused this render after Lumora tried moderation-safe cinematic orchestration.',
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

    console.error('SEEDANCE GENERATION FAILED:', {
      engine: payload.engine ?? 'seedance-2.0',
      quality,
      error,
    });
    res.status(500).json({
      id: null,
      jobId: null,
      status: 'failed',
      engine: quality === 'quality' ? 'seedance-quality' : 'seedance-2.0',
      provider: 'replicate',
      prompt,
      outputUrl: '',
      videoUrl: '',
      error: message,
      message,
      createdAt: new Date().toISOString(),
    });
  }
});

generationsRouter.post('/', generationRateLimit, async (req, res) => {
  const payload = generationSchema.parse(req.body);
  const selectedStyle = stylePrompt(payload.stylePreset, payload.prompt);
  const prompt = selectedStyle
    ? `${payload.prompt}\n\nStyle: ${selectedStyle}`
    : payload.prompt;

  try {
    if (payload.engine === 'seedance-2.0' || payload.engine === 'seedance-quality') {
      const result = await createSeedanceGeneration({
        prompt,
        quality: payload.engine === 'seedance-quality' ? 'quality' : 'fast',
        userId: payload.userId ?? null,
        title: payload.title ?? null,
        characterId: payload.characterId ?? null,
        characterName: payload.characterName ?? null,
        characterAvatar: payload.characterAvatar ?? null,
        isDefaultSelfCharacter: payload.isDefaultSelfCharacter ?? null,
        referenceImages: seedanceReferenceImages(payload.referenceImages),
      });
      const { rawOutput: _rawOutput, ...publicResult } = result;
      res.json({
        ...publicResult,
        characterId: payload.characterId ?? null,
        characterName: payload.characterName ?? null,
        characterAvatar: payload.characterAvatar ?? null,
        isDefaultSelfCharacter: payload.isDefaultSelfCharacter ?? null,
        displayEngine: payload.engine === 'seedance-quality' ? 'Seedance Quality' : 'Seedance Fast',
        generationMode: publicResult.multimodalReferenceMode ? 'seedance-multimodal-reference' : 'seedance-text-to-video',
        assetPersistence: publicResult.assetPersistence ?? null,
      });
      return;
    }

    const providerResult = await createVideoGeneration(payload.engine, {
      userId: payload.userId ?? 'local',
      prompt,
      durationSeconds: payload.duration,
      aspectRatio: payload.aspectRatio,
      privacy: payload.privacy,
      characterId: payload.characterId ?? null,
      characterName: payload.characterName ?? null,
    });

    if (providerResult.status !== 'completed') {
      res.status(202).json({
        id: providerResult.providerJobId,
        jobId: providerResult.providerJobId,
        status: providerResult.status,
        engine: payload.engine,
        characterId: payload.characterId ?? null,
        characterName: payload.characterName ?? null,
        prompt,
        outputUrl: '',
        message: providerResult.message,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const persistence = await persistCompletedGeneration({
      userId: payload.userId ?? null,
      id: providerResult.providerJobId,
      title: payload.title ?? null,
      prompt,
      finalPrompt: providerResult.prompt,
      provider: payload.engine,
      engine: payload.engine,
      videoUrl: providerResult.resultAssetUrl,
      thumbnailUrl: firstReferenceThumbnail(payload.referenceImages, payload.characterAvatar),
      characterId: payload.characterId ?? null,
      characterName: payload.characterName ?? null,
      characterAvatar: payload.characterAvatar ?? null,
      isDefaultSelfCharacter: payload.isDefaultSelfCharacter ?? null,
      durationSeconds: payload.duration,
      aspectRatio: payload.aspectRatio,
      privacy: payload.privacy,
    });

    res.json({
      id: providerResult.providerJobId,
      jobId: providerResult.providerJobId,
      status: 'completed',
      engine: payload.engine,
      provider: payload.engine,
      characterId: payload.characterId ?? null,
      characterName: payload.characterName ?? null,
      prompt,
      outputUrl: persistence.videoUrl,
      videoUrl: persistence.videoUrl,
      thumbnailUrl: firstReferenceThumbnail(payload.referenceImages, payload.characterAvatar),
      posterUrl: firstReferenceThumbnail(payload.referenceImages, payload.characterAvatar),
      projectId: persistence.projectId,
      storagePath: persistence.storagePath,
      warnings: persistence.warnings,
      message: providerResult.message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.';
    console.error('GENERATION PROVIDER FAILED:', {
      engine: payload.engine,
      error,
    });
    if (isAssetPersistenceError(error)) {
      res.status(error.statusCode).json({
        id: null,
        jobId: null,
        status: 'failed',
        engine: payload.engine,
        provider: 'replicate',
        prompt,
        outputUrl: '',
        videoUrl: '',
        error: message,
        message,
        assetPersistence: true,
        assetPersistenceDiagnostics: {
          code: error.code,
          sourceUrl: error.sourceUrl ?? null,
          host: error.host ?? null,
        },
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (isSeedanceModerationError(error)) {
      console.warn('GENERATION PROVIDER MODERATION RESPONSE:', {
        engine: payload.engine,
        diagnostics: error.diagnostics,
        exactProviderMessage: error.diagnostics.providerMessage,
      });
      res.status(error.statusCode).json({
        id: null,
        jobId: null,
        status: 'failed',
        engine: payload.engine,
        provider: 'replicate',
        prompt,
        outputUrl: '',
        videoUrl: '',
        error: 'Seedance moderation paused this render after Lumora tried moderation-safe cinematic orchestration.',
        message: 'Seedance moderation paused this render after Lumora tried moderation-safe cinematic orchestration.',
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

    res.status(500).json({
      id: null,
      jobId: null,
      status: 'failed',
      engine: payload.engine,
      prompt,
      outputUrl: '',
      videoUrl: '',
      error: message,
      message,
      createdAt: new Date().toISOString(),
    });
  }
});
