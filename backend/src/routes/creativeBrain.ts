import { Router } from 'express';
import { z } from 'zod';
import { createRateLimit } from '../middleware/rateLimit';
import {
  createCreativeBrainPlan,
  CreativeBrainConfigurationError,
  creativeBrainScenePlanSchema,
} from '../services/creativeBrain';
import {
  continuityMemoryFields,
  getContinuityMemory,
  saveContinuityMemoryPatch,
} from '../services/memoryEngine';
import {
  getCinematicCharacterProfileForUser,
  publicCharacterProfile,
} from '../services/characterProfiles';
import { executeScenePlan } from '../services/sceneExecutor';

const creativeBrainPlanRequestSchema = z.object({
  prompt: z.string().min(1),
  userId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  characterMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
  styleTheme: z.string().optional().nullable(),
});

const seedanceReferenceImageSchema = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    label: z.string().optional(),
    role: z.string().optional(),
    token: z.string().optional(),
  }),
]);

const creativeBrainExecuteRequestSchema = z.object({
  scenePlan: creativeBrainScenePlanSchema,
  userId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  characterMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
  referenceImages: z.array(seedanceReferenceImageSchema).optional(),
  quality: z.enum(['fast', 'quality']).default('fast'),
  privacy: z.enum(['private', 'approved_only', 'public']).default('private'),
});

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

export const creativeBrainRouter = Router();
const creativeBrainRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'creative-brain',
});
const sceneExecutorRateLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 4,
  keyPrefix: 'scene-executor',
});

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

creativeBrainRouter.post('/plan', creativeBrainRateLimit, async (req, res) => {
  const payload = creativeBrainPlanRequestSchema.parse(req.body);
  const characterProfile = payload.userId && payload.characterId
    ? await getCinematicCharacterProfileForUser(payload.userId, payload.characterId).catch(() => null)
    : null;
  const characterMetadata = {
    ...(payload.characterMetadata ?? {}),
    ...(characterProfile ? { characterProfile: publicCharacterProfile(characterProfile) } : {}),
  };

  try {
    const result = await createCreativeBrainPlan({
      prompt: payload.prompt,
      characterMetadata,
      styleTheme: payload.styleTheme ?? null,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Creative Brain failed to create a scene plan.';
    console.error('CREATIVE BRAIN PLAN FAILED:', {
      prompt: payload.prompt,
      styleTheme: payload.styleTheme ?? null,
      error,
    });

    res.status(error instanceof CreativeBrainConfigurationError ? error.statusCode : 500).json({
      error: message,
      status: 'failed',
      createdAt: new Date().toISOString(),
    });
  }
});

creativeBrainRouter.get('/memory', creativeBrainRateLimit, async (req, res) => {
  const payload = continuityMemoryScopeSchema.parse({
    userId: req.query.userId,
    projectId: req.query.projectId || null,
    characterId: req.query.characterId || null,
  });

  const memory = await getContinuityMemory({
    userId: payload.userId,
    projectId: payload.projectId ?? null,
    characterId: payload.characterId ?? null,
  });

  res.json({ memory });
});

creativeBrainRouter.patch('/memory', creativeBrainRateLimit, async (req, res) => {
  const payload = continuityMemoryPatchSchema.parse(req.body);
  const memory = await saveContinuityMemoryPatch({
    userId: payload.userId,
    projectId: payload.projectId ?? null,
    characterId: payload.characterId ?? null,
    state: payload.state ?? null,
    lockedFields: payload.lockedFields ?? null,
  });

  res.json({ memory });
});

creativeBrainRouter.post('/execute', sceneExecutorRateLimit, async (req, res) => {
  const payload = creativeBrainExecuteRequestSchema.parse(req.body);

  try {
    const result = await executeScenePlan({
      scenePlan: payload.scenePlan,
      userId: payload.userId,
      projectId: payload.projectId ?? null,
      characterId: payload.characterId ?? null,
      characterMetadata: payload.characterMetadata ?? null,
      referenceImages: seedanceReferenceImages(payload.referenceImages),
      quality: payload.quality,
      privacy: payload.privacy,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scene Executor failed to render the storyboard.';
    console.error('SCENE EXECUTOR ROUTE FAILED:', {
      userId: payload.userId,
      shotCount: payload.scenePlan.shotList.length,
      referenceImageCount: payload.referenceImages?.length ?? 0,
      error,
    });

    res.status(500).json({
      error: message,
      status: 'failed',
      clips: [],
      createdAt: new Date().toISOString(),
    });
  }
});
