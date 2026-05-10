import { Router } from 'express';
import { z } from 'zod';
import { createVideoGeneration } from '../video';

const generationSchema = z.object({
  prompt: z.string().min(1),
  stylePreset: z.union([z.string(), z.array(z.string())]).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  duration: z.coerce.number().int().min(2).max(30).default(8),
  engine: z.enum(['veo', 'runway', 'mock', 'openai']).default('mock'),
  privacy: z.enum(['private', 'approved_only', 'public']).default('private'),
  characterId: z.string().optional().nullable(),
  characterName: z.string().optional().nullable(),
  characterAvatar: z.string().optional().nullable(),
  isDefaultSelfCharacter: z.boolean().optional().nullable(),
});

function stylePrompt(value: string | string[] | undefined, prompt: string) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const promptLower = prompt.toLowerCase();
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
    .filter((style) => !promptLower.includes(style.toLowerCase()))
    .join(', ');
}

export const generationsRouter = Router();

generationsRouter.get('/', async (_req, res) => {
  res.json({ jobs: [] });
});

generationsRouter.post('/', async (req, res) => {
  const payload = generationSchema.parse(req.body);
  const selectedStyle = stylePrompt(payload.stylePreset, payload.prompt);
  const prompt = selectedStyle
    ? `${payload.prompt}\n\nStyle: ${selectedStyle}`
    : payload.prompt;

  const providerResult = await createVideoGeneration(payload.engine, {
    userId: 'local',
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

  res.json({
    id: providerResult.providerJobId,
    jobId: providerResult.providerJobId,
    status: 'completed',
    engine: payload.engine,
    characterId: payload.characterId ?? null,
    characterName: payload.characterName ?? null,
    prompt,
    outputUrl: providerResult.resultAssetUrl,
    message: providerResult.message,
    createdAt: new Date().toISOString(),
  });
});
