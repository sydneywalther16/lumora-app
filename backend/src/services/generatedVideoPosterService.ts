import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { query } from './db';
import { uploadGeneratedAsset } from './storageService';
import { serializeDiagnosticError } from './schemaDiagnostics';
import { repairVideoThumbnails } from './videoThumbnailRepair';

const execFileAsync = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 45_000;
const FFMPEG_PROBE_TIMEOUT_MS = 2_000;
const POSTER_SCAN_LIMIT = 50;

type PosterEntityKind = 'generation_job' | 'project' | 'post';

type PosterCandidate = {
  entityKind: PosterEntityKind;
  id: string;
  userId: string | null;
  videoUrl: string;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  thumbnailSource: string | null;
};

type PosterGenerationAvailability = {
  available: boolean;
  method: 'ffmpeg' | 'unavailable';
  ffmpegAvailable: boolean;
  storageAvailable: boolean;
  reason: string | null;
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
      reason: string;
      error?: string;
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
  failures: Array<{
    entityKind: PosterEntityKind;
    id: string;
    videoHost: string | null;
    reason: string;
    error?: string;
  }>;
};

let availabilityCache: PosterGenerationAvailability | null = null;

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

function sanitizeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  return message.replace(/https?:\/\/[^\s"')]+/g, (url) => {
    const host = sourceHost(url);
    return host ? `https://${host}/...` : '[redacted-url]';
  }).slice(0, 500);
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

export async function getPosterGenerationAvailability(options: { refresh?: boolean } = {}): Promise<PosterGenerationAvailability> {
  if (availabilityCache && !options.refresh) return availabilityCache;

  const ffmpegAvailable = await detectFfmpeg();
  const storageAvailable = Boolean(supabaseAdmin);
  let reason: string | null = null;
  if (!ffmpegAvailable) {
    reason = 'ffmpeg_unavailable';
  } else if (!storageAvailable) {
    reason = 'supabase_storage_unavailable';
  }

  availabilityCache = {
    available: ffmpegAvailable && storageAvailable,
    method: ffmpegAvailable && storageAvailable ? 'ffmpeg' : 'unavailable',
    ffmpegAvailable,
    storageAvailable,
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
    failures: [],
  };
}

function isMissingGeneratedPoster(candidate: PosterCandidate) {
  if (!candidate.videoUrl) return false;
  if (candidate.posterUrl) return false;
  if (candidate.thumbnailUrl && candidate.thumbnailSource === 'generated_poster') return false;
  return true;
}

async function findPosterCandidates(limit = POSTER_SCAN_LIMIT): Promise<PosterCandidate[]> {
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

async function capturePosterWithFfmpeg(candidate: PosterCandidate): Promise<PosterGenerationOutcome> {
  const availability = await getPosterGenerationAvailability();
  if (!availability.available) {
    return {
      ok: false,
      skipped: true,
      reason: availability.reason ?? 'poster_generation_unavailable',
    };
  }

  const owner = candidate.userId ?? 'system';
  const workDir = join(tmpdir(), 'lumora-video-posters');
  const outputPath = join(workDir, `${randomUUID()}.jpg`);
  await mkdir(workDir, { recursive: true });

  try {
    await execFileAsync(ffmpegBinary(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '00:00:01',
      '-i',
      candidate.videoUrl,
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

    const buffer = await readFile(outputPath);
    if (!buffer.length) {
      return {
        ok: false,
        skipped: false,
        reason: 'poster_frame_empty',
      };
    }

    const asset = await uploadGeneratedAsset({
      userId: owner,
      fileName: `${candidate.entityKind}-${candidate.id}-poster.jpg`,
      contentType: 'image/jpeg',
      buffer,
      folder: 'generated-posters',
    });

    return {
      ok: true,
      posterUrl: asset.publicUrl,
      method: 'ffmpeg',
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: 'poster_generation_failed',
      error: sanitizeError(error),
    };
  } finally {
    await rm(outputPath, { force: true }).catch(() => undefined);
  }
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
  if (candidate.thumbnailSource) return;

  if (candidate.entityKind === 'generation_job') {
    await query(
      `update generation_jobs
       set thumbnail_source = 'video_output',
           updated_at = now()
       where id = $1::uuid
         and thumbnail_source is null`,
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
         and thumbnail_source is null`,
      [candidate.id],
    );
    return;
  }

  await query(
    `update posts
     set thumbnail_source = 'video_output',
         updated_at = now()
     where id = $1::uuid
       and thumbnail_source is null`,
    [candidate.id],
  );
}

export async function backfillGeneratedVideoPosters(input: { limit?: number } = {}): Promise<VideoPosterBackfillResult> {
  const repaired = await repairVideoThumbnails();
  const candidates = await findPosterCandidates(input.limit ?? POSTER_SCAN_LIMIT);
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
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    const existingPoster = postersByVideoUrl.get(candidate.videoUrl);
    if (existingPoster) {
      await persistPoster(candidate, existingPoster);
      generatedCount += 1;
      continue;
    }

    const poster = await capturePosterWithFfmpeg(candidate);
    if (poster.ok) {
      postersByVideoUrl.set(candidate.videoUrl, poster.posterUrl);
      await persistPoster(candidate, poster.posterUrl);
      generatedCount += 1;
      continue;
    }

    const failedPoster = poster as Extract<PosterGenerationOutcome, { ok: false }>;
    if (failedPoster.skipped) {
      await markVideoFallback(candidate);
      skippedCount += 1;
    } else {
      failedCount += 1;
    }
    failures.push({
      entityKind: candidate.entityKind,
      id: candidate.id,
      videoHost: sourceHost(candidate.videoUrl),
      reason: failedPoster.reason,
      error: failedPoster.error,
    });
  }

  return {
    ok: failedCount === 0,
    scannedCount: candidates.length,
    generatedCount,
    skippedCount,
    failedCount,
    repairedProjects: repaired.repairedProjects,
    repairedPosts: repaired.repairedPosts,
    posterGenerationAvailable: availability.available,
    availability,
    failures,
  };
}

export async function buildGeneratedVideoPosterDiagnostics() {
  try {
    return {
      ok: true,
      availability: await getPosterGenerationAvailability(),
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeDiagnosticError(error),
    };
  }
}
