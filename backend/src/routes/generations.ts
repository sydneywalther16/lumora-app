import { Router } from 'express';
import { z } from 'zod';
import { createVideoGeneration, type VideoEngine, type VideoProviderResult } from '../video';

const generationSchema = z.object({
  prompt: z.string().min(1),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  duration: z.coerce.number().int().min(2).max(30).default(8),
  engine: z.enum(['veo', 'runway', 'mock', 'openai']).default('mock'),
  privacy: z.enum(['private', 'approved_only', 'public']).default('private'),
  characterId: z.string().optional().nullable(),
  characterName: z.string().optional().nullable(),
  characterAvatar: z.string().optional().nullable(),
  isDefaultSelfCharacter: z.boolean().optional().nullable(),
});

export const generationsRouter = Router();

generationsRouter.get('/', async (_req, res) => {
  res.json({ jobs: [] });
});

generationsRouter.post('/', async (req, res) => {
  const payload = generationSchema.parse(req.body);

  const providerResult = await createVideoGeneration(payload.engine, {
    userId: 'local',
    prompt: payload.prompt,
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
      prompt: payload.prompt,
      outputUrl: providerResult.resultAssetUrl ?? '',
      message: providerResult.message,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    id: providerResult.providerJobId,
    jobId: providerResult.providerJobId,
    status: 'completed',
    engine: payload.engine,
    characterId: payload.characterId ?? null,
    characterName: payload.characterName ?? null,
    prompt: payload.prompt,
    outputUrl: providerResult.resultAssetUrl,
    message: providerResult.message,
    createdAt: new Date().toISOString(),
  });
});
