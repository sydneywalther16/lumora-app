import { readFile } from 'node:fs/promises';

export const OPENAI_VIDEOS_API_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_VIDEOS_SHUTDOWN_DATE = '2026-09-24';
export const OPENAI_VIDEOS_DEPRECATED = true;
export const OPENAI_CHARACTER_VIDEO_USAGE_MAPPED = false;

export type OpenAIVideoFailureCategory =
  | 'openai_video_unavailable'
  | 'openai_character_unavailable'
  | 'openai_access_denied'
  | 'openai_deprecated'
  | 'openai_model_not_found'
  | 'openai_raw_api_error'
  | 'unsupported_until_character_usage_mapped';

export type OpenAIVideoJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | string;

export type OpenAIVideoJob = {
  id: string;
  object?: string;
  model?: string;
  status?: OpenAIVideoJobStatus;
  progress?: number;
  created_at?: number;
  completed_at?: number | null;
  expires_at?: number | null;
  size?: string;
  seconds?: string;
  quality?: string;
  error?: {
    code?: string;
    message?: string;
  } | null;
  [key: string]: unknown;
};

export type OpenAIVideoCharacter = {
  id: string;
  object?: string;
  name?: string;
  status?: string;
  created_at?: number;
  [key: string]: unknown;
};

export type OpenAIVideosRawClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type OpenAICreateCharacterInput = {
  name: string;
  videoFilePath?: string;
  videoBuffer?: Buffer;
  filename: string;
  contentType: string;
};

export type OpenAICreateVideoInput = {
  prompt: string;
  model: string;
  seconds: 4 | 8 | 12;
  size: string;
  characterId?: string | null;
};

export class OpenAIVideosRawError extends Error {
  readonly code: string;
  readonly category: OpenAIVideoFailureCategory;
  readonly statusCode: number | null;
  readonly detail: string | null;

  constructor(input: {
    code: string;
    category: OpenAIVideoFailureCategory;
    message: string;
    statusCode?: number | null;
    detail?: string | null;
  }) {
    super(input.message);
    this.name = 'OpenAIVideosRawError';
    this.code = input.code;
    this.category = input.category;
    this.statusCode = input.statusCode ?? null;
    this.detail = input.detail ?? null;
  }
}

function redactOpenAIErrorText(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9._-]+/gi, 'sk-[redacted]')
    .slice(0, 280);
}

async function responsePayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => null);
}

function errorPayloadText(payload: unknown) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') return String(payload);
  const record = payload as Record<string, unknown>;
  const error = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : record;
  return [
    typeof error.code === 'string' ? error.code : '',
    typeof error.message === 'string' ? error.message : '',
    typeof record.message === 'string' ? record.message : '',
  ].filter(Boolean).join(' ');
}

export function classifyOpenAIVideosRawError(input: {
  statusCode: number;
  payload: unknown;
  endpoint: 'characters' | 'videos' | 'content';
}): {
  code: string;
  category: OpenAIVideoFailureCategory;
  message: string;
  detail: string | null;
} {
  const text = errorPayloadText(input.payload) ?? '';
  const lower = text.toLowerCase();
  const detail = redactOpenAIErrorText(text);

  if (input.statusCode === 401 || input.statusCode === 403 || lower.includes('access') || lower.includes('permission')) {
    return {
      code: 'openai_access_denied',
      category: 'openai_access_denied',
      message: 'OpenAI video access is denied for the current API key or project.',
      detail,
    };
  }

  if (lower.includes('deprecated') || lower.includes('sunset') || lower.includes('shutdown')) {
    return {
      code: 'openai_deprecated',
      category: 'openai_deprecated',
      message: 'OpenAI Videos returned a deprecation or shutdown error.',
      detail,
    };
  }

  if (lower.includes('model_not_found') || lower.includes('model not found')) {
    return {
      code: 'openai_model_not_found',
      category: 'openai_model_not_found',
      message: 'The configured OpenAI video model is not available to this project.',
      detail,
    };
  }

  if (input.statusCode === 404) {
    return input.endpoint === 'characters'
      ? {
          code: 'openai_character_unavailable',
          category: 'openai_character_unavailable',
          message: 'The OpenAI video character endpoint is unavailable for this project.',
          detail,
        }
      : {
          code: 'openai_video_unavailable',
          category: 'openai_video_unavailable',
          message: 'The OpenAI video endpoint is unavailable for this project.',
          detail,
        };
  }

  return {
    code: 'openai_raw_api_error',
    category: 'openai_raw_api_error',
    message: 'OpenAI Videos returned an API error.',
    detail,
  };
}

export class OpenAIVideosRawClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIVideosRawClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? OPENAI_VIDEOS_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private async requestJson<T>(input: {
    path: string;
    method: string;
    body?: BodyInit;
    endpoint: 'characters' | 'videos' | 'content';
  }): Promise<T> {
    const response = await this.fetchImpl(this.url(input.path), {
      method: input.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: input.body,
    });

    if (!response.ok) {
      const payload = await responsePayload(response);
      const classified = classifyOpenAIVideosRawError({
        statusCode: response.status,
        payload,
        endpoint: input.endpoint,
      });
      throw new OpenAIVideosRawError({
        ...classified,
        statusCode: response.status,
      });
    }

    return response.json() as Promise<T>;
  }

  async createCharacter(input: OpenAICreateCharacterInput): Promise<OpenAIVideoCharacter> {
    const videoBytes = input.videoBuffer ?? await readFile(input.videoFilePath ?? '');
    const body = new FormData();
    body.set('name', input.name);
    body.set(
      'video',
      new Blob([new Uint8Array(videoBytes)], { type: input.contentType || 'video/mp4' }),
      input.filename || 'self-character-video.mp4',
    );

    return this.requestJson<OpenAIVideoCharacter>({
      path: '/videos/characters',
      method: 'POST',
      body,
      endpoint: 'characters',
    });
  }

  async createVideo(input: OpenAICreateVideoInput): Promise<OpenAIVideoJob> {
    if (input.characterId) {
      throw new OpenAIVideosRawError({
        code: 'unsupported_until_character_usage_mapped',
        category: 'unsupported_until_character_usage_mapped',
        message: 'Character creation is available, but video generation with a stored character id is not mapped yet.',
      });
    }

    const body = new FormData();
    body.set('prompt', input.prompt);
    body.set('model', input.model);
    body.set('seconds', String(input.seconds));
    body.set('size', input.size);

    return this.requestJson<OpenAIVideoJob>({
      path: '/videos',
      method: 'POST',
      body,
      endpoint: 'videos',
    });
  }

  async retrieveVideo(videoId: string): Promise<OpenAIVideoJob> {
    return this.requestJson<OpenAIVideoJob>({
      path: `/videos/${encodeURIComponent(videoId)}`,
      method: 'GET',
      endpoint: 'videos',
    });
  }

  async downloadVideoContent(videoId: string, variant = 'video') {
    const suffix = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    const response = await this.fetchImpl(this.url(`/videos/${encodeURIComponent(videoId)}/content${suffix}`), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const payload = await responsePayload(response);
      const classified = classifyOpenAIVideosRawError({
        statusCode: response.status,
        payload,
        endpoint: 'content',
      });
      throw new OpenAIVideosRawError({
        ...classified,
        statusCode: response.status,
      });
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'video/mp4',
    };
  }
}
