import { query } from './db';

export type CharacterStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type CharacterVisibility = 'private' | 'approved_only' | 'public';

export type CharacterReferenceImageUrls = {
  frontFace: string;
  leftAngle: string;
  rightAngle: string;
  expressive?: string | null;
};

export type CharacterProfile = {
  id: string;
  ownerUserId: string;
  name: string;
  status: CharacterStatus;
  consentConfirmed: boolean;
  visibility: CharacterVisibility;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: CharacterReferenceImageUrls;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

const characterSelect = `
  id,
  owner_user_id as "ownerUserId",
  name,
  status,
  consent_confirmed as "consentConfirmed",
  visibility,
  style_preferences as "stylePreferences",
  reference_image_urls as "referenceImageUrls",
  source_capture_video_url as "sourceCaptureVideoUrl",
  voice_sample_url as "voiceSampleUrl",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function createCharacterProfile(input: {
  ownerUserId: string;
  name: string;
  consentConfirmed: boolean;
  visibility: CharacterVisibility;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: CharacterReferenceImageUrls;
  sourceCaptureVideoUrl: string;
  voiceSampleUrl?: string | null;
  status?: CharacterStatus;
}) {
  const result = await query<CharacterProfile>(
    `insert into character_profiles (
       owner_user_id,
       name,
       status,
       consent_confirmed,
       visibility,
       style_preferences,
       reference_image_urls,
       source_capture_video_url,
       voice_sample_url
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${characterSelect}`,
    [
      input.ownerUserId,
      input.name,
      input.status ?? 'ready',
      input.consentConfirmed,
      input.visibility,
      JSON.stringify(input.stylePreferences),
      JSON.stringify(input.referenceImageUrls),
      input.sourceCaptureVideoUrl,
      input.voiceSampleUrl ?? null,
    ],
  );

  return result.rows[0];
}

export async function listCharacterProfilesForUser(ownerUserId: string) {
  const result = await query<CharacterProfile>(
    `select ${characterSelect}
     from character_profiles
     where owner_user_id = $1
     order by updated_at desc
     limit 50`,
    [ownerUserId],
  );

  return result.rows;
}

export async function getCharacterProfileForUser(ownerUserId: string, characterId: string) {
  const result = await query<CharacterProfile>(
    `select ${characterSelect}
     from character_profiles
     where owner_user_id = $1 and id = $2
     limit 1`,
    [ownerUserId, characterId],
  );

  return result.rows[0] ?? null;
}

export async function updateCharacterProfileForUser(input: {
  ownerUserId: string;
  characterId: string;
  name?: string;
  status?: CharacterStatus;
  visibility?: CharacterVisibility;
  consentConfirmed?: boolean;
  stylePreferences?: Record<string, unknown>;
  referenceImageUrls?: CharacterReferenceImageUrls;
  sourceCaptureVideoUrl?: string | null;
  voiceSampleUrl?: string | null;
}) {
  const current = await getCharacterProfileForUser(input.ownerUserId, input.characterId);
  if (!current) return null;

  const next = {
    name: input.name ?? current.name,
    status: input.status ?? current.status,
    visibility: input.visibility ?? current.visibility,
    consentConfirmed: input.consentConfirmed ?? current.consentConfirmed,
    stylePreferences: input.stylePreferences ?? current.stylePreferences,
    referenceImageUrls: input.referenceImageUrls ?? current.referenceImageUrls,
    sourceCaptureVideoUrl:
      input.sourceCaptureVideoUrl === undefined
        ? current.sourceCaptureVideoUrl
        : input.sourceCaptureVideoUrl,
    voiceSampleUrl:
      input.voiceSampleUrl === undefined ? current.voiceSampleUrl : input.voiceSampleUrl,
  };

  const result = await query<CharacterProfile>(
    `update character_profiles
     set
       name = $3,
       status = $4,
       consent_confirmed = $5,
       visibility = $6,
       style_preferences = $7,
       reference_image_urls = $8,
       source_capture_video_url = $9,
       voice_sample_url = $10,
       updated_at = now()
     where owner_user_id = $1 and id = $2
     returning ${characterSelect}`,
    [
      input.ownerUserId,
      input.characterId,
      next.name,
      next.status,
      next.consentConfirmed,
      next.visibility,
      JSON.stringify(next.stylePreferences),
      JSON.stringify(next.referenceImageUrls),
      next.sourceCaptureVideoUrl,
      next.voiceSampleUrl,
    ],
  );

  return result.rows[0] ?? null;
}
