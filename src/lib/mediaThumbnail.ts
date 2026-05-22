import type { ReferenceImageUrls } from './api';
import { normalizeVerifiedVideoOutputUrl } from './renderCompletion';

type MediaRecord = Record<string, unknown>;

export type NormalizedMediaCard = {
  id: string;
  title: string;
  caption: string;
  thumbnailUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  creatorName: string | null;
  creatorAvatar: string | null;
};

export type GeneratedVideoMedia = {
  videoUrl: string | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  hasVerifiedVideo: boolean;
  mainPreviewType: 'poster' | 'video' | 'placeholder';
  thumbnailSource: 'generated_poster' | 'video_output' | 'placeholder' | 'character_badge_only';
  castBadgeUrl: string | null;
};

function readRecord(value: unknown): MediaRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MediaRecord
    : {};
}

function readString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
}

function imageLikeUrl(value: unknown) {
  const url = readString(value);
  if (!url) return null;
  if (/^data:video/i.test(url)) return null;
  if (/^blob:/i.test(url)) return null;
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url)) return null;
  return url;
}

function videoLikeUrl(value: unknown) {
  const url = readString(value);
  if (!url) return null;
  if (/^data:image/i.test(url)) return null;
  return url;
}

function firstReferenceImage(value: unknown) {
  const references = readRecord(value);
  const preferredKeys: Array<keyof ReferenceImageUrls> = [
    'frontFaceUrl',
    'frontFace',
    'manualReferenceImageUrl',
    'fullBodyUrl',
    'fullBody',
    'expressiveUrl',
    'expressive',
    'leftAngleUrl',
    'leftAngle',
    'rightAngleUrl',
    'rightAngle',
  ];

  for (const key of preferredKeys) {
    const url = imageLikeUrl(references[key]);
    if (url) return url;
  }

  return null;
}

function collectReferenceImageValues(value: unknown) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return imageLikeUrl(entry);
        const record = readRecord(entry);
        return imageLikeUrl(record.url);
      })
      .filter((url): url is string => Boolean(url));
  }

  const references = readRecord(value);
  return [
    imageLikeUrl(references.frontFaceUrl),
    imageLikeUrl(references.frontFace),
    imageLikeUrl(references.fullBodyUrl),
    imageLikeUrl(references.fullBody),
    imageLikeUrl(references.expressiveUrl),
    imageLikeUrl(references.expressive),
    imageLikeUrl(references.leftAngleUrl),
    imageLikeUrl(references.leftAngle),
    imageLikeUrl(references.rightAngleUrl),
    imageLikeUrl(references.rightAngle),
    imageLikeUrl(references.manualReferenceImageUrl),
  ].filter((url): url is string => Boolean(url));
}

function collectReferenceImages(record: MediaRecord) {
  return Array.from(new Set([
    imageLikeUrl(record.referenceImageUrl),
    imageLikeUrl(record.reference_image_url),
    ...collectReferenceImageValues(record.referenceImageUrls),
    ...collectReferenceImageValues(record.reference_image_urls),
    ...collectReferenceImageValues(record.referenceImages),
    ...collectReferenceImageValues(record.reference_images),
    ...collectReferenceImageValues(record.additionalReferenceImageUrls),
    ...collectReferenceImageValues(record.additional_reference_image_urls),
    imageLikeUrl(record.characterAvatar),
    imageLikeUrl(record.character_avatar),
    imageLikeUrl(record.creatorAvatar),
    imageLikeUrl(record.creator_avatar),
    imageLikeUrl(record.avatar),
    imageLikeUrl(record.castAvatar),
    imageLikeUrl(record.cast_avatar),
  ].filter((url): url is string => Boolean(url))));
}

function sameUrl(left: string | null, right: string | null) {
  if (!left || !right) return false;
  return left.trim() === right.trim();
}

function sourceLabelLooksReference(value: unknown) {
  return typeof value === 'string' && /character|reference|self|avatar|cast/i.test(value);
}

function generatedPosterCandidate(record: MediaRecord, referenceUrls: string[]) {
  const candidates = [
    { url: imageLikeUrl(record.posterUrl), source: record.posterSource ?? record.poster_source },
    { url: imageLikeUrl(record.poster_url), source: record.posterSource ?? record.poster_source },
    { url: imageLikeUrl(record.videoPosterUrl), source: record.videoPosterSource ?? record.video_poster_source },
    { url: imageLikeUrl(record.video_poster_url), source: record.videoPosterSource ?? record.video_poster_source },
    { url: imageLikeUrl(record.thumbnailUrl), source: record.thumbnailSource ?? record.thumbnail_source },
    { url: imageLikeUrl(record.thumbnail_url), source: record.thumbnailSource ?? record.thumbnail_source },
    { url: imageLikeUrl(record.coverImageUrl), source: record.coverImageSource ?? record.cover_image_source },
    { url: imageLikeUrl(record.cover_image_url), source: record.coverImageSource ?? record.cover_image_source },
    { url: imageLikeUrl(record.coverAssetUrl), source: record.coverAssetSource ?? record.cover_asset_source },
    { url: imageLikeUrl(record.cover_asset_url), source: record.coverAssetSource ?? record.cover_asset_source },
    { url: imageLikeUrl(record.previewImageUrl), source: record.previewImageSource ?? record.preview_image_source },
    { url: imageLikeUrl(record.preview_image_url), source: record.previewImageSource ?? record.preview_image_source },
    { url: imageLikeUrl(record.providerPreviewImageUrl), source: record.providerPreviewImageSource ?? record.provider_preview_image_source },
    { url: imageLikeUrl(record.provider_preview_image_url), source: record.providerPreviewImageSource ?? record.provider_preview_image_source },
    { url: imageLikeUrl(record.imageUrl), source: record.imageSource ?? record.image_source },
    { url: imageLikeUrl(record.image_url), source: record.imageSource ?? record.image_source },
    { url: imageLikeUrl(record.keyframeUrl), source: record.keyframeSource ?? record.keyframe_source },
    { url: imageLikeUrl(record.keyframe_url), source: record.keyframeSource ?? record.keyframe_source },
  ];

  for (const candidate of candidates) {
    if (!candidate.url) continue;
    if (sourceLabelLooksReference(candidate.source)) continue;
    if (referenceUrls.some((referenceUrl) => sameUrl(candidate.url, referenceUrl))) continue;
    return candidate.url;
  }

  return null;
}

export function resolveGeneratedVideoMedia(item: unknown): GeneratedVideoMedia {
  const record = readRecord(item);
  const videoUrl = (
    normalizeVerifiedVideoOutputUrl(record.videoUrl) ||
    normalizeVerifiedVideoOutputUrl(record.video_url) ||
    normalizeVerifiedVideoOutputUrl(record.resultAssetUrl) ||
    normalizeVerifiedVideoOutputUrl(record.result_asset_url) ||
    normalizeVerifiedVideoOutputUrl(record.outputUrl) ||
    normalizeVerifiedVideoOutputUrl(record.output_url) ||
    normalizeVerifiedVideoOutputUrl(record.coverAssetUrl) ||
    normalizeVerifiedVideoOutputUrl(record.cover_asset_url)
  );
  const referenceUrls = collectReferenceImages(record);
  const posterUrl = generatedPosterCandidate(record, referenceUrls);
  const castBadgeUrl = referenceUrls[0] ?? null;

  if (videoUrl) {
    return {
      videoUrl,
      posterUrl,
      thumbnailUrl: posterUrl,
      hasVerifiedVideo: true,
      mainPreviewType: posterUrl ? 'poster' : 'video',
      thumbnailSource: posterUrl ? 'generated_poster' : 'video_output',
      castBadgeUrl,
    };
  }

  if (posterUrl) {
    return {
      videoUrl: null,
      posterUrl,
      thumbnailUrl: posterUrl,
      hasVerifiedVideo: false,
      mainPreviewType: 'poster',
      thumbnailSource: 'generated_poster',
      castBadgeUrl,
    };
  }

  return {
    videoUrl: null,
    posterUrl: null,
    thumbnailUrl: null,
    hasVerifiedVideo: false,
    mainPreviewType: 'placeholder',
    thumbnailSource: castBadgeUrl ? 'character_badge_only' : 'placeholder',
    castBadgeUrl,
  };
}

function legacyThumbnail(item: unknown): string | null {
  const record = readRecord(item);
  return (
    imageLikeUrl(record.thumbnailUrl) ||
    imageLikeUrl(record.thumbnail_url) ||
    imageLikeUrl(record.posterUrl) ||
    imageLikeUrl(record.poster_url) ||
    imageLikeUrl(record.coverImageUrl) ||
    imageLikeUrl(record.cover_image_url) ||
    imageLikeUrl(record.coverAssetUrl) ||
    imageLikeUrl(record.cover_asset_url) ||
    imageLikeUrl(record.previewImageUrl) ||
    imageLikeUrl(record.preview_image_url) ||
    imageLikeUrl(record.providerPreviewImageUrl) ||
    imageLikeUrl(record.provider_preview_image_url) ||
    imageLikeUrl(record.imageUrl) ||
    imageLikeUrl(record.image_url) ||
    imageLikeUrl(record.keyframeUrl) ||
    imageLikeUrl(record.keyframe_url) ||
    imageLikeUrl(record.referenceImageUrl) ||
    imageLikeUrl(record.reference_image_url) ||
    firstReferenceImage(record.referenceImageUrls) ||
    firstReferenceImage(record.reference_image_urls) ||
    imageLikeUrl(record.characterAvatar) ||
    imageLikeUrl(record.character_avatar) ||
    null
  );
}

export function getBestThumbnail(item: unknown): string | null {
  const generated = resolveGeneratedVideoMedia(item);
  if (generated.hasVerifiedVideo) return generated.thumbnailUrl;
  return generated.thumbnailUrl ?? legacyThumbnail(item);
}

export function getBestPoster(item: unknown): string | null {
  const generated = resolveGeneratedVideoMedia(item);
  if (generated.hasVerifiedVideo) return generated.posterUrl;
  return generated.posterUrl ?? legacyThumbnail(item);
}

export function getBestVideo(item: unknown): string | null {
  const record = readRecord(item);
  return (
    videoLikeUrl(record.videoUrl) ||
    videoLikeUrl(record.video_url) ||
    videoLikeUrl(record.resultAssetUrl) ||
    videoLikeUrl(record.result_asset_url) ||
    videoLikeUrl(record.outputUrl) ||
    videoLikeUrl(record.output_url) ||
    null
  );
}

export function normalizeMediaCard(item: unknown): NormalizedMediaCard {
  const record = readRecord(item);
  const title = readString(record.title, record.caption, record.prompt, record.name) ?? 'Untitled Lumora video';
  const caption = readString(record.caption, record.prompt, record.finalPrompt, record.final_prompt) ?? '';

  return {
    id: readString(record.id, record.projectId, record.project_id, record.sourceGenerationId, record.source_generation_id) ?? title,
    title,
    caption,
    thumbnailUrl: getBestThumbnail(record),
    posterUrl: getBestPoster(record),
    videoUrl: getBestVideo(record),
    creatorName: readString(record.creatorName, record.creator_name, record.displayName, record.display_name, record.username),
    creatorAvatar: getBestThumbnail({
      thumbnailUrl: record.creatorAvatar,
      imageUrl: record.creator_avatar,
      referenceImageUrl: record.avatar,
    }),
  };
}

export function repairMissingThumbnailIfNeeded<T extends MediaRecord>(item: T): T {
  const thumbnail = getBestThumbnail(item);
  if (!thumbnail || imageLikeUrl(item.thumbnailUrl) || imageLikeUrl(item.thumbnail_url)) return item;

  return {
    ...item,
    thumbnailUrl: thumbnail,
  };
}

// TODO: Replace image fallbacks with server-side ffmpeg frame extraction when the backend has a durable worker for video thumbnail generation.
