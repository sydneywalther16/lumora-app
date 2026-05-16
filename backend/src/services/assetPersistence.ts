import { createHash, randomUUID } from 'node:crypto';
import { env } from '../lib/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';
import type { SeedanceReferenceImage } from './providers/seedanceProvider';

const LUMORA_ASSET_BUCKET = 'lumora-assets';
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

type AssetUsage =
  | 'character_reference_image'
  | 'thumbnail'
  | 'poster'
  | 'continuity_frame'
  | 'storyboard_frame'
  | 'uploaded_image'
  | 'moderation_safe_rewrite'
  | 'scene_reference_image'
  | 'failed_asset_download'
  | 'unsupported_asset_host';

export type PersistedAsset = {
  originalUrl: string;
  sourceUrl: string;
  publicUrl: string;
  objectPath: string | null;
  bucket: string;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  persisted: boolean;
  alreadyControlled: boolean;
};

export type AssetPersistenceSummary = {
  attempted: number;
  persisted: number;
  alreadyControlled: number;
  failed: number;
  unsupportedHosts: string[];
  assets: PersistedAsset[];
};

export type AssetPersistenceFailureReason =
  | 'protected_external_url'
  | 'expired_signed_url'
  | 'invalid_url'
  | 'download_failed'
  | 'asset_too_large'
  | 'unsupported_content_type'
  | 'storage_not_configured'
  | 'storage_upload_failed';

export type AssetPersistenceFailureDiagnostics = {
  code: string;
  reason: AssetPersistenceFailureReason;
  sourceUrl: string | null;
  host: string | null;
  failedReferenceIndex: number | null;
  failedReferenceLabel: string | null;
  failedReferenceRole: string | null;
  originalUrlHost: string | null;
  canContinueWithoutReference: boolean;
};

export class AssetPersistenceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly sourceUrl?: string;
  readonly host?: string;
  readonly reason: AssetPersistenceFailureReason;
  readonly failedReferenceIndex?: number;
  readonly failedReferenceLabel?: string;
  readonly failedReferenceRole?: string;
  readonly canContinueWithoutReference: boolean;

  constructor(input: {
    message: string;
    code: string;
    reason?: AssetPersistenceFailureReason;
    statusCode?: number;
    sourceUrl?: string;
    host?: string;
    failedReferenceIndex?: number;
    failedReferenceLabel?: string;
    failedReferenceRole?: string;
    canContinueWithoutReference?: boolean;
  }) {
    super(input.message);
    this.name = 'AssetPersistenceError';
    this.code = input.code;
    this.statusCode = input.statusCode ?? 424;
    this.sourceUrl = input.sourceUrl;
    this.host = input.host;
    this.reason = input.reason ?? failureReasonForCode(input.code);
    this.failedReferenceIndex = input.failedReferenceIndex;
    this.failedReferenceLabel = input.failedReferenceLabel;
    this.failedReferenceRole = input.failedReferenceRole;
    this.canContinueWithoutReference = Boolean(input.canContinueWithoutReference);
  }

  toDiagnostics(): AssetPersistenceFailureDiagnostics {
    return {
      code: this.code,
      reason: this.reason,
      sourceUrl: this.sourceUrl ?? null,
      host: this.host ?? null,
      failedReferenceIndex: typeof this.failedReferenceIndex === 'number' ? this.failedReferenceIndex : null,
      failedReferenceLabel: this.failedReferenceLabel ?? null,
      failedReferenceRole: this.failedReferenceRole ?? null,
      originalUrlHost: this.host ?? (this.sourceUrl ? sourceHost(this.sourceUrl) : null),
      canContinueWithoutReference: this.canContinueWithoutReference,
    };
  }
}

const runtimeStats = {
  failedDownloads: 0,
  unsupportedHostCounts: new Map<string, number>(),
  failedReferenceLabelCounts: new Map<string, number>(),
  repairableFailures: 0,
};

export function isAssetPersistenceError(error: unknown): error is AssetPersistenceError {
  return error instanceof AssetPersistenceError;
}

function isUuid(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 96) || 'asset';
}

function extensionForContentType(contentType: string | null, fallbackUrl: string) {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'video/quicktime') return 'mov';

  try {
    const pathname = new URL(fallbackUrl).pathname;
    const extension = pathname.split('.').pop()?.toLowerCase();
    if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension;
  } catch {
    // Fall back below.
  }

  return normalized.startsWith('video/') ? 'mp4' : 'jpg';
}

function contentTypeFromUrl(url: string) {
  const extension = extensionForContentType(null, url);
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  return 'image/jpeg';
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function failureReasonForCode(code: string): AssetPersistenceFailureReason {
  if (code === 'unsupported_host' || code === 'protected_external_url') return 'protected_external_url';
  if (code === 'expired_signed_url') return 'expired_signed_url';
  if (code === 'invalid_url') return 'invalid_url';
  if (code === 'asset_too_large') return 'asset_too_large';
  if (code === 'unsupported_content_type') return 'unsupported_content_type';
  if (code === 'storage_not_configured') return 'storage_not_configured';
  if (code === 'storage_upload_failed') return 'storage_upload_failed';
  return 'download_failed';
}

function lumoraStorageHosts() {
  return [env.SUPABASE_URL]
    .flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).hostname.toLowerCase()];
      } catch {
        return [];
      }
    });
}

function isLumoraControlledPublicUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      lumoraStorageHosts().includes(parsed.hostname.toLowerCase()) &&
      parsed.pathname.includes('/storage/v1/object/public/')
    );
  } catch {
    return false;
  }
}

function hasTemporarySignature(url: URL) {
  const tempKeys = [
    'x-amz-signature',
    'x-amz-credential',
    'x-amz-expires',
    'x-amz-date',
    'signature',
    'sig',
    'token',
    'expires',
    'expires_at',
    'exp',
    'se',
  ];

  return tempKeys.some((key) => url.searchParams.has(key) || url.searchParams.has(key.toUpperCase()));
}

function parseEpochLike(value: string | null) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function expiredSignedUrl(url: URL) {
  const now = Date.now();
  const directExpiry =
    parseEpochLike(url.searchParams.get('expires')) ??
    parseEpochLike(url.searchParams.get('Expires')) ??
    parseEpochLike(url.searchParams.get('expires_at')) ??
    parseEpochLike(url.searchParams.get('exp')) ??
    parseEpochLike(url.searchParams.get('se'));

  if (directExpiry && directExpiry <= now) return true;

  const amzDate = url.searchParams.get('X-Amz-Date') ?? url.searchParams.get('x-amz-date');
  const amzExpires = Number(url.searchParams.get('X-Amz-Expires') ?? url.searchParams.get('x-amz-expires'));
  if (amzDate && Number.isFinite(amzExpires)) {
    const compact = amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    const start = Date.parse(compact);
    if (!Number.isNaN(start) && start + (amzExpires * 1000) <= now) return true;
  }

  return false;
}

function normalizeSourceUrl(url: string) {
  const parsed = new URL(url.trim());
  parsed.hash = '';

  if (isLumoraControlledPublicUrl(parsed.toString())) {
    parsed.search = '';
    return parsed.toString();
  }

  return parsed.toString();
}

function blockedHotlinkHost(host: string) {
  return [
    'fbcdn.net',
    'facebook.com',
    'instagram.com',
    'cdninstagram.com',
    'threads.net',
  ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function referenceText(reference: Pick<SeedanceReferenceImage, 'label' | 'role'>) {
  return `${reference.role ?? ''} ${reference.label ?? ''}`.toLowerCase();
}

function isManualReferenceOverride(reference: SeedanceReferenceImage) {
  const text = referenceText(reference);
  return text.includes('manual_reference_override') ||
    text.includes('manual reference') ||
    text.includes('manual override');
}

function isObsoleteManualReference(reference: SeedanceReferenceImage) {
  if (!isManualReferenceOverride(reference)) return false;
  if (!reference.url) return false;
  return !isLumoraControlledPublicUrl(reference.url);
}

function removeObsoleteManualReferences(references: SeedanceReferenceImage[]) {
  const savedLumoraReferenceCount = references.filter((reference) => (
    !isObsoleteManualReference(reference) && isLumoraControlledPublicUrl(reference.url)
  )).length;

  if (!savedLumoraReferenceCount) return references;

  return references.filter((reference) => !isObsoleteManualReference(reference));
}

function imageDimensions(buffer: Buffer, contentType: string | null) {
  const type = contentType?.toLowerCase() ?? '';

  if (type.includes('png') && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  if (type.includes('gif') && buffer.length >= 10) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  }

  if (type.includes('webp') && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
  }

  if ((type.includes('jpeg') || type.includes('jpg')) && buffer.length > 4) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + length;
    }
  }

  return { width: null, height: null };
}

function assetMetadata(input: {
  sourceUrl: string;
  originalUrl: string;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  usage: AssetUsage;
  reason?: string;
}) {
  return {
    originalUrl: input.originalUrl,
    sourceUrl: input.sourceUrl,
    sourceHost: sourceHost(input.sourceUrl),
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    aspectRatio: input.width && input.height ? Number((input.width / input.height).toFixed(4)) : null,
    usage: input.usage,
    reason: input.reason ?? null,
    persistedAt: new Date().toISOString(),
  };
}

async function recordMediaAsset(input: {
  userId?: string | null;
  bucket: string;
  objectPath: string;
  publicUrl?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  usage: AssetUsage;
  entityType?: string | null;
  entityId?: string | null;
  metadata: Record<string, unknown>;
}) {
  if (!supabaseAdmin || !isUuid(input.userId)) return;

  const { error } = await supabaseAdmin
    .from('media_assets')
    .upsert({
      user_id: input.userId,
      bucket: input.bucket,
      object_path: input.objectPath,
      public_url: input.publicUrl ?? null,
      signed_url: null,
      file_name: input.fileName ?? null,
      content_type: input.contentType ?? null,
      size_bytes: input.sizeBytes ?? null,
      usage: input.usage,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'bucket,object_path',
    });

  if (error) {
    console.warn('ASSET PERSISTENCE METADATA SAVE FAILED:', {
      usage: input.usage,
      objectPath: input.objectPath,
      error,
    });
  }
}

async function recordAssetFailure(input: {
  userId?: string | null;
  usage: AssetUsage;
  sourceUrl: string;
  reason: string;
  entityType?: string | null;
  entityId?: string | null;
}) {
  runtimeStats.failedDownloads += 1;
  const host = sourceHost(input.sourceUrl) || 'unknown';
  runtimeStats.unsupportedHostCounts.set(host, (runtimeStats.unsupportedHostCounts.get(host) ?? 0) + 1);

  await recordMediaAsset({
    userId: input.userId,
    bucket: LUMORA_ASSET_BUCKET,
    objectPath: `asset-failures/${randomUUID()}.json`,
    usage: input.usage,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    metadata: assetMetadata({
      sourceUrl: input.sourceUrl,
      originalUrl: input.sourceUrl,
      contentType: 'application/json',
      sizeBytes: null,
      width: null,
      height: null,
      usage: input.usage,
      reason: input.reason,
    }),
  });
}

async function downloadAsset(input: { url: string; expectedKind: 'image' | 'video' | 'any' }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(input.url, {
      signal: controller.signal,
      headers: {
        accept: input.expectedKind === 'video' ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
        'user-agent': 'LumoraAssetPersistence/1.0',
      },
    });

    if (!response.ok) {
      const protectedStatus = response.status === 401 || response.status === 403;
      throw new AssetPersistenceError({
        message: protectedStatus
          ? 'One reference image needs to be re-uploaded before Lumora can use it.'
          : `One reference image could not be saved before Lumora used it (${response.status}).`,
        code: protectedStatus ? 'protected_external_url' : 'download_failed',
        reason: protectedStatus ? 'protected_external_url' : 'download_failed',
        sourceUrl: input.url,
        host: sourceHost(input.url),
      });
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES) {
      throw new AssetPersistenceError({
        message: 'Saving scene references failed because an external asset is too large. Re-upload a smaller image directly to Lumora and try again.',
        code: 'asset_too_large',
        sourceUrl: input.url,
        host: sourceHost(input.url),
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ASSET_BYTES) {
      throw new AssetPersistenceError({
        message: 'Saving scene references failed because an external asset is too large. Re-upload a smaller image directly to Lumora and try again.',
        code: 'asset_too_large',
        sourceUrl: input.url,
        host: sourceHost(input.url),
      });
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || contentTypeFromUrl(input.url);
    if (input.expectedKind === 'image' && !contentType.startsWith('image/')) {
      throw new AssetPersistenceError({
        message: 'Saving scene references failed because an external reference did not return an image. Re-upload the image directly to Lumora and try again.',
        code: 'unsupported_content_type',
        sourceUrl: input.url,
        host: sourceHost(input.url),
      });
    }

    return { buffer, contentType };
  } catch (error) {
    if (isAssetPersistenceError(error)) throw error;
    throw new AssetPersistenceError({
      message: 'One reference image could not be saved before Lumora used it.',
      code: 'download_failed',
      reason: 'download_failed',
      sourceUrl: input.url,
      host: sourceHost(input.url),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function persistAssetUrl(input: {
  userId?: string | null;
  url: string;
  usage: AssetUsage;
  expectedKind?: 'image' | 'video' | 'any';
  entityType?: string | null;
  entityId?: string | null;
  fileNameHint?: string | null;
  required?: boolean;
}): Promise<PersistedAsset> {
  const originalUrl = input.url.trim();
  if (!/^https?:\/\//i.test(originalUrl)) {
    throw new AssetPersistenceError({
      message: 'One reference image needs to be re-uploaded before Lumora can use it.',
      code: 'invalid_url',
      reason: 'invalid_url',
      sourceUrl: originalUrl,
    });
  }

  const parsed = new URL(originalUrl);
  const host = parsed.hostname.toLowerCase();
  const sourceUrl = normalizeSourceUrl(originalUrl);

  if (isLumoraControlledPublicUrl(sourceUrl) && !hasTemporarySignature(parsed)) {
    return {
      originalUrl,
      sourceUrl,
      publicUrl: sourceUrl,
      objectPath: null,
      bucket: LUMORA_ASSET_BUCKET,
      contentType: null,
      sizeBytes: null,
      width: null,
      height: null,
      aspectRatio: null,
      persisted: false,
      alreadyControlled: true,
    };
  }

  if (blockedHotlinkHost(host)) {
    await recordAssetFailure({
      userId: input.userId,
      usage: 'unsupported_asset_host',
      sourceUrl,
      reason: `Blocked hotlink host: ${host}`,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    throw new AssetPersistenceError({
      message: 'One reference image needs to be re-uploaded before Lumora can use it.',
      code: 'unsupported_host',
      reason: 'protected_external_url',
      sourceUrl,
      host,
    });
  }

  if (hasTemporarySignature(parsed) && expiredSignedUrl(parsed)) {
    await recordAssetFailure({
      userId: input.userId,
      usage: 'failed_asset_download',
      sourceUrl,
      reason: 'Expired signed URL',
      entityType: input.entityType,
      entityId: input.entityId,
    });
    throw new AssetPersistenceError({
      message: 'One reference image needs to be re-uploaded before Lumora can use it.',
      code: 'expired_signed_url',
      reason: 'expired_signed_url',
      sourceUrl,
      host,
    });
  }

  if (!supabaseAdmin) {
    throw new AssetPersistenceError({
      message: 'Saving scene references requires Lumora storage. Configure Supabase service role storage and try again.',
      code: 'storage_not_configured',
      sourceUrl,
      host,
    });
  }

  try {
    const { buffer, contentType } = await downloadAsset({
      url: originalUrl,
      expectedKind: input.expectedKind ?? 'image',
    });
    const dimensions = imageDimensions(buffer, contentType);
    const aspectRatio = dimensions.width && dimensions.height
      ? Number((dimensions.width / dimensions.height).toFixed(4))
      : null;
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const extension = extensionForContentType(contentType, sourceUrl);
    const ownerSegment = safePathSegment(input.userId ?? 'anonymous');
    const usageSegment = safePathSegment(input.usage);
    const fileName = safePathSegment(input.fileNameHint ?? `${checksum.slice(0, 16)}.${extension}`);
    const objectPath = `${ownerSegment}/assets/${usageSegment}/${checksum.slice(0, 24)}-${fileName}`;

    const { error } = await supabaseAdmin.storage
      .from(LUMORA_ASSET_BUCKET)
      .upload(objectPath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from(LUMORA_ASSET_BUCKET).getPublicUrl(objectPath);
    const metadata = assetMetadata({
      sourceUrl,
      originalUrl,
      contentType,
      sizeBytes: buffer.length,
      width: dimensions.width,
      height: dimensions.height,
      usage: input.usage,
    });
    await recordMediaAsset({
      userId: input.userId,
      bucket: LUMORA_ASSET_BUCKET,
      objectPath,
      publicUrl: data.publicUrl,
      fileName,
      contentType,
      sizeBytes: buffer.length,
      usage: input.usage,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: {
        ...metadata,
        checksum,
      },
    });

    return {
      originalUrl,
      sourceUrl,
      publicUrl: data.publicUrl,
      objectPath,
      bucket: LUMORA_ASSET_BUCKET,
      contentType,
      sizeBytes: buffer.length,
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio,
      persisted: true,
      alreadyControlled: false,
    };
  } catch (error) {
    if (isAssetPersistenceError(error)) {
      await recordAssetFailure({
        userId: input.userId,
        usage: 'failed_asset_download',
        sourceUrl,
        reason: error.message,
        entityType: input.entityType,
        entityId: input.entityId,
      });
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown storage error';
    await recordAssetFailure({
      userId: input.userId,
      usage: 'failed_asset_download',
      sourceUrl,
      reason: message,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    throw new AssetPersistenceError({
      message: `Saving scene references failed while copying an external asset into Lumora storage: ${message}`,
      code: 'storage_upload_failed',
      sourceUrl,
      host,
    });
  }
}

export async function persistSeedanceReferenceImages(input: {
  userId?: string | null;
  characterId?: string | null;
  projectId?: string | null;
  sceneExecutionId?: string | null;
  referenceImages?: SeedanceReferenceImage[];
  usage?: AssetUsage;
}): Promise<{
  referenceImages: SeedanceReferenceImage[];
  summary: AssetPersistenceSummary;
}> {
  const assets: PersistedAsset[] = [];
  const unsupportedHosts = new Set<string>();
  const persistedReferences: SeedanceReferenceImage[] = [];
  const allReferences = removeObsoleteManualReferences(input.referenceImages ?? []);

  for (const [index, reference] of allReferences.entries()) {
    let asset: PersistedAsset;
    try {
      asset = await persistAssetUrl({
        userId: input.userId,
        url: reference.url,
        usage: input.usage ?? 'scene_reference_image',
        expectedKind: 'image',
        entityType: input.sceneExecutionId ? 'scene_execution' : input.characterId ? 'character_profile' : 'generation',
        entityId: input.sceneExecutionId ?? input.characterId ?? input.projectId ?? null,
        fileNameHint: `${reference.role ?? 'reference'}-${index + 1}`,
        required: true,
      });
    } catch (error) {
      if (!isAssetPersistenceError(error)) throw error;

      const canContinueWithoutReference = referenceCanBeSkipped(allReferences, index);
      const label = reference.label || reference.token || `Reference ${index + 1}`;
      runtimeStats.failedReferenceLabelCounts.set(
        label,
        (runtimeStats.failedReferenceLabelCounts.get(label) ?? 0) + 1,
      );
      if (canContinueWithoutReference) runtimeStats.repairableFailures += 1;

      throw new AssetPersistenceError({
        message: 'One reference image needs to be re-uploaded before Lumora can use it.',
        code: error.code,
        reason: error.reason,
        statusCode: error.statusCode,
        sourceUrl: error.sourceUrl,
        host: error.host,
        failedReferenceIndex: index,
        failedReferenceLabel: label,
        failedReferenceRole: reference.role,
        canContinueWithoutReference,
      });
    }
    assets.push(asset);
    if (asset.alreadyControlled) {
      persistedReferences.push(reference);
    } else {
      persistedReferences.push({
        ...reference,
        url: asset.publicUrl,
      });
    }
  }

  return {
    referenceImages: persistedReferences,
    summary: {
      attempted: input.referenceImages?.length ?? 0,
      persisted: assets.filter((asset) => asset.persisted).length,
      alreadyControlled: assets.filter((asset) => asset.alreadyControlled).length,
      failed: 0,
      unsupportedHosts: Array.from(unsupportedHosts),
      assets,
    },
  };
}

function referenceCanBeSkipped(references: SeedanceReferenceImage[], failedIndex: number) {
  const failed = references[failedIndex];
  if (!failed) return false;
  if (failed.role === 'front_angle' || failed.role === 'side_angle') return false;
  return references.length > 1;
}

export async function persistOptionalAssetUrl(input: Parameters<typeof persistAssetUrl>[0]) {
  try {
    return await persistAssetUrl(input);
  } catch (error) {
    console.warn('OPTIONAL ASSET PERSISTENCE FAILED:', {
      usage: input.usage,
      url: input.url,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

async function lumoraAssetBucketCheck() {
  if (!supabaseAdmin) return 'not_configured';
  const { error } = await supabaseAdmin.storage.getBucket(LUMORA_ASSET_BUCKET);
  return error ? 'missing_or_unreadable' : 'ready';
}

export async function buildAssetPersistenceDiagnostics() {
  const unsupportedHosts = Array.from(runtimeStats.unsupportedHostCounts.entries())
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count);

  try {
    const bucketCheck = await lumoraAssetBucketCheck();
    const result = await query<{
      persistedAssetCount: number;
      failedAssetDownloads: number;
      unsupportedHostEvents: number;
      orphanedAssetReferences: number;
      blockedHosts: number;
      repairableFailures: number;
    }>(
      `select
         coalesce(count(*) filter (where usage not in ('failed_asset_download', 'unsupported_asset_host')), 0)::int as "persistedAssetCount",
         coalesce(count(*) filter (where usage = 'failed_asset_download'), 0)::int as "failedAssetDownloads",
         coalesce(count(*) filter (where usage = 'unsupported_asset_host'), 0)::int as "unsupportedHostEvents",
         coalesce(count(*) filter (where usage = 'unsupported_asset_host'), 0)::int as "blockedHosts",
         0::int as "repairableFailures",
         coalesce(count(*) filter (
           where entity_type = 'character_profile'
             and entity_id is not null
             and not exists (
               select 1
               from character_profiles cp
               where cp.character_id = media_assets.entity_id
                  or cp.id::text = media_assets.entity_id
             )
         ), 0)::int as "orphanedAssetReferences"
       from media_assets`,
    );
    const row = result.rows[0] ?? {
      persistedAssetCount: 0,
      failedAssetDownloads: 0,
      unsupportedHostEvents: 0,
      orphanedAssetReferences: 0,
      blockedHosts: 0,
      repairableFailures: 0,
    };
    const runtimeFailureLabels = Array.from(runtimeStats.failedReferenceLabelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    return {
      ok: row.orphanedAssetReferences === 0,
      bucket: LUMORA_ASSET_BUCKET,
      persistedAssetCount: row.persistedAssetCount,
      failedAssetDownloads: row.failedAssetDownloads + runtimeStats.failedDownloads,
      unsupportedHostEvents: row.unsupportedHostEvents + unsupportedHosts.reduce((sum, entry) => sum + entry.count, 0),
      blockedHosts: row.blockedHosts + unsupportedHosts.reduce((sum, entry) => sum + entry.count, 0),
      unsupportedHosts,
      failedReferenceLabels: runtimeFailureLabels,
      repairableFailures: row.repairableFailures + runtimeStats.repairableFailures,
      mediaAssetsReadWrite: supabaseAdmin ? 'service_role_configured' : 'read_check_only',
      bucketCheck,
      orphanedAssetReferences: row.orphanedAssetReferences,
    };
  } catch (error) {
    const bucketCheck = await lumoraAssetBucketCheck();
    const runtimeFailureLabels = Array.from(runtimeStats.failedReferenceLabelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: false,
      bucket: LUMORA_ASSET_BUCKET,
      persistedAssetCount: 0,
      failedAssetDownloads: runtimeStats.failedDownloads,
      unsupportedHostEvents: unsupportedHosts.reduce((sum, entry) => sum + entry.count, 0),
      blockedHosts: unsupportedHosts.reduce((sum, entry) => sum + entry.count, 0),
      unsupportedHosts,
      failedReferenceLabels: runtimeFailureLabels,
      repairableFailures: runtimeStats.repairableFailures,
      mediaAssetsReadWrite: 'unavailable',
      bucketCheck,
      orphanedAssetReferences: 0,
      error: serializeDiagnosticError(error),
      remediation: 'Apply the creator app persistence migration so media_assets exists.',
    };
  }
}
