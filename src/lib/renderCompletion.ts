const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|mov|m4v|mpeg|mpg|m3u8)(?:[?#].*)?$/i;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif|heic|heif)(?:[?#].*)?$/i;
const TEXT_EXTENSION_PATTERN = /\.(txt|json|log|csv|html?)(?:[?#].*)?$/i;

function stringUrl(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = stringUrl(item);
      if (url) return url;
    }
  }
  return null;
}

export function normalizeVerifiedVideoOutputUrl(value: unknown): string | null {
  const url = stringUrl(value);
  if (!url) return null;
  if (/^(data|blob):/i.test(url)) return null;
  if (!/^https?:\/\//i.test(url) && !/^\/[^/]/.test(url)) return null;
  if (/^\/demo-video\.mp4(?:[?#].*)?$/i.test(url)) return null;
  if (IMAGE_EXTENSION_PATTERN.test(url) || TEXT_EXTENSION_PATTERN.test(url)) return null;
  if (/^\/[^/]/.test(url) && !VIDEO_EXTENSION_PATTERN.test(url)) return null;
  return url;
}

export function getVerifiedVideoOutputUrl(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) return null;
  return (
    normalizeVerifiedVideoOutputUrl(record.videoUrl) ||
    normalizeVerifiedVideoOutputUrl(record.video_url) ||
    normalizeVerifiedVideoOutputUrl(record.outputUrl) ||
    normalizeVerifiedVideoOutputUrl(record.output_url) ||
    normalizeVerifiedVideoOutputUrl(record.resultAssetUrl) ||
    normalizeVerifiedVideoOutputUrl(record.result_asset_url) ||
    normalizeVerifiedVideoOutputUrl(record.coverAssetUrl) ||
    normalizeVerifiedVideoOutputUrl(record.cover_asset_url)
  );
}

export function hasVerifiedVideoOutput(record: Record<string, unknown> | null | undefined) {
  return Boolean(getVerifiedVideoOutputUrl(record));
}

export function isPublishEligible(record: Record<string, unknown> | null | undefined) {
  return hasVerifiedVideoOutput(record);
}

export function isContinueStoryEligible(record: Record<string, unknown> | null | undefined) {
  return hasVerifiedVideoOutput(record);
}
