import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';

const execFileAsync = promisify(execFile);

export const VERIFICATION_VIDEO_PROVIDER_MAX_BYTES = 50 * 1024 * 1024;
export const VERIFICATION_VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const VERIFICATION_VIDEO_MIN_SECONDS = 2;
export const VERIFICATION_VIDEO_MAX_SECONDS = 15;
const FFMPEG_TIMEOUT_MS = 90_000;
const FFPROBE_TIMEOUT_MS = 8_000;

export const VERIFICATION_VIDEO_NORMALIZATION_TARGET = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  pixelFormat: 'yuv420p',
  videoProfile: 'high',
  width: 720,
  height: 1280,
  durationSeconds: 12,
  maxFileSizeBytes: VERIFICATION_VIDEO_PROVIDER_MAX_BYTES,
  faststart: true,
} as const;

export type VerificationVideoNormalizationReason =
  | 'missing_normalized_asset'
  | 'stale_asset'
  | 'force_refresh'
  | 'skipped_existing_valid_asset'
  | 'original_fallback_allowed';

export type VerificationVideoPreflightMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  fileSizeBytes: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  ffprobeAvailable: boolean;
  preflightOk: boolean;
  needsNormalization: boolean;
  preflightFailureReason: string | null;
};

export type VerificationVideoNormalizationDiagnostics = {
  original: VerificationVideoPreflightMetadata | null;
  normalized: VerificationVideoPreflightMetadata | null;
  normalizationTriggered: boolean;
  normalizationReason: VerificationVideoNormalizationReason | null;
  normalizedAssetUsed: boolean;
  normalizedAssetPathPresent: boolean;
  normalizedStatus: 'not_needed' | 'ready' | 'created' | 'unavailable' | 'failed';
  failureReason: string | null;
};

export type VerificationVideoPreparationResult =
  | {
      ok: true;
      bucket: string;
      objectPath: string;
      diagnostics: VerificationVideoNormalizationDiagnostics;
    }
  | {
      ok: false;
      bucket: string;
      objectPath: string;
      diagnostics: VerificationVideoNormalizationDiagnostics;
      errorCategory: 'verification_video_preflight_failed' | 'verification_video_asset_access';
      message: string;
    };

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
};

type ProbeOutput = {
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
  };
  streams?: ProbeStream[];
};

function ffmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

function ffprobeBinary() {
  return process.env.FFPROBE_PATH?.trim() || 'ffprobe';
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstFormatName(value: string | null | undefined) {
  return value?.split(',')[0]?.trim().toLowerCase() || null;
}

function containerNameForPath(filePath: string, formatName: string | null | undefined) {
  if (/\.mp4$/i.test(filePath)) return 'mp4';
  return firstFormatName(formatName);
}

function isProviderSafeContainer(value: string | null) {
  return Boolean(value && ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'quicktime'].includes(value));
}

function isProviderSafeVideoCodec(value: string | null) {
  return Boolean(value && ['h264', 'avc1'].includes(value));
}

function isProviderSafeAudioCodec(value: string | null) {
  return !value || ['aac', 'mp4a'].includes(value);
}

function hasProviderSafeResolution(width: number | null, height: number | null) {
  if (!width || !height) return false;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  return longSide >= 480 && longSide <= 1280 && shortSide >= 270 && shortSide <= 720;
}

export function validateVerificationVideoMetadata(input: Omit<VerificationVideoPreflightMetadata, 'preflightOk' | 'needsNormalization' | 'preflightFailureReason'>): VerificationVideoPreflightMetadata {
  let failureReason: string | null = null;
  let needsNormalization = false;

  if (!input.hasVideoStream) {
    failureReason = 'no_readable_video_stream';
  } else if (input.fileSizeBytes > VERIFICATION_VIDEO_UPLOAD_MAX_BYTES) {
    failureReason = 'verification_video_too_large';
  } else if (typeof input.durationSeconds === 'number' && input.durationSeconds < VERIFICATION_VIDEO_MIN_SECONDS) {
    failureReason = 'duration_too_short';
  } else if (typeof input.durationSeconds === 'number' && input.durationSeconds > VERIFICATION_VIDEO_MAX_SECONDS) {
    failureReason = 'duration_too_long';
    needsNormalization = true;
  } else if (input.fileSizeBytes > VERIFICATION_VIDEO_PROVIDER_MAX_BYTES) {
    failureReason = 'provider_file_size_too_large';
    needsNormalization = true;
  } else if (!isProviderSafeContainer(input.container)) {
    failureReason = 'provider_unsafe_container';
    needsNormalization = true;
  } else if (!isProviderSafeVideoCodec(input.videoCodec)) {
    failureReason = 'provider_unsafe_video_codec';
    needsNormalization = true;
  } else if (!isProviderSafeAudioCodec(input.audioCodec)) {
    failureReason = 'provider_unsafe_audio_codec';
    needsNormalization = true;
  } else if (!hasProviderSafeResolution(input.width, input.height)) {
    failureReason = 'provider_unsafe_resolution';
    needsNormalization = true;
  }

  return {
    ...input,
    preflightOk: !failureReason,
    needsNormalization,
    preflightFailureReason: failureReason,
  };
}

async function probeVideoFile(filePath: string, fallbackSizeBytes: number): Promise<VerificationVideoPreflightMetadata> {
  try {
    const { stdout } = await execFileAsync(ffprobeBinary(), [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], {
      timeout: FFPROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as ProbeOutput;
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video') ?? null;
    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio') ?? null;
    const size = numericValue(parsed.format?.size) ?? fallbackSizeBytes;
    return validateVerificationVideoMetadata({
      durationSeconds: numericValue(parsed.format?.duration),
      width: numericValue(video?.width),
      height: numericValue(video?.height),
      container: containerNameForPath(filePath, parsed.format?.format_name),
      videoCodec: video?.codec_name?.trim().toLowerCase() ?? null,
      audioCodec: audio?.codec_name?.trim().toLowerCase() ?? null,
      fileSizeBytes: size,
      hasVideoStream: Boolean(video),
      hasAudioStream: Boolean(audio),
      ffprobeAvailable: true,
    });
  } catch {
    return {
      durationSeconds: null,
      width: null,
      height: null,
      container: null,
      videoCodec: null,
      audioCodec: null,
      fileSizeBytes: fallbackSizeBytes,
      hasVideoStream: false,
      hasAudioStream: false,
      ffprobeAvailable: false,
      preflightOk: false,
      needsNormalization: false,
      preflightFailureReason: 'ffprobe_unavailable_or_unreadable',
    };
  }
}

async function normalizeVideoBuffer(buffer: Buffer): Promise<{
  ok: true;
  buffer: Buffer;
  metadata: VerificationVideoPreflightMetadata;
} | {
  ok: false;
  reason: string;
}> {
  const tmpRoot = join(tmpdir(), `lumora-verification-${randomUUID()}`);
  const inputPath = join(tmpRoot, 'input-video');
  const outputPath = join(tmpRoot, 'normalized.mp4');
  try {
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(inputPath, buffer);
    await execFileAsync(ffmpegBinary(), [
      '-y',
      '-i',
      inputPath,
      '-t',
      String(VERIFICATION_VIDEO_NORMALIZATION_TARGET.durationSeconds),
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      `scale=${VERIFICATION_VIDEO_NORMALIZATION_TARGET.width}:${VERIFICATION_VIDEO_NORMALIZATION_TARGET.height}:force_original_aspect_ratio=decrease,pad=${VERIFICATION_VIDEO_NORMALIZATION_TARGET.width}:${VERIFICATION_VIDEO_NORMALIZATION_TARGET.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      VERIFICATION_VIDEO_NORMALIZATION_TARGET.pixelFormat,
      '-profile:v',
      VERIFICATION_VIDEO_NORMALIZATION_TARGET.videoProfile,
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      outputPath,
    ], {
      timeout: FFMPEG_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const normalizedBuffer = await readFile(outputPath);
    const metadata = await probeVideoFile(outputPath, normalizedBuffer.length);
    return { ok: true, buffer: normalizedBuffer, metadata };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 240) : 'normalization_failed',
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => null);
  }
}

function safeObjectPathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/\/+/g, '/').replace(/^\/+/, '');
}

function normalizedObjectPath(originalObjectPath: string) {
  const directory = safeObjectPathSegment(dirname(originalObjectPath));
  const fileBase = basename(originalObjectPath).replace(/\.[^.]+$/, '') || 'self-verification-video';
  return `${directory}/normalized/${Date.now()}-${safeObjectPathSegment(fileBase)}-${randomUUID().slice(0, 8)}.mp4`;
}

async function persistNormalizedMetadata(input: {
  userId?: string | null;
  normalizedObjectPath: string;
  metadata: VerificationVideoPreflightMetadata;
  originalMetadata: VerificationVideoPreflightMetadata;
}) {
  if (!input.userId) return;
  const metadataJson = JSON.stringify({
    original: input.originalMetadata,
    normalized: input.metadata,
  });
  await query(
    `update character_profiles
        set verification_video_normalized_asset_id = $2,
            verification_video_normalized_at = now(),
            verification_video_normalized_status = 'ready',
            verification_video_metadata = $3::jsonb,
            updated_at = now()
      where owner_user_id = $1
        and (coalesce(is_self, false) = true or character_id = 'creator-self')`,
    [input.userId, input.normalizedObjectPath, metadataJson],
  ).catch(() => null);

  await query(
    `update self_characters
        set verification_video_normalized_asset_id = $2,
            verification_video_normalized_at = now(),
            verification_video_normalized_status = 'ready',
            verification_video_metadata = $3::jsonb,
            updated_at = now()
      where user_id = $1`,
    [input.userId, input.normalizedObjectPath, metadataJson],
  ).catch(() => null);
}

async function storedNormalizedAsset(input: {
  userId?: string | null;
}): Promise<string | null> {
  if (!input.userId) return null;
  const result = await query<{ normalizedAssetId: string | null }>(
    `select verification_video_normalized_asset_id as "normalizedAssetId"
       from character_profiles
      where owner_user_id = $1
        and (coalesce(is_self, false) = true or character_id = 'creator-self')
        and verification_video_normalized_asset_id is not null
      order by verification_video_normalized_at desc nulls last, updated_at desc nulls last
      limit 1`,
    [input.userId],
  ).catch(() => ({ rows: [] as Array<{ normalizedAssetId: string | null }> }));
  return result.rows[0]?.normalizedAssetId ?? null;
}

export function chooseVerificationVideoNormalizationAction(input: {
  forceNormalize?: boolean;
  storedNormalizedAssetPresent?: boolean;
  storedNormalizedAssetValid?: boolean;
}) {
  if (input.forceNormalize) {
    return {
      useStoredNormalizedAsset: false,
      normalizationTriggered: true,
      normalizationReason: 'force_refresh' as const,
    };
  }

  if (input.storedNormalizedAssetPresent && input.storedNormalizedAssetValid) {
    return {
      useStoredNormalizedAsset: true,
      normalizationTriggered: false,
      normalizationReason: 'skipped_existing_valid_asset' as const,
    };
  }

  return {
    useStoredNormalizedAsset: false,
    normalizationTriggered: true,
    normalizationReason: input.storedNormalizedAssetPresent ? 'stale_asset' as const : 'missing_normalized_asset' as const,
  };
}

export async function prepareVerificationVideoForProvider(input: {
  bucket: string;
  objectPath: string;
  userId?: string | null;
  forceNormalize?: boolean;
  requireNormalized?: boolean;
  allowOriginalFallback?: boolean;
}): Promise<VerificationVideoPreparationResult> {
  if (!supabaseAdmin) {
    return {
      ok: false,
      bucket: input.bucket,
      objectPath: input.objectPath,
      errorCategory: 'verification_video_asset_access',
      message: 'Supabase admin client is required to inspect private verification videos.',
      diagnostics: {
        original: null,
        normalized: null,
        normalizationTriggered: false,
        normalizationReason: null,
        normalizedAssetUsed: false,
        normalizedAssetPathPresent: false,
        normalizedStatus: 'unavailable',
        failureReason: 'supabase_admin_unavailable',
      },
    };
  }

  const storedNormalized = !input.forceNormalize ? await storedNormalizedAsset({ userId: input.userId }) : null;
  let objectToDownload = storedNormalized || input.objectPath;
  let usingStoredNormalized = Boolean(storedNormalized);
  let download = await supabaseAdmin.storage.from(input.bucket).download(objectToDownload);
  let normalizedAssetStale = false;
  if (usingStoredNormalized && (download.error || !download.data)) {
    objectToDownload = input.objectPath;
    usingStoredNormalized = false;
    normalizedAssetStale = true;
    download = await supabaseAdmin.storage.from(input.bucket).download(objectToDownload);
  }
  if (download.error || !download.data) {
    return {
      ok: false,
      bucket: input.bucket,
      objectPath: input.objectPath,
      errorCategory: 'verification_video_asset_access',
      message: usingStoredNormalized
        ? 'Stored normalized verification video is missing or unreadable.'
        : 'Self verification video is missing or unreadable.',
      diagnostics: {
        original: null,
        normalized: null,
        normalizationTriggered: false,
        normalizationReason: null,
        normalizedAssetUsed: usingStoredNormalized,
        normalizedAssetPathPresent: Boolean(storedNormalized),
        normalizedStatus: usingStoredNormalized ? 'failed' : 'not_needed',
        failureReason: usingStoredNormalized ? 'normalized_asset_missing' : 'verification_video_object_missing',
      },
    };
  }

  const contentType = download.data.type || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('video/') && contentType !== 'application/octet-stream') {
    return {
      ok: false,
      bucket: input.bucket,
      objectPath: input.objectPath,
      errorCategory: 'verification_video_preflight_failed',
      message: `Self verification asset is not video content (${contentType}).`,
      diagnostics: {
        original: null,
        normalized: null,
        normalizationTriggered: false,
        normalizationReason: null,
        normalizedAssetUsed: false,
        normalizedAssetPathPresent: Boolean(storedNormalized),
        normalizedStatus: 'not_needed',
        failureReason: 'not_video_content',
      },
    };
  }

  const buffer = Buffer.from(await download.data.arrayBuffer());
  const tmpRoot = join(tmpdir(), `lumora-verification-probe-${randomUUID()}`);
  const probePath = join(tmpRoot, 'probe-video');
  try {
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(probePath, buffer);
    const original = await probeVideoFile(probePath, buffer.length);
    if (usingStoredNormalized && original.preflightOk) {
      const action = chooseVerificationVideoNormalizationAction({
        storedNormalizedAssetPresent: true,
        storedNormalizedAssetValid: true,
        forceNormalize: false,
      });
      return {
        ok: true,
        bucket: input.bucket,
        objectPath: storedNormalized,
        diagnostics: {
          original,
          normalized: original,
          normalizationTriggered: action.normalizationTriggered,
          normalizationReason: action.normalizationReason,
          normalizedAssetUsed: true,
          normalizedAssetPathPresent: true,
          normalizedStatus: 'ready',
          failureReason: null,
        },
      };
    }

    const action = chooseVerificationVideoNormalizationAction({
      storedNormalizedAssetPresent: Boolean(storedNormalized),
      storedNormalizedAssetValid: false,
      forceNormalize: input.forceNormalize,
    });

    if (!input.requireNormalized && original.preflightOk && !input.forceNormalize) {
      return {
        ok: true,
        bucket: input.bucket,
        objectPath: input.objectPath,
        diagnostics: {
          original,
          normalized: null,
          normalizationTriggered: false,
          normalizationReason: input.allowOriginalFallback ? 'original_fallback_allowed' : null,
          normalizedAssetUsed: false,
          normalizedAssetPathPresent: false,
          normalizedStatus: 'not_needed',
          failureReason: null,
        },
      };
    }

    if (!input.requireNormalized && !original.needsNormalization && !input.forceNormalize) {
      return {
        ok: false,
        bucket: input.bucket,
        objectPath: input.objectPath,
        errorCategory: 'verification_video_preflight_failed',
        message: `Self verification video failed preflight (${original.preflightFailureReason ?? 'unknown'}).`,
        diagnostics: {
          original,
          normalized: null,
          normalizationTriggered: action.normalizationTriggered,
          normalizationReason: normalizedAssetStale ? 'stale_asset' : action.normalizationReason,
          normalizedAssetUsed: false,
          normalizedAssetPathPresent: false,
          normalizedStatus: 'unavailable',
          failureReason: original.preflightFailureReason ?? 'preflight_failed',
        },
      };
    }

    const normalized = await normalizeVideoBuffer(buffer);
    if (normalized.ok === false || !normalized.metadata.preflightOk) {
      if (input.allowOriginalFallback && original.preflightOk) {
        return {
          ok: true,
          bucket: input.bucket,
          objectPath: input.objectPath,
          diagnostics: {
            original,
            normalized: normalized.ok ? normalized.metadata : null,
            normalizationTriggered: true,
            normalizationReason: 'original_fallback_allowed',
            normalizedAssetUsed: false,
            normalizedAssetPathPresent: Boolean(storedNormalized),
            normalizedStatus: 'failed',
            failureReason: normalized.ok === true ? normalized.metadata.preflightFailureReason : normalized.reason,
          },
        };
      }
      return {
        ok: false,
        bucket: input.bucket,
        objectPath: input.objectPath,
        errorCategory: 'verification_video_preflight_failed',
        message: normalized.ok === true
          ? `Normalized verification video still failed preflight (${normalized.metadata.preflightFailureReason ?? 'unknown'}).`
          : `Could not normalize verification video (${normalized.reason}).`,
        diagnostics: {
          original,
          normalized: normalized.ok ? normalized.metadata : null,
          normalizationTriggered: true,
          normalizationReason: normalizedAssetStale ? 'stale_asset' : action.normalizationReason,
          normalizedAssetUsed: false,
          normalizedAssetPathPresent: false,
          normalizedStatus: 'failed',
          failureReason: normalized.ok === true ? normalized.metadata.preflightFailureReason : normalized.reason,
        },
      };
    }

    const normalizedPath = normalizedObjectPath(input.objectPath);
    const upload = await supabaseAdmin.storage.from(input.bucket).upload(normalizedPath, normalized.buffer, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (upload.error) {
      return {
        ok: false,
        bucket: input.bucket,
        objectPath: input.objectPath,
        errorCategory: 'verification_video_asset_access',
        message: 'Could not save normalized verification video.',
        diagnostics: {
          original,
          normalized: normalized.metadata,
          normalizationTriggered: true,
          normalizationReason: normalizedAssetStale ? 'stale_asset' : action.normalizationReason,
          normalizedAssetUsed: false,
          normalizedAssetPathPresent: false,
          normalizedStatus: 'failed',
          failureReason: upload.error.message,
        },
      };
    }

    await persistNormalizedMetadata({
      userId: input.userId,
      normalizedObjectPath: normalizedPath,
      metadata: normalized.metadata,
      originalMetadata: original,
    });

    return {
      ok: true,
      bucket: input.bucket,
      objectPath: normalizedPath,
      diagnostics: {
        original,
        normalized: normalized.metadata,
        normalizationTriggered: true,
        normalizationReason: normalizedAssetStale ? 'stale_asset' : action.normalizationReason,
        normalizedAssetUsed: true,
        normalizedAssetPathPresent: true,
        normalizedStatus: 'created',
        failureReason: null,
      },
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => null);
  }
}
