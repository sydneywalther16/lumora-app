import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import {
  createCharacterProfile,
  getCharacterProfileForUser,
  listCharacterProfilesForUser,
  updateCharacterProfileForUser,
  type CharacterReferenceImageUrls,
} from '../services/characterService';
import { persistMediaUpload } from '../services/storageService';

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
  consentConfirmed: z.boolean().optional(),
  consent_confirmed: z.boolean().optional(),
  visibility: visibilitySchema.default('private'),
  stylePreferences: z.record(z.string(), z.unknown()).default({}),
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
  status: statusSchema.optional(),
  consentConfirmed: z.boolean().optional(),
  consent_confirmed: z.boolean().optional(),
  visibility: visibilitySchema.optional(),
  stylePreferences: z.record(z.string(), z.unknown()).optional(),
  referenceImages: z.object({
    frontFace: mediaUploadSchema.optional(),
    leftAngle: mediaUploadSchema.optional(),
    rightAngle: mediaUploadSchema.optional(),
    expressive: mediaUploadSchema.optional().nullable(),
  }).optional(),
  sourceCaptureVideo: mediaUploadSchema.optional().nullable(),
  voiceSample: mediaUploadSchema.optional().nullable(),
});

export const charactersRouter = Router();
charactersRouter.use(requireAuth);

charactersRouter.get('/', async (req: AuthedRequest, res) => {
  const characters = await listCharacterProfilesForUser(req.userId!);
  res.json({ characters });
});

charactersRouter.get('/:id', async (req: AuthedRequest, res) => {
  const character = await getCharacterProfileForUser(req.userId!, req.params.id);
  if (!character) {
    res.status(404).json({ error: 'Character profile not found.' });
    return;
  }

  res.json({ character });
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
    consentConfirmed,
    visibility: payload.visibility,
    stylePreferences: payload.stylePreferences,
    referenceImageUrls,
    sourceCaptureVideoUrl,
    voiceSampleUrl,
    status: 'ready',
  });

  res.status(201).json({ character });
});

charactersRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const payload = patchCharacterSchema.parse(req.body);
  const consentConfirmed = payload.consentConfirmed ?? payload.consent_confirmed;

  if (consentConfirmed === false) {
    res.status(400).json({
      error: 'Character profiles cannot be saved without consent confirmation.',
    });
    return;
  }

  const current = await getCharacterProfileForUser(req.userId!, req.params.id);
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
    characterId: req.params.id,
    name: payload.name,
    status: payload.status,
    visibility: payload.visibility,
    consentConfirmed,
    stylePreferences: payload.stylePreferences,
    referenceImageUrls,
    sourceCaptureVideoUrl,
    voiceSampleUrl,
  });

  res.json({ character });
});
