import type {
  CharacterProfile,
  CreatorSelfStylePreferences,
  LumoraPost,
  PrivacySetting,
  ReferenceImageUrls,
  VideoEngine,
} from './api';
import type { LumoraProfile } from './profileStorage';
import type { StudioProject } from './projectStorage';
import { supabase } from './supabase';

export type LumoraDraft = {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
};

export type LumoraStorageBucket =
  | 'avatars'
  | 'character-reference-images'
  | 'self-capture-videos'
  | 'voice-samples'
  | 'generated-videos'
  | 'post-thumbnails';

type DbRow = Record<string, any>;

const CREATOR_SELF_CHARACTER_ID = 'creator-self';
const publicBuckets: LumoraStorageBucket[] = ['avatars', 'generated-videos', 'post-thumbnails'];

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

function publicOrSignedUrl(bucket: LumoraStorageBucket, objectPath: string): Promise<string> | string {
  const client = getClient();

  if (publicBuckets.includes(bucket)) {
    return client.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
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
    self_reference_image_urls: cleanJsonRecord(profile.selfReferenceImageUrls),
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
    selfReferenceImageUrls: jsonRecord(row.self_reference_image_urls),
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
  return {
    frontFace: record.frontFace ?? '',
    leftAngle: record.leftAngle ?? '',
    rightAngle: record.rightAngle ?? '',
    fullBody: record.fullBody ?? null,
    expressive: record.expressive ?? null,
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

function cleanReferenceImageUrls(value: ReferenceImageUrls): ReferenceImageUrls {
  return {
    frontFace: storageUrl(value.frontFace, 'Front reference photo') ?? '',
    leftAngle: storageUrl(value.leftAngle, 'Left reference photo') ?? '',
    rightAngle: storageUrl(value.rightAngle, 'Right reference photo') ?? '',
    fullBody: storageUrl(value.fullBody, 'Full body reference photo'),
    expressive: storageUrl(value.expressive, 'Expressive reference photo'),
  };
}

function mapCharacterRow(row: DbRow): CharacterProfile {
  return {
    id: stringValue(row.id),
    ownerUserId: stringValue(row.owner_user_id),
    name: stringValue(row.name) || 'Untitled character',
    status: row.status ?? 'ready',
    consentConfirmed: booleanValue(row.consent_confirmed),
    visibility: (row.visibility ?? 'private') as PrivacySetting,
    stylePreferences: jsonRecord(row.style_preferences),
    referenceImageUrls: mapReferenceImages(row.reference_image_urls),
    referencePhotoNames: mapReferencePhotoNames(row.reference_photo_names),
    sourceCaptureVideoUrl: nullableString(row.source_capture_video_url),
    voiceSampleUrl: nullableString(row.voice_sample_url),
    voiceSampleName: nullableString(row.voice_sample_name),
    voiceSampleNumbers: nullableString(row.voice_sample_numbers),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    isSelf: booleanValue(row.is_self),
    isCreatorSelf: booleanValue(row.is_creator_self),
  };
}

function mapSelfCharacterRow(row: DbRow): CharacterProfile {
  const stylePreferences = {
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
    ownerUserId: stringValue(row.user_id),
    name: stringValue(row.name) || 'Creator Self',
    status: row.status ?? 'ready',
    consentConfirmed: booleanValue(row.consent_confirmed),
    visibility: (row.visibility ?? 'private') as PrivacySetting,
    stylePreferences,
    referenceImageUrls: mapReferenceImages(row.reference_image_urls),
    referencePhotoNames: mapReferencePhotoNames(row.reference_photo_names),
    sourceCaptureVideoUrl: nullableString(row.source_capture_video_url),
    voiceSampleUrl: nullableString(row.voice_sample_url),
    voiceSampleName: nullableString(row.voice_sample_name),
    voiceSampleNumbers: nullableString(row.voice_sample_numbers),
    creatorSelfFeatures: stringRecord(row.creator_self_features),
    creatorSelfStylePreferences: mapStylePreferences(row.creator_self_style_preferences),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    isSelf: true,
    isCreatorSelf: true,
  };
}

export async function loadSupabaseCharacters(userId: string): Promise<CharacterProfile[]> {
  const client = getClient();
  const [charactersResult, selfResult] = await Promise.all([
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
  ]);

  if (charactersResult.error) throw charactersResult.error;
  if (selfResult.error) throw selfResult.error;

  console.log('LOADED SUPABASE SELF CHARACTER', {
    authUserId: userId,
    loaded: Boolean(selfResult.data),
    selfCharacterUserId: selfResult.data ? stringValue(selfResult.data.user_id) : null,
  });

  const fictionalCharacters = (charactersResult.data ?? []).map(mapCharacterRow);
  const selfCharacter = selfResult.data ? [mapSelfCharacterRow(selfResult.data)] : [];
  return [...selfCharacter, ...fictionalCharacters];
}

export async function saveSupabaseCharacter(input: {
  userId: string;
  name: string;
  consentConfirmed: boolean;
  visibility: PrivacySetting;
  stylePreferences: Record<string, unknown>;
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
      status: 'ready',
      consent_confirmed: input.consentConfirmed,
      visibility: input.visibility,
      style_preferences: cleanJsonRecord(input.stylePreferences),
      reference_image_urls: cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls)),
      reference_photo_names: cleanJsonRecord(input.referencePhotoNames),
      source_capture_video_url: storageUrl(input.sourceCaptureVideoUrl, 'Character capture video'),
      source_capture_video_name: input.sourceCaptureVideoName ?? null,
      voice_sample_url: storageUrl(input.voiceSampleUrl, 'Character voice sample'),
      voice_sample_name: input.voiceSampleName ?? null,
      voice_sample_numbers: input.voiceSampleNumbers ?? null,
      is_self: false,
      is_creator_self: false,
    })
    .select('*')
    .single();

  if (error) throw error;
  return mapCharacterRow(data);
}

export async function saveSupabaseCreatorSelfCharacter(input: {
  userId: string;
  profile: LumoraProfile;
  name: string;
  referenceImageUrls: ReferenceImageUrls;
  referencePhotoNames?: Record<string, string | null>;
  sourceCaptureVideoUrl: string | null;
  sourceCaptureVideoName?: string | null;
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
  editorDraft?: Record<string, unknown> | null;
}): Promise<{ profile: LumoraProfile; character: CharacterProfile }> {
  const client = getClient();
  const now = new Date().toISOString();
  const features = cleanJsonRecord(input.creatorSelfFeatures);
  const style = cleanJsonRecord(input.creatorSelfStylePreferences);
  const editorDraft = stripBase64Media(input.editorDraft) ?? null;
  const referenceImageUrls = cleanJsonRecord(cleanReferenceImageUrls(input.referenceImageUrls));
  const referencePhotoNames = cleanJsonRecord(input.referencePhotoNames);

  const { data: selfData, error: selfError } = await client
    .from('self_characters')
    .upsert(
      {
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
        },
        reference_image_urls: referenceImageUrls,
        reference_photo_names: referencePhotoNames,
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
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();

  if (selfError) throw selfError;

  console.log('SAVING SUPABASE SELF CHARACTER', {
    authUserId: input.userId,
    selfCharacterUserId: stringValue(selfData.user_id),
    avatarUrlExists: Boolean(jsonRecord(selfData.reference_image_urls).frontFace),
  });

  const nextProfile: LumoraProfile = {
    ...input.profile,
    defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
    defaultSelfCharacterName: input.name,
    defaultSelfCharacterAvatar:
      storageUrl(input.profile.avatar, 'Profile avatar') || stringValue(referenceImageUrls.frontFace),
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
  const payload = {
    id: project.id,
    user_id: userId,
    title: project.title || 'Untitled concept',
    caption: project.caption ?? project.prompt,
    prompt: project.prompt,
    final_prompt: project.finalPrompt ?? project.prompt,
    style_preset: project.engine ?? project.provider ?? 'replicate',
    status: project.status || 'completed',
    provider: project.provider,
    engine: project.engine ?? project.provider,
    display_engine: project.displayEngine ?? null,
    model: project.model ?? null,
    generation_mode: project.generationMode ?? null,
    output_type: 'video',
    video_url: storageUrl(project.videoUrl, 'Generated project video'),
    cover_asset_url: storageUrl(project.videoUrl, 'Generated project video'),
    reference_image_url: storageUrl(project.referenceImageUrl, 'Project reference image'),
    character_id: project.characterId,
    character_name: project.characterName,
    character_avatar: storageUrl(project.characterAvatar, 'Project character avatar'),
    is_default_self_character: Boolean(project.isDefaultSelfCharacter),
    creator_name: project.creatorName ?? null,
    creator_username: project.creatorUsername ?? null,
    creator_avatar: storageUrl(project.creatorAvatar, 'Project creator avatar'),
    aspect_ratio: project.aspectRatio ?? null,
    updated_at: project.updatedAt ?? new Date().toISOString(),
  };
  const removableProjectColumns = [
    'reference_image_url',
    'generation_mode',
    'display_engine',
    'model',
    'caption',
    'final_prompt',
    'engine',
    'aspect_ratio',
  ] as const;
  let payloadForUpsert: Partial<typeof payload> = payload;
  let result: { data: DbRow | null; error: unknown } = { data: null, error: null };

  for (let attempt = 0; attempt <= removableProjectColumns.length; attempt += 1) {
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

    const { [column]: _removedColumn, ...nextPayload } = payloadForUpsert;
    payloadForUpsert = nextPayload;
  }

  if (result.error) throw result.error;
  if (!result.data) throw new Error('Unable to save project.');
  return mapProjectRow(result.data);
}

function mapProjectRow(row: DbRow): StudioProject {
  return {
    id: stringValue(row.id),
    title: nullableString(row.title),
    caption: nullableString(row.caption),
    prompt: stringValue(row.prompt),
    finalPrompt: nullableString(row.final_prompt),
    videoUrl: stringValue(row.video_url) || stringValue(row.cover_asset_url),
    status: stringValue(row.status) || 'draft',
    provider: (row.provider ?? 'mock') as VideoEngine,
    engine: nullableString(row.engine) as VideoEngine | null,
    displayEngine: nullableString(row.display_engine),
    aspectRatio: nullableString(row.aspect_ratio),
    model: nullableString(row.model),
    generationMode: nullableString(row.generation_mode) as StudioProject['generationMode'],
    referenceImageUrl: nullableString(row.reference_image_url),
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
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPostRow);
}

export async function loadSupabasePublicPosts(): Promise<LumoraPost[]> {
  const client = getClient();
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('privacy', 'public')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map(mapPostRow);
}

export async function saveSupabasePost(userId: string, post: LumoraPost): Promise<LumoraPost> {
  const client = getClient();
  const payload = {
    user_id: userId,
    title: post.title || post.caption || 'Lumora post',
    caption: post.caption ?? null,
    prompt: post.prompt ?? null,
    image_url: storageUrl(post.imageUrl, 'Post image'),
    video_url: storageUrl(post.videoUrl, 'Post video'),
    source_generation_id: post.sourceGenerationId ?? null,
    privacy: post.privacy ?? 'private',
    character_id: post.characterId ?? null,
    character_name: post.characterName ?? null,
    character_avatar: storageUrl(post.characterAvatar, 'Post character avatar'),
    is_default_self_character: Boolean(post.isDefaultSelfCharacter),
    creator_name: post.creatorName ?? post.displayName ?? null,
    creator_username: post.creatorUsername ?? post.username ?? null,
    creator_avatar: storageUrl(post.creatorAvatar ?? post.avatar, 'Post creator avatar'),
    provider: post.provider ?? null,
    status: post.status ?? 'published',
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
        posted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.sourceGenerationId)
      .eq('user_id', userId);
  }

  return mapPostRow(data);
}

function mapPostRow(row: DbRow): LumoraPost {
  return {
    id: stringValue(row.id),
    userId: nullableString(row.user_id),
    title: nullableString(row.title),
    caption: nullableString(row.caption),
    prompt: nullableString(row.prompt),
    imageUrl: nullableString(row.image_url),
    videoUrl: nullableString(row.video_url),
    sourceGenerationId: nullableString(row.source_generation_id),
    createdAt: toIso(row.created_at),
    characterId: nullableString(row.character_id),
    characterName: nullableString(row.character_name),
    characterAvatar: nullableString(row.character_avatar),
    provider: nullableString(row.provider),
    status: nullableString(row.status),
    privacy: nullableString(row.privacy),
    displayName: nullableString(row.creator_name),
    username: nullableString(row.creator_username),
    avatar: nullableString(row.creator_avatar),
    creatorName: nullableString(row.creator_name),
    creatorUsername: nullableString(row.creator_username),
    creatorAvatar: nullableString(row.creator_avatar),
    isDefaultSelfCharacter: booleanValue(row.is_default_self_character),
  };
}
