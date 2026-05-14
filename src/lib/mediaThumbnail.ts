import type { ReferenceImageUrls } from './api';

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

export function getBestThumbnail(item: unknown): string | null {
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

export function getBestPoster(item: unknown): string | null {
  return getBestThumbnail(item);
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
