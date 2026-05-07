import type { CharacterProfile, ReferenceImageUrls } from './api';
import type { LumoraProfile } from './profileStorage';
import { supabase } from './supabase';

type ReferenceBucket = 'character-reference-images';

type ReferenceCandidate = {
  slot: keyof ReferenceImageUrls | 'avatar' | 'image' | 'media';
  label: string;
  value: unknown;
  bucket: ReferenceBucket;
  userId?: string | null;
};

type StoragePath = {
  bucket: 'character-reference-images';
  objectPath: string;
};

type ResolvedCandidate = {
  url: string | null;
  source: string | null;
  rejectionReason: string | null;
};

export type SelfCharacterReferenceImage = {
  url: string | null;
  label: string | null;
  slot: string | null;
  referenceImageUrls: Partial<ReferenceImageUrls>;
  inspectedFields: Array<{
    label: string;
    slot: string;
    hasValue: boolean;
    valuePreview: string | null;
  }>;
};

const candidateKeys = new Set([
  'frontFace',
  'frontFaceUrl',
  'frontImage',
  'frontImageUrl',
  'fullBody',
  'fullBodyUrl',
  'leftAngle',
  'leftAngleUrl',
  'rightAngle',
  'rightAngleUrl',
  'avatar',
  'avatarUrl',
  'imageUrl',
  'mediaUrl',
  'url',
]);

function previewValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 90) return value;
  return `${value.slice(0, 54)}...${value.slice(-18)}`;
}

function looksImageish(value: string): boolean {
  return (
    value.toLowerCase().includes('supabase') ||
    value.toLowerCase().includes('storage') ||
    value.toLowerCase().includes('public') ||
    /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(value)
  );
}

function isTransientOrLocalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('file:')) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

  try {
    const parsed = new URL(trimmed);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function cleanPermanentPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleanUrl = value.trim().split('?')[0];
  if (!cleanUrl.startsWith('https://')) return null;
  return cleanUrl;
}

function rejectionReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'empty';

  const trimmed = value.trim();
  if (trimmed.startsWith('blob:')) return 'blob:';
  if (trimmed.startsWith('data:')) return 'data:';
  if (trimmed.startsWith('file:')) return 'relative path';
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return 'relative path';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return 'missing protocol';
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) return 'relative path';
    return null;
  } catch {
    return 'missing protocol';
  }
}

function isValidPublicUrl(value: unknown): boolean {
  if (typeof value !== 'string' || isTransientOrLocalUrl(value)) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePotentialStoragePath(value: string): string {
  return value
    .trim()
    .replace(/^(\.\/|\.\.\/)+/, '')
    .replace(/^\/+/, '');
}

function bucketPrefixedPath(path: string): StoragePath | null {
  const normalized = normalizePotentialStoragePath(path);

  if (normalized.startsWith('character-reference-images/')) {
    return {
      bucket: 'character-reference-images',
      objectPath: normalized.slice('character-reference-images/'.length),
    };
  }

  return null;
}

function storagePathFromValue(value: unknown, bucket: ReferenceBucket): StoragePath | null {
  if (typeof value !== 'string') return null;
  if (isValidPublicUrl(value)) return null;
  if (bucket !== 'character-reference-images') return null;

  const bucketPath = bucketPrefixedPath(value);
  if (bucketPath?.objectPath) return bucketPath;

  const trimmed = normalizePotentialStoragePath(value);
  if (!trimmed || trimmed.includes(' ') || !trimmed.includes('/')) return null;

  if (trimmed.startsWith(`${bucket}/`)) {
    return {
      bucket: 'character-reference-images',
      objectPath: trimmed.slice(bucket.length + 1),
    };
  }

  return null;
}

function fieldKeyLikeValue(value: string): boolean {
  return /^(?:profile|selfCharacter)\.[a-zA-Z0-9_.]+$/.test(value);
}

function storageObjectPathFromPublicUrl(value: string): string | null {
  return storagePathFromSupabaseUrl(value)?.objectPath ?? null;
}

function storagePathFromSupabaseUrl(value: string): StoragePath | null {
  try {
    const parsed = new URL(value);
    const marker = `/storage/v1/object/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const objectPath = parsed.pathname.slice(markerIndex + marker.length);
    const bucketPathMatch = objectPath.match(/^(?:public|sign)\/([^/]+)\/(.+)$/);
    const matchedBucket = bucketPathMatch?.[1];
    const matchedPath = bucketPathMatch?.[2];

    if (matchedBucket === 'character-reference-images' && matchedPath) {
      return {
        bucket: 'character-reference-images',
        objectPath: decodeURIComponent(matchedPath),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function storagePathToPublicUrl(storagePath: StoragePath): { url: string; source: string } | null {
  if (!supabase) return null;

  try {
    const publicUrl = supabase.storage
      .from('character-reference-images')
      .getPublicUrl(storagePath.objectPath)
      .data.publicUrl;
    const cleanUrl = cleanPermanentPublicUrl(publicUrl);

    if (cleanUrl) {
      console.log('RESOLVED PUBLIC URL:', publicUrl);
      console.log('FINAL CLEAN URL:', cleanUrl);
      return {
        url: cleanUrl,
        source: `character-reference-images:${storagePath.objectPath}`,
      };
    }
  } catch (error) {
    console.warn('[getSelfCharacterReferenceImage] Unable to create public URL:', {
      bucket: storagePath.bucket,
      objectPath: storagePath.objectPath,
      error,
    });
  }

  return null;
}

async function mediaAssetUrlFromFileName(
  value: string,
  _bucket: ReferenceBucket,
  userId?: string | null,
): Promise<{ url: string; source: string } | null> {
  if (!supabase || !userId || fieldKeyLikeValue(value)) return null;

  const fileName = value.trim();
  if (!fileName || fileName.startsWith('http') || fileName.startsWith('data:') || fileName.startsWith('blob:')) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('media_assets')
      .select('bucket, object_path')
      .eq('user_id', userId)
      .eq('bucket', 'character-reference-images')
      .eq('file_name', fileName)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('[getSelfCharacterReferenceImage] Unable to resolve media asset filename:', {
        bucket: 'character-reference-images',
        fileName,
        error,
      });
      return null;
    }

    const asset = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
    const objectPath = typeof asset?.object_path === 'string' ? asset.object_path : null;

    if (objectPath) {
      return storagePathToPublicUrl({
        bucket: 'character-reference-images',
        objectPath,
      });
    }
  } catch (error) {
    console.warn('[getSelfCharacterReferenceImage] Media asset lookup failed:', {
      bucket: 'character-reference-images',
      fileName,
      error,
    });
  }

  return null;
}

async function storagePathToUrl(
  value: unknown,
  bucket: ReferenceBucket,
  userId?: string | null,
): Promise<{ url: string; source: string } | null> {
  const storagePath = typeof value === 'string' && isValidPublicUrl(value)
    ? storagePathFromSupabaseUrl(value)
    : storagePathFromValue(value, bucket);
  if (storagePath) {
    const publicUrl = storagePathToPublicUrl(storagePath);
    if (publicUrl) return publicUrl;
  }

  if (typeof value === 'string') {
    const publicUrlObjectPath = storageObjectPathFromPublicUrl(value);
    if (publicUrlObjectPath) {
      const resolved = storagePathToPublicUrl({
        bucket: 'character-reference-images',
        objectPath: publicUrlObjectPath,
      });
      if (resolved) return resolved;
    }
  }

  return typeof value === 'string'
    ? mediaAssetUrlFromFileName(value, bucket, userId)
    : null;
}

function pushCandidate(
  candidates: ReferenceCandidate[],
  slot: ReferenceCandidate['slot'],
  label: string,
  value: unknown,
  bucket: ReferenceBucket,
  userId?: string | null,
) {
  candidates.push({ slot, label, value, bucket, userId });
}

function pushKnownReferenceCandidates(
  candidates: ReferenceCandidate[],
  source: Record<string, unknown>,
  prefix: string,
  bucket: ReferenceBucket,
  userId?: string | null,
) {
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFace`, source.frontFace, bucket, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFaceUrl`, source.frontFaceUrl, bucket, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImage`, source.frontImage, bucket, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImageUrl`, source.frontImageUrl, bucket, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBody`, source.fullBody, bucket, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBodyUrl`, source.fullBodyUrl, bucket, userId);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngle`, source.leftAngle, bucket, userId);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngleUrl`, source.leftAngleUrl, bucket, userId);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngle`, source.rightAngle, bucket, userId);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngleUrl`, source.rightAngleUrl, bucket, userId);
  pushCandidate(candidates, 'avatar', `${prefix}.avatar`, source.avatar, 'character-reference-images', userId);
  pushCandidate(candidates, 'avatar', `${prefix}.avatarUrl`, source.avatarUrl, 'character-reference-images', userId);
  pushCandidate(candidates, 'image', `${prefix}.imageUrl`, source.imageUrl, bucket, userId);
}

function collectMediaUrlCandidates(
  candidates: ReferenceCandidate[],
  value: unknown,
  prefix: string,
  depth = 0,
) {
  if (depth > 3) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectMediaUrlCandidates(candidates, entry, `${prefix}[${index}]`, depth + 1));
    return;
  }

  const record = readObject(value);
  Object.entries(record).forEach(([key, entry]) => {
    const nextPrefix = `${prefix}.${key}`;
    if (typeof entry === 'string' && candidateKeys.has(key)) {
      pushCandidate(
        candidates,
        key.toLowerCase().includes('avatar') ? 'avatar' : 'media',
        nextPrefix,
        entry,
        'character-reference-images',
      );
    }

    if (entry && typeof entry === 'object') {
      collectMediaUrlCandidates(candidates, entry, nextPrefix, depth + 1);
    }
  });
}

function collectPermissiveStringCandidates(
  candidates: ReferenceCandidate[],
  value: unknown,
  prefix: string,
  depth = 0,
) {
  if (depth > 4) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPermissiveStringCandidates(candidates, entry, `${prefix}[${index}]`, depth + 1));
    return;
  }

  const record = readObject(value);
  Object.entries(record).forEach(([key, entry]) => {
    const nextPrefix = `${prefix}.${key}`;
    if (typeof entry === 'string' && looksImageish(entry)) {
      pushCandidate(
        candidates,
        key.toLowerCase().includes('avatar') ? 'avatar' : 'media',
        nextPrefix,
        entry,
        'character-reference-images',
      );
    }

    if (entry && typeof entry === 'object') {
      collectPermissiveStringCandidates(candidates, entry, nextPrefix, depth + 1);
    }
  });
}

function buildReferenceCandidates(
  selfCharacter: CharacterProfile | Record<string, unknown> | null | undefined,
  profile?: LumoraProfile | null,
): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  const characterRecord = readObject(selfCharacter);
  const profileRecord = readObject(profile);
  const userId = typeof characterRecord.ownerUserId === 'string' && characterRecord.ownerUserId !== 'local'
    ? characterRecord.ownerUserId
    : typeof profileRecord.userId === 'string'
      ? profileRecord.userId
      : typeof profileRecord.id === 'string'
        ? profileRecord.id
        : null;

  pushKnownReferenceCandidates(
    candidates,
    readObject(characterRecord.referenceImageUrls),
    'selfCharacter.referenceImageUrls',
    'character-reference-images',
    userId,
  );
  pushKnownReferenceCandidates(
    candidates,
    readObject(characterRecord.referencePhotoNames),
    'selfCharacter.referencePhotoNames',
    'character-reference-images',
    userId,
  );
  pushKnownReferenceCandidates(
    candidates,
    readObject(characterRecord.selfReferencePhotoNames),
    'selfCharacter.selfReferencePhotoNames',
    'character-reference-images',
    userId,
  );
  pushKnownReferenceCandidates(candidates, characterRecord, 'selfCharacter', 'character-reference-images', userId);
  pushKnownReferenceCandidates(
    candidates,
    readObject(profileRecord.selfReferenceImageUrls),
    'profile.selfReferenceImageUrls',
    'character-reference-images',
    userId,
  );
  pushKnownReferenceCandidates(
    candidates,
    readObject(profileRecord.selfReferencePhotoNames),
    'profile.selfReferencePhotoNames',
    'character-reference-images',
    userId,
  );
  pushCandidate(candidates, 'avatar', 'profile.defaultSelfCharacterAvatar', profileRecord.defaultSelfCharacterAvatar, 'character-reference-images', userId);
  pushCandidate(candidates, 'avatar', 'profile.avatar', profileRecord.avatar, 'character-reference-images', userId);
  collectMediaUrlCandidates(candidates, characterRecord, 'selfCharacter');
  collectMediaUrlCandidates(candidates, profileRecord, 'profile');
  collectPermissiveStringCandidates(candidates, characterRecord, 'selfCharacter');
  collectPermissiveStringCandidates(candidates, profileRecord, 'profile');

  return candidates;
}

function slotPriority(slot: ReferenceCandidate['slot']) {
  if (slot === 'frontFace') return 0;
  if (slot === 'fullBody') return 1;
  if (slot === 'leftAngle') return 2;
  if (slot === 'rightAngle') return 3;
  if (slot === 'avatar') return 4;
  if (slot === 'image') return 5;
  return 6;
}

async function resolveCandidateUrl(candidate: ReferenceCandidate): Promise<ResolvedCandidate> {
  const refreshedStorageUrl = await storagePathToUrl(candidate.value, candidate.bucket, candidate.userId);
  if (refreshedStorageUrl) {
    return {
      url: refreshedStorageUrl.url,
      source: refreshedStorageUrl.source,
      rejectionReason: null,
    };
  }

  return {
    url: null,
    source: null,
    rejectionReason: rejectionReason(candidate.value),
  };
}

function slotLabel(candidate: ReferenceCandidate): string {
  if (candidate.slot === 'frontFace') return 'Front face';
  if (candidate.slot === 'fullBody') return 'Full body';
  if (candidate.slot === 'leftAngle') return 'Left angle';
  if (candidate.slot === 'rightAngle') return 'Right angle';
  if (candidate.slot === 'avatar') return 'Avatar';
  return candidate.label;
}

function addReferenceImageUrl(
  referenceImageUrls: Partial<ReferenceImageUrls>,
  slot: ReferenceCandidate['slot'],
  url: string,
) {
  if (
    slot === 'frontFace' ||
    slot === 'fullBody' ||
    slot === 'leftAngle' ||
    slot === 'rightAngle' ||
    slot === 'expressive'
  ) {
    referenceImageUrls[slot] = referenceImageUrls[slot] || url;
  }
}

export async function getSelfCharacterReferenceImage(input: {
  selfCharacter: CharacterProfile | Record<string, unknown> | null | undefined;
  profile?: LumoraProfile | null;
}): Promise<SelfCharacterReferenceImage> {
  const characterRecord = readObject(input.selfCharacter);
  const referenceRecord = readObject(characterRecord.referenceImageUrls);
  const referencePhotoNames = readObject(characterRecord.referencePhotoNames);
  const selfReferencePhotoNames = readObject(characterRecord.selfReferencePhotoNames);
  const profileRecord = readObject(input.profile);
  const profileReferenceRecord = readObject(profileRecord.selfReferenceImageUrls);
  const profileReferencePhotoNames = readObject(profileRecord.selfReferencePhotoNames);
  const fieldsChecked = {
    frontFace: referenceRecord.frontFace ?? characterRecord.frontFace ?? profileReferenceRecord.frontFace ?? null,
    frontFacePhotoName:
      referencePhotoNames.frontFace ??
      selfReferencePhotoNames.frontFace ??
      profileReferencePhotoNames.frontFace ??
      null,
    frontFaceUrl: referenceRecord.frontFaceUrl ?? characterRecord.frontFaceUrl ?? profileReferenceRecord.frontFaceUrl ?? null,
    frontImage: referenceRecord.frontImage ?? characterRecord.frontImage ?? profileReferenceRecord.frontImage ?? null,
    fullBody: referenceRecord.fullBody ?? characterRecord.fullBody ?? profileReferenceRecord.fullBody ?? null,
    leftAngle: referenceRecord.leftAngle ?? characterRecord.leftAngle ?? profileReferenceRecord.leftAngle ?? null,
    rightAngle: referenceRecord.rightAngle ?? characterRecord.rightAngle ?? profileReferenceRecord.rightAngle ?? null,
    avatar:
      characterRecord.avatar ??
      characterRecord.avatarUrl ??
      profileRecord.defaultSelfCharacterAvatar ??
      profileRecord.avatar ??
      null,
    imageUrl: referenceRecord.imageUrl ?? characterRecord.imageUrl ?? profileRecord.imageUrl ?? null,
  };
  const candidates = buildReferenceCandidates(input.selfCharacter, input.profile)
    .sort((a, b) => slotPriority(a.slot) - slotPriority(b.slot));
  const inspectedFields = candidates.map((candidate) => ({
    label: candidate.label,
    slot: candidate.slot,
    hasValue: Boolean(candidate.value),
    valuePreview: previewValue(candidate.value),
  }));
  const referenceImageUrls: Partial<ReferenceImageUrls> = {};

  console.log('SELF CHARACTER RAW:', input.selfCharacter);
  console.log('FIELDS CHECKED:', fieldsChecked);
  console.log('REFERENCE CANDIDATES:', candidates.map((candidate) => ({
    label: candidate.label,
    slot: candidate.slot,
    bucket: candidate.bucket,
    value: candidate.value,
    valuePreview: previewValue(candidate.value),
    prefilterReason: rejectionReason(candidate.value),
  })));
  console.log('[getSelfCharacterReferenceImage] inspected fields', {
    selfCharacterId: readObject(input.selfCharacter).id ?? null,
    candidateCount: candidates.length,
    inspectedFields,
  });

  let selectedUrl: string | null = null;
  let selectedLabel: string | null = null;
  let selectedSlot: string | null = null;

  for (const candidate of candidates) {
    const resolved = await resolveCandidateUrl(candidate);
    if (!resolved.url) {
      console.log('REFERENCE CANDIDATE REJECTED:', {
        label: candidate.label,
        slot: candidate.slot,
        valuePreview: previewValue(candidate.value),
        reason: resolved.rejectionReason,
      });
      continue;
    }

    console.log('REFERENCE CANDIDATE ACCEPTED:', {
      label: candidate.label,
      slot: candidate.slot,
      source: resolved.source,
      urlPreview: previewValue(resolved.url),
    });

    if (
      candidate.slot === 'frontFace' ||
      candidate.slot === 'fullBody' ||
      candidate.slot === 'leftAngle' ||
      candidate.slot === 'rightAngle' ||
      candidate.slot === 'expressive'
    ) {
      addReferenceImageUrl(referenceImageUrls, candidate.slot, resolved.url);
    }

    if (!selectedUrl) {
      selectedUrl = resolved.url;
      selectedLabel = slotLabel(candidate);
      selectedSlot = candidate.slot;
    }
  }

  if (selectedUrl) {
    console.log('[getSelfCharacterReferenceImage] selected reference image', {
      label: selectedLabel,
      slot: selectedSlot,
      urlPreview: previewValue(selectedUrl),
      referenceImageUrls: Object.keys(referenceImageUrls),
    });

    return {
      url: selectedUrl,
      label: selectedLabel,
      slot: selectedSlot,
      referenceImageUrls,
      inspectedFields,
    };
  }

  console.log('[getSelfCharacterReferenceImage] no valid reference image found', {
    inspectedFields,
  });

  return {
    url: null,
    label: null,
    slot: null,
    referenceImageUrls,
    inspectedFields,
  };
}
