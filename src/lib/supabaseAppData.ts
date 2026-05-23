import type {
  CharacterAppearanceDrift,
  CharacterMemorySnapshot,
  CharacterProfile,
  CharacterRelationshipMemory,
  ContinuityMemoryState,
  CreatorSelfStylePreferences,
  LumoraIdentityFeedback,
  LumoraIdentityProfile,
  LumoraPost,
  PrivacySetting,
  ReferenceImageUrls,
  VideoEngine,
} from './api';
import {
  getBestPoster,
  getBestThumbnail,
  repairMissingThumbnailIfNeeded,
  resolveGeneratedVideoMedia,
} from './mediaThumbnail';
import type { LumoraProfile } from './profileStorage';
import type { StudioProject } from './projectStorage';
import { supabase } from './supabase';

export type LumoraDraft = {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
};

export type ProfileStats = {
  totalLikesReceived: number;
  followersCount: number;
  characterCount: number;
  followsTableAvailable: boolean;
};

export type LumoraStorageBucket =
  | 'avatars'
  | 'character-reference-images'
  | 'self-capture-videos'
  | 'voice-samples'
  | 'lumora-assets'
  | 'generated-videos'
  | 'post-thumbnails';

type DbRow = Record<string, any>;
type ReferencePhotoSlot = 'frontFace' | 'leftAngle' | 'rightAngle' | 'fullBody';

const CREATOR_SELF_CHARACTER_ID = 'creator-self';
const publicBuckets: LumoraStorageBucket[] = [
  'avatars',
  'character-reference-images',
  'lumora-assets',
  'generated-videos',
  'post-thumbnails',
];
const referenceSlotFilePrefixes: Record<ReferencePhotoSlot, string> = {
  frontFace: 'front',
  leftAngle: 'left',
  rightAngle: 'right',
  fullBody: 'full-body',
};

function getClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  return supabase;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function storageUrl(value: unknown, label: string): string | null {
  const url = nullableString(value);
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    throw new Error(`${label} must be uploaded to Supabase Storage before saving.`);
  }
  return url;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!isObject(error)) return false;

  const code = error.code;
  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
  return code === '42703' || message.includes(columnName);
}

function missingColumnName<T extends string>(error: unknown, columns: readonly T[]): T | null {
  return columns.find((column) => isMissingColumnError(error, column)) ?? null;
}

function serializeSupabaseError(error: unknown): Record<string, unknown> {
  if (!error) return {};

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (!isObject(error)) {
    return { message: String(error) };
  }

  return Object.fromEntries(
    Object.entries(error).map(([key, value]) => [
      key,
      isObject(value) || Array.isArray(value) ? JSON.stringify(value) : value,
    ]),
  );
}

function supabaseErrorSummary(error: unknown): string {
  const serialized = serializeSupabaseError(error);
  return [
    serialized.code,
    serialized.message,
    serialized.details,
    serialized.hint,
  ]
    .filter(Boolean)
    .join(' | ') || 'Unknown Supabase error';
}

function rlsHintForProjectSave(error: unknown): string | null {
  const summary = supabaseErrorSummary(error).toLowerCase();
  if (summary.includes('row-level security') || summary.includes('violates row-level security')) {
    return 'RLS rejected the project write. Verify the browser has a current Supabase session and projects_insert_own/projects_update_own policies use auth.uid() = user_id.';
  }

  if (summary.includes('jwt') || summary.includes('permission denied') || summary.includes('not authenticated')) {
    return 'Auth/session propagation may be stale. Refresh the Supabase session before saving account projects.';
  }

  return null;
}

async function getProjectSaveAuthDiagnostics(userId: string) {
  const client = getClient();
  const diagnostics: Record<string, unknown> = {
    requestedUserId: userId,
    supabaseConfigured: Boolean(supabase),
  };

  try {
    const { data, error } = await client.auth.getSession();
    const session = data.session;
    diagnostics.sessionUserId = session?.user?.id ?? null;
    diagnostics.hasAccessToken = Boolean(session?.access_token);
    diagnostics.sessionExpiresAt = session?.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null;
    diagnostics.sessionMatchesRequestedUser = session?.user?.id === userId;
    if (error) diagnostics.getSessionError = serializeSupabaseError(error);
  } catch (error) {
    diagnostics.getSessionException = serializeSupabaseError(error);
  }

  try {
    const { data, error } = await client.auth.getUser();
    diagnostics.authUserId = data.user?.id ?? null;
    diagnostics.authUserMatchesRequestedUser = data.user?.id === userId;
    if (error) diagnostics.getUserError = serializeSupabaseError(error);
  } catch (error) {
    diagnostics.getUserException = serializeSupabaseError(error);
  }

  return diagnostics;
}

async function probeProjectsTableForSave(userId: string) {
  const client = getClient();
  const { count, error } = await client
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return {
    ok: !error,
    ownProjectCount: count ?? null,
    error: error ? serializeSupabaseError(error) : null,
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function stripBase64Media(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith('data:') || value.startsWith('blob:') ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map(stripBase64Media);
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripBase64Media(entry)]),
    );
  }

  return value;
}

function cleanJsonRecord(value: unknown): Record<string, unknown> {
  return jsonRecord(stripBase64Media(value));
}

function memorySnapshots(value: unknown): CharacterMemorySnapshot[] {
  return Array.isArray(value)
    ? value.filter((item): item is CharacterMemorySnapshot => isObject(item))
    : [];
}

function relationshipMemory(value: unknown): Record<string, CharacterRelationshipMemory> {
  return jsonRecord(value) as Record<string, CharacterRelationshipMemory>;
}

function appearanceDrift(value: unknown): CharacterAppearanceDrift[] {
  return Array.isArray(value)
    ? value.filter((item): item is CharacterAppearanceDrift => isObject(item))
    : [];
}

function continuityState(value: unknown): Partial<ContinuityMemoryState> {
  return jsonRecord(value) as Partial<ContinuityMemoryState>;
}

function toIso(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date().toISOString();
}

function safeFileName(fileName: string) {
  return fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'upload';
}

function publicUrlForObjectPath(bucket: LumoraStorageBucket, objectPath: string): string {
  return getClient().storage.from(bucket).getPublicUrl(objectPath).data.publicUrl.split('?')[0];
}

async function validateUploadedReferencePhoto(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
    });
    const contentType = response.headers.get('content-type') ?? '';
    const ok = response.status === 200 && contentType.toLowerCase().startsWith('image/');

    console.log('VALIDATION RESULT', {
      url,
      status: response.status,
      contentType,
      ok,
    });

    if (!ok) {
      throw new Error(`Reference photo public URL failed validation (${response.status || 'no status'}).`);
    }
  } catch (error) {
    console.log('VALIDATION RESULT', {
      url,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    });
    throw new Error('Reference photo uploaded but is not publicly accessible. Apply the character-reference-images public bucket migration and re-save the photo.');
  }
}

function publicOrSignedUrl(bucket: LumoraStorageBucket, objectPath: string): Promise<string> | string {
  const client = getClient();

  if (publicBuckets.includes(bucket)) {
    return publicUrlForObjectPath(bucket, objectPath);
  }

  return client.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7)
    .then(({ data, error }) => {
      if (error) throw error;
      return data.signedUrl;
    });
}

export async function uploadLumoraMedia(input: {
  userId: string;
  bucket: LumoraStorageBucket;
  file: File;
  folder: string;
  usage: string;
  entityType?: string;
  entityId?: string;
}) {
  const client = getClient();
  const fileName = safeFileName(input.file.name);
  const objectPath = `${input.userId}/${input.folder}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await client.storage
    .from(input.bucket)
    .upload(objectPath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const url = await publicOrSignedUrl(input.bucket, objectPath);

  const { error: assetError } = await client.from('media_assets').upsert(
    {
      user_id: input.userId,
      bucket: input.bucket,
      object_path: objectPath,
      public_url: publicBuckets.includes(input.bucket) ? url : null,
      signed_url: publicBuckets.includes(input.bucket) ? null : url,
      file_name: input.file.name,
      content_type: input.file.type || null,
      size_bytes: input.file.size,
      usage: input.usage,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'bucket,object_path' },
  );

  if (assetError) throw assetError;

  return {
    url,
    objectPath,
    fileName: input.file.name,
  };
}

export async function uploadCharacterReferencePhoto(input: {
  userId: string;
  file: File;
  slot: ReferencePhotoSlot;
  usage?: string;
  entityType?: string;
  entityId?: string;
}) {
  const client = getClient();
  const bucket: LumoraStorageBucket = 'character-reference-images';
  const objectPath = `${input.userId}/${referenceSlotFilePrefixes[input.slot]}-${Date.now()}.png`;
  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(objectPath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const url = publicUrlForObjectPath(bucket, objectPath);
  try {
    await validateUploadedReferencePhoto(url);
  } catch (firstError) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 800));
    try {
      await validateUploadedReferencePhoto(url);
    } catch (secondError) {
      console.warn('Reference photo public validation failed after upload; saving durable storage URL anyway.', {
        objectPath,
        url,
        firstError,
        secondError,
      });
    }
  }

  const { error: assetError } = await client.from('media_assets').upsert(
    {
      user_id: input.userId,
      bucket,
      object_path: objectPath,
      public_url: url,
      signed_url: null,
      file_name: input.file.name,
      content_type: input.file.type || null,
      size_bytes: input.file.size,
      usage: input.usage ?? `self-${input.slot}-reference`,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'bucket,object_path' },
  );

  if (assetError) throw assetError;

  if (input.slot === 'frontFace') {
    console.log('UPLOADED FRONT FACE URL', {
      authUserId: input.userId,
      objectPath,
      url,
    });
  }

  return {
    url,
    objectPath,
    fileName: input.file.name,
  };
}

export async function loadSupabaseProfile(userId: string): Promise<LumoraProfile> {
  const client = getClient();
  let result = await client
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (
    result.error &&
    (isMissingColumnError(result.error, 'user_id') ||
      (isObject(result.error) && result.error.code === '42P10'))
  ) {
    result = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
  }

  if (!result.data && !result.error) {
    const legacyResult = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (legacyResult.data || legacyResult.error) {
      result = legacyResult;
    }
  }

  if (result.error) throw result.error;

  console.log('LOADED SUPABASE PROFILE', {
    authUserId: userId,
    loadedProfileId: result.data ? stringValue(result.data.id) : null,
    loadedProfileUserId: result.data ? nullableString(result.data.user_id) : null,
    avatarUrlExists: Boolean(result.data?.avatar_url),
  });

  if (!result.data) {
    return {
      id: userId,
      userId,
      displayName: 'Creator',
      username: `creator-${userId.slice(0, 8)}`,
      bio: '',
    };
  }

  return mapProfileRow(result.data);
}

export async function hasSupabaseProfile(userId: string): Promise<boolean> {
  const client = getClient();
  let result = await client
    .from('profiles')
    .select('id,user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (
    result.error &&
    (isMissingColumnError(result.error, 'user_id') ||
      (isObject(result.error) && result.error.code === '42P10'))
  ) {
    result = await client
      .from('profiles')
      .select('id,user_id')
      .eq('id', userId)
      .maybeSingle();
  }

  if (!result.data && !result.error) {
    const legacyResult = await client
      .from('profiles')
      .select('id,user_id')
      .eq('id', userId)
      .maybeSingle();

    if (legacyResult.data || legacyResult.error) {
      result = legacyResult;
    }
  }

  if (result.error) throw result.error;
  return Boolean(result.data);
}

export async function saveSupabaseProfile(userId: string, profile: LumoraProfile): Promise<LumoraProfile> {
  const client = getClient();
  const requestedUsername = profile.username.trim();
  const username =
    requestedUsername && requestedUsername !== 'lumora.creator'
      ? requestedUsername
      : `creator-${userId.slice(0, 8)}`;
  const displayName = profile.displayName.trim() || 'Creator';
  const profileAvatarUrl = storageUrl(profile.avatar, 'Profile avatar');
  const manualReferenceImageUrl = storageUrl(
    profile.manualReferenceImageUrl || profile.selfReferenceImageUrls?.manualReferenceImageUrl,
    'Manual reference image URL',
  );
  const selfReferenceImageUrls = cleanJsonRecord({
    ...(profile.selfReferenceImageUrls ?? {}),
    manualReferenceImageUrl,
  });
  const payload = {
    id: userId,
    user_id: userId,
    handle: username,
    username,
    display_name: displayName,
    bio: profile.bio ?? '',
    avatar_url: profileAvatarUrl,
    default_self_character_id: profile.defaultSelfCharacterId ?? null,
    default_self_character_name: profile.defaultSelfCharacterName ?? null,
    default_self_character_avatar: storageUrl(profile.defaultSelfCharacterAvatar, 'Default self character avatar'),
    self_reference_image_urls: selfReferenceImageUrls,
    self_reference_photo_names: cleanJsonRecord(profile.selfReferencePhotoNames),
    self_capture_video_name: profile.selfCaptureVideoName ?? null,
    self_capture_video_url: storageUrl(profile.selfCaptureVideoUrl, 'Self capture video'),
    self_capture_numbers: profile.selfCaptureNumbers ?? null,
    self_capture_completed: Boolean(profile.selfCaptureCompleted),
    self_capture_consent: Boolean(profile.selfCaptureConsent),
    self_capture_captured_at: profile.selfCaptureCapturedAt ?? null,
    self_voice_sample_name: profile.selfVoiceSampleName ?? null,
    self_voice_sample_url: storageUrl(profile.selfVoiceSampleUrl, 'Self voice sample'),
    self_voice_sample_numbers: profile.selfVoiceSampleNumbers ?? null,
    self_voice_sample_captured_at: profile.selfVoiceSampleCapturedAt ?? null,
    self_voice_sample_consent: Boolean(profile.selfVoiceSampleConsent),
    creator_self_features: cleanJsonRecord(profile.creatorSelfFeatures),
    creator_self_style_preferences: cleanJsonRecord(profile.creatorSelfStylePreferences),
    self_character_editor_draft: stripBase64Media(profile.selfCharacterEditorDraft) ?? null,
    updated_at: new Date().toISOString(),
  };

  console.log('SAVING SUPABASE PROFILE', {
    authUserId: userId,
    profileUserId: userId,
    avatarUrlExists: Boolean(profileAvatarUrl),
  });

  let result = await client
    .from('profiles')
    .upsert(
      payload,
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();

  if (
    result.error &&
    (isMissingColumnError(result.error, 'user_id') ||
      (isObject(result.error) && result.error.code === '42P10'))
  ) {
    const { user_id: _userId, ...legacyPayload } = payload;
    result = await client
      .from('profiles')
      .upsert(
        legacyPayload,
        { onConflict: 'id' },
      )
      .select('*')
      .single();
  }

  if (result.error) throw result.error;

  await client
    .from('posts')
    .update({
      creator_name: displayName,
      creator_username: username,
      creator_avatar: profileAvatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return mapProfileRow(result.data);
}

function mapProfileRow(row: DbRow): LumoraProfile {
  const userId = nullableString(row.user_id) || stringValue(row.id) || null;
  const selfReferenceImageUrls = jsonRecord(row.self_reference_image_urls);

  return {
    id: nullableString(row.id),
    userId,
    avatar: stringValue(row.avatar_url) || undefined,
    displayName: stringValue(row.display_name) || 'Creator',
    username: stringValue(row.username) || stringValue(row.handle) || 'lumora.creator',
    bio: stringValue(row.bio),
    defaultSelfCharacterId: nullableString(row.default_self_character_id),
    defaultSelfCharacterName: nullableString(row.default_self_character_name),
    defaultSelfCharacterAvatar: nullableString(row.default_self_character_avatar),
    manualReferenceImageUrl: nullableString(selfReferenceImageUrls.manualReferenceImageUrl),
    selfReferenceImageUrls,
    selfReferencePhotoNames: jsonRecord(row.self_reference_photo_names),
    selfCaptureVideoName: nullableString(row.self_capture_video_name),
    selfCaptureVideoUrl: nullableString(row.self_capture_video_url),
    selfCaptureNumbers: nullableString(row.self_capture_numbers),
    selfCaptureCompleted: booleanValue(row.self_capture_completed),
    selfCaptureConsent: booleanValue(row.self_capture_consent),
    selfCaptureCapturedAt: nullableString(row.self_capture_captured_at),
    selfVoiceSampleName: nullableString(row.self_voice_sample_name),
    selfVoiceSampleUrl: nullableString(row.self_voice_sample_url),
    selfVoiceSampleNumbers: nullableString(row.self_voice_sample_numbers),
    selfVoiceSampleCapturedAt: nullableString(row.self_voice_sample_captured_at),
    selfVoiceSampleConsent: booleanValue(row.self_voice_sample_consent),
    creatorSelfFeatures: stringRecord(row.creator_self_features),
    creatorSelfStylePreferences: mapStylePreferences(row.creator_self_style_preferences),
    selfCharacterFeatures: stringRecord(row.creator_self_features),
    selfCharacterStylePreferences: mapStylePreferences(row.creator_self_style_preferences),
    selfCharacterEditorDraft: isObject(row.self_character_editor_draft)
      ? row.self_character_editor_draft
      : null,
  };
}

function mapStylePreferences(value: unknown): CreatorSelfStylePreferences {
  const record = stringRecord(value);
  return {
    everydayStyle: record.everydayStyle,
    glamStyle: record.glamStyle,
    videoWardrobe: record.videoWardrobe,
    colorsToFavor: record.colorsToFavor,
    colorsToAvoid: record.colorsToAvoid ?? record.colorsItemsToAvoid,
  };
}

function mapReferenceImages(value: unknown): ReferenceImageUrls {
  const record = stringRecord(value);
  const manualReferenceImageUrl = record.manualReferenceImageUrl ?? null;
  const frontFaceUrl = record.frontFaceUrl ?? record.frontFace ?? '';
  const leftAngleUrl = record.leftAngleUrl ?? record.leftAngle ?? '';
  const rightAngleUrl = record.rightAngleUrl ?? record.rightAngle ?? '';
  const fullBodyUrl = record.fullBodyUrl ?? record.fullBody ?? null;
  const expressiveUrl = record.expressiveUrl ?? record.expressive ?? null;

  return {
    manualReferenceImageUrl,
    frontFace: frontFaceUrl,
    frontFaceUrl,
    frontFacePath: record.frontFacePath ?? null,
    leftAngle: leftAngleUrl,
    leftAngleUrl,
    leftAnglePath: record.leftAnglePath ?? null,
    rightAngle: rightAngleUrl,
    rightAngleUrl,
    rightAnglePath: record.rightAnglePath ?? null,
    fullBody: fullBodyUrl,
    fullBodyUrl,
    fullBodyPath: record.fullBodyPath ?? null,
    expressive: expressiveUrl,
    expressiveUrl,
    expressivePath: record.expressivePath ?? null,
  };
}

function mapReferencePhotoNames(value: unknown): Partial<Record<keyof ReferenceImageUrls, string | null>> {
  const record = stringRecord(value);
  return {
    frontFace: record.frontFace ?? null,
    leftAngle: record.leftAngle ?? null,
    rightAngle: record.rightAngle ?? null,
    fullBody: record.fullBody ?? null,
    expressive: record.expressive ?? null,
  };
}

function mapIdentityProfile(value: unknown): LumoraIdentityProfile | null {
  const record = jsonRecord(value);
  if (typeof record.identityId !== 'string') return null;
  const references = jsonRecord(record.references);
  const detectedFeatures = jsonRecord(record.detectedFeatures);
  const canonicalReferenceSet = Array.isArray(record.canonicalReferenceSet)
    ? record.canonicalReferenceSet.filter((item): item is string => typeof item === 'string')
    : [];
  const identityFeedback = Array.isArray(record.identityFeedback)
    ? record.identityFeedback.filter((item): item is NonNullable<LumoraIdentityProfile['identityFeedback']>[number] => isObject(item))
    : [];

  return {
    identityId: record.identityId,
    userId: stringValue(record.userId),
    createdAt: nullableString(record.createdAt) ?? undefined,
    frontFaceUrl: nullableString(record.frontFaceUrl),
    leftAngleUrl: nullableString(record.leftAngleUrl),
    rightAngleUrl: nullableString(record.rightAngleUrl),
    fullBodyUrl: nullableString(record.fullBodyUrl),
    videoReferenceUrls: Array.isArray(record.videoReferenceUrls)
      ? record.videoReferenceUrls.filter((item): item is string => typeof item === 'string')
      : [],
    references: Object.keys(references).length
      ? {
          frontFaceUrl: nullableString(references.frontFaceUrl),
          leftAngleUrl: nullableString(references.leftAngleUrl),
          rightAngleUrl: nullableString(references.rightAngleUrl),
          fullBodyUrl: nullableString(references.fullBodyUrl),
          selfieVideoUrl: nullableString(references.selfieVideoUrl),
          selfieVideo2Url: nullableString(references.selfieVideo2Url),
        }
      : undefined,
    detectedFeatures: Object.keys(detectedFeatures).length
      ? {
          hairColor: stringValue(detectedFeatures.hairColor) || 'unspecified',
          eyeColor: stringValue(detectedFeatures.eyeColor) || 'unspecified',
          skinTone: stringValue(detectedFeatures.skinTone) || 'unspecified',
          faceShape: stringValue(detectedFeatures.faceShape) || 'unspecified',
          bodyFrame: stringValue(detectedFeatures.bodyFrame) || 'unspecified',
          estimatedAgeRange: stringValue(detectedFeatures.estimatedAgeRange) || 'unspecified',
          genderPresentation: stringValue(detectedFeatures.genderPresentation) || 'unspecified',
          styleTags: Array.isArray(detectedFeatures.styleTags)
            ? detectedFeatures.styleTags.filter((item): item is string => typeof item === 'string')
            : [],
        }
      : undefined,
    canonicalReferenceSet,
    primaryIdentityImageUrl: nullableString(record.primaryIdentityImageUrl),
    identityPrompt: stringValue(record.identityPrompt),
    generationConsistencyPrompt: stringValue(record.generationConsistencyPrompt),
    keyframeUrl: nullableString(record.keyframeUrl),
    appearanceSummary: stringValue(record.appearanceSummary),
    userPreferences: stringRecord(record.userPreferences),
    dislikedTraits: Array.isArray(record.dislikedTraits)
      ? record.dislikedTraits.filter((item): item is string => typeof item === 'string')
      : [],
    likenessNotes: Array.isArray(record.likenessNotes)
      ? record.likenessNotes.filter((item): item is string => typeof item === 'string')
      : [],
    identityFeedback,
    preferredTraits: Array.isArray(record.preferredTraits)
      ? record.preferredTraits.filter((item): item is string => typeof item === 'string')
      : [],
    identityStrength: typeof record.identityStrength === 'number' ? record.identityStrength : 0,
    successfulGenerations: typeof record.successfulGenerations === 'number' ? record.successfulGenerations : 0,
    feedbackIterations: typeof record.feedbackIterations === 'number' ? record.feedbackIterations : identityFeedback.length,
    version: typeof record.version === 'number' ? record.version : 1,
    status: record.status === 'building' || record.status === 'needs_refs' ? record.status : 'ready',
  };
}

function cleanReferenceImageUrls(value: ReferenceImageUrls): ReferenceImageUrls {
  const manualReferenceImageUrl = storageUrl(value.manualReferenceImageUrl, 'Manual reference image URL');
  const frontFace = storageUrl(value.frontFaceUrl ?? value.frontFace, 'Front reference photo') ?? '';
  const leftAngle = storageUrl(value.leftAngleUrl ?? value.leftAngle, 'Left reference photo') ?? '';
  const rightAngle = storageUrl(value.rightAngleUrl ?? value.rightAngle, 'Right reference photo') ?? '';
  const fullBody = storageUrl(value.fullBodyUrl ?? value.fullBody, 'Full body reference photo');
  const expressive = storageUrl(value.expressiveUrl ?? value.expressive, 'Expressive reference photo');

  return {
    manualReferenceImageUrl,
    frontFace,
    frontFaceUrl: frontFace,
    frontFacePath: storageUrl(value.frontFacePath, 'Front reference photo path'),
    leftAngle,
    leftAngleUrl: leftAngle,
    leftAnglePath: storageUrl(value.leftAnglePath, 'Left reference photo path'),
    rightAngle,
    rightAngleUrl: rightAngle,
    rightAnglePath: storageUrl(value.rightAnglePath, 'Right reference photo path'),
    fullBody,
    fullBodyUrl: fullBody,
    fullBodyPath: storageUrl(value.fullBodyPath, 'Full body reference photo path'),
    expressive,
    expressiveUrl: expressive,
    expressivePath: storageUrl(value.expressivePath, 'Expressive reference photo path'),
  };
}

function mapCharacterRow(row: DbRow): CharacterProfile {
  const stylePreferences = jsonRecord(row.style_preferences);

  return {
    id: stringValue(row.id),
    characterId: stringValue(row.character_id) || stringValue(row.id),
    ownerUserId: stringValue(row.owner_user_id),
    name: stringValue(row.name) || 'Untitled character',
    displayName: nullableString(row.display_name) ?? stringValue(row.name) ?? 'Untitled character',
    status: row.status ?? 'ready',
    consentConfirmed: booleanValue(row.consent_confirmed),
    visibility: (row.visibility ?? 'private') as PrivacySetting,
    stylePreferences,
    referenceImageUrls: mapReferenceImages(row.reference_image_urls),
    referencePhotoNames: mapReferencePhotoNames(row.reference_photo_names),
    sourceCaptureVideoUrl: nullableString(row.source_capture_video_url),
    sourceCaptureVideoPath: nullableString(jsonRecord(row.style_preferences).selfieVideoPath),
    sourceCaptureVideo2Url: nullableString(jsonRecord(row.style_preferences).selfieVideo2Url),
    sourceCaptureVideo2Path: nullableString(jsonRecord(row.style_preferences).selfieVideo2Path),
    sourceCaptureVideo2Name: nullableString(jsonRecord(row.style_preferences).selfieVideo2Name),
    voiceSampleUrl: nullableString(row.voice_sample_url),
    voiceSampleName: nullableString(row.voice_sample_name),
    voiceSampleNumbers: nullableString(row.voice_sample_numbers),
    identityProfile: mapIdentityProfile(stylePreferences.identityProfile),
    appearanceSummary: nullableString(row.appearance_summary) ?? stringValue(stylePreferences.appearanceSummary),
    wardrobeTendencies: nullableString(row.wardrobe_tendencies) ?? stringValue(stylePreferences.wardrobeTendencies ?? stylePreferences.fashionStyle),
    emotionalTendencies: nullableString(row.emotional_tendencies) ?? stringValue(stylePreferences.emotionalTendencies ?? stylePreferences.characterVibe),
    soundtrackTendencies: nullableString(row.soundtrack_tendencies) ?? stringValue(stylePreferences.soundtrackTendencies),
    cinematicStyle: nullableString(row.cinematic_style) ?? stringValue(stylePreferences.cinematicStyle),
    continuityState: continuityState(row.continuity_state),
    memorySnapshots: memorySnapshots(row.memory_snapshots),
    relationshipMemory: relationshipMemory(row.relationship_memory),
    appearanceDrift: appearanceDrift(row.appearance_drift),
    providerIdentityProvider: nullableString(row.provider_identity_provider),
    providerCharacterId: null,
    providerCharacterIdPresent: Boolean(nullableString(row.provider_character_id)),
    providerCharacterStatus: nullableString(row.provider_character_status),
    providerCharacterCreatedAt: nullableString(row.provider_character_created_at),
    providerCharacterLastVerifiedAt: nullableString(row.provider_character_last_verified_at),
    likenessProviderStatus: nullableString(row.likeness_provider_status),
    likenessConsentAt: nullableString(row.likeness_consent_at),
    providerCharacterSourceAssetId: nullableString(row.provider_character_source_asset_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    isSelf: booleanValue(row.is_self),
    isCreatorSelf: booleanValue(row.is_creator_self),
  };
}

function mapCharacterProfileRow(row: DbRow): CharacterProfile {
  const mapped = mapCharacterRow(row);
  const isSelfProfile =
    booleanValue(row.is_self) ||
    stringValue(row.character_id) === CREATOR_SELF_CHARACTER_ID ||
    mapped.characterId === CREATOR_SELF_CHARACTER_ID;

  return isSelfProfile
    ? {
        ...mapped,
        id: CREATOR_SELF_CHARACTER_ID,
        characterId: CREATOR_SELF_CHARACTER_ID,
        isSelf: true,
        isCreatorSelf: true,
      }
    : mapped;
}

function characterProfileMergeKey(character: CharacterProfile) {
  if (character.id === CREATOR_SELF_CHARACTER_ID || character.characterId === CREATOR_SELF_CHARACTER_ID || character.isCreatorSelf) {
    return CREATOR_SELF_CHARACTER_ID;
  }

  return character.characterId || character.id;
}

function mapSelfCharacterRow(row: DbRow): CharacterProfile {
  const identityProfile = mapIdentityProfile(row.identity_profile ?? jsonRecord(row.style_preferences).identityProfile);
  const stylePreferences: Record<string, unknown> = {
    ...jsonRecord(row.style_preferences),
    creatorSelfFeatures: jsonRecord(row.creator_self_features),
    creatorSelfStylePreferences: jsonRecord(row.creator_self_style_preferences),
    creatorSelfEditorDraft: jsonRecord(row.editor_draft),
    selfCaptureNumbers: nullableString(row.self_capture_numbers),
    selfCaptureConsent: booleanValue(row.self_capture_consent),
    selfCaptureCompleted: booleanValue(row.self_capture_completed),
    selfVoiceSampleConsent: booleanValue(row.voice_sample_consent),
  };

  return {
    id: CREATOR_SELF_CHARACTER_ID,
    characterId: CREATOR_SELF_CHARACTER_ID,
    ownerUserId: stringValue(row.user_id),
    name: stringValue(row.name) || 'Creator Self',
    displayName: stringValue(row.name) || 'Creator Self',
    status: row.status ?? 'ready',
    consentConfirmed: booleanValue(row.consent_confirmed),
    visibility: (row.visibility ?? 'private') as PrivacySetting,
    stylePreferences,
    referenceImageUrls: mapReferenceImages(row.reference_image_urls),
    referencePhotoNames: mapReferencePhotoNames(row.reference_photo_names),
    sourceCaptureVideoUrl: nullableString(row.source_capture_video_url),
    sourceCaptureVideoPath: nullableString(stylePreferences.selfieVideoPath),
    sourceCaptureVideo2Url: nullableString(stylePreferences.selfieVideo2Url),
    sourceCaptureVideo2Path: nullableString(stylePreferences.selfieVideo2Path),
    sourceCaptureVideo2Name: nullableString(stylePreferences.selfieVideo2Name),
    voiceSampleUrl: nullableString(row.voice_sample_url),
    voiceSampleName: nullableString(row.voice_sample_name),
    voiceSampleNumbers: nullableString(row.voice_sample_numbers),
    identityProfile,
    creatorSelfFeatures: stringRecord(row.creator_self_features),
    creatorSelfStylePreferences: mapStylePreferences(row.creator_self_style_preferences),
    appearanceSummary: identityProfile?.appearanceSummary ?? stringValue(stylePreferences.appearanceSummary),
    wardrobeTendencies: stringValue(stylePreferences.videoWardrobe ?? stylePreferences.wardrobeTendencies),
    emotionalTendencies: stringValue(stylePreferences.characterVibe ?? stylePreferences.emotionalTendencies),
    soundtrackTendencies: stringValue(stylePreferences.soundtrackTendencies),
    cinematicStyle: stringValue(stylePreferences.cinematicStyle),
    continuityState: continuityState(stylePreferences.continuityState),
    memorySnapshots: memorySnapshots(stylePreferences.memorySnapshots),
    relationshipMemory: relationshipMemory(stylePreferences.relationshipMemory),
    appearanceDrift: appearanceDrift(stylePreferences.appearanceDrift),
    providerIdentityProvider: nullableString(row.provider_identity_provider),
    providerCharacterId: null,
    providerCharacterIdPresent: Boolean(nullableString(row.provider_character_id)),
    providerCharacterStatus: nullableString(row.provider_character_status),
    providerCharacterCreatedAt: nullableString(row.provider_character_created_at),
    providerCharacterLastVerifiedAt: nullableString(row.provider_character_last_verified_at),
    likenessProviderStatus: nullableString(row.likeness_provider_status),
    likenessConsentAt: nullableString(row.likeness_consent_at),
    providerCharacterSourceAssetId: nullableString(row.provider_character_source_asset_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    isSelf: true,
    isCreatorSelf: true,
  };
}

export async function loadSupabaseCharacters(userId: string): Promise<CharacterProfile[]> {
  const client = getClient();
  const [charactersResult, selfResult, profileResult] = await Promise.all([
    client
      .from('characters')
      .select('*')
      .eq('owner_user_id', userId)
      .order('updated_at', { ascending: false }),
    client
      .from('self_characters')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
    client
      .from('character_profiles')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  if (charactersResult.error) throw charactersResult.error;
  if (selfResult.error) throw selfResult.error;
  if (profileResult.error) {
    console.warn('Unable to load character_profiles; falling back to legacy character tables.', profileResult.error);
  }

  console.log('LOADED SUPABASE SELF CHARACTER', {
    authUserId: userId,
    loaded: Boolean(selfResult.data),
    selfCharacterUserId: selfResult.data ? stringValue(selfResult.data.user_id) : null,
  });
  console.log('LOADED SELF CHARACTER REFERENCES', {
    authUserId: userId,
    references: selfResult.data ? jsonRecord(selfResult.data.reference_image_urls) : null,
  });

  const fictionalCharacters = (charactersResult.data ?? []).map(mapCharacterRow);
  const profileCharacters = profileResult.error ? [] : (profileResult.data ?? []).map(mapCharacterProfileRow);
  const profileSelf = profileCharacters.find((character) => characterProfileMergeKey(character) === CREATOR_SELF_CHARACTER_ID) ?? null;
  const selfCharacter = selfResult.data ? [mapSelfCharacterRow(selfResult.data)] : profileSelf ? [profileSelf] : [];
  const mergedOtherCharacters = new Map<string, CharacterProfile>();

  for (const character of [...profileCharacters, ...fictionalCharacters]) {
    const key = characterProfileMergeKey(character);
    if (key === CREATOR_SELF_CHARACTER_ID || mergedOtherCharacters.has(key)) continue;
    mergedOtherCharacters.set(key, character);
  }

  return [
    ...selfCharacter,
    ...Array.from(mergedOtherCharacters.values()).sort((a, b) => (
      new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime()
    )),
  ];
}

export async function saveSupabaseCharacter(input: {
  userId: string;
  name: string;
  displayName?: string | null;
  consentConfirmed: boolean;
  visibility: PrivacySetting;
  stylePreferences: Record<string, unknown>;
  appearanceSummary?: string | null;
  wardrobeTendencies?: string | null;
  emotionalTendencies?: string | null;
  soundtrackTendencies?: string | null;
  cinematicStyle?: string | null;
  relationshipMemory?: Record<string, CharacterRelationshipMemory>;
  referenceImageUrls: ReferenceImageUrls;
  referencePhotoNames?: Record<string, string | null>;
  sourceCaptureVideoUrl: string | null;
  sourceCaptureVideoName?: string | null;
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
}): Promise<CharacterProfile> {
  const client = getClient();
  const { data, error } = await client
    .from('characters')
    .insert({
      owner_user_id: input.userId,
      name: input.name,
      display_name: input.displayName ?? input.name,
      status: 'ready',
      consent_confirmed: input.consentConfirmed,
      visibility: input.visibility,
      style_preferences: cleanJsonRecord({
        ...input.stylePreferences,
        appearanceSummary: input.appearanceSummary ?? input.stylePreferences.appearanceSummary,
        wardrobeTendencies: input.wardrobeTendencies ?? input.stylePreferences.wardrobeTendencies,
        emotionalTendencies: input.emotionalTendencies ?? input.stylePreferences.emotionalTendencies,
        soundtrackTendencies: input.soundtrackTendencies ?? input.stylePreferences.soundtrackTendencies,
        cinematicStyle: input.cinematicStyle ?? input.stylePreferences.cinematicStyle,
        relationshipMemory: input.relationshipMemory ?? input.stylePreferences.relationshipMemory,
      }),
      reference_image_urls: cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls)),
      reference_photo_names: cleanJsonRecord(input.referencePhotoNames),
      source_capture_video_url: storageUrl(input.sourceCaptureVideoUrl, 'Character capture video'),
      source_capture_video_name: input.sourceCaptureVideoName ?? null,
      voice_sample_url: storageUrl(input.voiceSampleUrl, 'Character voice sample'),
      voice_sample_name: input.voiceSampleName ?? null,
      voice_sample_numbers: input.voiceSampleNumbers ?? null,
      appearance_summary: input.appearanceSummary ?? '',
      wardrobe_tendencies: input.wardrobeTendencies ?? '',
      emotional_tendencies: input.emotionalTendencies ?? '',
      soundtrack_tendencies: input.soundtrackTendencies ?? '',
      cinematic_style: input.cinematicStyle ?? '',
      continuity_state: cleanJsonRecord({
        characterAppearance: input.appearanceSummary ?? '',
        wardrobe: input.wardrobeTendencies ?? '',
        emotionalTone: input.emotionalTendencies ?? '',
        soundtrackMood: input.soundtrackTendencies ?? '',
        cameraStyle: input.cinematicStyle ?? '',
      }),
      relationship_memory: cleanJsonRecord(input.relationshipMemory),
      is_self: false,
      is_creator_self: false,
    })
    .select('*')
    .single();

  if (error) throw error;
  return mapCharacterRow(data);
}

export async function updateSupabaseCharacterProfile(input: {
  userId: string;
  characterId: string;
  name?: string;
  displayName?: string | null;
  referenceImageUrls?: ReferenceImageUrls;
  stylePreferences?: Record<string, unknown>;
  appearanceSummary?: string | null;
  wardrobeTendencies?: string | null;
  emotionalTendencies?: string | null;
  soundtrackTendencies?: string | null;
  cinematicStyle?: string | null;
  relationshipMemory?: Record<string, CharacterRelationshipMemory>;
}): Promise<CharacterProfile> {
  const client = getClient();
  const existingResult = await client
    .from('characters')
    .select('*')
    .eq('owner_user_id', input.userId)
    .eq('id', input.characterId)
    .maybeSingle();

  if (existingResult.error) throw existingResult.error;
  if (!existingResult.data) {
    const profileResult = await client
      .from('character_profiles')
      .select('*')
      .eq('owner_user_id', input.userId)
      .eq('id', input.characterId)
      .maybeSingle();

    if (profileResult.error) throw profileResult.error;
    if (!profileResult.data) throw new Error('Character profile not found.');

    const existingProfile = mapCharacterProfileRow(profileResult.data);
    const stylePreferences = cleanJsonRecord({
      ...existingProfile.stylePreferences,
      ...(input.stylePreferences ?? {}),
      appearanceSummary: input.appearanceSummary ?? existingProfile.appearanceSummary ?? '',
      wardrobeTendencies: input.wardrobeTendencies ?? existingProfile.wardrobeTendencies ?? '',
      emotionalTendencies: input.emotionalTendencies ?? existingProfile.emotionalTendencies ?? '',
      soundtrackTendencies: input.soundtrackTendencies ?? existingProfile.soundtrackTendencies ?? '',
      cinematicStyle: input.cinematicStyle ?? existingProfile.cinematicStyle ?? '',
      relationshipMemory: input.relationshipMemory ?? existingProfile.relationshipMemory ?? {},
    });
    const { data, error } = await client
      .from('character_profiles')
      .update({
        name: input.name ?? existingProfile.name,
        display_name: input.displayName ?? input.name ?? existingProfile.displayName ?? existingProfile.name,
        reference_image_urls: input.referenceImageUrls
          ? cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls))
          : cleanJsonRecord(cleanReferenceImageUrls(existingProfile.referenceImageUrls)),
        style_preferences: stylePreferences,
        appearance_summary: input.appearanceSummary ?? existingProfile.appearanceSummary ?? '',
        wardrobe_tendencies: input.wardrobeTendencies ?? existingProfile.wardrobeTendencies ?? '',
        emotional_tendencies: input.emotionalTendencies ?? existingProfile.emotionalTendencies ?? '',
        soundtrack_tendencies: input.soundtrackTendencies ?? existingProfile.soundtrackTendencies ?? '',
        cinematic_style: input.cinematicStyle ?? existingProfile.cinematicStyle ?? '',
        relationship_memory: cleanJsonRecord(input.relationshipMemory ?? existingProfile.relationshipMemory ?? {}),
        continuity_state: cleanJsonRecord({
          ...(existingProfile.continuityState ?? {}),
          characterAppearance: input.appearanceSummary ?? existingProfile.appearanceSummary ?? '',
          wardrobe: input.wardrobeTendencies ?? existingProfile.wardrobeTendencies ?? '',
          emotionalTone: input.emotionalTendencies ?? existingProfile.emotionalTendencies ?? '',
          soundtrackMood: input.soundtrackTendencies ?? existingProfile.soundtrackTendencies ?? '',
          cameraStyle: input.cinematicStyle ?? existingProfile.cinematicStyle ?? '',
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('owner_user_id', input.userId)
      .eq('id', input.characterId)
      .select('*')
      .single();

    if (error) throw error;
    return mapCharacterProfileRow(data);
  }

  const existing = mapCharacterRow(existingResult.data);
  const stylePreferences = cleanJsonRecord({
    ...existing.stylePreferences,
    ...(input.stylePreferences ?? {}),
    appearanceSummary: input.appearanceSummary ?? existing.appearanceSummary ?? '',
    wardrobeTendencies: input.wardrobeTendencies ?? existing.wardrobeTendencies ?? '',
    emotionalTendencies: input.emotionalTendencies ?? existing.emotionalTendencies ?? '',
    soundtrackTendencies: input.soundtrackTendencies ?? existing.soundtrackTendencies ?? '',
    cinematicStyle: input.cinematicStyle ?? existing.cinematicStyle ?? '',
    relationshipMemory: input.relationshipMemory ?? existing.relationshipMemory ?? {},
  });

  const { data, error } = await client
    .from('characters')
    .update({
      name: input.name ?? existing.name,
      display_name: input.displayName ?? input.name ?? existing.displayName ?? existing.name,
      reference_image_urls: input.referenceImageUrls
        ? cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls))
        : cleanJsonRecord(cleanReferenceImageUrls(existing.referenceImageUrls)),
      style_preferences: stylePreferences,
      appearance_summary: input.appearanceSummary ?? existing.appearanceSummary ?? '',
      wardrobe_tendencies: input.wardrobeTendencies ?? existing.wardrobeTendencies ?? '',
      emotional_tendencies: input.emotionalTendencies ?? existing.emotionalTendencies ?? '',
      soundtrack_tendencies: input.soundtrackTendencies ?? existing.soundtrackTendencies ?? '',
      cinematic_style: input.cinematicStyle ?? existing.cinematicStyle ?? '',
      relationship_memory: cleanJsonRecord(input.relationshipMemory ?? existing.relationshipMemory ?? {}),
      continuity_state: cleanJsonRecord({
        ...(existing.continuityState ?? {}),
        characterAppearance: input.appearanceSummary ?? existing.appearanceSummary ?? '',
        wardrobe: input.wardrobeTendencies ?? existing.wardrobeTendencies ?? '',
        emotionalTone: input.emotionalTendencies ?? existing.emotionalTendencies ?? '',
        soundtrackMood: input.soundtrackTendencies ?? existing.soundtrackTendencies ?? '',
        cameraStyle: input.cinematicStyle ?? existing.cinematicStyle ?? '',
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('owner_user_id', input.userId)
    .eq('id', input.characterId)
    .select('*')
    .single();

  if (error) throw error;
  return mapCharacterRow(data);
}

export async function updateSupabaseCharacterReferenceImageUrls(input: {
  userId: string;
  character: CharacterProfile;
  referenceImageUrls: ReferenceImageUrls;
}): Promise<CharacterProfile> {
  const client = getClient();
  const cleanedReferenceImageUrls = cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls));

  if (
    input.character.id === CREATOR_SELF_CHARACTER_ID ||
    input.character.characterId === CREATOR_SELF_CHARACTER_ID ||
    input.character.isCreatorSelf
  ) {
    const selfResult = await client
      .from('self_characters')
      .update({
        reference_image_urls: cleanedReferenceImageUrls,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', input.userId)
      .select('*')
      .maybeSingle();

    if (selfResult.error && !missingCleanupSchemaError(selfResult.error)) {
      throw selfResult.error;
    }

    const profileByUserResult = await client
      .from('profiles')
      .update({
        self_reference_image_urls: cleanedReferenceImageUrls,
      })
      .eq('user_id', input.userId);

    if (profileByUserResult.error && !missingCleanupSchemaError(profileByUserResult.error)) {
      throw profileByUserResult.error;
    }

    const profileByIdResult = await client
      .from('profiles')
      .update({
        self_reference_image_urls: cleanedReferenceImageUrls,
      })
      .eq('id', input.userId);

    if (profileByIdResult.error && !missingCleanupSchemaError(profileByIdResult.error)) {
      throw profileByIdResult.error;
    }

    if (selfResult.data) return mapSelfCharacterRow(selfResult.data);

    return {
      ...input.character,
      referenceImageUrls: input.referenceImageUrls,
      updatedAt: new Date().toISOString(),
    };
  }

  return updateSupabaseCharacterProfile({
    userId: input.userId,
    characterId: input.character.id,
    referenceImageUrls: input.referenceImageUrls,
  });
}

function missingCleanupSchemaError(error: unknown) {
  const message = error && typeof error === 'object'
    ? JSON.stringify(error)
    : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('42p01') ||
    lower.includes('42703') ||
    lower.includes('continuity_memory_states') ||
    lower.includes('moderation_orchestration_memory') ||
    lower.includes('character_profiles') ||
    lower.includes('characters')
  );
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function bestEffortDeleteByCharacterIds(input: {
  table: string;
  userColumn: string;
  userId: string;
  characterIds: string[];
}) {
  const client = getClient();
  const { error } = await client
    .from(input.table)
    .delete()
    .eq(input.userColumn, input.userId)
    .in('character_id', input.characterIds);

  if (error && !missingCleanupSchemaError(error)) throw error;
}

export async function deleteSupabaseCharacterProfile(input: {
  userId: string;
  character: CharacterProfile;
}): Promise<void> {
  const client = getClient();
  const characterIds = Array.from(new Set([
    input.character.id,
    input.character.characterId,
  ].filter((value): value is string => Boolean(value && value.trim()))));

  if (input.character.id === CREATOR_SELF_CHARACTER_ID || input.character.characterId === CREATOR_SELF_CHARACTER_ID || input.character.isCreatorSelf) {
    throw new Error('Self character cannot be deleted in v1.');
  }

  await bestEffortDeleteByCharacterIds({
    table: 'continuity_memory_states',
    userColumn: 'user_id',
    userId: input.userId,
    characterIds,
  });
  await bestEffortDeleteByCharacterIds({
    table: 'moderation_orchestration_memory',
    userColumn: 'user_id',
    userId: input.userId,
    characterIds,
  });

  const profileDelete = await client
    .from('character_profiles')
    .delete()
    .eq('owner_user_id', input.userId)
    .in('character_id', characterIds);

  if (profileDelete.error && !missingCleanupSchemaError(profileDelete.error)) {
    throw profileDelete.error;
  }

  const profileIdDelete = isUuidLike(input.character.id)
    ? await client
        .from('character_profiles')
        .delete()
        .eq('owner_user_id', input.userId)
        .eq('id', input.character.id)
    : { error: null };

  if (profileIdDelete.error && !missingCleanupSchemaError(profileIdDelete.error)) {
    throw profileIdDelete.error;
  }

  const legacyDelete = await client
    .from('characters')
    .delete()
    .eq('owner_user_id', input.userId)
    .in('id', characterIds);

  if (legacyDelete.error && !missingCleanupSchemaError(legacyDelete.error)) {
    throw legacyDelete.error;
  }
}

export async function saveSupabaseCreatorSelfCharacter(input: {
  userId: string;
  profile: LumoraProfile;
  name: string;
  referenceImageUrls: ReferenceImageUrls;
  referencePhotoNames?: Record<string, string | null>;
  sourceCaptureVideoUrl: string | null;
  sourceCaptureVideoName?: string | null;
  sourceCaptureVideoPath?: string | null;
  sourceCaptureVideo2Url?: string | null;
  sourceCaptureVideo2Name?: string | null;
  sourceCaptureVideo2Path?: string | null;
  selfCaptureNumbers?: string | null;
  selfCaptureConsent: boolean;
  selfCaptureCompleted: boolean;
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
  voiceSampleConsent: boolean;
  creatorSelfFeatures: Record<string, string | undefined>;
  creatorSelfStylePreferences: CreatorSelfStylePreferences;
  stylePreferences?: Record<string, unknown>;
  identityProfile?: LumoraIdentityProfile | null;
  editorDraft?: Record<string, unknown> | null;
}): Promise<{ profile: LumoraProfile; character: CharacterProfile }> {
  const client = getClient();
  const now = new Date().toISOString();
  const features = cleanJsonRecord(input.creatorSelfFeatures);
  const style = cleanJsonRecord(input.creatorSelfStylePreferences);
  const editorDraft = stripBase64Media(input.editorDraft) ?? null;
  const referenceImageUrls = cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls));
  const referencePhotoNames = cleanJsonRecord(input.referencePhotoNames);
  const identityProfile = cleanJsonRecord(input.identityProfile);
  console.log('SAVING SELF CHARACTER REFERENCES', {
    authUserId: input.userId,
    referenceImageUrls,
    referencePhotoNames,
    selfieVideoUrl: Boolean(input.sourceCaptureVideoUrl),
    selfieVideo2Url: Boolean(input.sourceCaptureVideo2Url),
  });

  const selfPayload = {
    user_id: input.userId,
    id: CREATOR_SELF_CHARACTER_ID,
    name: input.name,
    status: 'ready',
    consent_confirmed: true,
    visibility: 'private',
    style_preferences: {
      ...cleanJsonRecord(input.stylePreferences),
      creatorSelfFeatures: features,
      creatorSelfStylePreferences: style,
      creatorSelfEditorDraft: editorDraft,
      identityProfile,
      selfieVideoPath: storageUrl(input.sourceCaptureVideoPath, 'Self capture video path'),
      selfieVideo2Url: storageUrl(input.sourceCaptureVideo2Url, 'Second self capture video'),
      selfieVideo2Name: input.sourceCaptureVideo2Name ?? null,
      selfieVideo2Path: storageUrl(input.sourceCaptureVideo2Path, 'Second self capture video path'),
    },
    reference_image_urls: referenceImageUrls,
    reference_photo_names: referencePhotoNames,
    identity_profile: identityProfile,
    source_capture_video_url: storageUrl(input.sourceCaptureVideoUrl, 'Self capture video'),
    source_capture_video_name: input.sourceCaptureVideoName ?? null,
    self_capture_numbers: input.selfCaptureNumbers ?? null,
    self_capture_consent: input.selfCaptureConsent,
    self_capture_completed: input.selfCaptureCompleted,
    self_capture_captured_at: input.sourceCaptureVideoUrl ? now : null,
    voice_sample_url: storageUrl(input.voiceSampleUrl, 'Self voice sample'),
    voice_sample_name: input.voiceSampleName ?? null,
    voice_sample_numbers: input.voiceSampleNumbers ?? null,
    voice_sample_consent: input.voiceSampleConsent,
    voice_sample_captured_at: input.voiceSampleUrl ? now : null,
    creator_self_features: features,
    creator_self_style_preferences: style,
    editor_draft: editorDraft,
    updated_at: now,
  };
  let selfResult = await client
    .from('self_characters')
    .upsert(selfPayload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (selfResult.error && isMissingColumnError(selfResult.error, 'identity_profile')) {
    const { identity_profile: _identityProfileColumn, ...fallbackPayload } = selfPayload;
    selfResult = await client
      .from('self_characters')
      .upsert(fallbackPayload, { onConflict: 'user_id' })
      .select('*')
      .single();
  }

  const { data: selfData, error: selfError } = selfResult;

  if (selfError) throw selfError;

  console.log('SAVING SUPABASE SELF CHARACTER', {
    authUserId: input.userId,
    selfCharacterUserId: stringValue(selfData.user_id),
    avatarUrlExists: Boolean(jsonRecord(selfData.reference_image_urls).frontFace),
  });
  console.log('SAVED SELF CHARACTER REFERENCES', {
    authUserId: input.userId,
    references: jsonRecord(selfData.reference_image_urls),
  });

  const nextProfile: LumoraProfile = {
    ...input.profile,
    defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
    defaultSelfCharacterName: input.name,
    defaultSelfCharacterAvatar:
      stringValue(referenceImageUrls.frontFaceUrl) ||
      stringValue(referenceImageUrls.frontFace) ||
      stringValue(referenceImageUrls.manualReferenceImageUrl) ||
      storageUrl(input.profile.avatar, 'Profile avatar'),
    manualReferenceImageUrl: stringValue(referenceImageUrls.manualReferenceImageUrl) || null,
    selfReferenceImageUrls: referenceImageUrls,
    selfReferencePhotoNames: referencePhotoNames,
    selfCaptureVideoName: input.sourceCaptureVideoName ?? null,
    selfCaptureVideoUrl: storageUrl(input.sourceCaptureVideoUrl, 'Self capture video'),
    selfCaptureNumbers: input.selfCaptureNumbers ?? null,
    selfCaptureConsent: input.selfCaptureConsent,
    selfCaptureCompleted: input.selfCaptureCompleted,
    selfCaptureCapturedAt: input.sourceCaptureVideoUrl ? now : input.profile.selfCaptureCapturedAt ?? null,
    selfVoiceSampleName: input.voiceSampleName ?? null,
    selfVoiceSampleUrl: storageUrl(input.voiceSampleUrl, 'Self voice sample'),
    selfVoiceSampleNumbers: input.voiceSampleNumbers ?? null,
    selfVoiceSampleCapturedAt: input.voiceSampleUrl ? now : input.profile.selfVoiceSampleCapturedAt ?? null,
    selfVoiceSampleConsent: input.voiceSampleConsent,
    creatorSelfFeatures: stringRecord(features),
    creatorSelfStylePreferences: mapStylePreferences(style),
    selfCharacterFeatures: stringRecord(features),
    selfCharacterStylePreferences: mapStylePreferences(style),
    selfCharacterEditorDraft: isObject(editorDraft) ? editorDraft : null,
  };
  const savedProfile = await saveSupabaseProfile(input.userId, nextProfile);

  return {
    profile: savedProfile,
    character: mapSelfCharacterRow(selfData),
  };
}

export async function saveSupabaseIdentityFeedback(input: {
  userId: string;
  identityProfile: LumoraIdentityProfile;
}): Promise<void> {
  const client = getClient();
  const { data, error } = await client
    .from('self_characters')
    .select('style_preferences')
    .eq('user_id', input.userId)
    .maybeSingle();

  if (error) throw error;

  const stylePreferences = {
    ...jsonRecord(data?.style_preferences),
    identityProfile: cleanJsonRecord(input.identityProfile),
  };

  let updateResult = await client
    .from('self_characters')
    .update({
      style_preferences: stylePreferences,
      identity_profile: cleanJsonRecord(input.identityProfile),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId);

  if (updateResult.error && isMissingColumnError(updateResult.error, 'identity_profile')) {
    updateResult = await client
      .from('self_characters')
      .update({
        style_preferences: stylePreferences,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', input.userId);
  }

  const updateError = updateResult.error;
  if (updateError) throw updateError;
}

export async function loadSupabaseProjects(userId: string): Promise<StudioProject[]> {
  const client = getClient();
  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapProjectRow);
}

export async function saveSupabaseProject(userId: string, project: StudioProject): Promise<StudioProject> {
  const client = getClient();
  const authDiagnostics = await getProjectSaveAuthDiagnostics(userId);
  const projectsTableProbe = await probeProjectsTableForSave(userId).catch((error) => ({
    ok: false,
    ownProjectCount: null,
    error: serializeSupabaseError(error),
  }));
  let payload: Record<string, unknown>;

  try {
    const generatedMedia = resolveGeneratedVideoMedia(project);
    const thumbnailUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(project);
    const posterUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(project);
    payload = {
      id: project.id,
      user_id: userId,
      title: project.title || 'Untitled concept',
      caption: project.caption ?? project.prompt,
      prompt: project.prompt,
      final_prompt: project.finalPrompt ?? project.prompt,
      thumbnail_url: storageUrl(thumbnailUrl, 'Generated project thumbnail'),
      poster_url: storageUrl(posterUrl, 'Generated project poster'),
      thumbnail_source: generatedMedia.thumbnailSource,
      style_preset: project.engine ?? project.provider ?? 'replicate',
      status: project.status || 'draft',
      published_at: project.publishedAt ?? null,
      posted_at: project.postedAt ?? null,
      is_posted: Boolean(project.isPosted),
      provider: project.provider,
      engine: project.engine ?? project.provider,
      display_engine: project.displayEngine ?? null,
      model: project.model ?? null,
      generation_mode: project.generationMode ?? null,
      identity_id: project.identityId ?? null,
      keyframe_url: storageUrl(project.keyframeUrl, 'Generated identity keyframe'),
      output_type: 'video',
      video_url: storageUrl(project.videoUrl, 'Generated project video'),
      cover_asset_url: storageUrl(project.videoUrl, 'Generated project video'),
      reference_image_url: storageUrl(project.referenceImageUrl, 'Project reference image'),
      reference_image_urls: cleanJsonRecord(project.referenceImageUrls),
      additional_reference_image_urls: stripBase64Media(project.additionalReferenceImageUrls) ?? null,
      likeness_feedback: cleanJsonRecord(project.likenessFeedback),
      character_id: project.characterId,
      character_name: project.characterName,
      character_avatar: storageUrl(project.characterAvatar, 'Project character avatar'),
      is_default_self_character: Boolean(project.isDefaultSelfCharacter),
      creator_name: project.creatorName ?? null,
      creator_username: project.creatorUsername ?? null,
      creator_avatar: storageUrl(project.creatorAvatar, 'Project creator avatar'),
      privacy: project.privacy ?? 'private',
      visibility: project.visibility ?? project.privacy ?? 'private',
      view_count: project.viewCount ?? 0,
      like_count: project.likeCount ?? 0,
      comment_count: project.commentCount ?? 0,
      share_count: project.shareCount ?? 0,
      aspect_ratio: project.aspectRatio ?? null,
      created_at: project.createdAt,
      updated_at: project.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    console.error('SUPABASE PROJECT SAVE PAYLOAD BUILD FAILED:', {
      projectId: project.id,
      userId,
      authDiagnostics,
      projectsTableProbe,
      error: serializeSupabaseError(error),
    });
    throw error;
  }

  const removableProjectColumns = [
    'thumbnail_url',
    'poster_url',
    'thumbnail_source',
    'published_at',
    'posted_at',
    'is_posted',
    'visibility',
    'view_count',
    'like_count',
    'comment_count',
    'share_count',
    'additional_reference_image_urls',
    'reference_image_url',
    'reference_image_urls',
    'keyframe_url',
    'identity_id',
    'likeness_feedback',
    'generation_mode',
    'display_engine',
    'model',
    'caption',
    'final_prompt',
    'engine',
    'aspect_ratio',
    'creator_avatar',
    'creator_username',
    'creator_name',
    'is_default_self_character',
    'character_avatar',
    'character_name',
    'character_id',
    'video_url',
    'output_type',
    'provider',
    'privacy',
    'duration_seconds',
  ] as const;
  let payloadForUpsert: Partial<typeof payload> = payload;
  let result: { data: DbRow | null; error: unknown } = { data: null, error: null };
  const removedColumns: string[] = [];

  console.info('SUPABASE PROJECT SAVE PREFLIGHT:', {
    projectId: project.id,
    userId,
    authDiagnostics,
    projectsTableProbe,
    payloadColumns: Object.keys(payload),
    media: {
      hasVideoUrl: Boolean(project.videoUrl),
      videoUrlKind: project.videoUrl?.startsWith('http') ? 'http' : project.videoUrl?.startsWith('/') ? 'relative' : 'other',
      hasThumbnailUrl: Boolean(project.thumbnailUrl),
      hasReferenceImageUrl: Boolean(project.referenceImageUrl),
      hasKeyframeUrl: Boolean(project.keyframeUrl),
    },
  });

  for (let attempt = 0; attempt <= removableProjectColumns.length; attempt += 1) {
    console.info('SUPABASE PROJECT SAVE ATTEMPT:', {
      projectId: project.id,
      attempt: attempt + 1,
      columns: Object.keys(payloadForUpsert),
      removedColumns,
    });

    result = await client
      .from('projects')
      .upsert(
        payloadForUpsert,
        { onConflict: 'id' },
      )
      .select('*')
      .single();

    const column = missingColumnName(result.error, removableProjectColumns);
    if (!result.error || !column) break;

    console.warn('SUPABASE PROJECT SAVE MISSING COLUMN, RETRYING:', {
      projectId: project.id,
      missingColumn: column,
      error: serializeSupabaseError(result.error),
    });

    const { [column]: _removedColumn, ...nextPayload } = payloadForUpsert;
    payloadForUpsert = nextPayload;
    removedColumns.push(column);
  }

  if (result.error) {
    const exactError = serializeSupabaseError(result.error);
    const rlsHint = rlsHintForProjectSave(result.error);
    console.error('SUPABASE PROJECT SAVE FAILED EXACT ERROR:', {
      projectId: project.id,
      userId,
      error: exactError,
      errorSummary: supabaseErrorSummary(result.error),
      rlsHint,
      authDiagnostics,
      projectsTableProbe,
      attemptedColumns: Object.keys(payloadForUpsert),
      removedColumns,
      requiredTables: ['projects'],
      expectedRlsPolicies: ['projects_select_own', 'projects_insert_own', 'projects_update_own'],
    });
    throw new Error(
      [
        `Supabase project save failed: ${supabaseErrorSummary(result.error)}`,
        rlsHint,
      ].filter(Boolean).join(' '),
    );
  }
  if (!result.data) throw new Error('Unable to save project.');
  console.info('SUPABASE PROJECT SAVE SUCCEEDED:', {
    projectId: project.id,
    userId,
    removedColumns,
    returnedColumns: Object.keys(result.data),
  });
  return mapProjectRow(result.data);
}

function mapProjectRow(row: DbRow): StudioProject {
  const rawProject = {
    ...row,
    thumbnailUrl: nullableString(row.thumbnail_url),
    posterUrl: nullableString(row.poster_url),
    thumbnailSource: nullableString(row.thumbnail_source),
    coverAssetUrl: nullableString(row.cover_asset_url),
    imageUrl: nullableString(row.image_url),
    videoUrl: nullableString(row.video_url) || nullableString(row.cover_asset_url),
    keyframeUrl: nullableString(row.keyframe_url),
    referenceImageUrl: nullableString(row.reference_image_url),
    referenceImageUrls: jsonRecord(row.reference_image_urls),
    characterAvatar: nullableString(row.character_avatar),
  };
  const generatedMedia = resolveGeneratedVideoMedia(rawProject);

  return {
    id: stringValue(row.id),
    title: nullableString(row.title),
    caption: nullableString(row.caption),
    prompt: stringValue(row.prompt),
    finalPrompt: nullableString(row.final_prompt),
    thumbnailUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(rawProject),
    posterUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(rawProject),
    thumbnailSource: generatedMedia.thumbnailSource,
    videoUrl: stringValue(row.video_url) || stringValue(row.cover_asset_url),
    status: stringValue(row.status) || 'draft',
    publishedAt: nullableString(row.published_at),
    postedAt: nullableString(row.posted_at),
    isPosted: booleanValue(row.is_posted) || stringValue(row.status) === 'published',
    privacy: nullableString(row.privacy),
    visibility: nullableString(row.visibility) ?? nullableString(row.privacy),
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    shareCount: Number(row.share_count ?? 0),
    provider: (row.provider ?? 'mock') as VideoEngine,
    engine: nullableString(row.engine) as VideoEngine | null,
    displayEngine: nullableString(row.display_engine),
    aspectRatio: nullableString(row.aspect_ratio),
    model: nullableString(row.model),
    generationMode: nullableString(row.generation_mode) as StudioProject['generationMode'],
    identityId: nullableString(row.identity_id),
    keyframeUrl: nullableString(row.keyframe_url),
    referenceImageUrl: nullableString(row.reference_image_url),
    referenceImageUrls: jsonRecord(row.reference_image_urls) as Partial<ReferenceImageUrls>,
    additionalReferenceImageUrls: Array.isArray(row.additional_reference_image_urls)
      ? row.additional_reference_image_urls.filter((item): item is string => typeof item === 'string')
      : null,
    likenessFeedback: isObject(row.likeness_feedback)
      ? row.likeness_feedback as LumoraIdentityFeedback
      : null,
    characterId: nullableString(row.character_id),
    characterName: nullableString(row.character_name),
    characterAvatar: nullableString(row.character_avatar),
    isDefaultSelfCharacter: booleanValue(row.is_default_self_character),
    creatorName: nullableString(row.creator_name),
    creatorUsername: nullableString(row.creator_username),
    creatorAvatar: nullableString(row.creator_avatar),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function loadSupabaseDrafts(userId: string): Promise<LumoraDraft[]> {
  const client = getClient();
  const { data, error } = await client
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stringValue(row.id),
    title: stringValue(row.title) || 'Draft concept',
    prompt: stringValue(row.prompt),
    createdAt: toIso(row.created_at),
  }));
}

export async function saveSupabaseDraft(input: {
  userId: string;
  title: string;
  prompt: string;
  payload?: Record<string, unknown>;
}): Promise<LumoraDraft> {
  const client = getClient();
  const { data, error } = await client
    .from('drafts')
    .insert({
      user_id: input.userId,
      title: input.title,
      prompt: input.prompt,
      payload: cleanJsonRecord(input.payload),
    })
    .select('*')
    .single();

  if (error) throw error;
  return {
    id: stringValue(data.id),
    title: stringValue(data.title) || 'Draft concept',
    prompt: stringValue(data.prompt),
    createdAt: toIso(data.created_at),
  };
}

export async function loadSupabaseProfilePosts(userId: string): Promise<LumoraPost[]> {
  const client = getClient();
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPostRow);
}

async function getPublishedLikeSum(userId: string): Promise<number | null> {
  const client = getClient();
  const { data, error } = await client
    .from('posts')
    .select('like_count')
    .eq('user_id', userId)
    .eq('status', 'published');

  if (error) return null;

  return (data ?? []).reduce((total, row) => total + Number(row.like_count ?? 0), 0);
}

async function getFollowerCount(userId: string): Promise<{ count: number | null; followsTableAvailable: boolean }> {
  const client = getClient();
  const { count, error } = await client
    .from('follows')
    .select('follower_user_id', { count: 'exact', head: true })
    .eq('following_user_id', userId);

  if (!error) {
    return { count: count ?? 0, followsTableAvailable: true };
  }

  let profileResult = await client
    .from('profiles')
    .select('followers_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (
    profileResult.error &&
    (isMissingColumnError(profileResult.error, 'user_id') ||
      (isObject(profileResult.error) && profileResult.error.code === '42P10'))
  ) {
    profileResult = await client
      .from('profiles')
      .select('followers_count')
      .eq('id', userId)
      .maybeSingle();
  }

  if (profileResult.error || !profileResult.data) {
    return { count: null, followsTableAvailable: false };
  }

  return {
    count: Number(profileResult.data.followers_count ?? 0),
    followsTableAvailable: false,
  };
}

async function getCharacterProfileCount(userId: string): Promise<number | null> {
  const client = getClient();
  const { count, error } = await client
    .from('character_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', userId);

  if (error) return null;
  return count ?? 0;
}

async function getLegacyCharacterCount(userId: string): Promise<number | null> {
  const client = getClient();
  const [charactersResult, selfResult] = await Promise.all([
    client
      .from('characters')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', userId),
    client
      .from('self_characters')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  if (charactersResult.error && selfResult.error) return null;
  return (charactersResult.error ? 0 : charactersResult.count ?? 0) + (selfResult.error ? 0 : selfResult.count ?? 0);
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [totalLikesReceived, followers, characterProfilesCount, legacyCharacterCount] = await Promise.all([
    getPublishedLikeSum(userId),
    getFollowerCount(userId),
    getCharacterProfileCount(userId),
    getLegacyCharacterCount(userId),
  ]);

  return {
    totalLikesReceived: totalLikesReceived ?? 0,
    followersCount: followers.count ?? 0,
    characterCount: Math.min(25, Math.max(characterProfilesCount ?? 0, legacyCharacterCount ?? 0)),
    followsTableAvailable: followers.followsTableAvailable,
  };
}

export async function loadSupabasePublicPosts(): Promise<LumoraPost[]> {
  const client = getClient();
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('privacy', 'public')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map(mapPostRow);
}

async function loadFollowedUserIds(userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return new Set();

  const client = getClient();
  const { data, error } = await client
    .from('follows')
    .select('following_user_id')
    .eq('follower_user_id', userId);

  if (error) return new Set();
  return new Set((data ?? []).map((row) => stringValue(row.following_user_id)).filter(Boolean));
}

function postSearchText(post: LumoraPost) {
  const postExtras = post as LumoraPost & {
    tags?: string[] | string | null;
    character?: { name?: string | null } | null;
  };
  const tags = Array.isArray(postExtras.tags) ? postExtras.tags.join(' ') : postExtras.tags;

  return [
    post.title,
    post.caption,
    post.prompt,
    post.creatorName,
    post.creatorUsername,
    post.displayName,
    post.username,
    post.characterName,
    postExtras.character?.name,
    tags,
    post.provider,
  ].filter(Boolean).join(' ').toLowerCase();
}

function scorePost(post: LumoraPost, input: {
  currentUserId?: string | null;
  followedUserIds: Set<string>;
  searchQuery?: string | null;
}) {
  const ageHours = Math.max(1, (Date.now() - new Date(post.publishedAt ?? post.createdAt).getTime()) / 36e5);
  const recencyScore = Math.max(0, 36 - Math.min(36, ageHours)) / 36;
  const engagement =
    (post.viewCount ?? 0) +
    (post.likeCount ?? 0) * 4 +
    (post.commentCount ?? 0) * 3 +
    (post.shareCount ?? 0) * 5;
  const viralScore = Math.log10(engagement + 1);
  const trendingScore = viralScore * recencyScore;
  const followBoost = post.userId && input.followedUserIds.has(post.userId) ? 4 : 0;
  const ownPostPenalty = input.currentUserId && post.userId === input.currentUserId ? -0.75 : 0;
  const query = input.searchQuery?.trim().toLowerCase() ?? '';
  const relevanceScore = query && postSearchText(post).includes(query) ? 5 : 0;

  return followBoost + trendingScore + viralScore + recencyScore + relevanceScore + ownPostPenalty;
}

export async function listForYouFeed(input: {
  currentUserId?: string | null;
  searchQuery?: string | null;
} = {}): Promise<LumoraPost[]> {
  const client = getClient();
  const query = input.searchQuery?.trim().toLowerCase() ?? '';
  const [{ data, error }, followedUserIds] = await Promise.all([
    client
      .from('posts')
      .select('*')
      .eq('privacy', 'public')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(120),
    loadFollowedUserIds(input.currentUserId),
  ]);

  if (error) throw error;

  return (data ?? [])
    .map(mapPostRow)
    .filter((post) => !query || postSearchText(post).includes(query))
    .sort((left, right) => (
      scorePost(right, { ...input, followedUserIds }) - scorePost(left, { ...input, followedUserIds })
    ));
}

function isDraftProject(project: StudioProject) {
  const status = (project.status || 'draft').toLowerCase();
  return !project.isPosted && !project.publishedAt && status !== 'published' && status !== 'archived';
}

export async function listDrafts(userId: string): Promise<StudioProject[]> {
  return (await loadSupabaseProjects(userId)).filter(isDraftProject);
}

export async function publishDraft(input: {
  userId: string;
  projectId?: string | null;
  post: LumoraPost;
  privacy?: PrivacySetting;
}): Promise<LumoraPost> {
  const privacy = input.privacy ?? (input.post.privacy as PrivacySetting | undefined) ?? 'public';
  return saveSupabasePost(input.userId, {
    ...input.post,
    sourceGenerationId: input.projectId ?? input.post.sourceGenerationId ?? null,
    privacy,
    visibility: input.post.visibility ?? privacy,
    status: 'published',
    publishedAt: input.post.publishedAt ?? new Date().toISOString(),
  });
}

export const listProfilePosts = loadSupabaseProfilePosts;
export { repairMissingThumbnailIfNeeded };

export async function saveSupabasePost(userId: string, post: LumoraPost): Promise<LumoraPost> {
  const client = getClient();
  const publishedAt = post.publishedAt ?? new Date().toISOString();
  const generatedMedia = resolveGeneratedVideoMedia(post);
  const thumbnailUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(post);
  const posterUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(post);
  const payload = {
    user_id: userId,
    title: post.title || post.caption || 'Lumora post',
    caption: post.caption ?? null,
    prompt: post.prompt ?? null,
    image_url: storageUrl(post.imageUrl, 'Post image'),
    video_url: storageUrl(post.videoUrl, 'Post video'),
    thumbnail_url: storageUrl(thumbnailUrl, 'Post thumbnail'),
    poster_url: storageUrl(posterUrl, 'Post poster'),
    thumbnail_source: generatedMedia.thumbnailSource,
    source_generation_id: post.sourceGenerationId ?? null,
    privacy: post.privacy ?? post.visibility ?? 'public',
    visibility: post.visibility ?? post.privacy ?? 'public',
    character_id: post.characterId ?? null,
    character_name: post.characterName ?? null,
    character_avatar: storageUrl(post.characterAvatar, 'Post character avatar'),
    is_default_self_character: Boolean(post.isDefaultSelfCharacter),
    creator_name: post.creatorName ?? post.displayName ?? null,
    creator_username: post.creatorUsername ?? post.username ?? null,
    creator_avatar: storageUrl(post.creatorAvatar ?? post.avatar, 'Post creator avatar'),
    provider: post.provider ?? null,
    status: 'published',
    published_at: publishedAt,
    view_count: post.viewCount ?? 0,
    like_count: post.likeCount ?? 0,
    comment_count: post.commentCount ?? 0,
    share_count: post.shareCount ?? 0,
    updated_at: new Date().toISOString(),
  };

  const existingPost = post.sourceGenerationId
    ? await client
        .from('posts')
        .select('id')
        .eq('user_id', userId)
        .eq('source_generation_id', post.sourceGenerationId)
        .maybeSingle()
    : null;

  if (existingPost?.error) throw existingPost.error;

  const result = existingPost?.data
    ? await client
        .from('posts')
        .update(payload)
        .eq('id', stringValue(existingPost.data.id))
        .eq('user_id', userId)
        .select('*')
        .single()
    : await client
        .from('posts')
        .insert(payload)
        .select('*')
        .single();

  const { data, error } = result;

  if (error) throw error;

  if (post.sourceGenerationId) {
    await client
      .from('projects')
      .update({
        is_posted: true,
        status: 'published',
        published_at: publishedAt,
        posted_at: publishedAt,
        privacy: payload.privacy,
        visibility: payload.visibility,
        thumbnail_url: storageUrl(thumbnailUrl, 'Published project thumbnail'),
        poster_url: storageUrl(posterUrl, 'Published project poster'),
        thumbnail_source: generatedMedia.thumbnailSource,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.sourceGenerationId)
      .eq('user_id', userId);
  }

  return mapPostRow(data);
}

function mapPostRow(row: DbRow): LumoraPost {
  const rawPost = repairMissingThumbnailIfNeeded({
    id: stringValue(row.id),
    title: nullableString(row.title),
    caption: nullableString(row.caption),
    prompt: nullableString(row.prompt),
    imageUrl: nullableString(row.image_url),
    videoUrl: nullableString(row.video_url),
    thumbnailUrl: nullableString(row.thumbnail_url),
    posterUrl: nullableString(row.poster_url),
    thumbnailSource: nullableString(row.thumbnail_source),
    characterAvatar: nullableString(row.character_avatar),
    creatorAvatar: nullableString(row.creator_avatar),
  });
  const generatedMedia = resolveGeneratedVideoMedia(rawPost);
  const thumbnailUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(rawPost);
  const posterUrl = generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(rawPost);

  return {
    id: stringValue(row.id),
    userId: nullableString(row.user_id),
    title: nullableString(row.title),
    caption: nullableString(row.caption),
    prompt: nullableString(row.prompt),
    imageUrl: nullableString(row.image_url),
    videoUrl: nullableString(row.video_url),
    thumbnailUrl,
    posterUrl,
    thumbnailSource: generatedMedia.thumbnailSource,
    sourceGenerationId: nullableString(row.source_generation_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    publishedAt: nullableString(row.published_at) ?? toIso(row.created_at),
    characterId: nullableString(row.character_id),
    characterName: nullableString(row.character_name),
    characterAvatar: nullableString(row.character_avatar),
    provider: nullableString(row.provider),
    status: nullableString(row.status) ?? 'published',
    privacy: nullableString(row.privacy),
    visibility: nullableString(row.visibility) ?? nullableString(row.privacy),
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    shareCount: Number(row.share_count ?? 0),
    displayName: nullableString(row.creator_name),
    username: nullableString(row.creator_username),
    avatar: nullableString(row.creator_avatar),
    creatorName: nullableString(row.creator_name),
    creatorUsername: nullableString(row.creator_username),
    creatorAvatar: nullableString(row.creator_avatar),
    isDefaultSelfCharacter: booleanValue(row.is_default_self_character),
  };
}
