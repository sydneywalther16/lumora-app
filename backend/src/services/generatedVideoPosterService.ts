import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { env } from '../lib/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { LUMORA_ASSET_BUCKET, uploadGeneratedAsset } from './storageService';
import { repairVideoThumbnails } from './videoThumbnailRepair';

const execFileAsync = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 45_000;
const FFMPEG_PROBE_TIMEOUT_MS = 2_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_VIDEO_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const DEFAULT_POSTER_SCAN_LIMIT = 10;
export const POSTER_BUCKET_NAME = LUMORA_ASSET_BUCKET;

export type PosterEntityKind = 'generation_job' | 'project' | 'post';
export type PosterEntityFilter = PosterEntityKind | 'all';
export type PosterFailureReason =
  | 'poster_generation_unavailable'
  | 'poster_bucket_missing'
  | 'video_bucket_missing'
  | 'video_object_missing'
  | 'video_download_failed'
  | 'video_too_large'
  | 'stale_external_video_url'
  | 'protected_or_non_video_url'
  | 'poster_frame_empty'
  | 'poster_generation_failed'
  | 'poster_upload_failed';

type PosterCandidate = {
  entityKind: PosterEntityKind;
  id: string;
  userId: string | null;
  videoUrl: string;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  thumbnailSource: string | null;
};

export type PosterGenerationAvailability = {
  available: boolean;
  method: 'ffmpeg' | 'unavailable';
  ffmpegAvailable: boolean;
  storageAvailable: boolean;
  posterBucketName: string;
  posterBucketExists: boolean;
  reason: string | null;
};

type PosterDiagnosticDetail = {
  bucket?: string | null;
  objectPathPresent?: boolean;
  objectExists?: boolean;
  contentType?: string | null;
  status?: number | null;
  sizeBytes?: number | null;
};

type PosterGenerationOutcome =
  | {
      ok: true;
      posterUrl: string;
      method: 'ffmpeg';
    }
  | {
      ok: false;
      skipped: boolean;
      reason: PosterFailureReason;
      error?: string;
      diagnostics?: PosterDiagnosticDetail;
    };

export type VideoPosterBackfillResult = {
  ok: boolean;
  scannedCount: number;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  repairedProjects: number;
  repairedPosts: number;
  posterGenerationAvailable: boolean;
  availability: PosterGenerationAvailability;
  skippedByReason: Record<string, number>;
  failedByReason: Record<string, number>;
  generatedPosterUrls: string[];
  failures: Array<{
    entityKind: PosterEntityKind;
    id: string;
    videoHost: string | null;
    reason: string;
    error?: string;
    diagnostics?: PosterDiagnosticDetail;
  }>;
  firstFailures: Array<{
    entityKind: PosterEntityKind;
    id: string;
    videoHost: string | null;
    reason: string;
    error?: string;
    diagnostics?: PosterDiagnosticDetail;
  }>;
  runAt: string;
};

export type BackfillGeneratedVideoPosterOptions = {
  limit?: number;
  onlyLatest?: boolean;
  entityKind?: PosterEntityFilter;
};

let availabilityCache: PosterGenerationAvailability | null = null;
const posterRuntimeStats = {
  latestPosterBackfillRunAt: null as string | null,
  latestPosterGenerationFailureReason: null as string | null,
  staleExternalVideoUrlCount: 0,
  protectedOrNonVideoUrlCount: 0,
  skippedByReason: {} as Record<string, number>,
  failedByReason: {} as Record<string, number>,
};

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sourceHost(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function redactUrl(url: string | null) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    return `${parsed.protocol}//${parsed.hostname}/.../${file}`;
  } catch {
    return '[redacted-url]';
  }
}

function sanitizeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  return message.replace(/https?:\/\/[^\s"')]+/g, (url) => redactUrl(url)).slice(0, 500);
}

function ffmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

async function detectFfmpeg() {
  try {
    await execFileAsync(ffmpegBinary(), ['-version'], {
      timeout: FFMPEG_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function posterBucketExists() {
  if (!supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin.storage.getBucket(POSTER_BUCKET_NAME);
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export async function getPosterGenerationAvailability(options: { refresh?: boolean } = {}): Promise<PosterGenerationAvailability> {
  if (availabilityCache && !options.refresh) return availabilityCache;

  const ffmpegAvailable = await detectFfmpeg();
  const storageAvailable = Boolean(supabaseAdmin);
  const bucketExists = storageAvailable ? await posterBucketExists() : false;
  let reason: string | null = null;
  if (!ffmpegAvailable) {
    reason = 'ffmpeg_unavailable';
  } else if (!storageAvailable) {
    reason = 'supabase_storage_unavailable';
  } else if (!bucketExists) {
    reason = 'poster_bucket_missing';
  }

  availabilityCache = {
    available: ffmpegAvailable && storageAvailable && bucketExists,
    method: ffmpegAvailable && storageAvailable && bucketExists ? 'ffmpeg' : 'unavailable',
    ffmpegAvailable,
    storageAvailable,
    posterBucketName: POSTER_BUCKET_NAME,
    posterBucketExists: bucketExists,
    reason,
  };
  return availabilityCache;
}

export function buildUnavailablePosterBackfillResult(input: {
  scannedCount: number;
  availability: PosterGenerationAvailability;
  repairedProjects?: number;
  repairedPosts?: number;
}): VideoPosterBackfillResult {
  const runAt = new Date().toISOString();
  posterRuntimeStats.latestPosterBackfillRunAt = runAt;
  return {
    ok: true,
    scannedCount: input.scannedCount,
    generatedCount: 0,
    skippedCount: input.scannedCount,
    failedCount: 0,
    repairedProjects: input.repairedProjects ?? 0,
    repairedPosts: input.repairedPosts ?? 0,
    posterGenerationAvailable: false,
    availability: input.availability,
    skippedByReason: input.scannedCount > 0 ? { [input.availability.reason ?? 'poster_generation_unavailable']: input.scannedCount } : {},
    failedByReason: {},
    generatedPosterUrls: [],
    failures: [],
    firstFailures: [],
    runAt,
  };
}

function isMissingGeneratedPoster(candidate: PosterCandidate) {
  if (!candidate.videoUrl) return false;
  if (candidate.posterUrl) return false;
  if (candidate.thumbnailUrl && candidate.thumbnailSource === 'generated_poster') return false;
  return true;
}

function entityFilterSql(entityKind: PosterEntityFilter) {
  if (entityKind === 'all') return '';
  return `where entity_kind = '${entityKind}'`;
}

async function findPosterCandidates(options: BackfillGeneratedVideoPosterOptions = {}): Promise<PosterCandidate[]> {
  const limit = options.onlyLatest ? 1 : Math.min(Math.max(options.limit ?? DEFAULT_POSTER_SCAN_LIMIT, 1), 250);
  const entityKind = options.entityKind ?? 'all';
  const result = await query<Record<string, unknown>>(
    `select entity_kind as "entityKind",
            id,
            user_id as "userId",
            video_url as "videoUrl",
            poster_url as "posterUrl",
            thumbnail_url as "thumbnailUrl",
            thumbnail_source as "thumbnailSource"
       from (
         select
           'generation_job'::text as entity_kind,
           id::text,
           user_id,
           coalesce(video_url, output_url, result_asset_url) as video_url,
           poster_url,
           thumbnail_url,
           thumbnail_source,
           coalesce(updated_at, created_at) as sort_at
         from generation_jobs
         where output_type = 'video'
           and status in ('completed', 'saved')
           and coalesce(video_url, output_url, result_asset_url) is not null
           and poster_url is null
         union all
         select
           'project'::text as entity_kind,
           id::text,
           user_id,
           coalesce(video_url, cover_asset_url) as video_url,
           poster_url,
           thumbnail_url,
           thumbnail_source,
           coalesce(updated_at, created_at) as sort_at
         from projects
         where output_type = 'video'
           and status in ('completed', 'draft', 'published')
           and coalesce(video_url, cover_asset_url) is not null
           and poster_url is null
         union all
         select
           'post'::text as entity_kind,
           id::text,
           user_id,
           video_url,
           poster_url,
           thumbnail_url,
           thumbnail_source,
           coalesce(updated_at, published_at, created_at) as sort_at
         from posts
         where video_url is not null
           and poster_url is null
       ) candidates
      ${entityFilterSql(entityKind)}
      order by sort_at desc nulls last
      limit $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    entityKind: stringValue(row.entityKind) as PosterEntityKind,
    id: stringValue(row.id) ?? '',
    userId: stringValue(row.userId),
    videoUrl: stringValue(row.videoUrl) ?? '',
    posterUrl: stringValue(row.posterUrl),
    thumbnailUrl: stringValue(row.thumbnailUrl),
    thumbnailSource: stringValue(row.thumbnailSource),
  })).filter((candidate) => candidate.id && isMissingGeneratedPoster(candidate));
}

function hostLooksVercel(host: string | null) {
  return Boolean(host && (host === 'vercel.app' || host.endsWith('.vercel.app')));
}

function hostLooksReplicate(host: string | null) {
  return Boolean(host && (host === 'replicate.delivery' || host.endsWith('.replicate.delivery')));
}

function urlLooksVideo(url: string) {
  try {
    return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(new URL(url).pathname) || /\.(mp4|mov|webm|m4v)$/i.test(extname(new URL(url).pathname));
  } catch {
    return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
  }
}

function contentTypeLooksVideo(contentType: string | null, url: string) {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('video/')) return true;
  if (normalized === 'application/octet-stream' && urlLooksVideo(url)) return true;
  if (!normalized && urlLooksVideo(url)) return true;
  return false;
}

export function classifyVideoFetchProblem(input: {
  url: string;
  status?: number | null;
  contentType?: string | null;
  errorMessage?: string | null;
}): PosterFailureReason {
  const host = sourceHost(input.url);
  const contentType = input.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const message = input.errorMessage?.toLowerCase() ?? '';
  if (hostLooksReplicate(host)) return 'stale_external_video_url';
  if (hostLooksVercel(host)) return 'protected_or_non_video_url';
  if (input.status === 401 || input.status === 403) return 'protected_or_non_video_url';
  if (contentType.includes('html') || contentType.startsWith('image/') || contentType.includes('json')) {
    return 'protected_or_non_video_url';
  }
  if (message.includes('moov atom not found') || message.includes('invalid data found')) {
    return 'stale_external_video_url';
  }
  return 'video_download_failed';
}

function classifyFfmpegFailure(url: string, error: unknown): PosterFailureReason {
  const message = sanitizeError(error).toLowerCase();
  if (hostLooksVercel(sourceHost(url))) return 'protected_or_non_video_url';
  if (message.includes('no jpeg data found') || message.includes('image2')) return 'protected_or_non_video_url';
  if (hostLooksReplicate(sourceHost(url)) && (message.includes('moov atom not found') || message.includes('invalid data'))) {
    return 'stale_external_video_url';
  }
  return 'poster_generation_failed';
}

function parseSupabaseStorageUrl(url: string): { bucket: string; objectPath: string } | null {
  if (!env.SUPABASE_URL) return null;
  try {
    const supabaseHost = new URL(env.SUPABASE_URL).hostname.toLowerCase();
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== supabaseHost) return null;
    const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      objectPath: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function downloadFromSupabaseStorage(input: {
  bucket: string;
  objectPath: string;
  sourceUrl: string;
}) {
  if (!supabaseAdmin) {
    return {
      ok: false as const,
      skipped: false,
      reason: 'video_download_failed' as PosterFailureReason,
      error: 'Supabase service role is not configured.',
      diagnostics: {
        bucket: input.bucket,
        objectPathPresent: Boolean(input.objectPath),
        objectExists: false,
      },
    };
  }

  const bucket = await supabaseAdmin.storage.getBucket(input.bucket);
  if (bucket.error) {
    return {
      ok: false as const,
      skipped: false,
      reason: 'video_bucket_missing' as PosterFailureReason,
      error: `Storage bucket missing: ${input.bucket}`,
      diagnostics: {
        bucket: input.bucket,
        objectPathPresent: Boolean(input.objectPath),
        objectExists: false,
      },
    };
  }

  const { data, error } = await supabaseAdmin.storage.from(input.bucket).download(input.objectPath);
  if (error || !data) {
    return {
      ok: false as const,
      skipped: true,
      reason: 'video_object_missing' as PosterFailureReason,
      error: `Storage object missing or unreadable in ${input.bucket}.`,
      diagnostics: {
        bucket: input.bucket,
        objectPathPresent: Boolean(input.objectPath),
        objectExists: false,
      },
    };
  }

  const contentType = data.type || 'application/octet-stream';
  if (!contentTypeLooksVideo(contentType, input.sourceUrl)) {
    return {
      ok: false as const,
      skipped: true,
      reason: 'protected_or_non_video_url' as PosterFailureReason,
      error: `Storage object is not video content (${contentType}).`,
      diagnostics: {
        bucket: input.bucket,
        objectPathPresent: Boolean(input.objectPath),
        objectExists: true,
        contentType,
      },
    };
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length > MAX_VIDEO_DOWNLOAD_BYTES) {
    return {
      ok: false as const,
      skipped: true,
      reason: 'video_too_large' as PosterFailureReason,
      error: `Video exceeds poster backfill download limit (${buffer.length} bytes).`,
      diagnostics: {
        bucket: input.bucket,
        objectPathPresent: Boolean(input.objectPath),
        objectExists: true,
        contentType,
        sizeBytes: buffer.length,
      },
    };
  }

  return {
    ok: true as const,
    buffer,
    contentType,
    sizeBytes: buffer.length,
    diagnostics: {
      bucket: input.bucket,
      objectPathPresent: Boolean(input.objectPath),
      objectExists: true,
      contentType,
      sizeBytes: buffer.length,
    },
  };
}

async function fetchVideoBuffer(url: string) {
  const supabaseLocation = parseSupabaseStorageUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'video/*,application/octet-stream;q=0.8,*/*;q=0.4',
        'user-agent': 'LumoraPosterBackfill/1.0',
      },
    });
    const contentType = response.headers.get('content-type');
    const contentLength = Number(response.headers.get('content-length'));

    if (!response.ok) {
      if (supabaseLocation) {
        return await downloadFromSupabaseStorage({
          ...supabaseLocation,
          sourceUrl: url,
        });
      }
      return {
        ok: false as const,
        skipped: true,
        reason: classifyVideoFetchProblem({ url, status: response.status, contentType }),
        error: `Video download returned HTTP ${response.status}.`,
        diagnostics: {
          status: response.status,
          contentType,
        },
      };
    }

    if (!contentTypeLooksVideo(contentType, url)) {
      if (supabaseLocation) {
        return await downloadFromSupabaseStorage({
          ...supabaseLocation,
          sourceUrl: url,
        });
      }
      return {
        ok: false as const,
        skipped: true,
        reason: classifyVideoFetchProblem({ url, status: response.status, contentType }),
        error: `URL did not return video content (${contentType ?? 'unknown'}).`,
        diagnostics: {
          status: response.status,
          contentType,
        },
      };
    }

    if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_DOWNLOAD_BYTES) {
      return {
        ok: false as const,
        skipped: true,
        reason: 'video_too_large' as PosterFailureReason,
        error: `Video exceeds poster backfill download limit (${contentLength} bytes).`,
        diagnostics: {
          status: response.status,
          contentType,
          sizeBytes: contentLength,
        },
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_VIDEO_DOWNLOAD_BYTES) {
      return {
        ok: false as const,
        skipped: true,
        reason: 'video_too_large' as PosterFailureReason,
        error: `Video exceeds poster backfill download limit (${buffer.length} bytes).`,
        diagnostics: {
          status: response.status,
          contentType,
          sizeBytes: buffer.length,
        },
      };
    }

    return {
      ok: true as const,
      buffer,
      contentType: contentType ?? 'video/mp4',
      sizeBytes: buffer.length,
      diagnostics: {
        status: response.status,
        contentType,
        sizeBytes: buffer.length,
      },
    };
  } catch (error) {
    if (supabaseLocation) {
      return await downloadFromSupabaseStorage({
        ...supabaseLocation,
        sourceUrl: url,
      });
    }
    return {
      ok: false as const,
      skipped: true,
      reason: classifyVideoFetchProblem({ url, errorMessage: sanitizeError(error) }),
      error: sanitizeError(error),
      diagnostics: {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generatePosterForVideo(input: {
  entityKind: PosterEntityKind;
  id: string;
  userId?: string | null;
  videoUrl: string;
}): Promise<PosterGenerationOutcome> {
  const availability = await getPosterGenerationAvailability();
  if (!availability.available) {
    return {
      ok: false,
      skipped: availability.reason !== 'poster_bucket_missing',
      reason: (availability.reason as PosterFailureReason | null) ?? 'poster_generation_unavailable',
      diagnostics: {
        bucket: availability.posterBucketName,
        objectPathPresent: false,
        objectExists: availability.posterBucketExists,
      },
    };
  }

  const owner = input.userId ?? 'system';
  const workDir = join(tmpdir(), 'lumora-video-posters');
  const videoPath = join(workDir, `${randomUUID()}-source.mp4`);
  const outputPath = join(workDir, `${randomUUID()}.jpg`);
  await mkdir(workDir, { recursive: true });

  try {
    const download = await fetchVideoBuffer(input.videoUrl);
    if (!download.ok) return download as Extract<PosterGenerationOutcome, { ok: false }>;

    await writeFile(videoPath, download.buffer);
    await execFileAsync(ffmpegBinary(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '00:00:01',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      outputPath,
    ], {
      timeout: FFMPEG_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    const posterBuffer = await readFile(outputPath);
    if (!posterBuffer.length) {
      return {
        ok: false,
        skipped: false,
        reason: 'poster_frame_empty',
        diagnostics: download.diagnostics,
      };
    }

    try {
      const asset = await uploadGeneratedAsset({
        userId: owner,
        fileName: `${input.id}.jpg`,
        contentType: 'image/jpeg',
        buffer: posterBuffer,
        folder: `video-posters/${input.entityKind}`,
      });
      return {
        ok: true,
        posterUrl: asset.publicUrl,
        method: 'ffmpeg',
      };
    } catch (error) {
      const message = sanitizeError(error);
      const bucketMissing = /bucket.*not.*found|not found/i.test(message);
      return {
        ok: false,
        skipped: false,
        reason: bucketMissing ? 'poster_bucket_missing' : 'poster_upload_failed',
        error: bucketMissing ? `Storage bucket missing: ${POSTER_BUCKET_NAME}` : message,
        diagnostics: {
          ...download.diagnostics,
          bucket: POSTER_BUCKET_NAME,
          objectPathPresent: false,
          objectExists: false,
        },
      };
    }
  } catch (error) {
    return {
      ok: false,
      skipped: classifyFfmpegFailure(input.videoUrl, error) === 'stale_external_video_url',
      reason: classifyFfmpegFailure(input.videoUrl, error),
      error: sanitizeError(error),
    };
  } finally {
    await Promise.all([
      rm(videoPath, { force: true }).catch(() => undefined),
      rm(outputPath, { force: true }).catch(() => undefined),
    ]);
  }
}

async function capturePosterWithFfmpeg(candidate: PosterCandidate): Promise<PosterGenerationOutcome> {
  return generatePosterForVideo({
    entityKind: candidate.entityKind,
    id: candidate.id,
    userId: candidate.userId,
    videoUrl: candidate.videoUrl,
  });
}

async function persistPoster(candidate: PosterCandidate, posterUrl: string) {
  if (candidate.entityKind === 'generation_job') {
    await query(
      `update generation_jobs
       set poster_url = $2,
           thumbnail_url = $2,
           thumbnail_source = 'generated_poster',
           updated_at = now()
       where id = $1::uuid`,
      [candidate.id, posterUrl],
    );
    return;
  }

  if (candidate.entityKind === 'project') {
    await query(
      `update projects
       set poster_url = $2,
           thumbnail_url = $2,
           thumbnail_source = 'generated_poster',
           updated_at = now()
       where id = $1::uuid`,
      [candidate.id, posterUrl],
    );
    return;
  }

  await query(
    `update posts
     set poster_url = $2,
         thumbnail_url = $2,
         thumbnail_source = 'generated_poster',
         updated_at = now()
     where id = $1::uuid`,
    [candidate.id, posterUrl],
  );
}

async function markVideoFallback(candidate: PosterCandidate) {
  if (candidate.thumbnailSource === 'generated_poster') return;

  if (candidate.entityKind === 'generation_job') {
    await query(
      `update generation_jobs
       set thumbnail_source = 'video_output',
           updated_at = now()
       where id = $1::uuid
         and (thumbnail_source is null or thumbnail_source <> 'generated_poster')`,
      [candidate.id],
    );
    return;
  }

  if (candidate.entityKind === 'project') {
    await query(
      `update projects
       set thumbnail_source = 'video_output',
           updated_at = now()
       where id = $1::uuid
         and (thumbnail_source is null or thumbnail_source <> 'generated_poster')`,
      [candidate.id],
    );
    return;
  }

  await query(
    `update posts
     set thumbnail_source = 'video_output',
         updated_at = now()
     where id = $1::uuid
       and (thumbnail_source is null or thumbnail_source <> 'generated_poster')`,
    [candidate.id],
  );
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function isSkippableReason(reason: PosterFailureReason) {
  return [
    'poster_generation_unavailable',
    'video_object_missing',
    'video_download_failed',
    'video_too_large',
    'stale_external_video_url',
    'protected_or_non_video_url',
  ].includes(reason);
}

export async function backfillGeneratedVideoPosters(input: BackfillGeneratedVideoPosterOptions = {}): Promise<VideoPosterBackfillResult> {
  const runAt = new Date().toISOString();
  posterRuntimeStats.latestPosterBackfillRunAt = runAt;
  const repaired = await repairVideoThumbnails();
  const candidates = await findPosterCandidates(input);
  const availability = await getPosterGenerationAvailability({ refresh: true });

  if (!availability.available) {
    for (const candidate of candidates) {
      await markVideoFallback(candidate);
    }
    return buildUnavailablePosterBackfillResult({
      scannedCount: candidates.length,
      availability,
      repairedProjects: repaired.repairedProjects,
      repairedPosts: repaired.repairedPosts,
    });
  }

  const postersByVideoUrl = new Map<string, string>();
  const failures: VideoPosterBackfillResult['failures'] = [];
  const skippedByReason: Record<string, number> = {};
  const failedByReason: Record<string, number> = {};
  const generatedPosterUrls: string[] = [];
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    const existingPoster = postersByVideoUrl.get(candidate.videoUrl);
    if (existingPoster) {
      await persistPoster(candidate, existingPoster);
      generatedPosterUrls.push(redactUrl(existingPoster));
      generatedCount += 1;
      continue;
    }

    const poster = await capturePosterWithFfmpeg(candidate);
    if (poster.ok) {
      postersByVideoUrl.set(candidate.videoUrl, poster.posterUrl);
      generatedPosterUrls.push(redactUrl(poster.posterUrl));
      await persistPoster(candidate, poster.posterUrl);
      generatedCount += 1;
      continue;
    }

    const failedPoster = poster as Extract<PosterGenerationOutcome, { ok: false }>;
    const skipped = failedPoster.skipped || isSkippableReason(failedPoster.reason);
    if (skipped) {
      await markVideoFallback(candidate);
      skippedCount += 1;
      increment(skippedByReason, failedPoster.reason);
    } else {
      failedCount += 1;
      increment(failedByReason, failedPoster.reason);
    }
    if (failedPoster.reason === 'stale_external_video_url') posterRuntimeStats.staleExternalVideoUrlCount += 1;
    if (failedPoster.reason === 'protected_or_non_video_url') posterRuntimeStats.protectedOrNonVideoUrlCount += 1;
    posterRuntimeStats.latestPosterGenerationFailureReason = failedPoster.reason;
    failures.push({
      entityKind: candidate.entityKind,
      id: candidate.id,
      videoHost: sourceHost(candidate.videoUrl),
      reason: failedPoster.reason,
      error: failedPoster.error,
      diagnostics: failedPoster.diagnostics,
    });
  }

  posterRuntimeStats.skippedByReason = { ...skippedByReason };
  posterRuntimeStats.failedByReason = { ...failedByReason };

  return {
    ok: true,
    scannedCount: candidates.length,
    generatedCount,
    skippedCount,
    failedCount,
    repairedProjects: repaired.repairedProjects,
    repairedPosts: repaired.repairedPosts,
    posterGenerationAvailable: availability.available,
    availability,
    skippedByReason,
    failedByReason,
    generatedPosterUrls,
    failures,
    firstFailures: failures.slice(0, 8),
    runAt,
  };
}

export function getPosterBackfillRuntimeDiagnostics() {
  return {
    latestPosterBackfillRunAt: posterRuntimeStats.latestPosterBackfillRunAt,
    latestPosterGenerationFailureReason: posterRuntimeStats.latestPosterGenerationFailureReason,
    staleExternalVideoUrlCount: posterRuntimeStats.staleExternalVideoUrlCount,
    protectedOrNonVideoUrlCount: posterRuntimeStats.protectedOrNonVideoUrlCount,
    skippedByReason: posterRuntimeStats.skippedByReason,
    failedByReason: posterRuntimeStats.failedByReason,
  };
}

export async function buildGeneratedVideoPosterDiagnostics() {
  try {
    return {
      ok: true,
      availability: await getPosterGenerationAvailability(),
      runtime: getPosterBackfillRuntimeDiagnostics(),
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeDiagnosticError(error),
    };
  }
}
