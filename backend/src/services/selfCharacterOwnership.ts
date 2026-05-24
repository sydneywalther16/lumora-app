import { query } from './db';

type OwnershipRow = {
  sourceId: string | null;
  sourceTable: string;
  characterId: string | null;
  ownerUserId: string | null;
  displayName: string | null;
};

export type SelfCharacterWritableTarget = {
  table: 'self_characters' | 'character_profiles';
  characterId: string;
  sourceId: string | null;
  writableFields: string[];
};

export type SelfCharacterOwnershipResolution = {
  authUserId: string;
  sourceTable: string | null;
  sourceId: string | null;
  ownerVerified: boolean;
  profileRowPresent: boolean;
  selfCharactersRowPresent: boolean;
  characterProfilesSelfRowPresent: boolean;
  legacyCreatorSelfPresent: boolean;
  writableTargetFound: boolean;
  mismatchDetected: boolean;
  writableTarget: SelfCharacterWritableTarget | null;
  recommendedNextAction: string;
};

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes('42p01') || lower.includes('42703');
}

export function redactOwnerId(value: string | null | undefined) {
  const text = textValue(value);
  if (!text) return null;
  return `${text.slice(0, 8)}...`;
}

function writableFields() {
  return [
    'verification_video_url',
    'verification_video_asset_id',
    'verification_audio_present',
    'verification_consent_at',
    'verification_status',
    'verification_prompt',
    'verification_last_tested_at',
    'video_reference_route_status',
    'video_reference_provider',
    'updated_at',
  ];
}

async function maybeSelfCharacterRow(authUserId: string) {
  try {
    const result = await query<OwnershipRow>(
      `select
         user_id::text as "ownerUserId",
         id as "sourceId",
         id as "characterId",
         name as "displayName",
         'self_characters' as "sourceTable"
       from self_characters
       where user_id = $1
       limit 1`,
      [authUserId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (optionalSchemaError(error)) return null;
    throw error;
  }
}

async function maybeCharacterProfileSelfRow(authUserId: string) {
  try {
    const result = await query<OwnershipRow>(
      `select
         owner_user_id::text as "ownerUserId",
         id::text as "sourceId",
         coalesce(nullif(character_id, ''), id::text) as "characterId",
         coalesce(nullif(display_name, ''), name) as "displayName",
         'character_profiles' as "sourceTable"
       from character_profiles cp
       where owner_user_id = $1
         and (
           coalesce((to_jsonb(cp)->>'is_self')::boolean, false) = true
           or character_id = 'creator-self'
         )
       order by updated_at desc
       limit 1`,
      [authUserId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (optionalSchemaError(error)) return null;
    throw error;
  }
}

async function maybeProfileRow(authUserId: string) {
  try {
    const result = await query<OwnershipRow>(
      `select
         coalesce(user_id::text, id::text) as "ownerUserId",
         id::text as "sourceId",
         coalesce(nullif(default_self_character_id, ''), 'creator-self') as "characterId",
         coalesce(nullif(display_name, ''), nullif(username, ''), 'Creator Self') as "displayName",
         'profiles' as "sourceTable"
       from profiles
       where user_id = $1 or id = $1
       order by updated_at desc
       limit 1`,
      [authUserId],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (optionalSchemaError(error)) {
      try {
        const fallback = await query<OwnershipRow>(
          `select
             id::text as "ownerUserId",
             id::text as "sourceId",
             coalesce(nullif(default_self_character_id, ''), 'creator-self') as "characterId",
             coalesce(nullif(display_name, ''), nullif(username, ''), 'Creator Self') as "displayName",
             'profiles' as "sourceTable"
           from profiles
           where id = $1
           order by updated_at desc
           limit 1`,
          [authUserId],
        );
        return fallback.rows[0] ?? null;
      } catch (fallbackError) {
        if (optionalSchemaError(fallbackError)) return null;
        throw fallbackError;
      }
    }
    throw error;
  }
}

async function ensureSelfCharacterRow(authUserId: string, profileRow: OwnershipRow | null) {
  try {
    const result = await query<OwnershipRow>(
      `insert into self_characters (
         user_id,
         id,
         name,
         status,
         consent_confirmed,
         visibility,
         style_preferences,
         reference_image_urls,
         reference_photo_names,
         updated_at
       )
       values ($1, 'creator-self', $2, 'ready', true, 'private', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())
       on conflict (user_id) do update
       set updated_at = self_characters.updated_at
       returning
         user_id::text as "ownerUserId",
         id as "sourceId",
         id as "characterId",
         name as "displayName",
         'self_characters' as "sourceTable"`,
      [authUserId, textValue(profileRow?.displayName) || 'Creator Self'],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (optionalSchemaError(error)) return null;
    throw error;
  }
}

function resolutionFor(input: {
  authUserId: string;
  selfRow: OwnershipRow | null;
  characterProfileRow: OwnershipRow | null;
  profileRow: OwnershipRow | null;
  createdSelfRow?: OwnershipRow | null;
}): SelfCharacterOwnershipResolution {
  const row = input.createdSelfRow ?? input.selfRow ?? input.characterProfileRow ?? input.profileRow;
  const targetRow = input.createdSelfRow ?? input.selfRow ?? input.characterProfileRow;
  const sourceTable = row?.sourceTable ?? null;
  const sourceId = row?.sourceId ?? null;
  const ownerVerified = Boolean(row?.ownerUserId === input.authUserId);
  const writableTarget = targetRow && ownerVerified
    ? {
        table: targetRow.sourceTable === 'character_profiles' ? 'character_profiles' as const : 'self_characters' as const,
        characterId: textValue(targetRow.characterId) || 'creator-self',
        sourceId: targetRow.sourceId,
        writableFields: writableFields(),
      }
    : null;

  return {
    authUserId: input.authUserId,
    sourceTable,
    sourceId,
    ownerVerified,
    profileRowPresent: Boolean(input.profileRow),
    selfCharactersRowPresent: Boolean(input.createdSelfRow ?? input.selfRow),
    characterProfilesSelfRowPresent: Boolean(input.characterProfileRow),
    legacyCreatorSelfPresent: Boolean(input.characterProfileRow && input.characterProfileRow.characterId === 'creator-self'),
    writableTargetFound: Boolean(writableTarget),
    mismatchDetected: Boolean(row && !ownerVerified),
    writableTarget,
    recommendedNextAction: writableTarget
      ? 'Save self verification video.'
      : row
        ? 'Repair self character ownership.'
        : 'Create your Lumora self character before saving verification video.',
  };
}

export async function resolveSelfCharacterForAuthenticatedUser(
  authUserId: string,
  options: { createIfMissing?: boolean } = {},
): Promise<SelfCharacterOwnershipResolution> {
  const [selfRow, characterProfileRow, profileRow] = await Promise.all([
    maybeSelfCharacterRow(authUserId),
    maybeCharacterProfileSelfRow(authUserId),
    maybeProfileRow(authUserId),
  ]);

  const needsWritableRow = !selfRow && !characterProfileRow && options.createIfMissing;
  const createdSelfRow = needsWritableRow ? await ensureSelfCharacterRow(authUserId, profileRow) : null;

  return resolutionFor({
    authUserId,
    selfRow,
    characterProfileRow,
    profileRow,
    createdSelfRow,
  });
}

export async function repairSelfCharacterOwnershipForAuthenticatedUser(authUserId: string) {
  return resolveSelfCharacterForAuthenticatedUser(authUserId, { createIfMissing: true });
}

export function publicSelfCharacterOwnershipDiagnostic(resolution: SelfCharacterOwnershipResolution) {
  return {
    authUserPresent: Boolean(resolution.authUserId),
    authUserIdRedacted: redactOwnerId(resolution.authUserId),
    profileRowPresent: resolution.profileRowPresent,
    selfCharactersRowPresent: resolution.selfCharactersRowPresent,
    characterProfilesSelfRowPresent: resolution.characterProfilesSelfRowPresent,
    legacyCreatorSelfPresent: resolution.legacyCreatorSelfPresent,
    writableVerificationTargetFound: resolution.writableTargetFound,
    mismatchDetected: resolution.mismatchDetected,
    ownerVerified: resolution.ownerVerified,
    selfCharacterSource: resolution.sourceTable,
    sourceIdRedacted: redactOwnerId(resolution.sourceId),
    writableTarget: resolution.writableTarget
      ? {
          table: resolution.writableTarget.table,
          characterIdRedacted: redactOwnerId(resolution.writableTarget.characterId),
          sourceIdRedacted: redactOwnerId(resolution.writableTarget.sourceId),
          writableFields: resolution.writableTarget.writableFields,
        }
      : null,
    recommendedNextAction: resolution.recommendedNextAction,
  };
}

export function ownershipMismatchResponse(resolution: SelfCharacterOwnershipResolution) {
  return {
    error: 'verification_owner_mismatch',
    message: 'This self character is not linked to the current signed-in user.',
    authUserPresent: Boolean(resolution.authUserId),
    selfCharacterSource: resolution.sourceTable,
    writableTargetFound: resolution.writableTargetFound,
    mismatchDetected: resolution.mismatchDetected,
    recommendedNextAction: 'Repair self character ownership.',
  };
}
