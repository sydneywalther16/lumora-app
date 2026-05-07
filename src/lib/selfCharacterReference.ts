import type { CharacterProfile, ReferenceImageUrls } from './api';
import type { LumoraProfile } from './profileStorage';
import { supabase } from './supabase';

const SUPABASE_STORAGE_BUCKETS = [
  'character-reference-images',
  'avatars',
  'self-capture-videos',
  'reference-images',
  'media-assets',
] as const;

type ReferenceBucket = (typeof SUPABASE_STORAGE_BUCKETS)[number];
type ReferenceSlot = keyof ReferenceImageUrls | 'avatar' | 'image' | 'media';

type ReferenceCandidate = {
  slot: ReferenceSlot;
  label: string;
  value: unknown;
  userId?: string | null;
};

type StoragePath = {
  bucket: ReferenceBucket;
  objectPath: string;
};

type ResolvedCandidate = {
  url: string | null;
  source: string | null;
  rejectionReason: string | null;
};

type PublicImageValidation = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  error: string | null;
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

const knownImageKeys = new Set([
  'frontFace',
  'frontFaceUrl',
  'frontImage',
  'frontImageUrl',
  'front',
  'face',
  'primary',
  'fullBody',
  'fullBodyUrl',
  'body',
  'full',
  'leftAngle',
  'leftAngleUrl',
  'left',
  'rightAngle',
  'rightAngleUrl',
  'right',
  'avatar',
  'avatarUrl',
  'image',
  'imageUrl',
  'media',
  'mediaUrl',
  'url',
  'publicUrl',
  'signedUrl',
  'objectPath',
  'path',
  'fileName',
  'name',
]);

const bucketSet = new Set<string>(SUPABASE_STORAGE_BUCKETS);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

function previewValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 90) return value;
  return `${value.slice(0, 54)}...${value.slice(-18)}`;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanCandidateValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;

  const lowerValue = raw.toLowerCase();
  if (
    lowerValue.startsWith('blob:') ||
    lowerValue.startsWith('data:') ||
    lowerValue.startsWith('file:')
  ) {
    return null;
  }

  if (
    raw.startsWith('/') ||
    raw.startsWith('./') ||
    raw.startsWith('../') ||
    /^(?:profile|selfCharacter)\.[a-zA-Z0-9_.]+$/.test(raw)
  ) {
    return null;
  }

  return raw;
}

function cleanHttpUrl(value: string): string | null {
  const raw = cleanCandidateValue(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) return null;

    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeStoragePath(value: string): string {
  return value
    .trim()
    .replace(/^(\.\/|\.\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/^storage\/v1\/object\/(?:public|sign)\//, '');
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeStoragePath(value: string): string {
  return normalizeStoragePath(decodePath(value))
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function splitBucketPath(value: string): StoragePath | null {
  const normalized = normalizeStoragePath(value);
  const [maybeBucket, ...pathParts] = normalized.split('/');
  if (!bucketSet.has(maybeBucket) || pathParts.length === 0) return null;

  return {
    bucket: maybeBucket as ReferenceBucket,
    objectPath: pathParts.join('/'),
  };
}

function storagePathFromSupabaseUrl(value: string): StoragePath | null {
  try {
    const parsed = new URL(value);
    const marker = '/storage/v1/object/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const storagePath = decodePath(parsed.pathname.slice(markerIndex + marker.length));
    const match = storagePath.match(/^(?:public|sign)\/([^/]+)\/(.+)$/);
    const bucket = match?.[1];
    const objectPath = match?.[2];

    if (!bucket || !objectPath || !bucketSet.has(bucket)) return null;
    return {
      bucket: bucket as ReferenceBucket,
      objectPath,
    };
  } catch {
    return null;
  }
}

function publicUrlForStoragePath(storagePath: StoragePath): string | null {
  if (!supabaseUrl) return null;

  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const encodedPath = encodeStoragePath(storagePath.objectPath);
  if (!encodedPath) return null;

  const publicUrl = `${baseUrl}/storage/v1/object/public/${storagePath.bucket}/${encodedPath}`;
  console.log('TRY PUBLIC URL', {
    bucket: storagePath.bucket,
    path: storagePath.objectPath,
    publicUrl,
  });

  return cleanHttpUrl(publicUrl);
}

function uniqueStoragePaths(paths: StoragePath[]): StoragePath[] {
  const seen = new Set<string>();

  return paths.filter((path) => {
    const key = `${path.bucket}/${path.objectPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function storagePathsForObjectPath(objectPath: string, preferredBucket?: ReferenceBucket): StoragePath[] {
  const orderedBuckets = preferredBucket
    ? [preferredBucket, ...SUPABASE_STORAGE_BUCKETS.filter((bucket) => bucket !== preferredBucket)]
    : [...SUPABASE_STORAGE_BUCKETS];

  return uniqueStoragePaths(
    orderedBuckets.map((bucket) => ({
      bucket,
      objectPath,
    })),
  );
}

function uniqueUrls(urls: Array<string | null>): string[] {
  const seen = new Set<string>();

  return urls.flatMap((url) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function toPublicSupabaseUrlCandidates(value: string): string[] {
  const raw = cleanCandidateValue(value);
  if (!raw) return [];
  const candidates: Array<string | null> = [];

  const storageUrlPath = storagePathFromSupabaseUrl(raw);
  if (storageUrlPath) {
    candidates.push(
      ...storagePathsForObjectPath(storageUrlPath.objectPath, storageUrlPath.bucket)
        .map(publicUrlForStoragePath),
    );
    return uniqueUrls(candidates);
  }

  const bucketPath = splitBucketPath(raw);
  if (bucketPath) {
    candidates.push(
      ...storagePathsForObjectPath(bucketPath.objectPath, bucketPath.bucket)
        .map(publicUrlForStoragePath),
    );
    return uniqueUrls(candidates);
  }

  if (/^https?:\/\//i.test(raw)) {
    candidates.push(cleanHttpUrl(raw));
    return uniqueUrls(candidates);
  }

  const normalized = normalizeStoragePath(raw);
  if (!normalized || normalized.includes(' ')) {
    return [];
  }

  const canBeStorageObject =
    normalized.includes('/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(normalized) ||
    SUPABASE_STORAGE_BUCKETS.some((bucket) => normalized.toLowerCase().includes(bucket));
  if (!canBeStorageObject) return [];

  candidates.push(
    ...storagePathsForObjectPath(normalized)
      .map(publicUrlForStoragePath),
  );

  return uniqueUrls(candidates);
}

export function toPublicSupabaseUrl(value: string): string | null {
  return toPublicSupabaseUrlCandidates(value)[0] ?? null;
}

async function validatePublicImageUrl(url: string): Promise<PublicImageValidation> {
  const methods: Array<'HEAD' | 'GET'> = ['HEAD', 'GET'];
  let lastValidation: PublicImageValidation = {
    ok: false,
    status: null,
    contentType: null,
    error: null,
  };

  for (const method of methods) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);

    try {
      console.log('VALIDATING REFERENCE URL', { url, method });
      const response = await fetch(url, {
        method,
        cache: 'no-store',
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';

      console.log('REFERENCE FETCH STATUS', {
        url,
        method,
        status: response.status,
        ok: response.ok,
      });
      console.log('REFERENCE CONTENT TYPE', {
        url,
        method,
        contentType,
      });

      if (method === 'GET') {
        void response.body?.cancel();
      }

      lastValidation = {
        ok: response.ok && contentType.toLowerCase().startsWith('image/'),
        status: response.status,
        contentType,
        error: response.ok ? null : response.statusText,
      };

      if (lastValidation.ok) return lastValidation;
    } catch (error) {
      lastValidation = {
        ok: false,
        status: null,
        contentType: null,
        error: error instanceof Error ? error.message : 'Unable to fetch reference image.',
      };
      console.log('REFERENCE FETCH STATUS', {
        url,
        method,
        status: null,
        ok: false,
        error: lastValidation.error,
      });
      console.log('REFERENCE CONTENT TYPE', {
        url,
        method,
        contentType: null,
      });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  return lastValidation;
}

function rejectionReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'empty';

  const trimmed = value.trim();
  const lowerValue = trimmed.toLowerCase();
  if (lowerValue.startsWith('blob:')) return 'blob:';
  if (lowerValue.startsWith('data:')) return 'data:';
  if (lowerValue.startsWith('file:')) return 'local file';
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return 'relative path';
  if (/^(?:profile|selfCharacter)\.[a-zA-Z0-9_.]+$/.test(trimmed)) return 'field key';
  return null;
}

function looksLikeReferenceString(value: string): boolean {
  const lowerValue = value.toLowerCase();
  return (
    lowerValue.includes('supabase') ||
    lowerValue.includes('storage') ||
    lowerValue.includes('/object/') ||
    SUPABASE_STORAGE_BUCKETS.some((bucket) => lowerValue.includes(bucket)) ||
    /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(value)
  );
}

function candidateSlotForKey(key: string): ReferenceSlot {
  const normalized = key.toLowerCase();
  if (normalized.includes('front') || normalized === 'face' || normalized === 'primary') return 'frontFace';
  if (normalized.includes('full') || normalized.includes('body')) return 'fullBody';
  if (normalized.includes('left')) return 'leftAngle';
  if (normalized.includes('right')) return 'rightAngle';
  if (normalized.includes('avatar')) return 'avatar';
  if (normalized.includes('image')) return 'image';
  return 'media';
}

function pushCandidate(
  candidates: ReferenceCandidate[],
  slot: ReferenceSlot,
  label: string,
  value: unknown,
  userId?: string | null,
) {
  candidates.push({ slot, label, value, userId });
}

function pushKnownReferenceCandidates(
  candidates: ReferenceCandidate[],
  source: Record<string, unknown>,
  prefix: string,
  userId?: string | null,
) {
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFace`, source.frontFace, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontFaceUrl`, source.frontFaceUrl, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImage`, source.frontImage, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.frontImageUrl`, source.frontImageUrl, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.front`, source.front, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.face`, source.face, userId);
  pushCandidate(candidates, 'frontFace', `${prefix}.primary`, source.primary, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBody`, source.fullBody, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.fullBodyUrl`, source.fullBodyUrl, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.body`, source.body, userId);
  pushCandidate(candidates, 'fullBody', `${prefix}.full`, source.full, userId);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngle`, source.leftAngle, userId);
  pushCandidate(candidates, 'leftAngle', `${prefix}.leftAngleUrl`, source.leftAngleUrl, userId);
  pushCandidate(candidates, 'leftAngle', `${prefix}.left`, source.left, userId);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngle`, source.rightAngle, userId);
  pushCandidate(candidates, 'rightAngle', `${prefix}.rightAngleUrl`, source.rightAngleUrl, userId);
  pushCandidate(candidates, 'rightAngle', `${prefix}.right`, source.right, userId);
  pushCandidate(candidates, 'avatar', `${prefix}.avatar`, source.avatar, userId);
  pushCandidate(candidates, 'avatar', `${prefix}.avatarUrl`, source.avatarUrl, userId);
  pushCandidate(candidates, 'image', `${prefix}.image`, source.image, userId);
  pushCandidate(candidates, 'image', `${prefix}.imageUrl`, source.imageUrl, userId);
  pushCandidate(candidates, 'media', `${prefix}.mediaUrl`, source.mediaUrl, userId);
  pushCandidate(candidates, 'media', `${prefix}.url`, source.url, userId);
  pushCandidate(candidates, 'media', `${prefix}.publicUrl`, source.publicUrl, userId);
  pushCandidate(candidates, 'media', `${prefix}.signedUrl`, source.signedUrl, userId);
  pushCandidate(candidates, 'media', `${prefix}.objectPath`, source.objectPath, userId);
  pushCandidate(candidates, 'media', `${prefix}.path`, source.path, userId);
  pushCandidate(candidates, 'media', `${prefix}.fileName`, source.fileName, userId);
}

function collectNestedReferenceCandidates(
  candidates: ReferenceCandidate[],
  value: unknown,
  prefix: string,
  userId?: string | null,
  depth = 0,
) {
  if (depth > 5) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string') {
        pushCandidate(candidates, 'media', `${prefix}[${index}]`, entry, userId);
        return;
      }

      collectNestedReferenceCandidates(candidates, entry, `${prefix}[${index}]`, userId, depth + 1);
    });
    return;
  }

  const record = readObject(value);
  Object.entries(record).forEach(([key, entry]) => {
    const nextPrefix = `${prefix}.${key}`;

    if (typeof entry === 'string') {
      if (knownImageKeys.has(key) || looksLikeReferenceString(entry)) {
        pushCandidate(candidates, candidateSlotForKey(key), nextPrefix, entry, userId);
      }
      return;
    }

    if (entry && typeof entry === 'object') {
      collectNestedReferenceCandidates(candidates, entry, nextPrefix, userId, depth + 1);
    }
  });
}

function uniqueCandidates(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const value = stringValue(candidate.value);
    const key = `${candidate.label}|${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildReferenceCandidates(
  selfCharacter: CharacterProfile | Record<string, unknown> | null | undefined,
  profile?: LumoraProfile | null,
): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  const characterRecord = readObject(selfCharacter);
  const profileRecord = readObject(profile);
  const stylePreferences = readObject(characterRecord.stylePreferences);
  const userId = typeof characterRecord.ownerUserId === 'string' && characterRecord.ownerUserId !== 'local'
    ? characterRecord.ownerUserId
    : typeof profileRecord.userId === 'string'
      ? profileRecord.userId
      : typeof profileRecord.id === 'string'
        ? profileRecord.id
        : null;

  pushKnownReferenceCandidates(candidates, readObject(characterRecord.referenceImageUrls), 'selfCharacter.referenceImageUrls', userId);
  pushKnownReferenceCandidates(candidates, readObject(characterRecord.referencePhotoNames), 'selfCharacter.referencePhotoNames', userId);
  pushKnownReferenceCandidates(candidates, readObject(characterRecord.selfReferencePhotoNames), 'selfCharacter.selfReferencePhotoNames', userId);
  pushKnownReferenceCandidates(candidates, characterRecord, 'selfCharacter', userId);
  pushKnownReferenceCandidates(candidates, readObject(profileRecord.selfReferenceImageUrls), 'profile.selfReferenceImageUrls', userId);
  pushKnownReferenceCandidates(candidates, readObject(profileRecord.selfReferencePhotoNames), 'profile.selfReferencePhotoNames', userId);
  pushKnownReferenceCandidates(candidates, profileRecord, 'profile', userId);
  pushKnownReferenceCandidates(candidates, readObject(stylePreferences.creatorSelfEditorDraft), 'selfCharacter.stylePreferences.creatorSelfEditorDraft', userId);
  pushKnownReferenceCandidates(candidates, readObject(profileRecord.selfCharacterEditorDraft), 'profile.selfCharacterEditorDraft', userId);

  collectNestedReferenceCandidates(candidates, characterRecord, 'selfCharacter', userId);
  collectNestedReferenceCandidates(candidates, profileRecord, 'profile', userId);

  return uniqueCandidates(candidates).sort((a, b) => slotPriority(a.slot) - slotPriority(b.slot));
}

function slotPriority(slot: ReferenceSlot) {
  if (slot === 'frontFace') return 0;
  if (slot === 'fullBody') return 1;
  if (slot === 'leftAngle') return 2;
  if (slot === 'rightAngle') return 3;
  if (slot === 'avatar') return 4;
  if (slot === 'image') return 5;
  return 6;
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
  slot: ReferenceSlot,
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

function valueLooksLikeBareFileName(value: string): boolean {
  return !value.includes('/') && /\.(png|jpe?g|webp|gif)$/i.test(value);
}

async function lookupMediaAssetUrlCandidates(
  value: string,
  userId?: string | null,
): Promise<Array<{ url: string; source: string }>> {
  if (!supabase || !userId) return [];
  const client = supabase;

  const cleanValue = cleanCandidateValue(value);
  if (!cleanValue) return [];

  const normalizedPath = normalizeStoragePath(cleanValue);
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  const lookups: Array<{
    label: string;
    query: () => Promise<{ data: unknown[] | null; error: unknown }>;
  }> = [];

  if (normalizedPath.includes('/')) {
    lookups.push({
      label: 'object_path',
      query: async () => {
        const { data, error } = await client
          .from('media_assets')
          .select('bucket, object_path')
          .eq('user_id', userId)
          .eq('object_path', normalizedPath)
          .limit(8);
        return { data, error };
      },
    });
  }

  lookups.push({
    label: 'file_name',
    query: async () => {
      const { data, error } = await client
        .from('media_assets')
        .select('bucket, object_path')
        .eq('user_id', userId)
        .eq('file_name', fileName)
        .order('updated_at', { ascending: false })
        .limit(8);
      return { data, error };
    },
  });

  lookups.push({
    label: 'object_path_suffix',
    query: async () => {
      const { data, error } = await client
        .from('media_assets')
        .select('bucket, object_path')
        .eq('user_id', userId)
        .ilike('object_path', `%${fileName}`)
        .order('updated_at', { ascending: false })
        .limit(8);
      return { data, error };
    },
  });

  const results: Array<{ url: string; source: string }> = [];
  const seen = new Set<string>();

  for (const lookup of lookups) {
    try {
      const { data, error } = await lookup.query();
      if (error) {
        console.warn('[getSelfCharacterReferenceImage] media_assets lookup failed:', {
          lookup: lookup.label,
          value: cleanValue,
          error,
        });
        continue;
      }

      const assets = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
      for (const asset of assets) {
        const bucket = typeof asset?.bucket === 'string' && bucketSet.has(asset.bucket)
          ? asset.bucket as ReferenceBucket
          : null;
        const objectPath = typeof asset?.object_path === 'string' ? asset.object_path : null;

        if (bucket && objectPath) {
          const url = publicUrlForStoragePath({ bucket, objectPath });
          if (url && !seen.has(url)) {
            seen.add(url);
            results.push({
              url,
              source: `media_assets.${lookup.label}`,
            });
          }
        }
      }
    } catch (error) {
      console.warn('[getSelfCharacterReferenceImage] media_assets lookup crashed:', {
        lookup: lookup.label,
        value: cleanValue,
        error,
      });
    }
  }

  return results;
}

async function resolveCandidateUrl(candidate: ReferenceCandidate): Promise<ResolvedCandidate> {
  const value = cleanCandidateValue(candidate.value);
  if (!value) {
    return {
      url: null,
      source: null,
      rejectionReason: rejectionReason(candidate.value),
    };
  }

  const publicUrlCandidates = toPublicSupabaseUrlCandidates(value).map((url) => ({
    url,
    source: 'public-url',
  }));
  const mediaAssetUrlCandidates = await lookupMediaAssetUrlCandidates(value, candidate.userId);
  const orderedCandidates = valueLooksLikeBareFileName(value)
    ? [...mediaAssetUrlCandidates, ...publicUrlCandidates]
    : [...publicUrlCandidates, ...mediaAssetUrlCandidates];
  const uniqueUrlCandidates = orderedCandidates.filter((urlCandidate, index, array) =>
    array.findIndex((entry) => entry.url === urlCandidate.url) === index,
  );

  for (const urlCandidate of uniqueUrlCandidates) {
    const validation = await validatePublicImageUrl(urlCandidate.url);

    if (validation.ok) {
      return {
        url: urlCandidate.url,
        source: urlCandidate.source,
        rejectionReason: null,
      };
    }

    console.log('REFERENCE CANDIDATE REJECTED:', {
      label: candidate.label,
      slot: candidate.slot,
      valuePreview: previewValue(candidate.value),
      urlPreview: previewValue(urlCandidate.url),
      reason: 'public fetch validation failed',
      status: validation.status,
      contentType: validation.contentType,
      error: validation.error,
    });
  }

  return {
    url: null,
    source: null,
    rejectionReason: rejectionReason(candidate.value) ?? (
      uniqueUrlCandidates.length
        ? 'reference image is not publicly accessible'
        : 'unresolved storage reference'
    ),
  };
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
  const candidates = buildReferenceCandidates(input.selfCharacter, input.profile);
  const inspectedFields = candidates.map((candidate) => ({
    label: candidate.label,
    slot: candidate.slot,
    hasValue: Boolean(candidate.value),
    valuePreview: previewValue(candidate.value),
  }));
  const referenceImageUrls: Partial<ReferenceImageUrls> = {};

  console.log('SELF CHARACTER RAW', input.selfCharacter);
  console.log('FIELDS CHECKED:', fieldsChecked);
  console.log('REFERENCE CANDIDATES', candidates.map((candidate) => ({
    label: candidate.label,
    slot: candidate.slot,
    value: candidate.value,
    valuePreview: previewValue(candidate.value),
    rejectionReason: rejectionReason(candidate.value),
  })));

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

    addReferenceImageUrl(referenceImageUrls, candidate.slot, resolved.url);

    if (!selectedUrl) {
      selectedUrl = resolved.url;
      selectedLabel = slotLabel(candidate);
      selectedSlot = candidate.slot;
    }
  }

  console.log('FINAL referenceImageUrl', selectedUrl);

  return {
    url: selectedUrl,
    label: selectedLabel,
    slot: selectedSlot,
    referenceImageUrls,
    inspectedFields,
  };
}
