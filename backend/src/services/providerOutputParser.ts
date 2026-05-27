export type ProviderOutputParseCategory =
  | 'ok'
  | 'output_missing'
  | 'unsupported_output_shape'
  | 'image_output'
  | 'non_video_output'
  | 'error_output';

export type ProviderOutputParseSuccess = {
  ok: true;
  category: 'ok';
  videoUrl: string;
  sourcePath: string;
};

export type ProviderOutputParseFailure = {
  ok: false;
  category: Exclude<ProviderOutputParseCategory, 'ok'>;
  videoUrl: null;
  sourcePath: string | null;
  reason: string;
};

export type ProviderOutputParseResult = ProviderOutputParseSuccess | ProviderOutputParseFailure;

const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|mov|m4v|avi|mpeg|mpg|m3u8)(?:[?#].*)?$/i;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif|heic|heif)(?:[?#].*)?$/i;
const TEXT_EXTENSION_PATTERN = /\.(txt|json|log|csv|html?)(?:[?#].*)?$/i;
const VIDEO_CONTENT_TYPE_PATTERN = /^video\//i;
const IMAGE_CONTENT_TYPE_PATTERN = /^image\//i;
const DANGEROUS_KEYS = new Set([
  'error',
  'errors',
  'log',
  'logs',
  'message',
  'messages',
  'stderr',
  'stdout',
  'trace',
  'traceback',
]);
const PREFERRED_KEYS = [
  'video',
  'video_url',
  'videoUrl',
  'output',
  'outputs',
  'url',
  'uri',
  'file',
  'files',
  'artifact',
  'artifacts',
  'result',
  'results',
];
const CONTENT_TYPE_KEYS = ['content_type', 'contentType', 'mime_type', 'mimeType', 'type'];
const CONTENT_TYPED_URL_KEYS = ['url', 'video_url', 'videoUrl', 'uri'];

function stringifyUrlLike(value: unknown): string | null {
  if (Array.isArray(value)) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (value instanceof URL) return value.toString();

  if (value && typeof value === 'object') {
    const maybeFileOutput = value as { url?: () => URL | string; toString?: () => string };
    if (typeof maybeFileOutput.url === 'function') {
      const url = maybeFileOutput.url();
      return url instanceof URL ? url.toString() : String(url || '').trim() || null;
    }

    if (typeof maybeFileOutput.toString === 'function') {
      const stringValue = maybeFileOutput.toString().trim();
      if (stringValue && stringValue !== '[object Object]') return stringValue;
    }
  }

  return null;
}

function isUrlCandidate(value: string) {
  return /^https?:\/\//i.test(value) || /^\/[^/]/.test(value);
}

function isErrorText(value: string) {
  return /\b(error|failed|exception|traceback|stack trace|moderation|policy violation)\b/i.test(value);
}

function classifyUrl(value: string, context?: { contentType?: string | null }): ProviderOutputParseResult {
  const contentType = typeof context?.contentType === 'string' ? context.contentType.trim() : '';
  if (!value) {
    return {
      ok: false,
      category: 'output_missing',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider output was empty.',
    };
  }

  if (!isUrlCandidate(value)) {
    return {
      ok: false,
      category: isErrorText(value) ? 'error_output' : 'non_video_output',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider output was not a URL.',
    };
  }

  if (/^(data|blob):/i.test(value)) {
    return {
      ok: false,
      category: 'unsupported_output_shape',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider output used a transient browser URL.',
    };
  }

  if (/^\/demo-video\.mp4(?:[?#].*)?$/i.test(value)) {
    return {
      ok: false,
      category: 'non_video_output',
      videoUrl: null,
      sourcePath: null,
      reason: 'Demo output cannot be counted as provider video output.',
    };
  }

  if (VIDEO_CONTENT_TYPE_PATTERN.test(contentType)) {
    return {
      ok: true,
      category: 'ok',
      videoUrl: value,
      sourcePath: '',
    };
  }

  if (IMAGE_CONTENT_TYPE_PATTERN.test(contentType)) {
    return {
      ok: false,
      category: 'image_output',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider returned an image URL where video output was expected.',
    };
  }

  if (IMAGE_EXTENSION_PATTERN.test(value)) {
    return {
      ok: false,
      category: 'image_output',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider returned an image URL where video output was expected.',
    };
  }

  if (TEXT_EXTENSION_PATTERN.test(value)) {
    return {
      ok: false,
      category: 'non_video_output',
      videoUrl: null,
      sourcePath: null,
      reason: 'Provider returned a text/log URL where video output was expected.',
    };
  }

  return {
    ok: true,
    category: 'ok',
    videoUrl: value,
    sourcePath: '',
  };
}

function contentTypeFromRecord(record: Record<string, unknown>) {
  for (const key of CONTENT_TYPE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function betterFailure(
  current: ProviderOutputParseResult | null,
  next: ProviderOutputParseResult,
): ProviderOutputParseResult {
  if (!current) return next;
  const priority: Record<ProviderOutputParseCategory, number> = {
    ok: 0,
    image_output: 1,
    non_video_output: 2,
    error_output: 3,
    unsupported_output_shape: 4,
    output_missing: 5,
  };
  return priority[next.category] < priority[current.category] ? next : current;
}

function parseAtPath(value: unknown, path: string, depth: number, seen: Set<unknown>): ProviderOutputParseResult {
  if (value == null) {
    return {
      ok: false,
      category: 'output_missing',
      videoUrl: null,
      sourcePath: path || null,
      reason: 'Provider output was empty.',
    };
  }

  if (depth > 8) {
    return {
      ok: false,
      category: 'unsupported_output_shape',
      videoUrl: null,
      sourcePath: path || null,
      reason: 'Provider output was nested too deeply.',
    };
  }

  const directUrl = stringifyUrlLike(value);
  if (directUrl) {
    const classified = classifyUrl(directUrl);
    return classified.ok ? { ...classified, sourcePath: path || '$' } : { ...classified, sourcePath: path || '$' };
  }

  if (typeof value !== 'object') {
    return {
      ok: false,
      category: 'unsupported_output_shape',
      videoUrl: null,
      sourcePath: path || null,
      reason: `Provider output value was ${typeof value}, not a video URL.`,
    };
  }

  if (seen.has(value)) {
    return {
      ok: false,
      category: 'unsupported_output_shape',
      videoUrl: null,
      sourcePath: path || null,
      reason: 'Provider output contained a circular reference.',
    };
  }
  seen.add(value);

  if (Array.isArray(value)) {
    let failure: ProviderOutputParseResult | null = null;
    for (let index = 0; index < value.length; index += 1) {
      const result = parseAtPath(value[index], `${path || '$'}[${index}]`, depth + 1, seen);
      if (result.ok) return result;
      failure = betterFailure(failure, result);
    }
    return failure ?? {
      ok: false,
      category: 'output_missing',
      videoUrl: null,
      sourcePath: path || null,
      reason: 'Provider output array was empty.',
    };
  }

  const record = value as Record<string, unknown>;
  let failure: ProviderOutputParseResult | null = null;
  const contentType = contentTypeFromRecord(record);

  if (contentType && (VIDEO_CONTENT_TYPE_PATTERN.test(contentType) || IMAGE_CONTENT_TYPE_PATTERN.test(contentType))) {
    for (const key of CONTENT_TYPED_URL_KEYS) {
      if (!(key in record)) continue;
      const url = stringifyUrlLike(record[key]);
      if (!url) continue;
      const result = classifyUrl(url, { contentType });
      const withPath = { ...result, sourcePath: `${path || '$'}.${key}` } as ProviderOutputParseResult;
      if (withPath.ok) return withPath;
      failure = betterFailure(failure, withPath);
    }
  }

  for (const key of PREFERRED_KEYS) {
    if (!(key in record)) continue;
    const result = parseAtPath(record[key], `${path || '$'}.${key}`, depth + 1, seen);
    if (result.ok) return result;
    failure = betterFailure(failure, result);
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (PREFERRED_KEYS.includes(key) || DANGEROUS_KEYS.has(key.toLowerCase())) continue;
    const result = parseAtPath(nestedValue, `${path || '$'}.${key}`, depth + 1, seen);
    if (result.ok) return result;
    failure = betterFailure(failure, result);
  }

  return failure ?? {
    ok: false,
    category: 'unsupported_output_shape',
    videoUrl: null,
    sourcePath: path || null,
    reason: 'Provider output did not contain a usable video URL.',
  };
}

export function parseProviderVideoOutput(output: unknown): ProviderOutputParseResult {
  return parseAtPath(output, '$', 0, new Set());
}

export function extractProviderVideoUrl(output: unknown): string | null {
  const parsed = parseProviderVideoOutput(output);
  return parsed.ok ? parsed.videoUrl : null;
}

export class ProviderOutputError extends Error {
  readonly category: Exclude<ProviderOutputParseCategory, 'ok'>;
  readonly reason: string;
  readonly sourcePath: string | null;

  constructor(result: ProviderOutputParseFailure) {
    super(result.reason);
    this.name = 'ProviderOutputError';
    this.category = result.category;
    this.reason = result.reason;
    this.sourcePath = result.sourcePath;
  }
}

export function isProviderOutputError(error: unknown): error is ProviderOutputError {
  return error instanceof ProviderOutputError || (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'ProviderOutputError'
  );
}
