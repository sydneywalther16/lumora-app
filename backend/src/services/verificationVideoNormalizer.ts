import { execFile, spawn } from 'node:child_process';
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
  audioCodec: null,
  audioIncluded: false,
  pixelFormat: 'yuv420p',
  videoProfile: 'high',
  width: 720,
  height: 1280,
  fallbackWidth: 480,
  fallbackHeight: 854,
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

export type VerificationVideoNormalizationErrorCategory =
  | 'ffmpeg_shell_parse'
  | 'ffmpeg_encoder_unavailable'
  | 'ffmpeg_input_decode_failed'
  | 'ffmpeg_output_missing'
  | 'ffmpeg_unknown';

export type VerificationVideoPreflightMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioIncluded?: boolean;
  skippedAudioReason?: string | null;
  skippedUnknownStreams?: boolean;
  unknownStreamCodecs?: string[];
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
  normalizationErrorCategory?: VerificationVideoNormalizationErrorCategory | null;
  normalizationExitCode?: number | null;
  normalizationStderrExcerpt?: string | null;
  normalizationStdoutExcerpt?: string | null;
  normalizationFfmpegArgs?: string[] | null;
  normalizationEncoderFallbackUsed?: boolean | null;
  normalizationResolutionFallbackUsed?: boolean | null;
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
  index?: number;
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

function excerpt(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeExtension(value: string | null | undefined) {
  const text = value?.trim().toLowerCase().replace(/^\./, '') ?? '';
  return /^[a-z0-9]{2,8}$/.test(text) ? text : 'mov';
}

export function verificationVideoInputExtension(input: {
  contentType?: string | null;
  objectPath?: string | null;
}) {
  const contentType = input.contentType?.toLowerCase() ?? '';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('quicktime') || contentType.includes('mov')) return 'mov';
  if (contentType.includes('webm')) return 'webm';
  const pathExtension = input.objectPath?.match(/\.([a-zA-Z0-9]{2,8})(?:$|\?)/)?.[1] ?? null;
  if (pathExtension) return safeExtension(pathExtension);
  return 'mov';
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

function isKnownSafeInputAudioCodec(value: string | null) {
  return Boolean(value && ['aac', 'mp3', 'opus', 'pcm_s16le', 'pcm_s24le'].includes(value));
}

function streamCodecName(stream: ProbeStream) {
  return stream.codec_name?.trim().toLowerCase() || 'unknown';
}

function unknownStreamCodecs(streams: ProbeStream[] | undefined) {
  return [...new Set((streams ?? [])
    .filter((stream) => {
      const codec = streamCodecName(stream);
      return codec === 'none' ||
        codec === 'unknown' ||
        stream.codec_type === 'data' ||
        (stream.codec_type === 'audio' && !isKnownSafeInputAudioCodec(codec));
    })
    .map((stream) => `${stream.codec_type ?? 'unknown'}:${streamCodecName(stream)}`))];
}

function hasProviderSafeResolution(width: number | null, height: number | null) {
  if (!width || !height) return false;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  return longSide >= 480 && longSide <= 1280 && shortSide >= 270 && shortSide <= 720;
}

function hasNormalizedTargetResolution(width: number | null, height: number | null) {
  return (width === 720 && height === 1280) || (width === 480 && height === 854);
}

function validateNormalizedOutputMetadata(metadata: VerificationVideoPreflightMetadata): VerificationVideoPreflightMetadata {
  if (!metadata.preflightOk) return metadata;
  if (metadata.container !== VERIFICATION_VIDEO_NORMALIZATION_TARGET.container) {
    return {
      ...metadata,
      preflightOk: false,
      needsNormalization: true,
      preflightFailureReason: 'normalized_container_mismatch',
    };
  }
  if (!isProviderSafeVideoCodec(metadata.videoCodec)) {
    return {
      ...metadata,
      preflightOk: false,
      needsNormalization: true,
      preflightFailureReason: 'normalized_video_codec_mismatch',
    };
  }
  if (metadata.hasAudioStream || metadata.audioIncluded) {
    return {
      ...metadata,
      preflightOk: false,
      needsNormalization: true,
      preflightFailureReason: 'normalized_audio_should_be_omitted',
    };
  }
  if (!hasNormalizedTargetResolution(metadata.width, metadata.height)) {
    return {
      ...metadata,
      preflightOk: false,
      needsNormalization: true,
      preflightFailureReason: 'normalized_resolution_mismatch',
    };
  }
  if (metadata.fileSizeBytes > VERIFICATION_VIDEO_PROVIDER_MAX_BYTES) {
    return {
      ...metadata,
      preflightOk: false,
      needsNormalization: true,
      preflightFailureReason: 'normalized_file_too_large',
    };
  }
  return metadata;
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

async function probeVideoFile(filePath: string, fallbackSizeBytes: number, options: {
  audioIncluded?: boolean;
  skippedAudioReason?: string | null;
  skippedUnknownStreams?: boolean;
} = {}): Promise<VerificationVideoPreflightMetadata> {
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
    const unknownCodecs = unknownStreamCodecs(parsed.streams);
    const size = numericValue(parsed.format?.size) ?? fallbackSizeBytes;
    return validateVerificationVideoMetadata({
      durationSeconds: numericValue(parsed.format?.duration),
      width: numericValue(video?.width),
      height: numericValue(video?.height),
      container: containerNameForPath(filePath, parsed.format?.format_name),
      videoCodec: video?.codec_name?.trim().toLowerCase() ?? null,
      audioCodec: audio?.codec_name?.trim().toLowerCase() ?? null,
      audioIncluded: options.audioIncluded ?? Boolean(audio),
      skippedAudioReason: options.skippedAudioReason ?? null,
      skippedUnknownStreams: options.skippedUnknownStreams ?? unknownCodecs.length > 0,
      unknownStreamCodecs: unknownCodecs,
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
      audioIncluded: false,
      skippedAudioReason: null,
      skippedUnknownStreams: false,
      unknownStreamCodecs: [],
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

export function buildVerificationVideoFfmpegArgs(inputPath: string, outputPath: string, encoder = 'libx264', options: {
  width?: number;
  height?: number;
  includeAudio?: boolean;
  audioStreamIndex?: number | null;
} = {}) {
  const width = options.width ?? VERIFICATION_VIDEO_NORMALIZATION_TARGET.width;
  const height = options.height ?? VERIFICATION_VIDEO_NORMALIZATION_TARGET.height;
  const includeAudio = options.includeAudio === true && typeof options.audioStreamIndex === 'number';
  const audioArgs = includeAudio
    ? ['-map', `0:${options.audioStreamIndex}?`, '-c:a', 'aac', '-b:a', '128k']
    : ['-an'];
  return [
    '-y',
    '-ignore_unknown',
    '-i',
    inputPath,
    '-t',
    String(VERIFICATION_VIDEO_NORMALIZATION_TARGET.durationSeconds),
    '-map',
    '0:v:0',
    ...audioArgs,
    '-dn',
    '-sn',
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-r',
    '24',
    '-c:v',
    encoder,
    '-pix_fmt',
    VERIFICATION_VIDEO_NORMALIZATION_TARGET.pixelFormat,
    '-profile:v',
    VERIFICATION_VIDEO_NORMALIZATION_TARGET.videoProfile,
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

function redactedFfmpegArgs(args: string[]) {
  return args.map((arg, index) => {
    const previous = args[index - 1];
    if (previous === '-i') return '[input-video]';
    if (index === args.length - 1) return '[output-video]';
    return arg;
  });
}

export function classifyFfmpegNormalizationFailure(input: {
  stderr?: string | null;
  stdout?: string | null;
  message?: string | null;
}): VerificationVideoNormalizationErrorCategory {
  const combined = `${input.message ?? ''}\n${input.stderr ?? ''}\n${input.stdout ?? ''}`;
  if (/Invalid data found|moov atom not found|could not find codec parameters|Error while decoding|Invalid input/i.test(combined)) {
    return 'ffmpeg_input_decode_failed';
  }
  if (/Syntax error|unexpected token|command not found|spawn .*ENOENT/i.test(combined)) return 'ffmpeg_shell_parse';
  if (/Unknown encoder ['"]?libx264|Encoder .*libx264.*not found|codec.*libx264.*not found/i.test(combined)) {
    return 'ffmpeg_encoder_unavailable';
  }
  return 'ffmpeg_unknown';
}

function shouldTryFallbackResolution(input: {
  category: VerificationVideoNormalizationErrorCategory;
  stderr?: string | null;
  stdout?: string | null;
}) {
  if (input.category === 'ffmpeg_encoder_unavailable' || input.category === 'ffmpeg_input_decode_failed') return false;
  const combined = `${input.stderr ?? ''}\n${input.stdout ?? ''}`;
  return /scale|pad|filter|Failed to configure|Error while filtering|Conversion failed/i.test(combined) ||
    input.category === 'ffmpeg_unknown';
}

type FfmpegRunResult =
  | {
      ok: true;
      stdout: string;
      stderr: string;
      exitCode: number;
      args: string[];
    }
  | {
      ok: false;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      args: string[];
      errorCategory: VerificationVideoNormalizationErrorCategory;
      message: string;
    };

function isFfmpegRunFailure(result: FfmpegRunResult): result is Extract<FfmpegRunResult, { ok: false }> {
  return result.ok === false;
}

function runFfmpegArgs(args: string[]): Promise<FfmpegRunResult> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBinary(), args, {
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 20_000) stdout = stdout.slice(-20_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 40_000) stderr = stderr.slice(-40_000);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        args,
        errorCategory: classifyFfmpegNormalizationFailure({ stdout, stderr, message: error.message }),
        message: error.message,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({
          ok: true,
          stdout,
          stderr,
          exitCode: 0,
          args,
        });
        return;
      }
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: code,
        args,
        errorCategory: classifyFfmpegNormalizationFailure({ stdout, stderr }),
        message: `ffmpeg exited with code ${code ?? 'unknown'}`,
      });
    });
  });
}

async function availableH264EncoderFallback() {
  try {
    const { stdout } = await execFileAsync(ffmpegBinary(), ['-hide_banner', '-encoders'], {
      timeout: FFPROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const candidates = ['h264', 'libx264', 'h264_nvenc', 'h264_qsv', 'h264_videotoolbox', 'h264_amf'];
    return candidates.find((candidate) => new RegExp(`\\b${candidate}\\b`).test(stdout)) ?? null;
  } catch {
    return 'h264';
  }
}

async function normalizeVideoBuffer(buffer: Buffer, inputExtension = 'mov', inputMetadata?: VerificationVideoPreflightMetadata | null): Promise<{
  ok: true;
  buffer: Buffer;
  metadata: VerificationVideoPreflightMetadata;
  ffmpegDiagnostics: {
    exitCode: number | null;
    stderrExcerpt: string | null;
    stdoutExcerpt: string | null;
    args: string[];
    encoderFallbackUsed: boolean;
    resolutionFallbackUsed: boolean;
  };
} | {
  ok: false;
  reason: string;
  errorCategory: VerificationVideoNormalizationErrorCategory;
  exitCode: number | null;
  stderrExcerpt: string | null;
  stdoutExcerpt: string | null;
  args: string[];
  encoderFallbackUsed: boolean;
  resolutionFallbackUsed: boolean;
}> {
  const tmpRoot = join(tmpdir(), `lumora-verification-${randomUUID()}`);
  const inputPath = join(tmpRoot, `input.${safeExtension(inputExtension)}`);
  const outputPath = join(tmpRoot, 'output.mp4');
  try {
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(inputPath, buffer);
    let encoderFallbackUsed = false;
    let resolutionFallbackUsed = false;
    const runWithEncoder = async (encoder: string, dimensions: { width: number; height: number }) => {
      const argsForRun = buildVerificationVideoFfmpegArgs(inputPath, outputPath, encoder, {
        width: dimensions.width,
        height: dimensions.height,
        includeAudio: false,
      });
      return {
        args: argsForRun,
        result: await runFfmpegArgs(argsForRun),
      };
    };
    let args = buildVerificationVideoFfmpegArgs(inputPath, outputPath, 'libx264', { includeAudio: false });
    let ffmpegResult = await runFfmpegArgs(args);
    if (isFfmpegRunFailure(ffmpegResult) && ffmpegResult.errorCategory === 'ffmpeg_encoder_unavailable') {
      const fallbackEncoder = await availableH264EncoderFallback();
      if (fallbackEncoder && fallbackEncoder !== 'libx264') {
        encoderFallbackUsed = true;
        args = buildVerificationVideoFfmpegArgs(inputPath, outputPath, fallbackEncoder, { includeAudio: false });
        ffmpegResult = await runFfmpegArgs(args);
      }
    }
    if (isFfmpegRunFailure(ffmpegResult) && shouldTryFallbackResolution({
      category: ffmpegResult.errorCategory,
      stderr: ffmpegResult.stderr,
      stdout: ffmpegResult.stdout,
    })) {
      resolutionFallbackUsed = true;
      const fallbackRun = await runWithEncoder(
        encoderFallbackUsed ? (args[args.indexOf('-c:v') + 1] ?? 'h264') : 'libx264',
        {
          width: VERIFICATION_VIDEO_NORMALIZATION_TARGET.fallbackWidth,
          height: VERIFICATION_VIDEO_NORMALIZATION_TARGET.fallbackHeight,
        },
      );
      args = fallbackRun.args;
      ffmpegResult = fallbackRun.result;
    }
    if (isFfmpegRunFailure(ffmpegResult)) {
      const failed = ffmpegResult;
      return {
        ok: false,
        reason: `${failed.errorCategory}: ${failed.message}`,
        errorCategory: failed.errorCategory,
        exitCode: failed.exitCode,
        stderrExcerpt: excerpt(failed.stderr, 2000),
        stdoutExcerpt: excerpt(failed.stdout, 1000),
        args: redactedFfmpegArgs(failed.args),
        encoderFallbackUsed,
        resolutionFallbackUsed,
      };
    }
    const normalizedBuffer = await readFile(outputPath);
    if (normalizedBuffer.length <= 0) {
      return {
        ok: false,
        reason: 'ffmpeg_output_missing: normalized output file was empty',
        errorCategory: 'ffmpeg_output_missing',
        exitCode: ffmpegResult.exitCode,
        stderrExcerpt: excerpt(ffmpegResult.stderr, 2000),
        stdoutExcerpt: excerpt(ffmpegResult.stdout, 1000),
        args: redactedFfmpegArgs(ffmpegResult.args),
        encoderFallbackUsed,
        resolutionFallbackUsed,
      };
    }
    const metadata = validateNormalizedOutputMetadata(await probeVideoFile(outputPath, normalizedBuffer.length, {
      audioIncluded: false,
      skippedAudioReason: 'provider_reference_video_uses_silent_normalized_asset',
      skippedUnknownStreams: Boolean(inputMetadata?.skippedUnknownStreams),
    }));
    return {
      ok: true,
      buffer: normalizedBuffer,
      metadata,
      ffmpegDiagnostics: {
        exitCode: ffmpegResult.exitCode,
        stderrExcerpt: excerpt(ffmpegResult.stderr, 2000),
        stdoutExcerpt: excerpt(ffmpegResult.stdout, 1000),
        args: redactedFfmpegArgs(ffmpegResult.args),
        encoderFallbackUsed,
        resolutionFallbackUsed,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'normalization_failed';
    return {
      ok: false,
      reason,
      errorCategory: /ENOENT|no such file/i.test(reason) ? 'ffmpeg_output_missing' : 'ffmpeg_unknown',
      exitCode: null,
      stderrExcerpt: null,
      stdoutExcerpt: null,
      args: [],
      encoderFallbackUsed: false,
      resolutionFallbackUsed: false,
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

  let contentType = download.data.type || 'application/octet-stream';
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

  let buffer = Buffer.from(await download.data.arrayBuffer());
  let inputExtension = verificationVideoInputExtension({
    contentType,
    objectPath: objectToDownload,
  });
  const tmpRoot = join(tmpdir(), `lumora-verification-probe-${randomUUID()}`);
  const probePath = join(tmpRoot, `probe-video.${inputExtension}`);
  try {
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(probePath, buffer);
    let original = await probeVideoFile(probePath, buffer.length);
    if (usingStoredNormalized && validateNormalizedOutputMetadata(original).preflightOk) {
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

    if (usingStoredNormalized) {
      normalizedAssetStale = true;
      const originalDownload = await supabaseAdmin.storage.from(input.bucket).download(input.objectPath);
      if (originalDownload.error || !originalDownload.data) {
        return {
          ok: false,
          bucket: input.bucket,
          objectPath: input.objectPath,
          errorCategory: 'verification_video_asset_access',
          message: 'Stored normalized verification video is stale and the original self verification video is missing or unreadable.',
          diagnostics: {
            original,
            normalized: validateNormalizedOutputMetadata(original),
            normalizationTriggered: true,
            normalizationReason: 'stale_asset',
            normalizedAssetUsed: false,
            normalizedAssetPathPresent: true,
            normalizedStatus: 'failed',
            failureReason: originalDownload.error?.message ?? 'verification_video_object_missing',
          },
        };
      }
      contentType = originalDownload.data.type || 'application/octet-stream';
      buffer = Buffer.from(await originalDownload.data.arrayBuffer());
      inputExtension = verificationVideoInputExtension({
        contentType,
        objectPath: input.objectPath,
      });
      const originalProbePath = join(tmpRoot, `probe-original.${inputExtension}`);
      await writeFile(originalProbePath, buffer);
      original = await probeVideoFile(originalProbePath, buffer.length);
      usingStoredNormalized = false;
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

    const normalized = await normalizeVideoBuffer(buffer, inputExtension, original);
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
            normalizationErrorCategory: normalized.ok === true ? null : normalized.errorCategory,
            normalizationExitCode: normalized.ok === true ? null : normalized.exitCode,
            normalizationStderrExcerpt: normalized.ok === true ? null : normalized.stderrExcerpt,
            normalizationStdoutExcerpt: normalized.ok === true ? null : normalized.stdoutExcerpt,
            normalizationFfmpegArgs: normalized.ok === true ? null : normalized.args,
            normalizationEncoderFallbackUsed: normalized.ok === true ? null : normalized.encoderFallbackUsed,
            normalizationResolutionFallbackUsed: normalized.ok === true ? null : normalized.resolutionFallbackUsed,
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
          normalizationErrorCategory: normalized.ok === true ? null : normalized.errorCategory,
          normalizationExitCode: normalized.ok === true ? null : normalized.exitCode,
          normalizationStderrExcerpt: normalized.ok === true ? null : normalized.stderrExcerpt,
          normalizationStdoutExcerpt: normalized.ok === true ? null : normalized.stdoutExcerpt,
          normalizationFfmpegArgs: normalized.ok === true ? null : normalized.args,
          normalizationEncoderFallbackUsed: normalized.ok === true ? null : normalized.encoderFallbackUsed,
          normalizationResolutionFallbackUsed: normalized.ok === true ? null : normalized.resolutionFallbackUsed,
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
          normalizationErrorCategory: null,
          normalizationExitCode: normalized.ffmpegDiagnostics.exitCode,
          normalizationStderrExcerpt: normalized.ffmpegDiagnostics.stderrExcerpt,
          normalizationStdoutExcerpt: normalized.ffmpegDiagnostics.stdoutExcerpt,
          normalizationFfmpegArgs: normalized.ffmpegDiagnostics.args,
          normalizationEncoderFallbackUsed: normalized.ffmpegDiagnostics.encoderFallbackUsed,
          normalizationResolutionFallbackUsed: normalized.ffmpegDiagnostics.resolutionFallbackUsed,
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
        normalizationErrorCategory: null,
        normalizationExitCode: normalized.ffmpegDiagnostics.exitCode,
        normalizationStderrExcerpt: normalized.ffmpegDiagnostics.stderrExcerpt,
        normalizationStdoutExcerpt: normalized.ffmpegDiagnostics.stdoutExcerpt,
        normalizationFfmpegArgs: normalized.ffmpegDiagnostics.args,
        normalizationEncoderFallbackUsed: normalized.ffmpegDiagnostics.encoderFallbackUsed,
        normalizationResolutionFallbackUsed: normalized.ffmpegDiagnostics.resolutionFallbackUsed,
      },
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => null);
  }
}
