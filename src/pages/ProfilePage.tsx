import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import AuthCard from '../components/auth/AuthCard';
import CharacterHub from '../components/CharacterHub';
import {
  CREATOR_SELF_CHARACTER_ID,
  cleanupCreatorSelfMetadata,
  getStoredCharacters,
  saveCreatorSelfCharacter,
} from '../lib/characterStorage';
import {
  loadCastInProjects,
  loadDrafts,
  loadLumoraProfile,
  loadProfilePosts,
  saveLumoraProfile,
  type LumoraProfile,
} from '../lib/profileStorage';
import type { CharacterProfile, CreatorSelfStylePreferences, LumoraIdentityProfile, LumoraPost } from '../lib/api';
import type { StudioProject } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import { useLumoraTheme, type LumoraTheme } from '../hooks/useLumoraTheme';
import { supabase } from '../lib/supabase';
import {
  hasSupabaseProfile,
  loadSupabaseCharacters,
  loadSupabaseDrafts,
  loadSupabaseProfile,
  loadSupabaseProfilePosts,
  loadSupabaseProjects,
  getProfileStats,
  saveSupabaseCreatorSelfCharacter,
  saveSupabaseProfile,
  uploadCharacterReferencePhoto,
  uploadLumoraMedia,
  type ProfileStats,
} from '../lib/supabaseAppData';
import {
  loadLocalProfileAvatarFile,
  loadLocalProfileAvatarUrl,
  saveLocalProfileAvatar,
} from '../lib/localAvatarStorage';
import {
  buildLumoraIdentityProfile,
  identityProfileToStylePreferences,
} from '../lib/identityCharacter';
import { getBestPoster, getBestThumbnail } from '../lib/mediaThumbnail';
import { resolveRenderableReferenceUrl } from '../lib/selfCharacterReference';
import SelfReferencePreview, { normalizeReference } from '../components/SelfReferencePreview';

type Draft = { id: string; title: string; prompt: string; createdAt: string };
type ProfileDebugInfo = {
  authUserId: string | null;
  loadedProfileId: string | null;
  profileAvatarUrlExists: boolean;
  selfCharacterLoaded: boolean;
  selfCharacterUserId: string | null;
  source: 'supabase' | 'local' | 'default';
};

type CreatorSelfFeatures = {
  hairColorStyle: string;
  eyeColor: string;
  skinTone: string;
  bodyBuild: string;
  signatureMakeup: string;
  distinctiveFeatures: string;
};

type SelfCharacterForm = {
  frontFace: string;
  frontFacePath: string;
  frontFaceName: string;
  leftAngle: string;
  leftAnglePath: string;
  leftAngleName: string;
  rightAngle: string;
  rightAnglePath: string;
  rightAngleName: string;
  fullBody: string;
  fullBodyPath: string;
  fullBodyName: string;
  manualReferenceImageUrl: string;
  selfieVideoName: string;
  selfieVideoUrl: string | null;
  selfieVideoPath: string;
  selfieVideo2Name: string;
  selfieVideo2Url: string | null;
  selfieVideo2Path: string;
  voiceSampleName: string;
  voiceSampleUrl: string | null;
  voiceSampleNumbers: string;
  voiceSampleConsent: boolean;
  selfCaptureNumbers: string;
  selfCaptureConsent: boolean;
  selfCaptureCompleted: boolean;
  features: CreatorSelfFeatures;
  style: Required<CreatorSelfStylePreferences>;
};

type SelfCharacterEditorDraft = SelfCharacterForm &
  Partial<CreatorSelfFeatures> &
  Partial<CreatorSelfStylePreferences> & {
  autosavedAt?: string;
  creatorSelfFeatures?: CreatorSelfFeatures;
  creatorSelfStylePreferences?: Required<CreatorSelfStylePreferences>;
};

type ReferencePhotoField = 'frontFace' | 'leftAngle' | 'rightAngle' | 'fullBody';
type ReferencePhotoNameField = 'frontFaceName' | 'leftAngleName' | 'rightAngleName' | 'fullBodyName';
type ReferencePhotoPathField = 'frontFacePath' | 'leftAnglePath' | 'rightAnglePath' | 'fullBodyPath';
type SelfCharacterFormSource = Partial<Omit<SelfCharacterForm, 'features' | 'style'>> & {
  features?: Partial<CreatorSelfFeatures>;
  style?: Partial<CreatorSelfStylePreferences>;
};

const SELF_VOICE_SAMPLE_SCRIPT =
  'Today I am creating my Lumora self character. My voice should sound natural, expressive, and accurate.';
const SELF_CHARACTER_EDITOR_DRAFT_KEY = 'lumora_self_character_editor_draft';

const referencePhotoNameFields: Record<ReferencePhotoField, ReferencePhotoNameField> = {
  frontFace: 'frontFaceName',
  leftAngle: 'leftAngleName',
  rightAngle: 'rightAngleName',
  fullBody: 'fullBodyName',
};

const referencePhotoPathFields: Record<ReferencePhotoField, ReferencePhotoPathField> = {
  frontFace: 'frontFacePath',
  leftAngle: 'leftAnglePath',
  rightAngle: 'rightAnglePath',
  fullBody: 'fullBodyPath',
};

function selfReferencePreviewSource(form: SelfCharacterForm, field: ReferencePhotoField): string {
  return form[field] || form[referencePhotoPathFields[field]];
}

function hasSelfReferenceSource(form: SelfCharacterForm, field: ReferencePhotoField): boolean {
  return Boolean(selfReferencePreviewSource(form, field));
}

function resolvedSelfReferenceSource(form: SelfCharacterForm, field: ReferencePhotoField): string | null {
  return (
    resolveRenderableReferenceUrl(form[field]) ??
    resolveRenderableReferenceUrl(form[referencePhotoPathFields[field]])
  );
}

function isManualReferenceUrlReady(value?: string | null): boolean {
  return Boolean(value?.trim().startsWith('https://'));
}

function selfReferencePreviewReference(form: SelfCharacterForm, field: ReferencePhotoField) {
  return normalizeReference(
    {
      url: form[field],
      path: form[referencePhotoPathFields[field]],
      fileName: form[referencePhotoNameFields[field]],
    },
    `${field}Url`,
    `${field}Path`,
  );
}

const emptyCreatorSelfFeatures: CreatorSelfFeatures = {
  hairColorStyle: '',
  eyeColor: '',
  skinTone: '',
  bodyBuild: '',
  signatureMakeup: '',
  distinctiveFeatures: '',
};

const emptyCreatorSelfStylePreferences: Required<CreatorSelfStylePreferences> = {
  everydayStyle: '',
  glamStyle: '',
  videoWardrobe: '',
  colorsToFavor: '',
  colorsToAvoid: '',
};

const creatorSelfFeatureFields: Array<{
  key: keyof CreatorSelfFeatures;
  label: string;
  placeholder: string;
}> = [
  { key: 'hairColorStyle', label: 'Hair color/style', placeholder: 'Dark brown waves, copper bob, shaved blonde fade' },
  { key: 'eyeColor', label: 'Eye color', placeholder: 'Brown, hazel, green' },
  { key: 'skinTone', label: 'Skin tone', placeholder: 'Warm medium, deep cool, fair neutral' },
  { key: 'bodyBuild', label: 'Body/build', placeholder: 'Petite, athletic, curvy, tall' },
  { key: 'signatureMakeup', label: 'Signature makeup', placeholder: 'Soft glam, winged liner, bare skin' },
  { key: 'distinctiveFeatures', label: 'Distinctive features', placeholder: 'Freckles, beauty mark, glasses, tattoos' },
];

const creatorSelfStyleFields: Array<{
  key: keyof CreatorSelfStylePreferences;
  label: string;
  placeholder: string;
  helper?: string;
}> = [
  {
    key: 'everydayStyle',
    label: 'Everyday style',
    placeholder: 'Optional - describe your typical on-camera outfits',
  },
  {
    key: 'glamStyle',
    label: 'Glam style',
    placeholder: 'Optional - describe your polished or editorial look',
  },
  {
    key: 'videoWardrobe',
    label: 'Preferred / Dream Wardrobe',
    placeholder: 'Silk dresses, tailored suits, oversized streetwear, vintage glam...',
    helper: 'Optional - describe the outfits you would love to wear or be known for in your content.',
  },
  {
    key: 'colorsToFavor',
    label: 'Colors to favor',
    placeholder: 'Optional - list colors that suit your on-camera style',
  },
  {
    key: 'colorsToAvoid',
    label: 'Colors/items to avoid',
    placeholder: 'Optional - list colors or items to avoid',
  },
];

function formatPostedDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function friendlyProfileLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('character_id')) {
    return 'Character Profiles need the latest database migration.';
  }

  if (lower.includes('status') || lower.includes('published_at') || lower.includes('thumbnail_url')) {
    return 'Drafts and Feed need the latest database migration.';
  }

  return error instanceof Error ? error.message : 'Unable to load Supabase profile data.';
}

function formatSelfVoiceSamplePrompt(numbers: string | null | undefined) {
  return `${numbers || '742 913 608'}. ${SELF_VOICE_SAMPLE_SCRIPT}`;
}

function generateSelfCaptureNumbers() {
  return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(' ');
}

function generateSelfVoiceSampleNumbers() {
  return Array.from({ length: 3 }, () => Math.floor(100 + Math.random() * 900)).join(' ');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unable to read media file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read media file.'));
    reader.readAsDataURL(file);
  });
}

function isTransientMediaUrl(value?: string | null): boolean {
  return Boolean(value && (value.startsWith('data:') || value.startsWith('blob:')));
}

async function hydrateLocalProfileAvatar(profile: LumoraProfile): Promise<LumoraProfile> {
  if (profile.avatar || !profile.avatarStorageKey) return profile;

  const avatar = await loadLocalProfileAvatarUrl(profile.avatarStorageKey);
  return avatar ? { ...profile, avatar } : profile;
}

function hasLocalProfileDetails(profile: LumoraProfile): boolean {
  return Boolean(
    profile.avatar ||
      profile.avatarStorageKey ||
      profile.bio.trim() ||
      (profile.displayName && profile.displayName !== 'Creator') ||
      (profile.username && profile.username !== 'lumora.creator') ||
      profile.defaultSelfCharacterId ||
      profile.selfReferenceImageUrls?.frontFace ||
      profile.selfReferenceImageUrls?.leftAngle ||
      profile.selfReferenceImageUrls?.rightAngle
  );
}

function hasLocalAccountRecoveryData(): boolean {
  if (typeof window === 'undefined') return false;

  const localProfile = loadLumoraProfile();
  const localCreatorSelf = findCreatorSelfCharacter(getStoredCharacters());
  return hasLocalProfileDetails(localProfile) || Boolean(localCreatorSelf);
}

function getLocalRecoveryAvailability(options: {
  supabaseProfileExists: boolean;
  loadedCreatorSelf: CharacterProfile | null;
}) {
  if (typeof window === 'undefined') {
    return {
      profile: false,
      selfCharacter: false,
    };
  }

  const localProfile = loadLumoraProfile();
  const localCreatorSelf = findCreatorSelfCharacter(getStoredCharacters());

  return {
    profile: hasLocalProfileDetails(localProfile) && !options.supabaseProfileExists,
    selfCharacter: Boolean(localCreatorSelf) && !options.loadedCreatorSelf,
  };
}

async function prepareLocalProfileForAccountSync(
  userId: string,
  localProfile: LumoraProfile,
): Promise<LumoraProfile> {
  let nextProfile = await hydrateLocalProfileAvatar(localProfile);

  if (isTransientMediaUrl(nextProfile.avatar) && nextProfile.avatarStorageKey) {
    const avatarFile = await loadLocalProfileAvatarFile(nextProfile.avatarStorageKey);
    if (avatarFile) {
      const uploadedAvatar = await uploadLumoraMedia({
        userId,
        bucket: 'avatars',
        file: avatarFile,
        folder: 'profile',
        usage: 'profile-avatar',
      });
      console.log('UPLOADED AVATAR URL', {
        authUserId: userId,
        avatarUrl: uploadedAvatar.url,
      });
      nextProfile = {
        ...nextProfile,
        avatar: uploadedAvatar.url,
        avatarStorageKey: null,
        avatarFileName: uploadedAvatar.fileName,
      };
    }
  }

  return {
    ...nextProfile,
    id: userId,
    userId,
    avatar: isTransientMediaUrl(nextProfile.avatar) ? undefined : nextProfile.avatar,
    avatarStorageKey: isTransientMediaUrl(nextProfile.avatar) ? null : nextProfile.avatarStorageKey ?? null,
    defaultSelfCharacterAvatar: isTransientMediaUrl(nextProfile.defaultSelfCharacterAvatar)
      ? null
      : nextProfile.defaultSelfCharacterAvatar ?? null,
    manualReferenceImageUrl: isTransientMediaUrl(nextProfile.manualReferenceImageUrl)
      ? null
      : nextProfile.manualReferenceImageUrl || nextProfile.selfReferenceImageUrls?.manualReferenceImageUrl || null,
    selfReferenceImageUrls: nextProfile.selfReferenceImageUrls
      ? {
          manualReferenceImageUrl: isTransientMediaUrl(nextProfile.selfReferenceImageUrls.manualReferenceImageUrl)
            ? null
            : nextProfile.selfReferenceImageUrls.manualReferenceImageUrl || nextProfile.manualReferenceImageUrl || null,
          frontFace: isTransientMediaUrl(nextProfile.selfReferenceImageUrls.frontFace)
            ? null
            : nextProfile.selfReferenceImageUrls.frontFace ?? null,
          leftAngle: isTransientMediaUrl(nextProfile.selfReferenceImageUrls.leftAngle)
            ? null
            : nextProfile.selfReferenceImageUrls.leftAngle ?? null,
          rightAngle: isTransientMediaUrl(nextProfile.selfReferenceImageUrls.rightAngle)
            ? null
            : nextProfile.selfReferenceImageUrls.rightAngle ?? null,
        }
      : null,
    selfCaptureVideoUrl: isTransientMediaUrl(nextProfile.selfCaptureVideoUrl)
      ? null
      : nextProfile.selfCaptureVideoUrl ?? null,
    selfVoiceSampleUrl: isTransientMediaUrl(nextProfile.selfVoiceSampleUrl)
      ? null
      : nextProfile.selfVoiceSampleUrl ?? null,
  };
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function readObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstString(...values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.length > 0) ?? '';
}

function firstNullableString(...values: Array<string | null | undefined>): string | null {
  return firstString(...values) || null;
}

function findCreatorSelfCharacter(characters: CharacterProfile[]): CharacterProfile | null {
  return characters.find(
    (character) => character.id === CREATOR_SELF_CHARACTER_ID || character.isCreatorSelf === true
  ) ?? null;
}

function pickStringFields<T extends string>(record: Record<string, string>, keys: readonly T[]): Partial<Record<T, string>> {
  return Object.fromEntries(
    keys
      .map((key) => [key, record[key]] as const)
      .filter((entry): entry is readonly [T, string] => typeof entry[1] === 'string')
  ) as Partial<Record<T, string>>;
}

function compactStringRecord<T extends Record<string, string | undefined>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, value?.trim() ?? ''])
      .filter(([, value]) => value)
  ) as Partial<T>;
}

function getCreatorSelfFormValues(character: CharacterProfile | null): {
  features: CreatorSelfFeatures;
  style: Required<CreatorSelfStylePreferences>;
} {
  const stylePreferences = character?.stylePreferences ?? {};
  const flatStylePreferences = readStringRecord(stylePreferences);
  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);
  const storedFeatures = {
    ...pickStringFields(flatStylePreferences, featureKeys),
    ...readStringRecord(stylePreferences.creatorSelfFeatures),
    ...readStringRecord(character?.creatorSelfFeatures),
  };
  const storedStyleRecord = {
    ...pickStringFields(flatStylePreferences, styleKeys),
    ...readStringRecord(stylePreferences.creatorSelfStylePreferences),
    ...readStringRecord(character?.creatorSelfStylePreferences),
  };
  const storedStyle = storedStyleRecord as Record<string, string>;
  const legacyColorsToAvoid = storedStyle.colorsToAvoid ?? storedStyle.colorsItemsToAvoid;

  return {
    features: { ...emptyCreatorSelfFeatures, ...storedFeatures },
    style: {
      ...emptyCreatorSelfStylePreferences,
      ...storedStyle,
      colorsToAvoid: legacyColorsToAvoid ?? '',
    },
  };
}

function parseSelfCharacterEditorDraft(value: unknown): SelfCharacterEditorDraft | null {
  const record = readObjectRecord(value);
  if (Object.keys(record).length === 0) return null;

  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);
  const flatRecord = readStringRecord(record);
  const featureRecord = {
    ...pickStringFields(flatRecord, featureKeys),
    ...readStringRecord(record.features),
    ...readStringRecord(record.creatorSelfFeatures),
  };
  const styleRecord = {
    ...pickStringFields(flatRecord, styleKeys),
    ...readStringRecord(record.style),
    ...readStringRecord(record.creatorSelfStylePreferences),
  } as Record<string, string>;
  const legacyColorsToAvoid = styleRecord.colorsToAvoid ?? styleRecord.colorsItemsToAvoid;
  const features = {
    ...emptyCreatorSelfFeatures,
    ...pickStringFields(featureRecord, featureKeys),
  };
  const style = {
    ...emptyCreatorSelfStylePreferences,
    ...pickStringFields(styleRecord, styleKeys),
    colorsToAvoid: legacyColorsToAvoid ?? '',
  };

  return {
    frontFace: readString(record.frontFace),
    frontFacePath: readString(record.frontFacePath),
    frontFaceName: readString(record.frontFaceName),
    leftAngle: readString(record.leftAngle),
    leftAnglePath: readString(record.leftAnglePath),
    leftAngleName: readString(record.leftAngleName),
    rightAngle: readString(record.rightAngle),
    rightAnglePath: readString(record.rightAnglePath),
    rightAngleName: readString(record.rightAngleName),
    fullBody: readString(record.fullBody),
    fullBodyPath: readString(record.fullBodyPath),
    fullBodyName: readString(record.fullBodyName),
    manualReferenceImageUrl: readString(record.manualReferenceImageUrl),
    selfieVideoName: readString(record.selfieVideoName),
    selfieVideoUrl: firstNullableString(readString(record.selfieVideoUrl)),
    selfieVideoPath: readString(record.selfieVideoPath),
    selfieVideo2Name: readString(record.selfieVideo2Name),
    selfieVideo2Url: firstNullableString(readString(record.selfieVideo2Url)),
    selfieVideo2Path: readString(record.selfieVideo2Path),
    voiceSampleName: readString(record.voiceSampleName),
    voiceSampleUrl: firstNullableString(readString(record.voiceSampleUrl)),
    voiceSampleNumbers: readString(record.voiceSampleNumbers),
    voiceSampleConsent: record.voiceSampleConsent === true,
    selfCaptureNumbers: readString(record.selfCaptureNumbers),
    selfCaptureConsent: record.selfCaptureConsent === true,
    selfCaptureCompleted: record.selfCaptureCompleted === true,
    features,
    style,
    creatorSelfFeatures: features,
    creatorSelfStylePreferences: style,
    ...features,
    ...style,
    autosavedAt: readString(record.autosavedAt) || undefined,
  };
}

function loadSelfCharacterEditorDraft(): SelfCharacterEditorDraft | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(SELF_CHARACTER_EDITOR_DRAFT_KEY);
    if (!raw) return null;
    return parseSelfCharacterEditorDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function createSelfCharacterEditorDraft(form: SelfCharacterForm): SelfCharacterEditorDraft {
  const features = { ...emptyCreatorSelfFeatures, ...form.features };
  const style = { ...emptyCreatorSelfStylePreferences, ...form.style };

  return {
    frontFace: form.frontFace,
    frontFacePath: form.frontFacePath,
    frontFaceName: form.frontFaceName,
    leftAngle: form.leftAngle,
    leftAnglePath: form.leftAnglePath,
    leftAngleName: form.leftAngleName,
    rightAngle: form.rightAngle,
    rightAnglePath: form.rightAnglePath,
    rightAngleName: form.rightAngleName,
    fullBody: form.fullBody,
    fullBodyPath: form.fullBodyPath,
    fullBodyName: form.fullBodyName,
    manualReferenceImageUrl: form.manualReferenceImageUrl,
    selfieVideoName: form.selfieVideoName,
    selfieVideoUrl: form.selfieVideoUrl,
    selfieVideoPath: form.selfieVideoPath,
    selfieVideo2Name: form.selfieVideo2Name,
    selfieVideo2Url: form.selfieVideo2Url,
    selfieVideo2Path: form.selfieVideo2Path,
    voiceSampleName: form.voiceSampleName,
    voiceSampleUrl: form.voiceSampleUrl,
    voiceSampleNumbers: form.voiceSampleNumbers,
    voiceSampleConsent: form.voiceSampleConsent,
    selfCaptureNumbers: form.selfCaptureNumbers,
    selfCaptureConsent: form.selfCaptureConsent,
    selfCaptureCompleted: form.selfCaptureCompleted,
    features,
    style,
    creatorSelfFeatures: features,
    creatorSelfStylePreferences: style,
    ...features,
    ...style,
    autosavedAt: new Date().toISOString(),
  };
}

/**
 * Clean media URLs from draft values before storing.
 * Removes transient data/blob URLs to avoid localStorage quota issues.
 */
function cleanMediaFromDraft(draft: SelfCharacterEditorDraft): SelfCharacterEditorDraft {
  const cleanMediaUrl = (value?: string | null): string | null => {
    if (!value) return null;
    if (typeof value !== 'string') return null;
    if (value.startsWith('data:') || value.startsWith('blob:')) {
      return null;
    }
    return value;
  };

  return {
    ...draft,
    frontFace: cleanMediaUrl(draft.frontFace) || '',
    leftAngle: cleanMediaUrl(draft.leftAngle) || '',
    rightAngle: cleanMediaUrl(draft.rightAngle) || '',
    fullBody: cleanMediaUrl(draft.fullBody) || '',
    manualReferenceImageUrl: cleanMediaUrl(draft.manualReferenceImageUrl) || '',
    selfieVideoUrl: cleanMediaUrl(draft.selfieVideoUrl),
    selfieVideoPath: cleanMediaUrl(draft.selfieVideoPath) || '',
    selfieVideo2Url: cleanMediaUrl(draft.selfieVideo2Url),
    selfieVideo2Path: cleanMediaUrl(draft.selfieVideo2Path) || '',
    voiceSampleUrl: cleanMediaUrl(draft.voiceSampleUrl),
  };
}

function saveSelfCharacterEditorDraft(form: SelfCharacterForm): SelfCharacterEditorDraft | null {
  if (typeof window === 'undefined') return null;

  const draft = createSelfCharacterEditorDraft(form);
  const cleanedDraft = cleanMediaFromDraft(draft);

  try {
    localStorage.setItem(SELF_CHARACTER_EDITOR_DRAFT_KEY, JSON.stringify(cleanedDraft));
    return cleanedDraft;
  } catch (error) {
    console.error('FAILED TO AUTOSAVE DRAFT:', error);
    return null;
  }
}

function getCharacterEditorDraft(character: CharacterProfile | null): SelfCharacterEditorDraft | null {
  return parseSelfCharacterEditorDraft(readObjectRecord(character?.stylePreferences).creatorSelfEditorDraft);
}

function getProfileEditorDraft(profile: LumoraProfile): SelfCharacterEditorDraft | null {
  return parseSelfCharacterEditorDraft(readObjectRecord(profile).selfCharacterEditorDraft);
}

function buildCreatorSelfCharacterSource(character: CharacterProfile | null): SelfCharacterFormSource {
  if (!character) return {};

  const editorDraft = getCharacterEditorDraft(character);
  const formValues = getCreatorSelfFormValues(character);
  const stylePreferences = readObjectRecord(character.stylePreferences);
  const referencePhotoNames = readObjectRecord(character.referencePhotoNames);
  const compactFeatures = compactStringRecord(formValues.features);
  const compactStyle = compactStringRecord(formValues.style);

  return {
    ...editorDraft,
    frontFace: firstString(character.referenceImageUrls.frontFaceUrl, character.referenceImageUrls.frontFace, editorDraft?.frontFace),
    frontFacePath: firstString(character.referenceImageUrls.frontFacePath, editorDraft?.frontFacePath),
    frontFaceName: firstString(readString(referencePhotoNames.frontFace), editorDraft?.frontFaceName, character.referenceImageUrls.frontFace ? 'Saved front photo' : ''),
    leftAngle: firstString(character.referenceImageUrls.leftAngleUrl, character.referenceImageUrls.leftAngle, editorDraft?.leftAngle),
    leftAnglePath: firstString(character.referenceImageUrls.leftAnglePath, editorDraft?.leftAnglePath),
    leftAngleName: firstString(readString(referencePhotoNames.leftAngle), editorDraft?.leftAngleName, character.referenceImageUrls.leftAngle ? 'Saved left angle photo' : ''),
    rightAngle: firstString(character.referenceImageUrls.rightAngleUrl, character.referenceImageUrls.rightAngle, editorDraft?.rightAngle),
    rightAnglePath: firstString(character.referenceImageUrls.rightAnglePath, editorDraft?.rightAnglePath),
    rightAngleName: firstString(readString(referencePhotoNames.rightAngle), editorDraft?.rightAngleName, character.referenceImageUrls.rightAngle ? 'Saved right angle photo' : ''),
    fullBody: firstString(character.referenceImageUrls.fullBodyUrl, character.referenceImageUrls.fullBody, editorDraft?.fullBody),
    fullBodyPath: firstString(character.referenceImageUrls.fullBodyPath, editorDraft?.fullBodyPath),
    fullBodyName: firstString(readString(referencePhotoNames.fullBody), editorDraft?.fullBodyName, character.referenceImageUrls.fullBody ? 'Saved full body photo' : ''),
    manualReferenceImageUrl: firstString(
      character.referenceImageUrls.manualReferenceImageUrl,
      readString(stylePreferences.manualReferenceImageUrl),
      editorDraft?.manualReferenceImageUrl,
    ),
    selfieVideoName: firstString(editorDraft?.selfieVideoName, character.sourceCaptureVideoUrl ? 'Saved selfie video' : ''),
    selfieVideoUrl: firstNullableString(character.sourceCaptureVideoUrl, editorDraft?.selfieVideoUrl),
    selfieVideoPath: firstString(character.sourceCaptureVideoPath, readString(stylePreferences.selfieVideoPath), editorDraft?.selfieVideoPath),
    selfieVideo2Name: firstString(character.sourceCaptureVideo2Name, readString(stylePreferences.selfieVideo2Name), editorDraft?.selfieVideo2Name),
    selfieVideo2Url: firstNullableString(character.sourceCaptureVideo2Url, readString(stylePreferences.selfieVideo2Url), editorDraft?.selfieVideo2Url),
    selfieVideo2Path: firstString(character.sourceCaptureVideo2Path, readString(stylePreferences.selfieVideo2Path), editorDraft?.selfieVideo2Path),
    voiceSampleName: firstString(
      character.voiceSampleName,
      editorDraft?.voiceSampleName,
      character.voiceSampleUrl ? 'Saved voice sample' : '',
    ),
    voiceSampleUrl: firstNullableString(character.voiceSampleUrl, editorDraft?.voiceSampleUrl),
    voiceSampleNumbers: firstString(character.voiceSampleNumbers, editorDraft?.voiceSampleNumbers),
    voiceSampleConsent: stylePreferences.selfVoiceSampleConsent === true || editorDraft?.voiceSampleConsent === true,
    selfCaptureNumbers: editorDraft?.selfCaptureNumbers,
    selfCaptureConsent: editorDraft?.selfCaptureConsent,
    selfCaptureCompleted: editorDraft?.selfCaptureCompleted,
    features: {
      ...(editorDraft?.features ?? {}),
      ...compactFeatures,
    },
    style: {
      ...(editorDraft?.style ?? {}),
      ...compactStyle,
    },
  };
}

function buildProfileSelfCharacterSource(profile: LumoraProfile): SelfCharacterFormSource {
  const profileRecord = readObjectRecord(profile);
  const editorDraft = getProfileEditorDraft(profile);
  const referenceImageUrls = readObjectRecord(profileRecord.selfReferenceImageUrls);
  const referencePhotoNames = readObjectRecord(profileRecord.selfReferencePhotoNames);
  const profileFeatures = compactStringRecord({
    ...readStringRecord(profileRecord.creatorSelfFeatures),
    ...readStringRecord(profileRecord.selfCharacterFeatures),
  });
  const profileStyleRecord = {
    ...readStringRecord(profileRecord.creatorSelfStylePreferences),
    ...readStringRecord(profileRecord.selfCharacterStylePreferences),
  };
  const profileStyle = compactStringRecord({
    ...pickStringFields(profileStyleRecord, creatorSelfStyleFields.map((field) => field.key)),
    colorsToAvoid: profileStyleRecord.colorsToAvoid ?? profileStyleRecord.colorsItemsToAvoid,
  });

  return {
    ...editorDraft,
    frontFace: firstString(readString(referenceImageUrls.frontFaceUrl), readString(referenceImageUrls.frontFace), profile.defaultSelfCharacterAvatar, profile.avatar, editorDraft?.frontFace),
    frontFacePath: firstString(readString(referenceImageUrls.frontFacePath), editorDraft?.frontFacePath),
    frontFaceName: firstString(readString(referencePhotoNames.frontFace), editorDraft?.frontFaceName),
    leftAngle: firstString(readString(referenceImageUrls.leftAngleUrl), readString(referenceImageUrls.leftAngle), editorDraft?.leftAngle),
    leftAnglePath: firstString(readString(referenceImageUrls.leftAnglePath), editorDraft?.leftAnglePath),
    leftAngleName: firstString(readString(referencePhotoNames.leftAngle), editorDraft?.leftAngleName),
    rightAngle: firstString(readString(referenceImageUrls.rightAngleUrl), readString(referenceImageUrls.rightAngle), editorDraft?.rightAngle),
    rightAnglePath: firstString(readString(referenceImageUrls.rightAnglePath), editorDraft?.rightAnglePath),
    rightAngleName: firstString(readString(referencePhotoNames.rightAngle), editorDraft?.rightAngleName),
    fullBody: firstString(readString(referenceImageUrls.fullBodyUrl), readString(referenceImageUrls.fullBody), editorDraft?.fullBody),
    fullBodyPath: firstString(readString(referenceImageUrls.fullBodyPath), editorDraft?.fullBodyPath),
    fullBodyName: firstString(readString(referencePhotoNames.fullBody), editorDraft?.fullBodyName),
    manualReferenceImageUrl: firstString(
      profile.manualReferenceImageUrl,
      readString(referenceImageUrls.manualReferenceImageUrl),
      editorDraft?.manualReferenceImageUrl,
    ),
    selfieVideoName: firstString(profile.selfCaptureVideoName, editorDraft?.selfieVideoName),
    selfieVideoUrl: firstNullableString(profile.selfCaptureVideoUrl, editorDraft?.selfieVideoUrl),
    selfieVideoPath: firstString(editorDraft?.selfieVideoPath),
    selfieVideo2Name: firstString(readString(readObjectRecord(profileRecord.selfCharacterEditorDraft)?.selfieVideo2Name), editorDraft?.selfieVideo2Name),
    selfieVideo2Url: firstNullableString(readString(readObjectRecord(profileRecord.selfCharacterEditorDraft)?.selfieVideo2Url), editorDraft?.selfieVideo2Url),
    selfieVideo2Path: firstString(readString(readObjectRecord(profileRecord.selfCharacterEditorDraft)?.selfieVideo2Path), editorDraft?.selfieVideo2Path),
    voiceSampleName: firstString(profile.selfVoiceSampleName, editorDraft?.voiceSampleName),
    voiceSampleUrl: firstNullableString(profile.selfVoiceSampleUrl, editorDraft?.voiceSampleUrl),
    voiceSampleNumbers: firstString(profile.selfVoiceSampleNumbers, editorDraft?.voiceSampleNumbers),
    voiceSampleConsent: Boolean(profile.selfVoiceSampleConsent) || editorDraft?.voiceSampleConsent === true,
    selfCaptureNumbers: firstString(profile.selfCaptureNumbers, editorDraft?.selfCaptureNumbers),
    selfCaptureConsent: Boolean(profile.selfCaptureConsent) || editorDraft?.selfCaptureConsent === true,
    selfCaptureCompleted: Boolean(profile.selfCaptureCompleted) || editorDraft?.selfCaptureCompleted === true,
    features: {
      ...(editorDraft?.features ?? {}),
      ...profileFeatures,
    },
    style: {
      ...(editorDraft?.style ?? {}),
      ...profileStyle,
    },
  };
}

function mergeSelfCharacterFormSources(...sources: SelfCharacterFormSource[]): SelfCharacterForm {
  const defaults = buildBlankSelfCharacterForm();
  const featureKeys = creatorSelfFeatureFields.map((field) => field.key);
  const styleKeys = creatorSelfStyleFields.map((field) => field.key);

  const findStringField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    firstString(...sources.map((source) => readString(source[field])));
  const findNullableStringField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    firstNullableString(...sources.map((source) => readString(source[field])));
  const findBooleanField = (field: keyof Omit<SelfCharacterForm, 'features' | 'style'>) =>
    sources.some((source) => source[field] === true);

  return {
    frontFace: findStringField('frontFace'),
    frontFacePath: findStringField('frontFacePath'),
    frontFaceName: findStringField('frontFaceName'),
    leftAngle: findStringField('leftAngle'),
    leftAnglePath: findStringField('leftAnglePath'),
    leftAngleName: findStringField('leftAngleName'),
    rightAngle: findStringField('rightAngle'),
    rightAnglePath: findStringField('rightAnglePath'),
    rightAngleName: findStringField('rightAngleName'),
    fullBody: findStringField('fullBody'),
    fullBodyPath: findStringField('fullBodyPath'),
    fullBodyName: findStringField('fullBodyName'),
    manualReferenceImageUrl: findStringField('manualReferenceImageUrl'),
    selfieVideoName: findStringField('selfieVideoName'),
    selfieVideoUrl: findNullableStringField('selfieVideoUrl'),
    selfieVideoPath: findStringField('selfieVideoPath'),
    selfieVideo2Name: findStringField('selfieVideo2Name'),
    selfieVideo2Url: findNullableStringField('selfieVideo2Url'),
    selfieVideo2Path: findStringField('selfieVideo2Path'),
    voiceSampleName: findStringField('voiceSampleName'),
    voiceSampleUrl: findNullableStringField('voiceSampleUrl'),
    voiceSampleNumbers: findStringField('voiceSampleNumbers') || defaults.voiceSampleNumbers,
    voiceSampleConsent: findBooleanField('voiceSampleConsent'),
    selfCaptureNumbers: findStringField('selfCaptureNumbers') || defaults.selfCaptureNumbers,
    selfCaptureConsent: findBooleanField('selfCaptureConsent'),
    selfCaptureCompleted: findBooleanField('selfCaptureCompleted'),
    features: {
      ...emptyCreatorSelfFeatures,
      ...Object.fromEntries(
        featureKeys.map((key) => [key, firstString(...sources.map((source) => source.features?.[key]))])
      ),
    },
    style: {
      ...emptyCreatorSelfStylePreferences,
      ...Object.fromEntries(
        styleKeys.map((key) => [key, firstString(...sources.map((source) => source.style?.[key]))])
      ),
    },
  };
}

function buildSelfCharacterEditorState(
  profile: LumoraProfile,
  character: CharacterProfile | null,
  localDraft: SelfCharacterEditorDraft | null,
): SelfCharacterForm {
  const characterSource = buildCreatorSelfCharacterSource(character);
  const profileSource = buildProfileSelfCharacterSource(profile);
  const localDraftSource = localDraft ?? {};

  return mergeSelfCharacterFormSources(characterSource, profileSource, localDraftSource);
}

function buildSelfCharacterForm(profile: LumoraProfile, character: CharacterProfile | null): SelfCharacterForm {
  return buildSelfCharacterEditorState(profile, character, null);
}

function buildBlankSelfCharacterForm(): SelfCharacterForm {
  return {
    frontFace: '',
    frontFacePath: '',
    frontFaceName: '',
    leftAngle: '',
    leftAnglePath: '',
    leftAngleName: '',
    rightAngle: '',
    rightAnglePath: '',
    rightAngleName: '',
    fullBody: '',
    fullBodyPath: '',
    fullBodyName: '',
    manualReferenceImageUrl: '',
    selfieVideoName: '',
    selfieVideoUrl: null,
    selfieVideoPath: '',
    selfieVideo2Name: '',
    selfieVideo2Url: null,
    selfieVideo2Path: '',
    voiceSampleName: '',
    voiceSampleUrl: null,
    voiceSampleNumbers: generateSelfVoiceSampleNumbers(),
    voiceSampleConsent: false,
    selfCaptureNumbers: generateSelfCaptureNumbers(),
    selfCaptureConsent: false,
    selfCaptureCompleted: false,
    features: { ...emptyCreatorSelfFeatures },
    style: { ...emptyCreatorSelfStylePreferences },
  };
}

function buildSelfFormAppearanceSummary(form: SelfCharacterForm): string {
  return [
    form.features.hairColorStyle ? `Hair: ${form.features.hairColorStyle}.` : '',
    form.features.eyeColor ? `Eyes: ${form.features.eyeColor}.` : '',
    form.features.skinTone ? `Skin tone: ${form.features.skinTone}.` : '',
    form.features.bodyBuild ? `Body/build: ${form.features.bodyBuild}.` : '',
    form.features.signatureMakeup ? `Signature makeup: ${form.features.signatureMakeup}.` : '',
    form.features.distinctiveFeatures ? `Distinctive features: ${form.features.distinctiveFeatures}.` : '',
    form.style.everydayStyle ? `Everyday style: ${form.style.everydayStyle}.` : '',
    form.style.glamStyle ? `Glam style: ${form.style.glamStyle}.` : '',
    form.style.videoWardrobe ? `Wardrobe preference: ${form.style.videoWardrobe}.` : '',
    form.style.colorsToFavor ? `Colors to favor: ${form.style.colorsToFavor}.` : '',
    form.style.colorsToAvoid ? `Avoid: ${form.style.colorsToAvoid}.` : '',
  ].filter(Boolean).join(' ');
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="list-stack" style={{ marginTop: '22px' }}>
      <div className="headline-card compact" style={{ padding: '22px', borderRadius: '30px' }}>
        <span className="eyebrow">{title}</span>
      </div>
      {children}
    </section>
  );
}

function ProfileTextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="field-group">
      <span className="eyebrow">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ImagePreview({
  src,
  fallback,
  errorMessage,
}: {
  src?: string | null;
  fallback: string;
  errorMessage?: string;
}) {
  const resolvedUrl = resolveRenderableReferenceUrl(src);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={fallback}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onLoad={() => console.log('LOADED PREVIEW:', resolvedUrl)}
          onError={() => {
            console.error('FAILED PREVIEW:', resolvedUrl);
            console.error('FAILED PREVIEW URL:', resolvedUrl);
          }}
        />
      ) : (
        <span style={{ color: 'var(--soft-text)', fontSize: '1rem', padding: '8px', textAlign: 'center', zIndex: 0 }}>
          {fallback}
        </span>
      )}
    </div>
  );
}

function ProfilePostTile({
  post,
  onSelect,
}: {
  post: LumoraPost;
  onSelect: (post: LumoraPost) => void;
}) {
  const title = post.title || post.caption || 'Untitled post';
  const bodyText = post.caption || post.prompt || 'No prompt available';
  const thumbnailUrl = getBestThumbnail(post);
  const mediaUrl = thumbnailUrl || post.imageUrl;
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const characterLabel = post.isDefaultSelfCharacter
    ? 'Created as self'
    : post.characterName
      ? `Featuring ${post.characterName}`
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(post)}
      title={title}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 5',
        overflow: 'hidden',
        padding: 0,
        borderRadius: '16px',
        color: '#fff',
        textAlign: 'left',
        background: 'var(--card-media-background)',
        border: '1px solid var(--surface-border)',
      }}
    >
      {mediaUrl ? (
        <img
          src={mediaUrl}
          alt={title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            padding: '12px',
            background:
              'var(--card-media-background)',
          }}
        >
          <span style={{ color: 'var(--soft-text)', fontWeight: 700 }}>Lumora</span>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, transparent 40%, rgba(5,4,11,0.84) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '10px',
          right: '10px',
          bottom: '10px',
          display: 'grid',
          gap: '5px',
        }}
      >
        {characterLabel ? (
          <span className="tiny-pill" style={{ width: 'fit-content', background: 'rgba(63,47,95,0.82)' }}>
            {characterLabel}
          </span>
        ) : null}
        <strong
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '0.88rem',
          }}
        >
          {bodyText}
        </strong>
        <span style={{ color: '#d3cdf3', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {authorName}
        </span>
      </div>
    </button>
  );
}

function ProfilePostPreviewModal({
  post,
  fallbackAvatar,
  onClose,
}: {
  post: LumoraPost;
  fallbackAvatar?: string | null;
  onClose: () => void;
}) {
  const title = post.title || post.caption || 'Untitled post';
  const bodyText = post.caption || post.prompt || 'No prompt available';
  const thumbnailUrl = getBestThumbnail(post);
  const posterUrl = getBestPoster(post);
  const mediaUrl = thumbnailUrl || post.imageUrl;
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAvatar;
  const characterLabel = post.isDefaultSelfCharacter
    ? 'Created as self'
    : post.characterName
      ? `Featuring ${post.characterName}`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
        background: 'var(--modal-backdrop)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(900px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          borderRadius: '24px',
          background: 'var(--modal-surface)',
          boxShadow: 'var(--modal-shadow)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="row-between" style={{ padding: '16px', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                overflow: 'hidden',
                background: 'var(--control-background)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
              }}
            >
              <ImagePreview src={authorAvatar} fallback="U" />
            </div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{authorName}</strong>
              <span className="muted">@{authorUsername}</span>
            </div>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {post.videoUrl ? (
          <video
            src={post.videoUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            poster={posterUrl ?? undefined}
            style={{ width: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block', background: '#000' }}
          />
        ) : mediaUrl ? (
          <img src={mediaUrl} alt={title} style={{ width: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div
            style={{
              minHeight: '340px',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--card-media-background)',
            }}
          >
            <strong>Preview unavailable</strong>
          </div>
        )}

        <div style={{ padding: '18px', display: 'grid', gap: '10px' }}>
          <div className="row-between" style={{ gap: '10px', alignItems: 'flex-start' }}>
            <h3>{title}</h3>
            {characterLabel ? (
              <span className="tiny-pill" style={{ background: 'var(--pill-background)' }}>
                {characterLabel}
              </span>
            ) : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>{bodyText}</p>
          <p className="muted" style={{ margin: 0, fontSize: '0.95rem' }}>
            Posted {formatPostedDate(post.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

type ProfileMenuPanelId =
  | 'account'
  | 'about'
  | 'contact'
  | 'help'
  | 'privacy'
  | 'settings'
  | 'terms';

type ProfileMenuItem = {
  id: ProfileMenuPanelId;
  label: string;
  title: string;
};

const profileMenuItems: ProfileMenuItem[] = [
  { id: 'settings', label: 'Settings', title: 'Settings' },
  { id: 'account', label: 'Account', title: 'Account' },
  { id: 'about', label: 'About Lumora', title: 'About Lumora' },
  { id: 'help', label: 'Help', title: 'Help' },
  { id: 'contact', label: 'Contact', title: 'Contact' },
  { id: 'privacy', label: 'Privacy', title: 'Privacy' },
  { id: 'terms', label: 'Terms', title: 'Terms' },
];

function shortenUserId(userId: string | null): string {
  if (!userId) return '';
  return userId.length > 12 ? `${userId.slice(0, 8)}...${userId.slice(-4)}` : userId;
}

function MenuSectionCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: 'grid',
        gap: '10px',
        padding: '14px',
        borderRadius: '20px',
        background: 'var(--panel-background)',
        border: '1px solid var(--panel-border)',
      }}
    >
      {title ? <strong>{title}</strong> : null}
      {children}
    </section>
  );
}

function ComingSoonPill() {
  return (
    <span className="tiny-pill" style={{ width: 'fit-content', background: 'var(--pill-background)' }}>
      Coming soon
    </span>
  );
}

function ProfileMenuDetail({
  item,
  signedIn,
  authUserId,
  userEmail,
  onBack,
  onSignOut,
  onJumpToAuth,
}: {
  item: ProfileMenuItem;
  signedIn: boolean;
  authUserId: string | null;
  userEmail?: string | null;
  onBack: () => void;
  onSignOut: () => void;
  onJumpToAuth: () => void;
}) {
  const { theme, setTheme } = useLumoraTheme();
  const mutedTextStyle = { margin: 0, color: 'var(--muted-text)', lineHeight: 1.45 };
  const appearanceOptions: Array<{ value: LumoraTheme; label: string }> = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];

  return (
    <div style={{ display: 'grid', gap: '14px', alignContent: 'start' }}>
      <button
        type="button"
        className="text-btn"
        onClick={onBack}
        style={{ width: 'fit-content', paddingLeft: 0 }}
      >
        Menu
      </button>

      <div>
        <span className="eyebrow">profile menu</span>
        <h2 style={{ margin: '6px 0 0' }}>{item.title}</h2>
      </div>

      {item.id === 'account' ? (
        <MenuSectionCard>
          {signedIn ? (
            <>
              <span className="eyebrow">signed in</span>
              <strong>Signed in as {userEmail || 'Lumora account'}</strong>
              <p style={mutedTextStyle}>User ID {shortenUserId(authUserId)}</p>
              <button
                type="button"
                className="ghost-btn"
                onClick={onSignOut}
                style={{ flex: 'unset', width: '100%', cursor: 'pointer', borderRadius: '18px' }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">not signed in</span>
              <p style={mutedTextStyle}>
                Sign in to save profile, self character, posts, and drafts to your Lumora account.
              </p>
              <button
                type="button"
                className="primary-btn"
                onClick={onJumpToAuth}
                style={{ flex: 'unset', width: '100%', cursor: 'pointer', borderRadius: '18px' }}
              >
                Go to creator access
              </button>
            </>
          )}
        </MenuSectionCard>
      ) : null}

      {item.id === 'settings' ? (
        <div style={{ display: 'grid', gap: '10px' }}>
          <MenuSectionCard title="Appearance">
            <p style={mutedTextStyle}>Choose Lumora's interface palette.</p>
            <div className="chip-row wrap" role="group" aria-label="Appearance">
              {appearanceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  className={`chip ${theme === option.value ? 'active' : ''}`}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </MenuSectionCard>
          {[
            'Workspace preferences',
            'Creator profile',
            'Notifications',
            'Privacy controls',
          ].map((setting) => (
            <MenuSectionCard key={setting}>
              <div className="row-between" style={{ gap: '10px' }}>
                <strong>{setting}</strong>
                <ComingSoonPill />
              </div>
              <p style={mutedTextStyle}>
                Configure {setting.toLowerCase()} as Lumora grows your creator workspace.
              </p>
            </MenuSectionCard>
          ))}
        </div>
      ) : null}

      {item.id === 'about' ? (
        <MenuSectionCard title="Lumora">
          <p style={mutedTextStyle}>
            Lumora is a creator workspace for character-led short video concepts, self-character creation, and social publishing.
          </p>
        </MenuSectionCard>
      ) : null}

      {item.id === 'help' ? (
        <MenuSectionCard title="Quick steps">
          {[
            'Create or sync your self character',
            'Generate a concept',
            'Edit caption and privacy',
            'Post from Drafts',
          ].map((step) => (
            <p key={step} style={mutedTextStyle}>
              {step}
            </p>
          ))}
        </MenuSectionCard>
      ) : null}

      {item.id === 'contact' ? (
        <MenuSectionCard title="Support">
          <p style={mutedTextStyle}>support@lumora.app</p>
          <p style={mutedTextStyle}>Contact tools are coming soon.</p>
        </MenuSectionCard>
      ) : null}

      {item.id === 'privacy' ? (
        <MenuSectionCard title="Privacy basics">
          {[
            'Private drafts stay private',
            'Public posts appear in feed',
            'Self character media is account-owned',
            'Users control what they publish',
          ].map((line) => (
            <p key={line} style={mutedTextStyle}>
              {line}
            </p>
          ))}
        </MenuSectionCard>
      ) : null}

      {item.id === 'terms' ? (
        <MenuSectionCard title="Terms preview">
          {[
            'Use Lumora responsibly',
            'Only upload media you have permission to use',
            'Do not impersonate people without consent',
            'Final legal terms coming soon',
          ].map((line) => (
            <p key={line} style={mutedTextStyle}>
              {line}
            </p>
          ))}
        </MenuSectionCard>
      ) : null}
    </div>
  );
}

function ProfileMenuSidebar({
  open,
  signedIn,
  authUserId,
  userEmail,
  activeItem,
  onBack,
  onClose,
  onSelect,
  onSignOut,
  onJumpToAuth,
}: {
  open: boolean;
  signedIn: boolean;
  authUserId: string | null;
  userEmail?: string | null;
  activeItem: ProfileMenuItem | null;
  onBack: () => void;
  onClose: () => void;
  onSelect: (item: ProfileMenuItem) => void;
  onSignOut: () => void;
  onJumpToAuth: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'var(--modal-backdrop)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(86vw, 320px)',
          height: '100%',
          padding: '18px',
          background: 'var(--modal-surface)',
          borderLeft: '1px solid var(--surface-border)',
          boxShadow: 'var(--modal-shadow)',
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          gap: '18px',
          overflowY: 'auto',
        }}
      >
        <div className="row-between" style={{ gap: '10px' }}>
          <div>
            <span className="eyebrow">{activeItem ? 'section' : 'menu'}</span>
            <h2 style={{ margin: '6px 0 0' }}>{activeItem?.title ?? 'Lumora'}</h2>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {activeItem ? (
          <ProfileMenuDetail
            item={activeItem}
            signedIn={signedIn}
            authUserId={authUserId}
            userEmail={userEmail}
            onBack={onBack}
            onSignOut={onSignOut}
            onJumpToAuth={onJumpToAuth}
          />
        ) : (
          <nav style={{ display: 'grid', gap: '10px', alignContent: 'start' }}>
            {profileMenuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ghost-btn"
                onClick={() => onSelect(item)}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  borderRadius: '18px',
                  flex: 'unset',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                {item.label}
              </button>
            ))}
            {signedIn ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={onSignOut}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  borderRadius: '18px',
                  flex: 'unset',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                Sign out
              </button>
            ) : null}
          </nav>
        )}
      </aside>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: StudioProject; onOpen: () => void }) {
  const thumbnailUrl = getBestThumbnail(project);
  const posterUrl = getBestPoster(project);
  const characterLabel = project.isDefaultSelfCharacter
    ? 'Created as self'
    : project.characterName
      ? `Character: ${project.characterName}`
      : 'No character selected';

  return (
    <article
      className="list-card"
      role="button"
      tabIndex={0}
      aria-label={`Open completed project ${project.title || project.prompt || project.id}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      style={{ borderRadius: '28px', background: 'var(--surface-strong)', padding: '18px', cursor: 'pointer' }}
    >
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{project.prompt || 'Cast Video'}</h3>
          <p className="muted" style={{ marginTop: '10px' }}>
            {characterLabel} - {(project.displayEngine || project.provider).toUpperCase()}
          </p>
        </div>
        <span className="tiny-pill" style={{ background: 'var(--pill-background)' }}>
          {project.status}
        </span>
      </div>
      {project.videoUrl ? (
        <video
          src={project.videoUrl}
          controls
          muted
          loop
          playsInline
          poster={posterUrl ?? undefined}
          onClick={(event) => event.stopPropagation()}
          style={{ width: '100%', borderRadius: '20px', objectFit: 'cover', background: '#000', marginTop: '14px' }}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={project.title || project.prompt || 'Cast video'}
          style={{ width: '100%', borderRadius: '20px', objectFit: 'cover', background: '#000', marginTop: '14px' }}
        />
      ) : null}
    </article>
  );
}

function DraftCard({ draft, onOpen }: { draft: Draft; onOpen: () => void }) {
  return (
    <article
      className="list-card"
      role="button"
      tabIndex={0}
      aria-label={`Open draft ${draft.title || draft.id}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      style={{ borderRadius: '28px', background: 'var(--surface-strong)', padding: '18px', cursor: 'pointer' }}
    >
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{draft.title || 'Draft concept'}</h3>
          <p className="muted" style={{ marginTop: '10px' }}>
            {draft.prompt || 'Draft prompt not available'}
          </p>
        </div>
        <span className="tiny-pill status-drafting">Draft</span>
      </div>
      <p className="muted" style={{ marginTop: '14px' }}>
        Saved {formatPostedDate(draft.createdAt)}
      </p>
    </article>
  );
}

export default function ProfilePage() {
  const {
    authReady,
    user,
    session,
    loading: sessionLoading,
    configured: supabaseConfigured,
    source: sessionSource,
    refreshSession,
  } = useSession();
  const authUser = session?.user ?? user;
  const authUserId = session?.user?.id || user?.id || null;
  const signedIn = Boolean(authUserId);
  const [profile, setProfile] = useState<LumoraProfile>(() => loadLumoraProfile());
  const [profileDraft, setProfileDraft] = useState<LumoraProfile>(() => loadLumoraProfile());
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [posts, setPosts] = useState<LumoraPost[]>([]);
  const [castIn, setCastIn] = useState<StudioProject[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [profileStats, setProfileStats] = useState<ProfileStats>({
    totalLikesReceived: 0,
    followersCount: 0,
    characterCount: 0,
    followsTableAvailable: false,
  });
  const [selectedPost, setSelectedPost] = useState<LumoraPost | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [activeProfileMenuItem, setActiveProfileMenuItem] = useState<ProfileMenuItem | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingSelfCharacter, setEditingSelfCharacter] = useState(false);
  const [characterHubOpen, setCharacterHubOpen] = useState(false);
  const [selfForm, setSelfForm] = useState<SelfCharacterForm>(() => buildSelfCharacterForm(loadLumoraProfile(), null));
  const [captureChecklist, setCaptureChecklist] = useState({
    readNumbers: false,
    faceForward: false,
    turnLeft: false,
    turnRight: false,
    tiltUp: false,
  });
  const [showSelfCaptureRedo, setShowSelfCaptureRedo] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selfCharacterStatus, setSelfCharacterStatus] = useState<string | null>(null);
  const [identityBuildStatus, setIdentityBuildStatus] = useState<string | null>(null);
  const [buildingIdentity, setBuildingIdentity] = useState(false);
  const [syncLocalProfileAvailable, setSyncLocalProfileAvailable] = useState(false);
  const [syncLocalSelfAvailable, setSyncLocalSelfAvailable] = useState(false);
  const [syncingLocal, setSyncingLocal] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<ProfileDebugInfo>({
    authUserId: null,
    loadedProfileId: null,
    profileAvatarUrlExists: false,
    selfCharacterLoaded: false,
    selfCharacterUserId: null,
    source: 'default',
  });
  const selfCharacterEditorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    console.info('PROFILE OK');
  }, []);

  useEffect(() => {
    console.log('PROFILE AUTH USER ID', { authUserId });
  }, [authUserId]);

  useEffect(() => {
    console.log('PROFILE SESSION SOURCE', {
      authUserId,
      configured: supabaseConfigured,
      loading: sessionLoading,
      source: sessionSource,
    });
  }, [authUserId, sessionLoading, sessionSource, supabaseConfigured]);

  useEffect(() => {
    console.log('PROFILE HIDING AUTH CARD', {
      authUserId,
      hidden: signedIn,
    });
  }, [authUserId, signedIn]);

  useEffect(() => {
    void refreshProfileData();
  }, [authReady, authUserId, sessionLoading, supabaseConfigured]);

  useEffect(() => {
    if (!editingSelfCharacter) return;
    saveSelfCharacterEditorDraft(selfForm);
  }, [editingSelfCharacter, selfForm]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;
    if (localStorage.getItem('lumora_open_characters_hub') !== '1') return;
    localStorage.removeItem('lumora_open_characters_hub');
    setCharacterHubOpen(true);
    void openSelfCharacterEditor();
  }, [isHydrated]);

  async function refreshProfileData() {
    setIsHydrated(false);
    setCharacters([]);
    setPosts([]);
    setCastIn([]);
    setDrafts([]);
    setProfileStats({
      totalLikesReceived: 0,
      followersCount: 0,
      characterCount: 0,
      followsTableAvailable: false,
    });

    if (supabaseConfigured && (!authReady || sessionLoading)) {
      setDebugInfo((current) => ({
        ...current,
        authUserId,
        source: authUserId ? 'supabase' : 'default',
      }));
      return;
    }

    if (authUserId) {
      try {
        const loadedProfile = await loadSupabaseProfile(authUserId);
        const loadedCharacters = await loadSupabaseCharacters(authUserId);
        const loadedCreatorSelf = findCreatorSelfCharacter(loadedCharacters);
        console.log('HYDRATED SELF CHARACTER:', loadedCreatorSelf);
        console.log('PROFILE SOURCE:', 'supabase');
        console.log('SELF CHARACTER SOURCE:', 'supabase');
        const [
          loadedPosts,
          loadedProjects,
          loadedDrafts,
          supabaseProfileExists,
          loadedProfileStats,
        ] = await Promise.all([
          loadSupabaseProfilePosts(authUserId),
          loadSupabaseProjects(authUserId),
          loadSupabaseDrafts(authUserId),
          hasSupabaseProfile(authUserId),
          getProfileStats(authUserId),
        ]);
        const normalizedProfile: LumoraProfile = loadedCreatorSelf
          ? {
              ...loadedProfile,
              defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
              defaultSelfCharacterName: loadedCreatorSelf.name,
              defaultSelfCharacterAvatar:
                loadedProfile.defaultSelfCharacterAvatar ||
                loadedCreatorSelf.referenceImageUrls.frontFaceUrl ||
                loadedCreatorSelf.referenceImageUrls.frontFace ||
                loadedProfile.avatar ||
                null,
            }
          : loadedProfile;

        setProfile(normalizedProfile);
        setProfileDraft(normalizedProfile);
        setCharacters(loadedCharacters);
        setPosts(loadedPosts);
        setCastIn(loadedProjects.filter((item) => Boolean(item.isDefaultSelfCharacter || item.characterName)));
        setDrafts(loadedDrafts);
        setProfileStats({
          ...loadedProfileStats,
          characterCount: Math.max(loadedProfileStats.characterCount, Math.min(25, loadedCharacters.length)),
        });
        const localRecovery = getLocalRecoveryAvailability({
          supabaseProfileExists,
          loadedCreatorSelf,
        });
        setSyncLocalProfileAvailable(localRecovery.profile);
        setSyncLocalSelfAvailable(localRecovery.selfCharacter);
        setDebugInfo({
          authUserId,
          loadedProfileId: normalizedProfile.userId || normalizedProfile.id || null,
          profileAvatarUrlExists: Boolean(normalizedProfile.avatar),
          selfCharacterLoaded: Boolean(loadedCreatorSelf),
          selfCharacterUserId: loadedCreatorSelf?.ownerUserId ?? null,
          source: 'supabase',
        });
        setIsHydrated(true);
        return;
      } catch (error) {
        console.error('Unable to load Supabase profile data:', error);
        setSaveMessage(friendlyProfileLoadError(error));
        const localRecovery = getLocalRecoveryAvailability({
          supabaseProfileExists: false,
          loadedCreatorSelf: null,
        });
        setSyncLocalProfileAvailable(localRecovery.profile);
        setSyncLocalSelfAvailable(localRecovery.selfCharacter);
        setDebugInfo((current) => ({
          ...current,
          authUserId,
          source: 'supabase',
        }));
        setCharacters([]);
        setProfileStats({
          totalLikesReceived: 0,
          followersCount: 0,
          characterCount: 0,
          followsTableAvailable: false,
        });
        setIsHydrated(true);
        return;
      }
    }

    setSyncLocalProfileAvailable(false);
    setSyncLocalSelfAvailable(false);
    const loadedProfile = await hydrateLocalProfileAvatar(loadLumoraProfile());
    cleanupCreatorSelfMetadata(loadedProfile);
    const loadedCharacters = getStoredCharacters();
    const loadedCreatorSelf = findCreatorSelfCharacter(loadedCharacters);
    console.log('HYDRATED SELF CHARACTER:', loadedCreatorSelf);
    console.log('PROFILE SOURCE:', typeof window !== 'undefined' && localStorage.getItem('lumora_profile') ? 'local' : 'default');
    console.log('SELF CHARACTER SOURCE:', loadedCreatorSelf ? 'local' : 'default');
    setProfile(loadedProfile);
    setProfileDraft(loadedProfile);
    const localPosts = loadProfilePosts();
    setCharacters(loadedCharacters);
    setPosts(localPosts);
    setCastIn(loadCastInProjects());
    setDrafts(loadDrafts());
    setProfileStats({
      totalLikesReceived: localPosts.reduce((total, post) => total + Number(post.likeCount ?? 0), 0),
      followersCount: 0,
      characterCount: Math.min(25, loadedCharacters.length),
      followsTableAvailable: false,
    });
    setDebugInfo({
      authUserId: null,
      loadedProfileId: loadedProfile.userId || loadedProfile.id || null,
      profileAvatarUrlExists: Boolean(loadedProfile.avatar),
      selfCharacterLoaded: Boolean(loadedCreatorSelf),
      selfCharacterUserId: loadedCreatorSelf?.ownerUserId ?? null,
      source: typeof window !== 'undefined' && localStorage.getItem('lumora_profile') ? 'local' : 'default',
    });
    setIsHydrated(true);
  }

  const creatorSelfCharacter = isHydrated ? findCreatorSelfCharacter(characters) : null;
  const displayedCharacterCount = Math.max(profileStats.characterCount, Math.min(25, characters.length));
  const selfCharacterFormTitle = creatorSelfCharacter ? 'Edit self character' : 'Create self character';
  const selfCharacterActionLabel = creatorSelfCharacter ? 'Save self character' : 'Create self character';
  const creatorIdentityProfile = creatorSelfCharacter
    ? buildLumoraIdentityProfile({
        userId: authUserId || 'local',
        selfCharacter: creatorSelfCharacter,
        profile,
        referenceImageUrls: creatorSelfCharacter.referenceImageUrls,
        primaryReferenceImageUrl:
          creatorSelfCharacter.referenceImageUrls.frontFaceUrl ||
          creatorSelfCharacter.referenceImageUrls.frontFace ||
          creatorSelfCharacter.referenceImageUrls.manualReferenceImageUrl,
      })
    : null;
  const identityConfidence = Math.round(creatorIdentityProfile?.identityStrength ?? 0);
  const identityLifecycleLabel = !creatorIdentityProfile
    ? 'Needs references'
    : creatorIdentityProfile.status === 'building'
      ? 'Building identity'
      : (creatorIdentityProfile.feedbackIterations ?? 0) > 0
        ? 'Identity learning'
        : ((creatorIdentityProfile.keyframeUrl && creatorIdentityProfile.keyframeUrl !== creatorIdentityProfile.frontFaceUrl) || identityConfidence >= 70)
          ? 'Identity stabilized'
          : creatorIdentityProfile.status === 'ready'
            ? 'Identity ready'
            : 'Needs references';
  function openProfileEditor() {
    setProfileDraft(profile);
    setSaveMessage(null);
    setEditingProfile(true);
  }

  async function handleCharacterHubRefresh(nextCharacters?: CharacterProfile[]) {
    if (nextCharacters) {
      setCharacters(nextCharacters);
      setProfileStats((current) => ({
        ...current,
        characterCount: Math.min(25, nextCharacters.length),
      }));
      return;
    }

    await refreshProfileData();
  }

  function closeCharactersHub() {
    setCharacterHubOpen(false);
    setEditingSelfCharacter(false);
  }

  async function handleProfileMenuSignOut() {
    await supabase?.auth.signOut();
    setProfileMenuOpen(false);
    setActiveProfileMenuItem(null);
  }

  function handleProfileMenuSelect(item: ProfileMenuItem) {
    setActiveProfileMenuItem(item);
  }

  function handleProfileMenuJumpToAuth() {
    setProfileMenuOpen(false);
    setActiveProfileMenuItem(null);
    window.requestAnimationFrame(() => {
      document.getElementById('profile-auth-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  async function openSelfCharacterEditor() {
    setCharacterHubOpen(true);
    let latestProfile = profile;
    let latestCharacters = characters;

    if (authUserId) {
      try {
        const remoteProfile = await loadSupabaseProfile(authUserId);
        const remoteCharacters = await loadSupabaseCharacters(authUserId);
        console.log('HYDRATED SELF CHARACTER:', findCreatorSelfCharacter(remoteCharacters));
        console.log('PROFILE SOURCE:', 'supabase');
        latestProfile = remoteProfile;
        latestCharacters = remoteCharacters;
        setProfile(remoteProfile);
        setProfileDraft(remoteProfile);
        setCharacters(remoteCharacters);
      } catch (error) {
        console.error('Unable to preload self character from Supabase:', error);
        setSelfCharacterStatus(error instanceof Error ? error.message : 'Unable to load self character from Supabase.');
        return;
      }
    } else {
      latestProfile = await hydrateLocalProfileAvatar(loadLumoraProfile());
      latestCharacters = getStoredCharacters();
    }

    const latestSelfCharacter = findCreatorSelfCharacter(latestCharacters);
    const localDraft = signedIn ? null : loadSelfCharacterEditorDraft();
    const initialSelfForm = buildSelfCharacterEditorState(latestProfile, latestSelfCharacter, localDraft);

    setSelfForm(initialSelfForm);
    setCaptureChecklist({
      readNumbers: Boolean(initialSelfForm.selfCaptureCompleted),
      faceForward: Boolean(initialSelfForm.selfCaptureCompleted),
      turnLeft: Boolean(initialSelfForm.selfCaptureCompleted),
      turnRight: Boolean(initialSelfForm.selfCaptureCompleted),
      tiltUp: Boolean(initialSelfForm.selfCaptureCompleted),
    });
    setShowSelfCaptureRedo(false);
    setSelfCharacterStatus(null);
    setEditingProfile(false);
    setEditingSelfCharacter(true);
    window.requestAnimationFrame(() => {
      selfCharacterEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handleProfileAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (authUserId) {
        const avatar = (await uploadLumoraMedia({
            userId: authUserId,
            bucket: 'avatars',
            file,
            folder: 'profile',
            usage: 'profile-avatar',
          })).url;
        console.log('UPLOADED AVATAR URL', {
          authUserId,
          avatarUrl: avatar,
        });
        setProfileDraft((current) => ({
          ...current,
          avatar,
          avatarStorageKey: null,
          avatarFileName: file.name,
        }));
        return;
      }

      const localAvatar = await saveLocalProfileAvatar(file);
      setProfileDraft((current) => ({
        ...current,
        avatar: localAvatar.url,
        avatarStorageKey: localAvatar.storageKey,
        avatarFileName: localAvatar.fileName,
      }));
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Unable to upload avatar.');
    }
  }

  async function handleSaveProfile() {
    let nextProfile: LumoraProfile = {
      ...profileDraft,
      displayName: profileDraft.displayName.trim() || 'Creator',
      username: profileDraft.username.trim() || 'lumora.creator',
      bio: profileDraft.bio,
      defaultSelfCharacterName: creatorSelfCharacter
        ? profileDraft.displayName.trim() || 'Creator'
        : profileDraft.defaultSelfCharacterName ?? null,
    };

    try {
      if (authUserId && isTransientMediaUrl(nextProfile.avatar) && nextProfile.avatarStorageKey) {
        const avatarFile = await loadLocalProfileAvatarFile(nextProfile.avatarStorageKey);
        if (avatarFile) {
          const uploadedAvatar = await uploadLumoraMedia({
            userId: authUserId,
            bucket: 'avatars',
            file: avatarFile,
            folder: 'profile',
            usage: 'profile-avatar',
          });
          console.log('UPLOADED AVATAR URL', {
            authUserId,
            avatarUrl: uploadedAvatar.url,
          });
          nextProfile = {
            ...nextProfile,
            avatar: uploadedAvatar.url,
            avatarStorageKey: null,
            avatarFileName: uploadedAvatar.fileName,
          };
        }
      }

      const savedProfile = authUserId
        ? await saveSupabaseProfile(authUserId, nextProfile)
        : nextProfile;

      if (!authUserId) {
        saveLumoraProfile(savedProfile);
        cleanupCreatorSelfMetadata(savedProfile);
      }
      setProfile(savedProfile);
      setProfileDraft(savedProfile);
      setCharacters(authUserId ? await loadSupabaseCharacters(authUserId) : getStoredCharacters());
      if (authUserId) {
        setSyncLocalProfileAvailable(false);
      }
      setDebugInfo((current) => ({
        ...current,
        authUserId,
        loadedProfileId: savedProfile.userId || savedProfile.id || authUserId || null,
        profileAvatarUrlExists: Boolean(savedProfile.avatar),
        source: authUserId ? 'supabase' : current.source,
      }));
      setSaveMessage('Profile saved.');
      setEditingProfile(false);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Unable to save profile.');
    }
  }

  async function persistSelfCharacterReferences(
    nextForm: SelfCharacterForm,
    statusMessage: string,
    identityProfileOverride?: LumoraIdentityProfile | null,
  ) {
    const compactFeatures = compactStringRecord(nextForm.features);
    const compactStyle = compactStringRecord(nextForm.style);
    const finalEditorDraft = saveSelfCharacterEditorDraft(nextForm) ?? createSelfCharacterEditorDraft(nextForm);
    const displayName = profile.displayName.trim() || 'Creator';
    const referenceImageUrls = {
      manualReferenceImageUrl: nextForm.manualReferenceImageUrl || null,
      frontFace: nextForm.frontFace,
      frontFaceUrl: nextForm.frontFace,
      frontFacePath: nextForm.frontFacePath || null,
      leftAngle: nextForm.leftAngle,
      leftAngleUrl: nextForm.leftAngle,
      leftAnglePath: nextForm.leftAnglePath || null,
      rightAngle: nextForm.rightAngle,
      rightAngleUrl: nextForm.rightAngle,
      rightAnglePath: nextForm.rightAnglePath || null,
      fullBody: nextForm.fullBody || null,
      fullBodyUrl: nextForm.fullBody || null,
      fullBodyPath: nextForm.fullBodyPath || null,
    };
    const baseStylePreferences = {
      creatorSelfFeatures: compactFeatures,
      creatorSelfStylePreferences: compactStyle,
      creatorSelfEditorDraft: finalEditorDraft,
      selfCaptureNumbers: nextForm.selfCaptureNumbers || null,
      selfCaptureConsent: nextForm.selfCaptureConsent,
      selfCaptureCompleted: nextForm.selfCaptureCompleted,
      selfVoiceSampleConsent: Boolean(nextForm.voiceSampleConsent),
      manualReferenceImageUrl: nextForm.manualReferenceImageUrl || null,
      selfieVideoPath: nextForm.selfieVideoPath || null,
      selfieVideo2Name: nextForm.selfieVideo2Name || null,
      selfieVideo2Url: nextForm.selfieVideo2Url,
      selfieVideo2Path: nextForm.selfieVideo2Path || null,
    };
    const identityDraftCharacter: CharacterProfile = {
      id: CREATOR_SELF_CHARACTER_ID,
      ownerUserId: authUserId || 'local',
      name: displayName,
      status: 'ready',
      consentConfirmed: true,
      visibility: 'private',
      stylePreferences: baseStylePreferences,
      referenceImageUrls,
      sourceCaptureVideoUrl: nextForm.selfieVideoUrl,
      sourceCaptureVideoPath: nextForm.selfieVideoPath || null,
      sourceCaptureVideo2Url: nextForm.selfieVideo2Url,
      sourceCaptureVideo2Path: nextForm.selfieVideo2Path || null,
      sourceCaptureVideo2Name: nextForm.selfieVideo2Name || null,
      voiceSampleUrl: nextForm.voiceSampleUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSelf: true,
      isCreatorSelf: true,
      creatorSelfFeatures: compactFeatures,
      creatorSelfStylePreferences: compactStyle,
    };
    const builtIdentityProfile = buildLumoraIdentityProfile({
      userId: authUserId || 'local',
      selfCharacter: identityDraftCharacter,
      profile,
      referenceImageUrls,
      primaryReferenceImageUrl: nextForm.frontFace || nextForm.manualReferenceImageUrl,
      additionalReferenceImageUrls: [nextForm.leftAngle, nextForm.rightAngle, nextForm.fullBody].filter(Boolean),
    });
    const identityProfile = identityProfileOverride
      ? {
          ...builtIdentityProfile,
          ...identityProfileOverride,
          references: identityProfileOverride.references ?? builtIdentityProfile.references,
          detectedFeatures: identityProfileOverride.detectedFeatures ?? builtIdentityProfile.detectedFeatures,
          canonicalReferenceSet: identityProfileOverride.canonicalReferenceSet ?? builtIdentityProfile.canonicalReferenceSet,
          identityPrompt: identityProfileOverride.identityPrompt || builtIdentityProfile.identityPrompt,
          generationConsistencyPrompt:
            identityProfileOverride.generationConsistencyPrompt || builtIdentityProfile.generationConsistencyPrompt,
          keyframeUrl: identityProfileOverride.keyframeUrl ?? builtIdentityProfile.keyframeUrl,
          identityStrength: identityProfileOverride.identityStrength ?? builtIdentityProfile.identityStrength,
          status: identityProfileOverride.status ?? builtIdentityProfile.status,
        }
      : builtIdentityProfile;
    const stylePreferences = identityProfileToStylePreferences(baseStylePreferences, identityProfile);

    if (!authUserId) {
      saveSelfCharacterEditorDraft(nextForm);
      setSelfCharacterStatus(statusMessage);
      return;
    }

    console.log('SAVING SELF CHARACTER REFERENCES', {
      authUserId,
      referenceImageUrls,
      selfieVideoPath: nextForm.selfieVideoPath || null,
      selfieVideo2Path: nextForm.selfieVideo2Path || null,
    });

    const saved = await saveSupabaseCreatorSelfCharacter({
      userId: authUserId,
      profile,
      name: displayName,
      referenceImageUrls,
      referencePhotoNames: {
        frontFace: nextForm.frontFaceName || null,
        leftAngle: nextForm.leftAngleName || null,
        rightAngle: nextForm.rightAngleName || null,
        fullBody: nextForm.fullBodyName || null,
      },
      sourceCaptureVideoUrl: nextForm.selfieVideoUrl,
      sourceCaptureVideoName: nextForm.selfieVideoName || null,
      sourceCaptureVideoPath: nextForm.selfieVideoPath || null,
      sourceCaptureVideo2Url: nextForm.selfieVideo2Url,
      sourceCaptureVideo2Name: nextForm.selfieVideo2Name || null,
      sourceCaptureVideo2Path: nextForm.selfieVideo2Path || null,
      selfCaptureNumbers: nextForm.selfCaptureNumbers || null,
      selfCaptureConsent: nextForm.selfCaptureConsent,
      selfCaptureCompleted: nextForm.selfCaptureCompleted,
      voiceSampleUrl: nextForm.voiceSampleUrl,
      voiceSampleName: nextForm.voiceSampleName || null,
      voiceSampleNumbers: nextForm.voiceSampleNumbers || null,
      voiceSampleConsent: nextForm.voiceSampleConsent,
      creatorSelfFeatures: compactFeatures,
      creatorSelfStylePreferences: compactStyle,
      stylePreferences,
      identityProfile,
      editorDraft: finalEditorDraft,
    });
    const remoteCharacters = await loadSupabaseCharacters(authUserId);

    saveLumoraProfile(saved.profile);
    setProfile(saved.profile);
    setProfileDraft(saved.profile);
    setCharacters(remoteCharacters.length ? remoteCharacters : [saved.character]);
    setSyncLocalProfileAvailable(false);
    setSyncLocalSelfAvailable(false);
    setSelfCharacterStatus(statusMessage);
  }

  async function handleSelfImageUpload(
    event: ChangeEvent<HTMLInputElement>,
    field: ReferencePhotoField,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const nameField = referencePhotoNameFields[field];
      const pathField = referencePhotoPathFields[field];

      if (authUserId) {
        const upload = await uploadCharacterReferencePhoto({
          userId: authUserId,
          file,
          slot: field,
          usage: `self-${field}-reference`,
          entityType: 'self_character',
          entityId: CREATOR_SELF_CHARACTER_ID,
        });
        const nextForm = {
          ...selfForm,
          [field]: upload.url,
          [pathField]: upload.objectPath,
          [nameField]: upload.fileName,
        };
        setSelfForm(nextForm);
        await persistSelfCharacterReferences(nextForm, `${upload.fileName} saved.`);
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const nextForm = { ...selfForm, [field]: dataUrl, [pathField]: '', [nameField]: file.name };
      setSelfForm(nextForm);
      saveSelfCharacterEditorDraft(nextForm);
    } catch (error) {
      setSelfCharacterStatus(error instanceof Error ? error.message : 'Unable to upload reference photo.');
    }
  }

  async function handleRemoveSelfImage(field: ReferencePhotoField) {
    const nameField = referencePhotoNameFields[field];
    const pathField = referencePhotoPathFields[field];
    const nextForm = {
      ...selfForm,
      [field]: '',
      [pathField]: '',
      [nameField]: '',
    };

    setSelfForm(nextForm);
    try {
      await persistSelfCharacterReferences(nextForm, `${field === 'frontFace' ? 'Front face' : field === 'leftAngle' ? 'Left angle' : field === 'rightAngle' ? 'Right angle' : 'Full body'} reference removed.`);
    } catch (error) {
      setSelfCharacterStatus(error instanceof Error ? error.message : 'Unable to remove reference photo.');
    }
  }

  async function handleSelfVideoUpload(
    event: ChangeEvent<HTMLInputElement>,
    slot: 'primary' | 'secondary' = 'primary',
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const upload = authUserId
        ? await uploadLumoraMedia({
            userId: authUserId,
            bucket: 'self-capture-videos',
            file,
            folder: 'self/capture',
            usage: slot === 'primary' ? 'self-capture-video' : 'self-capture-video-2',
          })
        : null;
      const dataUrl = upload?.url ?? await readFileAsDataUrl(file);
      const nextForm = {
        ...selfForm,
        ...(slot === 'primary'
          ? { selfieVideoName: file.name, selfieVideoUrl: dataUrl, selfieVideoPath: upload?.objectPath ?? '' }
          : { selfieVideo2Name: file.name, selfieVideo2Url: dataUrl, selfieVideo2Path: upload?.objectPath ?? '' }),
        selfCaptureCompleted: Boolean(selfForm.selfCaptureConsent),
      };
      setSelfForm(nextForm);
      if (authUserId) {
        await persistSelfCharacterReferences(nextForm, `${slot === 'primary' ? 'Selfie video 1' : 'Selfie video 2'} saved.`);
      } else {
        saveSelfCharacterEditorDraft(nextForm);
      }
    } catch (error) {
      setSelfCharacterStatus(error instanceof Error ? error.message : 'Unable to upload self capture video.');
    }
  }

  async function handleVoiceSampleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = authUserId
        ? (await uploadLumoraMedia({
            userId: authUserId,
            bucket: 'voice-samples',
            file,
            folder: 'self/voice',
            usage: 'self-voice-sample',
          })).url
        : await readFileAsDataUrl(file);
      setSelfForm((current) => ({
        ...current,
        voiceSampleName: file.name,
        voiceSampleUrl: dataUrl,
        voiceSampleNumbers: current.voiceSampleNumbers || generateSelfVoiceSampleNumbers(),
      }));
    } catch (error) {
      setSelfCharacterStatus(error instanceof Error ? error.message : 'Unable to upload voice sample.');
    }
  }

  function handleStartSelfCapture() {
    setShowSelfCaptureRedo(true);
    setCaptureChecklist({
      readNumbers: false,
      faceForward: false,
      turnLeft: false,
      turnRight: false,
      tiltUp: false,
    });
    setSelfForm((current) => ({
      ...current,
      selfCaptureNumbers: generateSelfCaptureNumbers(),
      selfCaptureCompleted: false,
    }));
  }

  function handleSelfCaptureConsent(checked: boolean) {
    setSelfForm((current) => ({
      ...current,
      selfCaptureConsent: checked,
      selfCaptureCompleted: Boolean(checked && current.selfieVideoUrl),
    }));
  }

  function handleCaptureChecklistChange(name: keyof typeof captureChecklist, checked: boolean) {
    const nextChecklist = { ...captureChecklist, [name]: checked };
    const checklistComplete = Object.values(nextChecklist).every(Boolean);

    setCaptureChecklist(nextChecklist);
    setSelfForm((current) => ({
      ...current,
      selfCaptureCompleted: Boolean(current.selfCaptureConsent && (current.selfieVideoUrl || checklistComplete)),
    }));
  }

  function updateSelfFeature(name: keyof CreatorSelfFeatures, value: string) {
    setSelfForm((current) => ({
      ...current,
      features: { ...current.features, [name]: value },
    }));
  }

  function updateSelfStyle(name: keyof CreatorSelfStylePreferences, value: string) {
    setSelfForm((current) => ({
      ...current,
      style: { ...current.style, [name]: value },
    }));
  }

  async function handleBuildIdentityCharacter() {
    const primaryReference =
      resolvedSelfReferenceSource(selfForm, 'frontFace') ||
      (isManualReferenceUrlReady(selfForm.manualReferenceImageUrl) ? selfForm.manualReferenceImageUrl.trim() : null);
    const leftAngleUrl = resolvedSelfReferenceSource(selfForm, 'leftAngle');
    const rightAngleUrl = resolvedSelfReferenceSource(selfForm, 'rightAngle');
    const fullBodyUrl = resolvedSelfReferenceSource(selfForm, 'fullBody');

    if (!primaryReference) {
      setIdentityBuildStatus('Add or re-save a public front photo before building identity.');
      return;
    }

    setBuildingIdentity(true);
    setIdentityBuildStatus('Building identity...');

    try {
      const response = await fetch('/api/lumora/build-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityId: creatorIdentityProfile?.identityId,
          userId: authUserId || 'local',
          frontFaceUrl: primaryReference,
          leftAngleUrl,
          rightAngleUrl,
          fullBodyUrl,
          selfieVideoUrl: selfForm.selfieVideoUrl,
          selfieVideo2Url: selfForm.selfieVideo2Url,
          appearanceSummary: buildSelfFormAppearanceSummary(selfForm),
          userPreferences: compactStringRecord(selfForm.style),
          dislikedTraits: compactStringRecord(selfForm.style).colorsToAvoid
            ? compactStringRecord(selfForm.style).colorsToAvoid?.split(',').map((item) => item.trim()).filter(Boolean)
            : [],
          likenessNotes: creatorIdentityProfile?.likenessNotes ?? [],
          identityFeedback: creatorIdentityProfile?.identityFeedback ?? [],
        }),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) as {
        identityProfile?: LumoraIdentityProfile;
        error?: string;
        warnings?: string[];
      } : {};

      if (!response.ok || !data.identityProfile) {
        throw new Error(data.error || 'Unable to build Lumora identity profile.');
      }

      await persistSelfCharacterReferences(
        selfForm,
        data.identityProfile.keyframeUrl && !data.warnings?.length
          ? 'Identity stabilized. Master keyframe saved.'
          : 'Identity profile saved. Image-animation fallback remains available.',
        data.identityProfile,
      );
      setIdentityBuildStatus(
        data.warnings?.length
          ? `Identity learning. ${data.warnings[0]}`
          : 'Identity stabilized.',
      );
    } catch (error) {
      setIdentityBuildStatus(error instanceof Error ? error.message : 'Unable to build Lumora identity.');
    } finally {
      setBuildingIdentity(false);
    }
  }

  async function handleSaveSelfCharacter() {
    if (!hasSelfReferenceSource(selfForm, 'frontFace') || !hasSelfReferenceSource(selfForm, 'leftAngle') || !hasSelfReferenceSource(selfForm, 'rightAngle')) {
      setSelfCharacterStatus('Add front, left, and right photos to save your self character.');
      return;
    }

    const compactFeatures = compactStringRecord(selfForm.features);
    const compactStyle = compactStringRecord(selfForm.style);
    const finalEditorDraft = saveSelfCharacterEditorDraft(selfForm) ?? createSelfCharacterEditorDraft(selfForm);
    const displayName = profile.displayName.trim() || 'Creator';
    const referenceImageUrls = {
      manualReferenceImageUrl: selfForm.manualReferenceImageUrl || null,
      frontFace: selfForm.frontFace,
      frontFaceUrl: selfForm.frontFace,
      frontFacePath: selfForm.frontFacePath || null,
      leftAngle: selfForm.leftAngle,
      leftAngleUrl: selfForm.leftAngle,
      leftAnglePath: selfForm.leftAnglePath || null,
      rightAngle: selfForm.rightAngle,
      rightAngleUrl: selfForm.rightAngle,
      rightAnglePath: selfForm.rightAnglePath || null,
      fullBody: selfForm.fullBody || null,
      fullBodyUrl: selfForm.fullBody || null,
      fullBodyPath: selfForm.fullBodyPath || null,
    };
    const baseStylePreferences = {
      creatorSelfFeatures: compactFeatures,
      creatorSelfStylePreferences: compactStyle,
      creatorSelfEditorDraft: finalEditorDraft,
      selfCaptureNumbers: selfForm.selfCaptureNumbers || null,
      selfCaptureConsent: selfForm.selfCaptureConsent,
      selfCaptureCompleted: selfForm.selfCaptureCompleted,
      selfVoiceSampleConsent: Boolean(selfForm.voiceSampleConsent),
      manualReferenceImageUrl: selfForm.manualReferenceImageUrl || null,
      selfieVideoPath: selfForm.selfieVideoPath || null,
      selfieVideo2Name: selfForm.selfieVideo2Name || null,
      selfieVideo2Url: selfForm.selfieVideo2Url,
      selfieVideo2Path: selfForm.selfieVideo2Path || null,
    };
    const identityDraftCharacter: CharacterProfile = {
      id: CREATOR_SELF_CHARACTER_ID,
      ownerUserId: authUserId || 'local',
      name: displayName,
      status: 'ready',
      consentConfirmed: true,
      visibility: 'private',
      stylePreferences: baseStylePreferences,
      referenceImageUrls,
      sourceCaptureVideoUrl: selfForm.selfieVideoUrl,
      voiceSampleUrl: selfForm.voiceSampleUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSelf: true,
      isCreatorSelf: true,
      creatorSelfFeatures: compactFeatures,
      creatorSelfStylePreferences: compactStyle,
    };
    const identityProfile = buildLumoraIdentityProfile({
      userId: authUserId || 'local',
      selfCharacter: identityDraftCharacter,
      profile,
      referenceImageUrls,
      primaryReferenceImageUrl: selfForm.frontFace || selfForm.manualReferenceImageUrl,
      additionalReferenceImageUrls: [selfForm.leftAngle, selfForm.rightAngle].filter(Boolean),
    });
    const stylePreferences = identityProfileToStylePreferences(baseStylePreferences, identityProfile);

    if (authUserId) {
      try {
        const saved = await saveSupabaseCreatorSelfCharacter({
          userId: authUserId,
          profile,
          name: displayName,
          referenceImageUrls,
          referencePhotoNames: {
            frontFace: selfForm.frontFaceName || null,
            leftAngle: selfForm.leftAngleName || null,
            rightAngle: selfForm.rightAngleName || null,
            fullBody: selfForm.fullBodyName || null,
          },
          sourceCaptureVideoUrl: selfForm.selfieVideoUrl,
          sourceCaptureVideoName: selfForm.selfieVideoName || null,
          sourceCaptureVideoPath: selfForm.selfieVideoPath || null,
          sourceCaptureVideo2Url: selfForm.selfieVideo2Url,
          sourceCaptureVideo2Name: selfForm.selfieVideo2Name || null,
          sourceCaptureVideo2Path: selfForm.selfieVideo2Path || null,
          selfCaptureNumbers: selfForm.selfCaptureNumbers || null,
          selfCaptureConsent: selfForm.selfCaptureConsent,
          selfCaptureCompleted: selfForm.selfCaptureCompleted,
          voiceSampleUrl: selfForm.voiceSampleUrl,
          voiceSampleName: selfForm.voiceSampleName || null,
          voiceSampleNumbers: selfForm.voiceSampleNumbers || null,
          voiceSampleConsent: selfForm.voiceSampleConsent,
          creatorSelfFeatures: compactFeatures,
          creatorSelfStylePreferences: compactStyle,
          stylePreferences,
          identityProfile,
          editorDraft: finalEditorDraft,
        });
        const remoteCharacters = await loadSupabaseCharacters(authUserId);

        saveLumoraProfile(saved.profile);
        setProfile(saved.profile);
        setProfileDraft(saved.profile);
        setCharacters(remoteCharacters.length ? remoteCharacters : [saved.character]);
        setSyncLocalProfileAvailable(false);
        setSyncLocalSelfAvailable(false);
        setDebugInfo({
          authUserId,
          loadedProfileId: saved.profile.userId || saved.profile.id || authUserId,
          profileAvatarUrlExists: Boolean(saved.profile.avatar),
          selfCharacterLoaded: true,
          selfCharacterUserId: saved.character.ownerUserId,
          source: 'supabase',
        });
        setSaveMessage('Self character saved.');
        setSelfCharacterStatus(null);
        setEditingSelfCharacter(false);
      } catch (error) {
        console.error('[handleSaveSelfCharacter] Supabase save error:', error);
        setSelfCharacterStatus(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}. Your draft is still autosaved.`);
        setSaveMessage(null);
      }

      return;
    }
    
    try {
      // Save to character storage
      const selfCharacter = saveCreatorSelfCharacter({
        name: displayName,
        referenceImageUrls: {
          ...referenceImageUrls,
        },
        sourceCaptureVideoUrl: selfForm.selfieVideoUrl,
        voiceSampleUrl: selfForm.voiceSampleUrl,
        voiceSampleName: selfForm.voiceSampleName || null,
        voiceSampleNumbers: selfForm.voiceSampleNumbers || null,
        stylePreferences,
        creatorSelfFeatures: compactFeatures,
        creatorSelfStylePreferences: compactStyle,
        identityProfile,
      });

      // Save profile with self character metadata
      const nextProfile: LumoraProfile = {
        ...profile,
        defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
        defaultSelfCharacterName: displayName,
        defaultSelfCharacterAvatar: selfForm.frontFace || selfForm.manualReferenceImageUrl || profile.avatar,
        manualReferenceImageUrl: selfForm.manualReferenceImageUrl || null,
        selfReferenceImageUrls: {
          manualReferenceImageUrl: selfForm.manualReferenceImageUrl || null,
          frontFace: selfForm.frontFace || null,
          frontFaceUrl: selfForm.frontFace || null,
          frontFacePath: selfForm.frontFacePath || null,
          leftAngle: selfForm.leftAngle || null,
          leftAngleUrl: selfForm.leftAngle || null,
          leftAnglePath: selfForm.leftAnglePath || null,
          rightAngle: selfForm.rightAngle || null,
          rightAngleUrl: selfForm.rightAngle || null,
          rightAnglePath: selfForm.rightAnglePath || null,
          fullBody: selfForm.fullBody || null,
          fullBodyUrl: selfForm.fullBody || null,
          fullBodyPath: selfForm.fullBodyPath || null,
        },
        selfReferencePhotoNames: {
          frontFace: selfForm.frontFaceName || null,
          leftAngle: selfForm.leftAngleName || null,
          rightAngle: selfForm.rightAngleName || null,
          fullBody: selfForm.fullBodyName || null,
        },
        selfCaptureVideoName: selfForm.selfieVideoName || null,
        selfCaptureVideoUrl: selfForm.selfieVideoUrl,
        selfCaptureNumbers: selfForm.selfCaptureNumbers || null,
        selfCaptureConsent: selfForm.selfCaptureConsent,
        selfCaptureCompleted: selfForm.selfCaptureCompleted,
        selfCaptureCapturedAt: selfForm.selfieVideoUrl ? new Date().toISOString() : profile.selfCaptureCapturedAt ?? null,
        selfVoiceSampleName: selfForm.voiceSampleName || null,
        selfVoiceSampleUrl: selfForm.voiceSampleUrl,
        selfVoiceSampleNumbers: selfForm.voiceSampleNumbers || null,
        selfVoiceSampleCapturedAt: selfForm.voiceSampleUrl ? new Date().toISOString() : profile.selfVoiceSampleCapturedAt ?? null,
        selfVoiceSampleConsent: selfForm.voiceSampleConsent,
        creatorSelfFeatures: compactFeatures,
        creatorSelfStylePreferences: compactStyle,
        selfCharacterFeatures: compactFeatures,
        selfCharacterStylePreferences: compactStyle,
        selfCharacterEditorDraft: finalEditorDraft,
      };

      saveLumoraProfile(nextProfile);
      // Verify that creator-self was actually saved to localStorage
      const verificationCharacters = getStoredCharacters();
      const verifiedCreatorSelf = findCreatorSelfCharacter(verificationCharacters);
      
      if (verifiedCreatorSelf && verifiedCreatorSelf.id === CREATOR_SELF_CHARACTER_ID) {
        // SUCCESS: Creator-self persisted to localStorage
        // Update React state from localStorage to ensure consistency
        setProfile(nextProfile);
        setProfileDraft(nextProfile);
        setCharacters(verificationCharacters);
        setSaveMessage('Self character saved and verified.');
        setSelfCharacterStatus(null);
        setEditingSelfCharacter(false);
      } else {
        // FAILURE: Creator-self did not persist
        console.error('[handleSaveSelfCharacter] ✗ VERIFICATION FAILED: creator-self not found in localStorage after save');
        setSelfCharacterStatus('Save failed. Your draft is still autosaved.');
        setSaveMessage(null);
        // Keep editingSelfCharacter = true so user stays in editor
      }
    } catch (error) {
      console.error('[handleSaveSelfCharacter] ✗ Save error:', error);
      setSelfCharacterStatus(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}. Your draft is still autosaved.`);
      setSaveMessage(null);
      // Keep editingSelfCharacter = true so user stays in editor
    }
  }

  async function handleSyncLocalProfileToAccount() {
    if (!authUserId || syncingLocal) return;

    setSyncingLocal(true);
    setSaveMessage(null);
    setSelfCharacterStatus(null);

    try {
      const localProfile = loadLumoraProfile();
      const localCharacters = getStoredCharacters();
      const localCreatorSelf = findCreatorSelfCharacter(localCharacters);
      const accountProfile = await prepareLocalProfileForAccountSync(authUserId, localProfile);
      let savedProfile = await saveSupabaseProfile(authUserId, accountProfile);
      let remoteCharacters = await loadSupabaseCharacters(authUserId);
      let savedCreatorSelf = findCreatorSelfCharacter(remoteCharacters);
      let selfSyncSkipped = false;

      if (localCreatorSelf) {
        const localSelfForm = buildSelfCharacterEditorState(accountProfile, localCreatorSelf, null);
        const canSyncSelfCharacter =
          localSelfForm.frontFace &&
          localSelfForm.leftAngle &&
          localSelfForm.rightAngle &&
          !isTransientMediaUrl(localSelfForm.frontFace) &&
          !isTransientMediaUrl(localSelfForm.leftAngle) &&
          !isTransientMediaUrl(localSelfForm.rightAngle);

        if (canSyncSelfCharacter) {
          const compactFeatures = compactStringRecord(localSelfForm.features);
          const compactStyle = compactStringRecord(localSelfForm.style);
          const finalEditorDraft = createSelfCharacterEditorDraft(localSelfForm);
          const savedSelf = await saveSupabaseCreatorSelfCharacter({
            userId: authUserId,
            profile: savedProfile,
            name: localCreatorSelf.name || savedProfile.displayName,
            referenceImageUrls: {
              manualReferenceImageUrl: localSelfForm.manualReferenceImageUrl || null,
              frontFace: localSelfForm.frontFace,
              frontFaceUrl: localSelfForm.frontFace,
              frontFacePath: localSelfForm.frontFacePath || null,
              leftAngle: localSelfForm.leftAngle,
              leftAngleUrl: localSelfForm.leftAngle,
              leftAnglePath: localSelfForm.leftAnglePath || null,
              rightAngle: localSelfForm.rightAngle,
              rightAngleUrl: localSelfForm.rightAngle,
              rightAnglePath: localSelfForm.rightAnglePath || null,
              fullBody: localSelfForm.fullBody || null,
              fullBodyUrl: localSelfForm.fullBody || null,
              fullBodyPath: localSelfForm.fullBodyPath || null,
            },
            referencePhotoNames: {
              frontFace: localSelfForm.frontFaceName || null,
              leftAngle: localSelfForm.leftAngleName || null,
              rightAngle: localSelfForm.rightAngleName || null,
              fullBody: localSelfForm.fullBodyName || null,
            },
            sourceCaptureVideoUrl: isTransientMediaUrl(localSelfForm.selfieVideoUrl)
              ? null
              : localSelfForm.selfieVideoUrl,
            sourceCaptureVideoName: isTransientMediaUrl(localSelfForm.selfieVideoUrl)
              ? null
              : localSelfForm.selfieVideoName || null,
            sourceCaptureVideoPath: localSelfForm.selfieVideoPath || null,
            sourceCaptureVideo2Url: isTransientMediaUrl(localSelfForm.selfieVideo2Url)
              ? null
              : localSelfForm.selfieVideo2Url,
            sourceCaptureVideo2Name: isTransientMediaUrl(localSelfForm.selfieVideo2Url)
              ? null
              : localSelfForm.selfieVideo2Name || null,
            sourceCaptureVideo2Path: localSelfForm.selfieVideo2Path || null,
            selfCaptureNumbers: localSelfForm.selfCaptureNumbers || null,
            selfCaptureConsent: localSelfForm.selfCaptureConsent,
            selfCaptureCompleted: localSelfForm.selfCaptureCompleted,
            voiceSampleUrl: isTransientMediaUrl(localSelfForm.voiceSampleUrl)
              ? null
              : localSelfForm.voiceSampleUrl,
            voiceSampleName: isTransientMediaUrl(localSelfForm.voiceSampleUrl)
              ? null
              : localSelfForm.voiceSampleName || null,
            voiceSampleNumbers: localSelfForm.voiceSampleNumbers || null,
            voiceSampleConsent: localSelfForm.voiceSampleConsent,
            creatorSelfFeatures: compactFeatures,
            creatorSelfStylePreferences: compactStyle,
            stylePreferences: {
              creatorSelfFeatures: compactFeatures,
              creatorSelfStylePreferences: compactStyle,
              creatorSelfEditorDraft: finalEditorDraft,
              selfCaptureNumbers: localSelfForm.selfCaptureNumbers || null,
              selfCaptureConsent: localSelfForm.selfCaptureConsent,
              selfCaptureCompleted: localSelfForm.selfCaptureCompleted,
              selfVoiceSampleConsent: Boolean(localSelfForm.voiceSampleConsent),
              selfieVideoPath: localSelfForm.selfieVideoPath || null,
              selfieVideo2Name: localSelfForm.selfieVideo2Name || null,
              selfieVideo2Url: isTransientMediaUrl(localSelfForm.selfieVideo2Url) ? null : localSelfForm.selfieVideo2Url,
              selfieVideo2Path: localSelfForm.selfieVideo2Path || null,
            },
            editorDraft: finalEditorDraft,
          });

          savedProfile = savedSelf.profile;
          remoteCharacters = await loadSupabaseCharacters(authUserId);
          savedCreatorSelf = findCreatorSelfCharacter(remoteCharacters) ?? savedSelf.character;
        } else {
          selfSyncSkipped = true;
        }
      }

      setProfile(savedProfile);
      setProfileDraft(savedProfile);
      setCharacters(remoteCharacters);
      setSyncLocalProfileAvailable(false);
      setSyncLocalSelfAvailable(false);
      setDebugInfo({
        authUserId,
        loadedProfileId: savedProfile.userId || savedProfile.id || authUserId,
        profileAvatarUrlExists: Boolean(savedProfile.avatar),
        selfCharacterLoaded: Boolean(savedCreatorSelf),
        selfCharacterUserId: savedCreatorSelf?.ownerUserId ?? null,
        source: 'supabase',
      });
      setSaveMessage(
        selfSyncSkipped
          ? 'Local profile synced. Self character needs saved reference photos before syncing.'
          : 'Local profile synced to your account.'
      );
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Unable to sync local profile to your account.');
    } finally {
      setSyncingLocal(false);
    }
  }

  function openCompletedProject(project: StudioProject) {
    localStorage.setItem('lumora_open_studio_project_id', project.id);
    window.location.href = '/drafts';
  }

  function openDraftInCreate(draft: Draft) {
    localStorage.setItem('remixPrompt', draft.prompt || '');
    localStorage.setItem('remixTitle', draft.title || 'Draft concept');
    window.location.href = '/create';
  }

  const showSelfCaptureControls = !selfForm.selfCaptureCompleted || showSelfCaptureRedo;
  const manualReferenceReady = isManualReferenceUrlReady(selfForm.manualReferenceImageUrl);
  const selfCharacterReferencesReady =
    manualReferenceReady ||
    (hasSelfReferenceSource(selfForm, 'frontFace') &&
      hasSelfReferenceSource(selfForm, 'leftAngle') &&
      hasSelfReferenceSource(selfForm, 'rightAngle'));
  const debugSource = authUserId ? 'supabase' : debugInfo.source;

  if (!authReady || sessionLoading || !isHydrated) {
    return (
      <div className="page" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <section className="headline-card" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
          <span className="eyebrow">identity</span>
          <h1 style={{ marginTop: '8px' }}>Hydrating Lumora identity...</h1>
        </section>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: '40px' }}>
      <section className="list-card" style={{ borderRadius: '30px', padding: '22px', background: 'var(--surface-strong)' }}>
        <div style={{ display: 'grid', gap: '18px', justifyItems: 'center', textAlign: 'center' }}>
          <div className="row-between" style={{ width: '100%', alignItems: 'center' }}>
            <span className="eyebrow">creator profile</span>
            <button
              type="button"
              aria-label="Open profile menu"
              onClick={() => setProfileMenuOpen(true)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--control-background)',
                color: 'var(--control-text)',
                border: '1px solid var(--control-border)',
              }}
            >
              <span style={{ display: 'grid', gap: '4px', width: '16px' }} aria-hidden="true">
                <span style={{ display: 'block', height: '2px', borderRadius: '999px', background: 'var(--control-text)' }} />
                <span style={{ display: 'block', height: '2px', borderRadius: '999px', background: 'var(--control-text)' }} />
                <span style={{ display: 'block', height: '2px', borderRadius: '999px', background: 'var(--control-text)' }} />
              </span>
            </button>
          </div>

          <div
            style={{
              width: '108px',
              height: '108px',
              borderRadius: '34px',
              overflow: 'hidden',
              background: 'var(--control-background)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ImagePreview src={profile.avatar} fallback={profile.displayName.charAt(0).toUpperCase() || 'L'} />
          </div>

          <div style={{ minWidth: 0 }}>
            <h1 style={{ marginTop: '8px' }}>{profile.displayName}</h1>
            <p className="muted" style={{ marginTop: '4px' }}>
              @{profile.username}
            </p>
            {profile.bio ? (
              <p style={{ margin: '12px auto 0', lineHeight: 1.5, maxWidth: '28rem' }}>{profile.bio}</p>
            ) : null}
          </div>

          <div className="stats-row" style={{ width: '100%', justifyContent: 'center', gap: '14px' }}>
            <span>{formatCompactNumber(profileStats.totalLikesReceived)} Likes</span>
            <span>{formatCompactNumber(profileStats.followersCount)} Followers</span>
            <span>{formatCompactNumber(displayedCharacterCount)} Characters</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="primary-btn" onClick={openProfileEditor}>
              Edit profile
            </button>
            <button type="button" className="ghost-btn" onClick={() => void openSelfCharacterEditor()}>
              Characters
            </button>
          </div>

          {saveMessage ? <p style={{ color: 'var(--success-text)', margin: 0 }}>{saveMessage}</p> : null}
        </div>
      </section>

      {!signedIn ? (
        <div id="profile-auth-section">
          <AuthCard
            configured={supabaseConfigured}
            loading={sessionLoading && !signedIn}
            user={authUser}
            session={session}
          />
        </div>
      ) : null}

      {signedIn && (syncLocalProfileAvailable || syncLocalSelfAvailable) ? (
        <section className="headline-card compact" style={{ borderRadius: '24px', padding: '14px' }}>
          <div className="row-between" style={{ gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span className="eyebrow">account sync</span>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                Local creator data exists on this device but is not saved to this account yet.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {syncLocalProfileAvailable ? (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void handleSyncLocalProfileToAccount()}
                  disabled={syncingLocal}
                >
                  {syncingLocal ? 'Syncing...' : 'Sync local profile to account'}
                </button>
              ) : null}
              {syncLocalSelfAvailable ? (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void handleSyncLocalProfileToAccount()}
                  disabled={syncingLocal}
                >
                  {syncingLocal ? 'Syncing...' : 'Sync local self character to account'}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {editingProfile ? (
        <section className="headline-card compact" style={{ marginTop: '18px', padding: '22px', borderRadius: '30px' }}>
          <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">edit profile</span>
              <h2 style={{ marginTop: '8px' }}>Profile details</h2>
            </div>
            <button type="button" className="text-btn" onClick={() => setEditingProfile(false)}>
              Close
            </button>
          </div>

          <div style={{ marginTop: '18px', display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '78px',
                  height: '78px',
                  borderRadius: '24px',
                  overflow: 'hidden',
                  background: 'var(--control-background)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ImagePreview src={profileDraft.avatar} fallback="Avatar" />
              </div>
              <label className="ghost-btn" style={{ padding: '10px 16px' }}>
                Upload avatar
                <input type="file" accept="image/*" onChange={handleProfileAvatarUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <ProfileTextField
              label="Display name"
              value={profileDraft.displayName}
              placeholder="Your creator name"
              onChange={(value) => setProfileDraft((current) => ({ ...current, displayName: value }))}
            />
            <ProfileTextField
              label="Username"
              value={profileDraft.username}
              placeholder="lumora.creator"
              onChange={(value) => setProfileDraft((current) => ({ ...current, username: value }))}
            />
            <ProfileTextField
              label="Bio"
              value={profileDraft.bio}
              placeholder="Write a short creator bio"
              multiline
              onChange={(value) => setProfileDraft((current) => ({ ...current, bio: value }))}
            />

            <button type="button" className="primary-btn full-width" onClick={() => void handleSaveProfile()}>
              Save profile
            </button>
          </div>
        </section>
      ) : null}

      <CharacterHub
        open={characterHubOpen}
        characters={characters}
        onClose={closeCharactersHub}
        onEditSelf={() => void openSelfCharacterEditor()}
        onRefresh={(nextCharacters) => void handleCharacterHubRefresh(nextCharacters)}
      >
        {editingSelfCharacter && isHydrated ? (
        <section
          ref={selfCharacterEditorRef}
          className="headline-card compact"
          style={{ marginTop: '18px', padding: '22px', borderRadius: '30px' }}
        >
          <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <span className="eyebrow">creator self</span>
              <h2 style={{ marginTop: '8px' }}>{selfCharacterFormTitle}</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="text-btn" onClick={() => setEditingSelfCharacter(false)}>
                Close
              </button>
            </div>
          </div>

          <div style={{ marginTop: '18px', display: 'grid', gap: '18px' }}>
            <div>
              <strong>Reference photos</strong>
              <p className="muted" style={{ marginTop: '8px' }}>
                Front, left, and right photos are required. A full body photo is optional for stronger scene consistency.
              </p>
            </div>

            <div className="reference-grid" style={{ gap: '12px' }}>
              {([
                ['frontFace', 'Front photo'],
                ['leftAngle', 'Left angle'],
                ['rightAngle', 'Right angle'],
                ['fullBody', 'Full body'],
              ] as const).map(([field, label]) => {
                const previewSource = selfReferencePreviewSource(selfForm, field);
                const hasReference = Boolean(previewSource);

                return (
                  <label className="reference-upload" key={field}>
                    <span>{label}</span>
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '1',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        background: 'var(--control-background)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      margin: '8px 0',
                    }}
                  >
                      <SelfReferencePreview
                        label={label}
                        reference={selfReferencePreviewReference(selfForm, field)}
                        required={field !== 'fullBody'}
                      />
                      {hasReference ? (
                        <button
                          type="button"
                          aria-label={`Remove ${label.toLowerCase()} reference`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleRemoveSelfImage(field);
                          }}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: 'rgba(5,4,11,0.78)',
                            color: '#fff',
                            cursor: 'pointer',
                            zIndex: 2,
                          }}
                        >
                          X
                        </button>
                      ) : null}
                    </div>
                    <strong>
                      {label}: {hasReference ? 'Uploaded / Ready' : field === 'fullBody' ? 'Optional' : 'Required'}
                    </strong>
                    <span className="muted">
                      {selfForm[referencePhotoNameFields[field]] ||
                        (hasReference ? 'Saved reference photo' : 'No file selected')}
                    </span>
                    <input type="file" accept="image/*" onChange={(event) => void handleSelfImageUpload(event, field)} />
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'grid', gap: '12px', padding: '16px', borderRadius: '18px', background: 'var(--panel-background)' }}>
              <div>
                <span className="eyebrow">Backup reference URL</span>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  Optional public HTTPS image URL used only when the saved front photo is not available.
                </p>
              </div>
              <label className="field-group">
                <span className="eyebrow">Backup public reference URL</span>
                <input
                  type="url"
                  value={selfForm.manualReferenceImageUrl}
                  placeholder="https://..."
                  onChange={(event) =>
                    setSelfForm((current) => ({
                      ...current,
                      manualReferenceImageUrl: event.target.value,
                    }))
                  }
                />
              </label>
              {manualReferenceReady ? (
                <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: '12px', alignItems: 'center' }}>
                  <SelfReferencePreview
                    label="Backup public reference URL"
                    reference={normalizeReference(
                      { url: selfForm.manualReferenceImageUrl },
                      'url',
                      'path',
                    )}
                  />
                  <span className="muted">Backup HTTPS reference ready. Saved photos remain preferred.</span>
                </div>
              ) : selfForm.manualReferenceImageUrl.trim() ? (
                <p className="muted" style={{ margin: 0 }}>
                  Backup reference must start with https:// to be used for generation.
                </p>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <strong>Self capture</strong>
              {showSelfCaptureControls ? (
                <>
                  <button type="button" className="ghost-btn" onClick={handleStartSelfCapture}>
                    Start self capture
                  </button>
                  <div style={{ padding: '16px', borderRadius: '18px', background: 'var(--panel-background)' }}>
                    <strong>Read the numbers shown on screen:</strong>
                    <div style={{ marginTop: '10px', fontSize: '1.35rem', letterSpacing: '0.25em' }}>
                      {selfForm.selfCaptureNumbers}
                    </div>
                  </div>
                  <label className="field-group">
                    <span className="eyebrow">Selfie video 1</span>
                    <input type="file" accept="video/*" onChange={(event) => void handleSelfVideoUpload(event, 'primary')} />
                    <span className="muted">{selfForm.selfieVideoName || 'Upload or record a selfie video'}</span>
                  </label>
                  <label className="field-group">
                    <span className="eyebrow">Selfie video 2</span>
                    <input type="file" accept="video/*" onChange={(event) => void handleSelfVideoUpload(event, 'secondary')} />
                    <span className="muted">{selfForm.selfieVideo2Name || 'Optional second selfie video'}</span>
                  </label>
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div>
                      <strong>Capture instructions</strong>
                      <p className="muted" style={{ marginTop: '8px' }}>
                        Read the numbers shown on screen, then slowly turn your head left, right, and up.
                      </p>
                    </div>
                    {([
                      ['readNumbers', 'Read the numbers out loud'],
                      ['faceForward', 'Face forward'],
                      ['turnLeft', 'Turn head left'],
                      ['turnRight', 'Turn head right'],
                      ['tiltUp', 'Tilt head up'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="consent-row">
                        <input
                          type="checkbox"
                          checked={captureChecklist[key]}
                          onChange={(event) => handleCaptureChecklistChange(key, event.target.checked)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="consent-row">
                    <input
                      type="checkbox"
                      checked={selfForm.selfCaptureConsent}
                      onChange={(event) => handleSelfCaptureConsent(event.target.checked)}
                    />
                    <span>I confirm I own or have permission to use these reference images/videos.</span>
                  </label>
                </>
              ) : (
                <div style={{ display: 'grid', gap: '12px', padding: '16px', borderRadius: '18px', background: 'var(--panel-background)' }}>
                  <div>
                    <strong>Self capture complete</strong>
                    <p className="muted" style={{ marginTop: '8px' }}>
                      Your selfie video and consent are saved.
                    </p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={() => setShowSelfCaptureRedo(true)}>
                    Redo self capture
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <strong>Voice sample</strong>
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  setSelfForm((current) => ({
                    ...current,
                    voiceSampleNumbers: generateSelfVoiceSampleNumbers(),
                  }))
                }
              >
                Generate voice prompt
              </button>
              <div style={{ padding: '16px', borderRadius: '18px', background: 'var(--panel-background)' }}>
                <strong>Voice sample prompt</strong>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {formatSelfVoiceSamplePrompt(selfForm.voiceSampleNumbers)}
                </p>
              </div>
              <label className="field-group">
                <span className="eyebrow">Voice sample</span>
                <input type="file" accept="audio/*" onChange={(event) => void handleVoiceSampleUpload(event)} />
                <span className="muted">{selfForm.voiceSampleName || 'Optional voice sample upload'}</span>
              </label>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={selfForm.voiceSampleConsent}
                  onChange={(event) =>
                    setSelfForm((current) => ({ ...current, voiceSampleConsent: event.target.checked }))
                  }
                />
                <span>I confirm this is my own voice and I consent to using it for my self character.</span>
              </label>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <strong>Character Features</strong>
                <p className="muted" style={{ marginTop: '4px' }}>(optional)</p>
              </div>
              {creatorSelfFeatureFields.map((field) => (
                <ProfileTextField
                  key={field.key}
                  label={field.label}
                  value={selfForm.features[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(value) => updateSelfFeature(field.key, value)}
                />
              ))}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <strong>Fashion / Style</strong>
                <p className="muted" style={{ marginTop: '4px' }}>(optional)</p>
              </div>
              {creatorSelfStyleFields.map((field) => (
                <label key={field.key} className="field-group">
                  <span className="eyebrow">{field.label}</span>
                  {field.helper ? (
                    <span className="muted" style={{ display: 'block', marginTop: '6px' }}>
                      {field.helper}
                    </span>
                  ) : null}
                  <input
                    type="text"
                    value={selfForm.style[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => updateSelfStyle(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <p className="muted" style={{ margin: 0 }}>
              Save changes to your self character photos, voice, features, and style.
            </p>
            <div style={{ display: 'grid', gap: '10px', padding: '16px', borderRadius: '18px', background: 'var(--panel-background)' }}>
              <span className="eyebrow">Build My Lumora Character</span>
              <strong>
                {buildingIdentity ? 'Building identity' : selfCharacterReferencesReady ? 'Identity ready' : 'Needs references'}
              </strong>
              <p className="muted" style={{ margin: 0 }}>
                Build a reusable photorealistic character from your reference photos and videos.
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Lumora will use your feedback to improve future prompts and character consistency.
              </p>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void handleBuildIdentityCharacter()}
                disabled={buildingIdentity}
              >
                {buildingIdentity ? 'Building identity...' : creatorIdentityProfile?.keyframeUrl ? 'Improve My Character' : 'Build My Lumora Character'}
              </button>
              {identityBuildStatus ? <p className="muted" style={{ margin: 0 }}>{identityBuildStatus}</p> : null}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Draft autosaved locally
            </p>
            <button type="button" className="primary-btn full-width" onClick={() => void handleSaveSelfCharacter()}>
              {selfCharacterActionLabel}
            </button>
            {selfCharacterStatus ? <p className="muted">{selfCharacterStatus}</p> : null}
          </div>
        </section>
        ) : null}
      </CharacterHub>

      <SectionCard title="Published videos">
        {posts.length ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
              gap: '8px',
            }}
          >
            {posts.map((post) => (
              <ProfilePostTile key={post.id} post={post} onSelect={setSelectedPost} />
            ))}
          </div>
        ) : (
          <article className="list-card" style={{ borderRadius: '28px', padding: '18px' }}>
            <h3>No posts yet</h3>
            <p className="muted">Create and post a video from Drafts to see it appear here.</p>
          </article>
        )}
      </SectionCard>

      {selectedPost ? (
        <ProfilePostPreviewModal
          post={selectedPost}
          fallbackAvatar={profile.avatar}
          onClose={() => setSelectedPost(null)}
        />
      ) : null}

      <ProfileMenuSidebar
        open={profileMenuOpen}
        signedIn={signedIn}
        authUserId={authUserId}
        userEmail={authUser?.email}
        activeItem={activeProfileMenuItem}
        onBack={() => setActiveProfileMenuItem(null)}
        onClose={() => setProfileMenuOpen(false)}
        onSelect={handleProfileMenuSelect}
        onSignOut={() => void handleProfileMenuSignOut()}
        onJumpToAuth={handleProfileMenuJumpToAuth}
      />
    </div>
  );
}
