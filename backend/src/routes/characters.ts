import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import {
  createCharacterProfile,
  deleteCharacterProfileForUser,
  getCharacterProfileForUser,
  listCharacterProfilesForUser,
  updateCharacterProfileForUser,
  updateSelfCharacterProviderIdentityForUser,
  type CharacterReferenceImageUrls,
  type CharacterRelationshipMemory,
} from '../services/characterService';
import { cleanupObsoleteCharacterReferencesForUser } from '../services/referenceCleanup';
import { persistMediaUpload } from '../services/storageService';
import {
  createOpenAISoraCharacterIdentity,
  getOpenAISoraProviderReadiness,
  OpenAISoraProviderError,
  validateSoraCharacterConsent,
} from '../services/providers/openaiSoraProvider';

const visibilitySchema = z.enum(['private', 'approved_only', 'public']);
const statusSchema = z.enum(['draft', 'processing', 'ready', 'failed']);

const mediaUploadSchema = z.object({
  url: z.string().url().optional(),
  dataUrl: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
}).refine((value) => value.url || value.dataUrl, {
  message: 'Media uploads require either a url or dataUrl.',
});

const createCharacterSchema = z.object({
  name: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120).optional().nullable(),
  consentConfirmed: z.boolean().optional(),
  consent_confirmed: z.boolean().optional(),
  visibility: visibilitySchema.default('private'),
  stylePreferences: z.record(z.string(), z.unknown()).default({}),
  appearanceSummary: z.string().optional().nullable(),
  wardrobeTendencies: z.string().optional().nullable(),
  emotionalTendencies: z.string().optional().nullable(),
  soundtrackTendencies: z.string().optional().nullable(),
  cinematicStyle: z.string().optional().nullable(),
  relationshipMemory: z.record(z.string(), z.unknown()).optional().default({}),
  referenceImages: z.object({
    frontFace: mediaUploadSchema,
    leftAngle: mediaUploadSchema,
    rightAngle: mediaUploadSchema,
    expressive: mediaUploadSchema.optional(),
  }),
  sourceCaptureVideo: mediaUploadSchema,
  voiceSample: mediaUploadSchema.optional(),
});

const patchCharacterSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  displayName: z.string().min(1).max(120).optional(),
  status: statusSchema.optional(),
  consentConfirmed: z.boolean().optional(),
  consent_confirmed: z.boolean().optional(),
  visibility: visibilitySchema.optional(),
  stylePreferences: z.record(z.string(), z.unknown()).optional(),
  appearanceSummary: z.string().optional(),
  wardrobeTendencies: z.string().optional(),
  emotionalTendencies: z.string().optional(),
  soundtrackTendencies: z.string().optional(),
  cinematicStyle: z.string().optional(),
  relationshipMemory: z.record(z.string(), z.unknown()).optional(),
  referenceImages: z.object({
    frontFace: mediaUploadSchema.optional(),
    leftAngle: mediaUploadSchema.optional(),
    rightAngle: mediaUploadSchema.optional(),
    expressive: mediaUploadSchema.optional().nullable(),
  }).optional(),
  sourceCaptureVideo: mediaUploadSchema.optional().nullable(),
  voiceSample: mediaUploadSchema.optional().nullable(),
});
const soraSelfCharacterSchema = z.object({
  userId: z.string().min(1).optional().nullable(),
  characterId: z.string().min(1).optional().nullable(),
  consentConfirmed: z.boolean().optional(),
  consent_confirmed: z.boolean().optional(),
  sourceUploadAssetId: z.string().min(1).optional().nullable(),
  sourceVideoUrl: z.string().url().optional().nullable(),
  identityVideo: mediaUploadSchema.optional().nullable(),
});

export const charactersRouter = Router();
charactersRouter.use(requireAuth);

function stringRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function relationshipMemoryValue(value: Record<string, unknown> | undefined) {
  return (value ?? {}) as Record<string, CharacterRelationshipMemory>;
}

function creatorSafeCharacter<T extends { providerCharacterId?: string | null }>(character: T) {
  return {
    ...character,
    providerCharacterId: null,
    providerCharacterIdPresent: Boolean(character.providerCharacterId),
  };
}

charactersRouter.get('/', async (req: AuthedRequest, res) => {
  const characters = await listCharacterProfilesForUser(req.userId!);
  res.json({ characters: characters.map(creatorSafeCharacter) });
});

charactersRouter.post('/self/sora-character', async (req: AuthedRequest, res) => {
  const payload = soraSelfCharacterSchema.parse(req.body ?? {});
  const consentConfirmed = payload.consentConfirmed ?? payload.consent_confirmed ?? false;

  try {
    validateSoraCharacterConsent({ consentConfirmed });
  } catch (error) {
    if (error instanceof OpenAISoraProviderError) {
      res.status(error.statusCode).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }

  const ownerUserId = payload.userId ?? req.userId!;
  const characterId = payload.characterId ?? 'creator-self';
  const character = await getCharacterProfileForUser(ownerUserId, characterId);
  if (!character && characterId !== 'creator-self') {
    res.status(404).json({
      error: 'self_character_not_found',
      message: 'Create your Lumora self character before creating a verified provider identity.',
    });
    return;
  }

  let sourceVideoUrl = payload.sourceVideoUrl ?? null;
  let sourceUploadAssetId = payload.sourceUploadAssetId ?? null;
  if (payload.identityVideo) {
    sourceVideoUrl = await persistMediaUpload({
      userId: ownerUserId,
      media: payload.identityVideo,
      folder: `characters/${character?.id ?? characterId}/provider-identity`,
      fallbackFileName: 'sora-self-identity-video',
    });
    sourceUploadAssetId = sourceUploadAssetId ?? sourceVideoUrl;
  }

  if (!sourceVideoUrl && !sourceUploadAssetId) {
    res.status(400).json({
      error: 'identity_video_required',
      message: 'Upload a short self video before creating a verified self character.',
    });
    return;
  }

  const readiness = getOpenAISoraProviderReadiness();
  let setupResult;
  try {
    setupResult = await createOpenAISoraCharacterIdentity({
      consentConfirmed,
      sourceUploadAssetId,
      sourceVideoUrl,
      sourceVideoFilename: 'self-character-video.mp4',
      characterName: character?.displayName ?? character?.name ?? 'Lumora self character',
    });
  } catch (error) {
    if (error instanceof OpenAISoraProviderError) {
      res.status(error.statusCode).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
  const patch = setupResult.patch;

  const updated = await updateCharacterProfileForUser({
    ownerUserId,
    characterId,
    ...patch,
  });
  await updateSelfCharacterProviderIdentityForUser({
    ownerUserId,
    patch,
  });

  res.status(setupResult.statusCode).json({
    ok: setupResult.ok,
    status: patch.providerCharacterStatus,
    provider: 'openai_sora',
    providerCharacterIdPresent: setupResult.providerCharacterIdPresent,
    providerCharacterIdRedacted: setupResult.providerCharacterIdRedacted,
    providerCharacterStatus: patch.providerCharacterStatus,
    likenessProviderStatus: patch.likenessProviderStatus,
    failureCategory: setupResult.failureCategory,
    readiness,
    message: setupResult.message,
    character: updated ? creatorSafeCharacter(updated) : null,
  });
});

charactersRouter.get('/:id', async (req: AuthedRequest, res) => {
  const characterId = stringRouteParam(req.params.id);
  if (!characterId) {
    res.status(400).json({ error: 'Character id is required.' });
    return;
  }

  const character = await getCharacterProfileForUser(req.userId!, characterId);
  if (!character) {
    res.status(404).json({ error: 'Character profile not found.' });
    return;
  }

  res.json({ character: creatorSafeCharacter(character) });
});

charactersRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const characterId = stringRouteParam(req.params.id);
  if (!characterId) {
    res.status(400).json({ error: 'Character id is required.' });
    return;
  }

  try {
    const result = await deleteCharacterProfileForUser({
      ownerUserId: req.userId!,
      characterId,
    });

    if (!result) {
      res.status(404).json({ error: 'Character profile not found.' });
      return;
    }

    res.json({
      deleted: true,
      characterId: result.character.characterId,
      preservedGenerationReferences: result.preservedGenerationReferences,
      cleanup: {
        characterProfiles: result.deletedCharacterProfiles,
        continuityMemory: result.deletedContinuityMemory,
        moderationMemory: result.deletedModerationMemory,
      },
    });
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Unable to delete character profile.',
    });
  }
});

charactersRouter.post('/:id/references/cleanup-obsolete', async (req: AuthedRequest, res) => {
  const characterId = stringRouteParam(req.params.id);
  if (!characterId) {
    res.status(400).json({ error: 'Character id is required.' });
    return;
  }

  const result = await cleanupObsoleteCharacterReferencesForUser({
    ownerUserId: req.userId!,
    characterId,
  });

  if (!result) {
    res.status(404).json({ error: 'Character profile not found.' });
    return;
  }

  res.json({
    removedCount: result.removedCount,
    remainingReferences: result.remainingReferences,
    character: creatorSafeCharacter(result.character),
  });
});

charactersRouter.post('/', async (req: AuthedRequest, res) => {
  const payload = createCharacterSchema.parse(req.body);
  const consentConfirmed = payload.consentConfirmed ?? payload.consent_confirmed ?? false;

  if (!consentConfirmed) {
    res.status(400).json({
      error: 'Consent confirmation is required before creating a character profile.',
    });
    return;
  }

  const folder = `characters/${Date.now()}`;
  const referenceImageUrls: CharacterReferenceImageUrls = {
    frontFace: await persistMediaUpload({
      userId: req.userId!,
      media: payload.referenceImages.frontFace,
      folder,
      fallbackFileName: 'front-face',
    }),
    leftAngle: await persistMediaUpload({
      userId: req.userId!,
      media: payload.referenceImages.leftAngle,
      folder,
      fallbackFileName: 'left-angle',
    }),
    rightAngle: await persistMediaUpload({
      userId: req.userId!,
      media: payload.referenceImages.rightAngle,
      folder,
      fallbackFileName: 'right-angle',
    }),
  };

  if (payload.referenceImages.expressive) {
    referenceImageUrls.expressive = await persistMediaUpload({
      userId: req.userId!,
      media: payload.referenceImages.expressive,
      folder,
      fallbackFileName: 'expressive',
    });
  }

  const sourceCaptureVideoUrl = await persistMediaUpload({
    userId: req.userId!,
    media: payload.sourceCaptureVideo,
    folder,
    fallbackFileName: 'capture-video',
  });

  const voiceSampleUrl = payload.voiceSample
    ? await persistMediaUpload({
        userId: req.userId!,
        media: payload.voiceSample,
        folder,
        fallbackFileName: 'voice-sample',
      })
    : null;

  const character = await createCharacterProfile({
    ownerUserId: req.userId!,
    name: payload.name,
    displayName: payload.displayName ?? payload.name,
    consentConfirmed,
    visibility: payload.visibility,
    stylePreferences: {
      ...payload.stylePreferences,
      appearanceSummary: payload.appearanceSummary ?? payload.stylePreferences.appearanceSummary ?? '',
      wardrobeTendencies: payload.wardrobeTendencies ?? payload.stylePreferences.wardrobeTendencies ?? '',
      emotionalTendencies: payload.emotionalTendencies ?? payload.stylePreferences.emotionalTendencies ?? '',
      soundtrackTendencies: payload.soundtrackTendencies ?? payload.stylePreferences.soundtrackTendencies ?? '',
      cinematicStyle: payload.cinematicStyle ?? payload.stylePreferences.cinematicStyle ?? '',
    },
    referenceImageUrls,
    sourceCaptureVideoUrl,
    voiceSampleUrl,
    status: 'ready',
    appearanceSummary: payload.appearanceSummary,
    wardrobeTendencies: payload.wardrobeTendencies,
    emotionalTendencies: payload.emotionalTendencies,
    soundtrackTendencies: payload.soundtrackTendencies,
    cinematicStyle: payload.cinematicStyle,
    relationshipMemory: relationshipMemoryValue(payload.relationshipMemory),
  });

  res.status(201).json({ character: creatorSafeCharacter(character) });
});

charactersRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const payload = patchCharacterSchema.parse(req.body);
  const consentConfirmed = payload.consentConfirmed ?? payload.consent_confirmed;
  const characterId = stringRouteParam(req.params.id);

  if (!characterId) {
    res.status(400).json({ error: 'Character id is required.' });
    return;
  }

  if (consentConfirmed === false) {
    res.status(400).json({
      error: 'Character profiles cannot be saved without consent confirmation.',
    });
    return;
  }

  const current = await getCharacterProfileForUser(req.userId!, characterId);
  if (!current) {
    res.status(404).json({ error: 'Character profile not found.' });
    return;
  }

  const folder = `characters/${current.id}`;
  const referenceImageUrls = payload.referenceImages
    ? { ...current.referenceImageUrls }
    : undefined;

  if (payload.referenceImages && referenceImageUrls) {
    for (const key of ['frontFace', 'leftAngle', 'rightAngle'] as const) {
      const media = payload.referenceImages[key];
      if (media) {
        referenceImageUrls[key] = await persistMediaUpload({
          userId: req.userId!,
          media,
          folder,
          fallbackFileName: key,
        });
      }
    }

    if (payload.referenceImages.expressive === null) {
      referenceImageUrls.expressive = null;
    } else if (payload.referenceImages.expressive) {
      referenceImageUrls.expressive = await persistMediaUpload({
        userId: req.userId!,
        media: payload.referenceImages.expressive,
        folder,
        fallbackFileName: 'expressive',
      });
    }
  }

  const sourceCaptureVideoUrl =
    payload.sourceCaptureVideo === undefined
      ? undefined
      : payload.sourceCaptureVideo === null
        ? null
        : await persistMediaUpload({
            userId: req.userId!,
            media: payload.sourceCaptureVideo,
            folder,
            fallbackFileName: 'capture-video',
          });

  const voiceSampleUrl =
    payload.voiceSample === undefined
      ? undefined
      : payload.voiceSample === null
        ? null
        : await persistMediaUpload({
            userId: req.userId!,
            media: payload.voiceSample,
            folder,
            fallbackFileName: 'voice-sample',
          });

  const character = await updateCharacterProfileForUser({
    ownerUserId: req.userId!,
    characterId,
    name: payload.name,
    displayName: payload.displayName,
    status: payload.status,
    visibility: payload.visibility,
    consentConfirmed,
    stylePreferences: payload.stylePreferences,
    referenceImageUrls,
    sourceCaptureVideoUrl,
    voiceSampleUrl,
    appearanceSummary: payload.appearanceSummary,
    wardrobeTendencies: payload.wardrobeTendencies,
    emotionalTendencies: payload.emotionalTendencies,
    soundtrackTendencies: payload.soundtrackTendencies,
    cinematicStyle: payload.cinematicStyle,
    relationshipMemory: payload.relationshipMemory
      ? relationshipMemoryValue(payload.relationshipMemory)
      : undefined,
  });

  res.json({ character: creatorSafeCharacter(character) });
});
