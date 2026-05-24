import { query } from './db';

export const SELF_VERIFICATION_PROMPT =
  'Look forward at the camera, say 3 pairs of two-digit numbers, turn your head slightly right, turn your head slightly left, return to center, keep a neutral expression, stay fully clothed, use clear lighting, and do not use filters.';

export const SEEDANCE_VIDEO_REFERENCE_PROMPT =
  'The verified self character from [Video1] walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion.';

export type SelfVerificationVideoPatch = {
  verificationVideoUrl: string | null;
  verificationVideoAssetId: string | null;
  verificationAudioPresent: boolean;
  verificationConsentAt: string | null;
  verificationStatus: string | null;
  verificationPrompt: string | null;
  verificationLastTestedAt: string | null;
  videoReferenceRouteStatus: string | null;
  videoReferenceProvider: string | null;
};

export type SelfVerificationVideoDiagnostics = {
  schemaReady: boolean;
  oldSelfCapturePresent: boolean;
  selfVerificationVideoPresent: boolean;
  selfVerificationConsentPresent: boolean;
  verificationAudioPresent: boolean;
  verificationStatus: string | null;
  verificationPrompt: string | null;
  verificationLastTestedAt: string | null;
  seedanceVideoReferenceCanaryStatus: string | null;
  seedanceVideoReferenceLastFailureCategory: string | null;
  seedanceVideoReferenceProviderStatus: string | null;
  videoReferenceProvider: string | null;
  verificationVideoUrlRedacted: string | null;
  migratedFromOldSelfCapture: boolean;
  recommendedNextAction: string;
};

export type SelfVerificationVideoReferenceAsset = {
  schemaReady: boolean;
  selfVerificationVideoPresent: boolean;
  selfVerificationConsentPresent: boolean;
  verificationVideoUrl: string | null;
  verificationVideoAssetId: string | null;
  verificationAudioPresent: boolean;
  verificationStatus: string | null;
  verificationPrompt: string | null;
  videoReferenceRouteStatus: string | null;
  videoReferenceProvider: string | null;
};

export const SELF_VERIFICATION_VIDEO_MAX_SIZE_BYTES = 100 * 1024 * 1024;
const allowedVerificationVideoExtensions = ['.mp4', '.webm', '.mov'];

type VerificationRow = {
  verificationVideoUrl: string | null;
  verificationVideoAssetId: string | null;
  verificationAudioPresent: boolean | null;
  verificationConsentAt: string | null;
  verificationStatus: string | null;
  verificationPrompt: string | null;
  verificationLastTestedAt: string | null;
  videoReferenceRouteStatus: string | null;
  videoReferenceProvider: string | null;
  oldSelfCaptureVideoUrl?: string | null;
  oldSelfCaptureConsent?: boolean | null;
  oldSelfCaptureCompleted?: boolean | null;
  oldSelfCaptureCapturedAt?: string | null;
};

function optionalVerificationSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('42703') ||
    lower.includes('42p01') ||
    lower.includes('verification_video') ||
    lower.includes('video_reference_route_status')
  );
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function redactVerificationVideoUrl(value: string | null | undefined) {
  return textValue(value) ? '[private-verification-video-present]' : null;
}

export function validateSelfVerificationVideoConsent(input: { consentConfirmed?: boolean | null }) {
  if (!input.consentConfirmed) {
    throw Object.assign(new Error('Consent is required before saving a self verification video.'), {
      statusCode: 400,
      code: 'verification_consent_required',
    });
  }
}

function hasAllowedVideoExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  return allowedVerificationVideoExtensions.some((extension) => lower.endsWith(extension));
}

export function validateSelfVerificationVideoUpload(input: {
  consentConfirmed?: boolean | null;
  contentType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
}) {
  validateSelfVerificationVideoConsent({ consentConfirmed: input.consentConfirmed });

  const contentType = textValue(input.contentType).toLowerCase();
  const fileName = textValue(input.fileName).toLowerCase();
  const sizeBytes = typeof input.sizeBytes === 'number' ? input.sizeBytes : null;

  if (sizeBytes !== null && sizeBytes > SELF_VERIFICATION_VIDEO_MAX_SIZE_BYTES) {
    throw Object.assign(new Error('Self verification video is too large. Upload a video under 100 MB.'), {
      statusCode: 413,
      code: 'verification_video_too_large',
    });
  }

  if (contentType.startsWith('image/') || contentType.startsWith('audio/')) {
    throw Object.assign(new Error('Upload a video file for self verification, not an image or audio-only file.'), {
      statusCode: 400,
      code: 'verification_video_invalid_type',
    });
  }

  const contentTypeLooksVideo = contentType.startsWith('video/');
  const fileNameLooksVideo = hasAllowedVideoExtension(fileName);
  const genericUploadType = !contentType || contentType === 'application/octet-stream';
  if (!contentTypeLooksVideo && !(genericUploadType && fileNameLooksVideo)) {
    throw Object.assign(new Error('Use an mp4, webm, or mov video for self verification.'), {
      statusCode: 400,
      code: 'verification_video_invalid_type',
    });
  }
}

export function buildSelfVerificationVideoPatch(input: {
  sourceVideoUrl: string;
  sourceUploadAssetId?: string | null;
  verificationAudioPresent?: boolean | null;
  now?: string;
}): SelfVerificationVideoPatch {
  const sourceVideoUrl = textValue(input.sourceVideoUrl);
  if (!sourceVideoUrl) {
    throw Object.assign(new Error('A self verification video URL is required.'), {
      statusCode: 400,
      code: 'verification_video_required',
    });
  }

  return {
    verificationVideoUrl: sourceVideoUrl,
    verificationVideoAssetId: textValue(input.sourceUploadAssetId) || null,
    verificationAudioPresent: Boolean(input.verificationAudioPresent),
    verificationConsentAt: input.now ?? new Date().toISOString(),
    verificationStatus: 'uploaded',
    verificationPrompt: SELF_VERIFICATION_PROMPT,
    verificationLastTestedAt: null,
    videoReferenceRouteStatus: 'not_tested',
    videoReferenceProvider: 'seedance',
  };
}

export function buildClearedSelfVerificationVideoPatch(): SelfVerificationVideoPatch {
  return {
    verificationVideoUrl: null,
    verificationVideoAssetId: null,
    verificationAudioPresent: false,
    verificationConsentAt: null,
    verificationStatus: 'missing',
    verificationPrompt: null,
    verificationLastTestedAt: null,
    videoReferenceRouteStatus: null,
    videoReferenceProvider: null,
  };
}

function diagnosticsFromRow(row: VerificationRow | null, schemaReady = true): SelfVerificationVideoDiagnostics {
  const newVideoPresent = Boolean(textValue(row?.verificationVideoUrl) || textValue(row?.verificationVideoAssetId));
  const oldSelfCapturePresent = Boolean(
    textValue(row?.oldSelfCaptureVideoUrl) &&
    (row?.oldSelfCaptureConsent === true || row?.oldSelfCaptureCompleted === true),
  );
  const videoPresent = newVideoPresent || oldSelfCapturePresent;
  const consentPresent = Boolean(row?.verificationConsentAt || oldSelfCapturePresent);
  const rawRouteStatus = textValue(row?.videoReferenceRouteStatus) || (oldSelfCapturePresent ? 'not_tested' : null);
  const routeStatus = rawRouteStatus === 'transient_unavailable' ? 'retry_later' : rawRouteStatus;
  const routeFailureCategory = rawRouteStatus === 'transient_unavailable'
    ? 'video_reference_provider_unavailable'
    : routeStatus &&
      !['not_tested', 'canary_succeeded', 'succeeded', 'configured_ready_for_canary', 'retry_later'].includes(routeStatus)
      ? routeStatus
      : null;
  const migratedFromOldSelfCapture = oldSelfCapturePresent && !newVideoPresent;
  const recommendedNextAction = !schemaReady
    ? 'Apply the self verification video migration.'
    : migratedFromOldSelfCapture
      ? 'Migrate old self capture into verification video.'
    : !videoPresent
      ? 'Record self verification video.'
      : !consentPresent
        ? 'Confirm self verification consent.'
        : routeStatus === 'canary_succeeded'
          ? 'Use Seedance video reference route for exact self character tests.'
          : routeStatus === 'retry_later'
            ? 'Retry Seedance video reference canary later.'
          : routeStatus === 'blocked'
            ? 'Continue using soft self guidance or test another exact likeness provider.'
            : routeStatus === 'configured_not_implemented'
              ? 'Run Seedance video reference canary now that the provider video-reference field is mapped.'
              : 'Run Seedance video reference canary.';

  return {
    schemaReady,
    oldSelfCapturePresent,
    selfVerificationVideoPresent: videoPresent,
    selfVerificationConsentPresent: consentPresent,
    verificationAudioPresent: Boolean(row?.verificationAudioPresent),
    verificationStatus: textValue(row?.verificationStatus) || (oldSelfCapturePresent ? 'uploaded' : null),
    verificationPrompt: textValue(row?.verificationPrompt) || (oldSelfCapturePresent ? SELF_VERIFICATION_PROMPT : null),
    verificationLastTestedAt: row?.verificationLastTestedAt ?? null,
    seedanceVideoReferenceCanaryStatus: routeStatus,
    seedanceVideoReferenceLastFailureCategory: routeFailureCategory,
    seedanceVideoReferenceProviderStatus: textValue(row?.videoReferenceProvider) === 'seedance' && routeStatus
      ? routeStatus
      : null,
    videoReferenceProvider: textValue(row?.videoReferenceProvider) || null,
    verificationVideoUrlRedacted: redactVerificationVideoUrl(row?.verificationVideoUrl || row?.oldSelfCaptureVideoUrl),
    migratedFromOldSelfCapture,
    recommendedNextAction,
  };
}

function rowHasVerificationSignal(row: VerificationRow | null | undefined) {
  return Boolean(
    textValue(row?.verificationVideoUrl) ||
    textValue(row?.verificationVideoAssetId) ||
    textValue(row?.videoReferenceRouteStatus) ||
    textValue(row?.oldSelfCaptureVideoUrl),
  );
}

async function firstSelfVerificationRow(input: {
  userId?: string | null;
  characterId?: string | null;
}) {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (input.userId) {
    params.push(input.userId);
    filters.push(`owner_user_id = $${params.length}`);
  }
  if (input.characterId) {
    params.push(input.characterId);
    filters.push(`(id::text = $${params.length} or character_id = $${params.length})`);
  } else {
    filters.push(`coalesce(is_self, false) = true or character_id = 'creator-self'`);
  }

  const characterResult = await query<VerificationRow>(
    `select
       verification_video_url as "verificationVideoUrl",
       verification_video_asset_id as "verificationVideoAssetId",
       verification_audio_present as "verificationAudioPresent",
       verification_consent_at as "verificationConsentAt",
       verification_status as "verificationStatus",
       verification_prompt as "verificationPrompt",
       verification_last_tested_at as "verificationLastTestedAt",
       video_reference_route_status as "videoReferenceRouteStatus",
       video_reference_provider as "videoReferenceProvider",
       source_capture_video_url as "oldSelfCaptureVideoUrl",
       consent_confirmed as "oldSelfCaptureConsent",
       false as "oldSelfCaptureCompleted",
       updated_at as "oldSelfCaptureCapturedAt"
     from character_profiles
     where ${filters.map((filter) => `(${filter})`).join(' and ')}
     order by is_self desc, updated_at desc
     limit 1`,
    params,
  );
  const characterRow = characterResult.rows[0] ?? null;
  if (characterRow?.verificationVideoUrl || characterRow?.verificationVideoAssetId || characterRow?.videoReferenceRouteStatus) {
    return characterRow;
  }

  const selfParams: unknown[] = [];
  const selfFilters: string[] = [];
  if (input.userId) {
    selfParams.push(input.userId);
    selfFilters.push(`user_id = $${selfParams.length}`);
  }
  const selfResult = await query<VerificationRow>(
    `select
       verification_video_url as "verificationVideoUrl",
       verification_video_asset_id as "verificationVideoAssetId",
       verification_audio_present as "verificationAudioPresent",
       verification_consent_at as "verificationConsentAt",
       verification_status as "verificationStatus",
       verification_prompt as "verificationPrompt",
       verification_last_tested_at as "verificationLastTestedAt",
       video_reference_route_status as "videoReferenceRouteStatus",
       video_reference_provider as "videoReferenceProvider",
       source_capture_video_url as "oldSelfCaptureVideoUrl",
       self_capture_consent as "oldSelfCaptureConsent",
       self_capture_completed as "oldSelfCaptureCompleted",
       self_capture_captured_at as "oldSelfCaptureCapturedAt"
     from self_characters
     ${selfFilters.length ? `where ${selfFilters.join(' and ')}` : ''}
     order by updated_at desc
     limit 1`,
    selfParams,
  );
  const selfRow = selfResult.rows[0] ?? null;
  return rowHasVerificationSignal(selfRow) ? selfRow : characterRow;
}

export async function getSelfVerificationVideoDiagnostics(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}): Promise<SelfVerificationVideoDiagnostics> {
  try {
    return diagnosticsFromRow(await firstSelfVerificationRow(input));
  } catch (error) {
    if (optionalVerificationSchemaError(error)) return diagnosticsFromRow(null, false);
    throw error;
  }
}

export async function getSelfVerificationVideoReferenceAsset(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}): Promise<SelfVerificationVideoReferenceAsset> {
  try {
    const row = await firstSelfVerificationRow(input);
    const diagnostics = diagnosticsFromRow(row);
    return {
      schemaReady: diagnostics.schemaReady,
      selfVerificationVideoPresent: diagnostics.selfVerificationVideoPresent,
      selfVerificationConsentPresent: diagnostics.selfVerificationConsentPresent,
      verificationVideoUrl: textValue(row?.verificationVideoUrl) || textValue(row?.oldSelfCaptureVideoUrl) || null,
      verificationVideoAssetId: textValue(row?.verificationVideoAssetId) || null,
      verificationAudioPresent: diagnostics.verificationAudioPresent,
      verificationStatus: diagnostics.verificationStatus,
      verificationPrompt: diagnostics.verificationPrompt,
      videoReferenceRouteStatus: diagnostics.seedanceVideoReferenceCanaryStatus,
      videoReferenceProvider: diagnostics.videoReferenceProvider,
    };
  } catch (error) {
    if (optionalVerificationSchemaError(error)) {
      return {
        schemaReady: false,
        selfVerificationVideoPresent: false,
        selfVerificationConsentPresent: false,
        verificationVideoUrl: null,
        verificationVideoAssetId: null,
        verificationAudioPresent: false,
        verificationStatus: null,
        verificationPrompt: null,
        videoReferenceRouteStatus: null,
        videoReferenceProvider: null,
      };
    }
    throw error;
  }
}

export async function updateSelfCharacterVerificationVideoForUser(input: {
  ownerUserId: string;
  characterId?: string | null;
  patch: SelfVerificationVideoPatch;
}) {
  const characterId = input.characterId ?? 'creator-self';
  const result = await query<VerificationRow>(
    `update character_profiles
     set
       verification_video_url = $3,
       verification_video_asset_id = $4,
       verification_audio_present = $5,
       verification_consent_at = $6,
       verification_status = $7,
       verification_prompt = $8,
       verification_last_tested_at = $9,
       video_reference_route_status = $10,
       video_reference_provider = $11,
       updated_at = now()
     where owner_user_id = $1 and (id::text = $2 or character_id = $2 or coalesce(is_self, false) = true)
     returning
       verification_video_url as "verificationVideoUrl",
       verification_video_asset_id as "verificationVideoAssetId",
       verification_audio_present as "verificationAudioPresent",
       verification_consent_at as "verificationConsentAt",
       verification_status as "verificationStatus",
       verification_prompt as "verificationPrompt",
       verification_last_tested_at as "verificationLastTestedAt",
       video_reference_route_status as "videoReferenceRouteStatus",
       video_reference_provider as "videoReferenceProvider"`,
    [
      input.ownerUserId,
      characterId,
      input.patch.verificationVideoUrl,
      input.patch.verificationVideoAssetId,
      input.patch.verificationAudioPresent,
      input.patch.verificationConsentAt,
      input.patch.verificationStatus,
      input.patch.verificationPrompt,
      input.patch.verificationLastTestedAt,
      input.patch.videoReferenceRouteStatus,
      input.patch.videoReferenceProvider,
    ],
  );

  try {
    await query(
      `update self_characters
       set
         verification_video_url = $2,
         verification_video_asset_id = $3,
         verification_audio_present = $4,
         verification_consent_at = $5,
         verification_status = $6,
         verification_prompt = $7,
         verification_last_tested_at = $8,
         video_reference_route_status = $9,
         video_reference_provider = $10,
         updated_at = now()
       where user_id = $1`,
      [
        input.ownerUserId,
        input.patch.verificationVideoUrl,
        input.patch.verificationVideoAssetId,
        input.patch.verificationAudioPresent,
        input.patch.verificationConsentAt,
        input.patch.verificationStatus,
        input.patch.verificationPrompt,
        input.patch.verificationLastTestedAt,
        input.patch.videoReferenceRouteStatus,
        input.patch.videoReferenceProvider,
      ],
    );
  } catch (error) {
    if (!optionalVerificationSchemaError(error)) throw error;
  }

  return diagnosticsFromRow(result.rows[0] ?? {
    verificationVideoUrl: input.patch.verificationVideoUrl,
    verificationVideoAssetId: input.patch.verificationVideoAssetId,
    verificationAudioPresent: input.patch.verificationAudioPresent,
    verificationConsentAt: input.patch.verificationConsentAt,
    verificationStatus: input.patch.verificationStatus,
    verificationPrompt: input.patch.verificationPrompt,
    verificationLastTestedAt: input.patch.verificationLastTestedAt,
    videoReferenceRouteStatus: input.patch.videoReferenceRouteStatus,
    videoReferenceProvider: input.patch.videoReferenceProvider,
  });
}

export async function clearSelfCharacterVerificationVideoForUser(input: {
  ownerUserId: string;
  characterId?: string | null;
}) {
  const diagnostics = await updateSelfCharacterVerificationVideoForUser({
    ownerUserId: input.ownerUserId,
    characterId: input.characterId,
    patch: buildClearedSelfVerificationVideoPatch(),
  });

  const characterId = input.characterId ?? 'creator-self';
  try {
    await query(
      `update character_profiles
       set source_capture_video_url = null,
           updated_at = now()
       where owner_user_id = $1 and (id::text = $2 or character_id = $2 or coalesce(is_self, false) = true)`,
      [input.ownerUserId, characterId],
    );
  } catch (error) {
    if (!optionalVerificationSchemaError(error)) throw error;
  }

  try {
    await query(
      `update self_characters
       set source_capture_video_url = null,
           source_capture_video_name = null,
           self_capture_consent = false,
           self_capture_completed = false,
           self_capture_captured_at = null,
           updated_at = now()
       where user_id = $1`,
      [input.ownerUserId],
    );
  } catch (error) {
    if (!optionalVerificationSchemaError(error)) throw error;
  }

  return {
    ...diagnostics,
    oldSelfCapturePresent: false,
    selfVerificationVideoPresent: false,
    selfVerificationConsentPresent: false,
    migratedFromOldSelfCapture: false,
    recommendedNextAction: 'Record self verification video.',
  };
}

export async function markSeedanceVideoReferenceCanaryUnmapped(input: {
  userId?: string | null;
  characterId?: string | null;
}) {
  const now = new Date().toISOString();
  if (input.userId) {
    const patch: SelfVerificationVideoPatch = {
      verificationVideoUrl: null,
      verificationVideoAssetId: null,
      verificationAudioPresent: false,
      verificationConsentAt: null,
      verificationStatus: 'uploaded',
      verificationPrompt: SELF_VERIFICATION_PROMPT,
      verificationLastTestedAt: now,
      videoReferenceRouteStatus: 'configured_not_implemented',
      videoReferenceProvider: 'seedance',
    };
    const existing = await firstSelfVerificationRow(input);
    await updateSelfCharacterVerificationVideoForUser({
      ownerUserId: input.userId,
      characterId: input.characterId,
      patch: {
        ...patch,
        verificationVideoUrl: existing?.verificationVideoUrl ?? existing?.oldSelfCaptureVideoUrl ?? null,
        verificationVideoAssetId: existing?.verificationVideoAssetId ?? null,
        verificationAudioPresent: Boolean(existing?.verificationAudioPresent),
        verificationConsentAt: existing?.verificationConsentAt ?? existing?.oldSelfCaptureCapturedAt ?? null,
        verificationStatus: existing?.verificationStatus ?? 'uploaded',
        verificationPrompt: existing?.verificationPrompt ?? SELF_VERIFICATION_PROMPT,
      },
    });
  }
  return now;
}

export async function markSeedanceVideoReferenceCanaryResult(input: {
  userId?: string | null;
  characterId?: string | null;
  routeStatus: string;
  provider?: string | null;
}) {
  const now = new Date().toISOString();
  if (input.userId) {
    const existing = await firstSelfVerificationRow(input);
    await updateSelfCharacterVerificationVideoForUser({
      ownerUserId: input.userId,
      characterId: input.characterId,
      patch: {
        verificationVideoUrl: existing?.verificationVideoUrl ?? existing?.oldSelfCaptureVideoUrl ?? null,
        verificationVideoAssetId: existing?.verificationVideoAssetId ?? null,
        verificationAudioPresent: Boolean(existing?.verificationAudioPresent),
        verificationConsentAt: existing?.verificationConsentAt ?? existing?.oldSelfCaptureCapturedAt ?? null,
        verificationStatus: existing?.verificationStatus ?? 'uploaded',
        verificationPrompt: existing?.verificationPrompt ?? SELF_VERIFICATION_PROMPT,
        verificationLastTestedAt: now,
        videoReferenceRouteStatus: input.routeStatus,
        videoReferenceProvider: input.provider ?? 'seedance',
      },
    });
  }
  return now;
}
