import type { CharacterProfile, ReferenceImageUrls } from './api';
import type { LumoraProfile } from './profileStorage';
import { supabase } from './supabase';

type ReferenceBucket = 'character-reference-images' | 'avatars';

type ReferenceCandidate = {
  slot: keyof ReferenceImageUrls | 'avatar' | 'image' | 'media';
  label: string;
  value: unknown;
  bucket: ReferenceBucket;
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

function isValidPublicUrl(value: unknown): boolean {
  if (typeof value !== 'string' || isTransientOrLocalUrl(value)) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storagePathFromValue(value: unknown, bucket: ReferenceBucket): string | null {
  if (typeof value !== 'string') return null;
  if (isValidPublicUrl(value) || isTransientOrLocalUrl(value)) return null;

  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.includes(' ') || !trimmed.includes('/')) return null;

  if (trimmed.startsWith(`${bucket}/`)) {
    return trimmed.slice(bucket.length + 1);
  }

  if (/\.(png|jpe?g|webp|gif)$/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function storagePathFromSupabaseUrl(value: string, bucket: ReferenceBucket): string | null {
  try {
    const parsed = new URL(value);
    const marker = `/storage/v1/object/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const objectPath = parsed.pathname.slice(markerIndex + marker.length);
    const bucketPathMatch = objectPath.match(new RegExp(`^(?:public|sign)/${bucket}/(.+)$`));
    return bucketPathMatch?.[1] ? decodeURIComponent(bucketPathMatch[1]) : null;
  } catch {
    return null;
  }
}

async function storagePathToUrl(value: unknown, bucket: ReferenceBucket): Promise<string | null> {
  const objectPath = typeof value === 'string' && isValidPublicUrl(value)
    ? storagePathFromSupabaseUrl(value, bucket)
    : storagePathFromValue(value, bucket);
  if (!objectPath || !supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, 60 * 60 * 24);

    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (error) {
    console.warn('[getSelfCharacterReferenceImage] Unable to create signed reference URL:', {
      bucket,
      error,
    });
  }

  try {
    return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  } catch {
    return null;
  }
}

function pushCandidate(
  candidates: ReferenceCandidate[],
  slot: ReferenceCandidate['slot'],
  label: string,
  value: unknown,
  bucket: ReferenceBucket,
) {
  candidates.push({ slot, label, value, bucket });
}

function pushKnownReferenceCandidates(
  candidates: ReferenceCandidate[],
  source: Record<string, unknown>,
  prefix: string,
  bucket: ReferenceBucket,
) {
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFace`, source.frontFace, bucket);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFaceUrl`, source.frontFaceUrl, bucket);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImage`, source.frontImage, bucket);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImageUrl`, source.frontImageUrl, bucket);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBody`, source.fullBody, bucket);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBodyUrl`, source.fullBodyUrl, bucket);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngle`, source.leftAngle, bucket);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngleUrl`, source.leftAngleUrl, bucket);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngle`, source.rightAngle, bucket);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngleUrl`, source.rightAngleUrl, bucket);
  pushCandidate(candidates, 'avatar', `${prefix}.avatar`, source.avatar, 'avatars');
  pushCandidate(candidates, 'avatar', `${prefix}.avatarUrl`, source.avatarUrl, 'avatars');
  pushCandidate(candidates, 'image', `${prefix}.imageUrl`, source.imageUrl, bucket);
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
        key.toLowerCase().includes('avatar') ? 'avatars' : 'character-reference-images',
      );
    }

    if (entry && typeof entry === 'object') {
      collectMediaUrlCandidates(candidates, entry, nextPrefix, depth + 1);
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

  pushKnownReferenceCandidates(
    candidates,
    readObject(characterRecord.referenceImageUrls),
    'selfCharacter.referenceImageUrls',
    'character-reference-images',
  );
  pushKnownReferenceCandidates(candidates, characterRecord, 'selfCharacter', 'character-reference-images');
  pushKnownReferenceCandidates(
    candidates,
    readObject(profileRecord.selfReferenceImageUrls),
    'profile.selfReferenceImageUrls',
    'character-reference-images',
  );
  pushCandidate(candidates, 'avatar', 'profile.defaultSelfCharacterAvatar', profileRecord.defaultSelfCharacterAvatar, 'character-reference-images');
  pushCandidate(candidates, 'avatar', 'profile.avatar', profileRecord.avatar, 'avatars');
  collectMediaUrlCandidates(candidates, characterRecord, 'selfCharacter');
  collectMediaUrlCandidates(candidates, profileRecord, 'profile');

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

async function resolveCandidateUrl(candidate: ReferenceCandidate): Promise<string | null> {
  const refreshedStorageUrl = await storagePathToUrl(candidate.value, candidate.bucket);
  if (refreshedStorageUrl) return refreshedStorageUrl;
  if (isValidPublicUrl(candidate.value) && typeof candidate.value === 'string') return candidate.value;
  return null;
}

export async function getSelfCharacterReferenceImage(input: {
  selfCharacter: CharacterProfile | Record<string, unknown> | null | undefined;
  profile?: LumoraProfile | null;
}): Promise<SelfCharacterReferenceImage> {
  const candidates = buildReferenceCandidates(input.selfCharacter, input.profile)
    .sort((a, b) => slotPriority(a.slot) - slotPriority(b.slot));
  const inspectedFields = candidates.map((candidate) => ({
    label: candidate.label,
    slot: candidate.slot,
    hasValue: Boolean(candidate.value),
    valuePreview: previewValue(candidate.value),
  }));
  const referenceImageUrls: Partial<ReferenceImageUrls> = {};

  console.log('[getSelfCharacterReferenceImage] inspected fields', {
    selfCharacterId: readObject(input.selfCharacter).id ?? null,
    candidateCount: candidates.length,
    inspectedFields,
  });

  let selectedUrl: string | null = null;
  let selectedLabel: string | null = null;
  let selectedSlot: string | null = null;

  for (const candidate of candidates) {
    const url = await resolveCandidateUrl(candidate);
    if (!url) continue;

    if (
      candidate.slot === 'frontFace' ||
      candidate.slot === 'fullBody' ||
      candidate.slot === 'leftAngle' ||
      candidate.slot === 'rightAngle' ||
      candidate.slot === 'expressive'
    ) {
      referenceImageUrls[candidate.slot] = referenceImageUrls[candidate.slot] || url;
    }

    if (!selectedUrl) {
      selectedUrl = url;
      selectedLabel = candidate.slot === 'frontFace'
        ? 'Front face'
        : candidate.slot === 'fullBody'
          ? 'Full body'
          : candidate.label;
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
