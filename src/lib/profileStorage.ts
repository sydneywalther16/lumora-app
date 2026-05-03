import type { CreatorSelfStylePreferences, LumoraPost } from './api';
import type { StudioProject } from './projectStorage';

type SelfReferenceImageUrls = {
  frontFace?: string | null;
  leftAngle?: string | null;
  rightAngle?: string | null;
};

type SelfReferencePhotoNames = {
  frontFace?: string | null;
  leftAngle?: string | null;
  rightAngle?: string | null;
};

export type LumoraProfile = {
  avatar?: string;
  avatarStorageKey?: string | null;
  avatarFileName?: string | null;
  displayName: string;
  username: string;
  bio: string;
  defaultSelfCharacterId?: string | null;
  defaultSelfCharacterName?: string | null;
  defaultSelfCharacterAvatar?: string | null;
  selfReferenceImageUrls?: SelfReferenceImageUrls | null;
  selfReferencePhotoNames?: SelfReferencePhotoNames | null;
  selfCaptureVideoName?: string | null;
  selfCaptureVideoUrl?: string | null;
  selfCaptureNumbers?: string | null;
  selfCaptureCompleted?: boolean;
  selfCaptureConsent?: boolean;
  selfCaptureCapturedAt?: string | null;
  selfVoiceSampleName?: string | null;
  selfVoiceSampleUrl?: string | null;
  selfVoiceSampleNumbers?: string | null;
  selfVoiceSampleCapturedAt?: string | null;
  selfVoiceSampleConsent?: boolean;
  creatorSelfFeatures?: Record<string, string>;
  creatorSelfStylePreferences?: CreatorSelfStylePreferences;
  selfCharacterFeatures?: Record<string, string>;
  selfCharacterStylePreferences?: CreatorSelfStylePreferences;
  selfCharacterEditorDraft?: Record<string, unknown> | null;
};

const STORAGE_KEY = 'lumora_profile';

function isTransientMediaUrl(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('blob:');
}

function stripBase64Media(value: unknown): unknown {
  if (typeof value === 'string') {
    return isTransientMediaUrl(value) ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map(stripBase64Media);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripBase64Media(entry)]),
    );
  }

  return value;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = readObjectRecord(value);
  if (!record) return undefined;

  const strings = Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );

  return Object.keys(strings).length > 0 ? strings : undefined;
}

function readReferenceMetadata(value: unknown): SelfReferenceImageUrls | null {
  const record = readObjectRecord(value);
  if (!record) return null;

  return {
    frontFace: typeof record.frontFace === 'string' ? record.frontFace : null,
    leftAngle: typeof record.leftAngle === 'string' ? record.leftAngle : null,
    rightAngle: typeof record.rightAngle === 'string' ? record.rightAngle : null,
  };
}

function readStylePreferences(value: unknown): CreatorSelfStylePreferences | undefined {
  const record = readStringRecord(value);
  if (!record) return undefined;

  return {
    everydayStyle: record.everydayStyle,
    glamStyle: record.glamStyle,
    videoWardrobe: record.videoWardrobe,
    colorsToFavor: record.colorsToFavor,
    colorsToAvoid: record.colorsToAvoid ?? record.colorsItemsToAvoid,
  };
}

export function loadLumoraProfile(): LumoraProfile {
  if (typeof window === 'undefined') return { displayName: 'Creator', username: 'lumora.creator', bio: '' };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { displayName: 'Creator', username: 'lumora.creator', bio: '' };
    const parsed = JSON.parse(raw) as LumoraProfile;

    return {
      avatar:
        typeof parsed.avatar === 'string' && !isTransientMediaUrl(parsed.avatar)
          ? parsed.avatar
          : undefined,
      avatarStorageKey: typeof parsed.avatarStorageKey === 'string' ? parsed.avatarStorageKey : null,
      avatarFileName: typeof parsed.avatarFileName === 'string' ? parsed.avatarFileName : null,
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0
          ? parsed.displayName.trim()
          : 'Creator',
      username:
        typeof parsed.username === 'string' && parsed.username.trim().length > 0
          ? parsed.username.trim()
          : 'lumora.creator',
      bio: typeof parsed.bio === 'string' ? parsed.bio : '',
      defaultSelfCharacterId:
        typeof parsed.defaultSelfCharacterId === 'string' && parsed.defaultSelfCharacterId.trim().length > 0
          ? parsed.defaultSelfCharacterId.trim()
          : null,
      defaultSelfCharacterName:
        typeof parsed.defaultSelfCharacterName === 'string' && parsed.defaultSelfCharacterName.trim().length > 0
          ? parsed.defaultSelfCharacterName.trim()
          : null,
      defaultSelfCharacterAvatar:
        typeof parsed.defaultSelfCharacterAvatar === 'string' ? parsed.defaultSelfCharacterAvatar : null,
      selfReferenceImageUrls: readReferenceMetadata(parsed.selfReferenceImageUrls),
      selfReferencePhotoNames: readReferenceMetadata(parsed.selfReferencePhotoNames),
      selfCaptureVideoName:
        typeof parsed.selfCaptureVideoName === 'string' ? parsed.selfCaptureVideoName : null,
      selfCaptureVideoUrl:
        typeof parsed.selfCaptureVideoUrl === 'string' ? parsed.selfCaptureVideoUrl : null,
      selfCaptureNumbers:
        typeof parsed.selfCaptureNumbers === 'string' ? parsed.selfCaptureNumbers : null,
      selfCaptureCompleted:
        typeof parsed.selfCaptureCompleted === 'boolean' ? parsed.selfCaptureCompleted : false,
      selfCaptureConsent:
        typeof parsed.selfCaptureConsent === 'boolean' ? parsed.selfCaptureConsent : false,
      selfCaptureCapturedAt:
        typeof parsed.selfCaptureCapturedAt === 'string' ? parsed.selfCaptureCapturedAt : null,
      selfVoiceSampleName:
        typeof parsed.selfVoiceSampleName === 'string' ? parsed.selfVoiceSampleName : null,
      selfVoiceSampleUrl:
        typeof parsed.selfVoiceSampleUrl === 'string' ? parsed.selfVoiceSampleUrl : null,
      selfVoiceSampleNumbers:
        typeof parsed.selfVoiceSampleNumbers === 'string' ? parsed.selfVoiceSampleNumbers : null,
      selfVoiceSampleCapturedAt:
        typeof parsed.selfVoiceSampleCapturedAt === 'string' ? parsed.selfVoiceSampleCapturedAt : null,
      selfVoiceSampleConsent:
        typeof parsed.selfVoiceSampleConsent === 'boolean' ? parsed.selfVoiceSampleConsent : false,
      creatorSelfFeatures: readStringRecord(parsed.creatorSelfFeatures),
      creatorSelfStylePreferences: readStylePreferences(parsed.creatorSelfStylePreferences),
      selfCharacterFeatures: readStringRecord(parsed.selfCharacterFeatures),
      selfCharacterStylePreferences: readStylePreferences(parsed.selfCharacterStylePreferences),
      selfCharacterEditorDraft: readObjectRecord(parsed.selfCharacterEditorDraft),
    };
  } catch {
    return { displayName: 'Creator', username: 'lumora.creator', bio: '' };
  }
}

export function saveLumoraProfile(profile: LumoraProfile) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripBase64Media(profile)));
  } catch {
    // ignore storage failures
  }
}

export function loadDrafts(): Array<{ id: string; title: string; prompt: string; createdAt: string }> {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem('lumora_drafts');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is { id: string; title: string; prompt: string; createdAt: string } => {
      return (
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.prompt === 'string' &&
        typeof item.createdAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

export function loadProfilePosts(): LumoraPost[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem('lumora_posts');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is LumoraPost => {
      return (
        item &&
        typeof item.id === 'string' &&
        (typeof item.caption === 'string' || typeof item.title === 'string') &&
        (typeof item.videoUrl === 'string' || typeof item.imageUrl === 'string') &&
        typeof item.createdAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

export function loadCastInProjects(): StudioProject[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem('lumora_projects');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is StudioProject => {
      return (
        item &&
        typeof item.id === 'string' &&
        typeof item.prompt === 'string' &&
        typeof item.videoUrl === 'string' &&
        typeof item.status === 'string' &&
        typeof item.provider === 'string' &&
        (typeof item.characterId === 'string' || item.characterId === null || item.characterId === undefined) &&
        (typeof item.characterName === 'string' || item.characterName === null) &&
        typeof item.createdAt === 'string'
      );
    }).filter((item) => Boolean(item.isDefaultSelfCharacter || item.characterName));
  } catch {
    return [];
  }
}
