import type { SupabaseClient } from '@supabase/supabase-js';

export const SCENE_ANCHOR_ASSET_BUCKET = 'lumora-assets';
const SCENE_ANCHOR_ASSET_MAX_BYTES = 25 * 1024 * 1024;

type SceneAnchorStorageClient = Pick<SupabaseClient, 'storage'>;

type SceneAnchorAssetUploadInput = {
  userId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  folder?: string;
  bucket?: string;
  envSource?: NodeJS.ProcessEnv;
  storageClient?: SceneAnchorStorageClient | null;
  supabaseModuleLoader?: () => Promise<{ createClient: typeof import('@supabase/supabase-js').createClient }>;
};

type SceneAnchorProviderImageInput = {
  userId: string;
  imageUrl: string;
  fetchImpl?: typeof fetch;
  envSource?: NodeJS.ProcessEnv;
  storageClient?: SceneAnchorStorageClient | null;
  supabaseModuleLoader?: () => Promise<{ createClient: typeof import('@supabase/supabase-js').createClient }>;
};

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') return undefined;
  if (Array.isArray(value)) return value.map((item) => safeJsonValue(item, seen));
  if (typeof value === 'object') {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        const safeValue = safeJsonValue(item, seen);
        return safeValue === undefined ? [] : [[key, safeValue]];
      }),
    );
  }
  return String(value);
}

export function redactSceneAnchorAssetText(value: unknown, maxLength = 1000) {
  const text = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(safeJsonValue(value))
      : String(value ?? '');

  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
    .replace(/\b(?:fal|sk|rk|sbp|supabase)_[A-Za-z0-9._-]{12,}\b/gi, '[redacted-key]')
    .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
    .slice(0, maxLength);
}

function sceneAnchorAssetPersistError(input: {
  type: string;
  message: string;
  missingConfig?: string[];
  cause?: unknown;
}) {
  const missingConfig = input.missingConfig?.filter(Boolean) ?? [];
  const message = redactSceneAnchorAssetText(input.message);
  return Object.assign(new Error(message), {
    failureCategory: 'scene_anchor_asset_persist',
    assetPersistErrorType: input.type,
    assetPersistErrorMessageRedacted: message,
    missingConfig,
    cause: input.cause,
    privateUrlsRedacted: true,
    secretsRedacted: true,
  });
}

function sceneAnchorAssetDownloadError(input: {
  type: string;
  message: string;
  status?: number;
  contentType?: string | null;
  cause?: unknown;
}) {
  const message = redactSceneAnchorAssetText(input.message);
  return Object.assign(new Error(message), {
    failureCategory: 'scene_anchor_asset_download_failed',
    assetPersistErrorType: input.type,
    assetPersistErrorMessageRedacted: message,
    status: input.status ?? null,
    contentType: input.contentType ?? null,
    cause: input.cause,
    privateUrlsRedacted: true,
    secretsRedacted: true,
  });
}

export function sceneAnchorAssetStorageMissingConfig(envSource: NodeJS.ProcessEnv = process.env) {
  return [
    textValue(envSource.SUPABASE_URL) ? null : 'SUPABASE_URL',
    textValue(envSource.SUPABASE_SERVICE_ROLE_KEY) ? null : 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((item): item is string => Boolean(item));
}

export async function buildSceneAnchorStorageRuntimeStatus(input: {
  envSource?: NodeJS.ProcessEnv;
  supabaseModuleLoader?: () => Promise<{ createClient: typeof import('@supabase/supabase-js').createClient }>;
} = {}) {
  const envSource = input.envSource ?? process.env;
  let supabaseModuleLoadable = false;
  let message: string | null = null;
  try {
    await loadSupabaseModule(input.supabaseModuleLoader);
    supabaseModuleLoadable = true;
  } catch (error) {
    message = redactSceneAnchorAssetText(error, 700);
  }
  const missingConfig = sceneAnchorAssetStorageMissingConfig(envSource);
  const configured = supabaseModuleLoadable && missingConfig.length === 0;
  return {
    ok: configured,
    endpointLoaded: true,
    storageAdapterModuleLoaded: true,
    supabaseModuleLoadable,
    supabaseUrlPresent: Boolean(textValue(envSource.SUPABASE_URL)),
    supabaseServiceRoleKeyPresent: Boolean(textValue(envSource.SUPABASE_SERVICE_ROLE_KEY)),
    bucketName: SCENE_ANCHOR_ASSET_BUCKET,
    configured,
    missingConfig,
    message,
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

async function loadSupabaseModule(
  loader: (() => Promise<{ createClient: typeof import('@supabase/supabase-js').createClient }>) | undefined,
) {
  try {
    return await (loader ?? (async () => import('@supabase/supabase-js')))();
  } catch (error) {
    throw sceneAnchorAssetPersistError({
      type: 'scene_anchor_supabase_module_load_failed',
      cause: error,
      message: `Scene anchor was generated, but Lumora could not persist it for Kling. Supabase storage module could not be loaded. ${redactSceneAnchorAssetText(error)}.`,
    });
  }
}

async function sceneAnchorStorageClient(input: {
  envSource?: NodeJS.ProcessEnv;
  storageClient?: SceneAnchorStorageClient | null;
  supabaseModuleLoader?: () => Promise<{ createClient: typeof import('@supabase/supabase-js').createClient }>;
}) {
  if (input.storageClient) return input.storageClient;
  const envSource = input.envSource ?? process.env;
  const missingConfig = sceneAnchorAssetStorageMissingConfig(envSource);
  if (missingConfig.length) {
    throw sceneAnchorAssetPersistError({
      type: 'scene_anchor_storage_config_missing',
      missingConfig,
      message: `Scene anchor was generated, but Lumora could not persist it for Kling. Missing config: ${missingConfig.join(', ')}.`,
    });
  }

  const { createClient } = await loadSupabaseModule(input.supabaseModuleLoader);
  try {
    return createClient(
      textValue(envSource.SUPABASE_URL),
      textValue(envSource.SUPABASE_SERVICE_ROLE_KEY),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  } catch (error) {
    throw sceneAnchorAssetPersistError({
      type: 'scene_anchor_storage_client_create_failed',
      cause: error,
      message: `Scene anchor was generated, but Lumora could not persist it for Kling. Supabase storage client could not be created. ${redactSceneAnchorAssetText(error)}.`,
    });
  }
}

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function safePathSegment(value: string, fallback: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized || fallback;
}

function safeFolder(value: string | null | undefined) {
  return textValue(value)
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

function sceneAnchorObjectPath(input: {
  userId: string;
  folder?: string;
  fileName: string;
}) {
  const userId = safePathSegment(input.userId, 'local');
  const folder = safeFolder(input.folder);
  const safeFileName = safePathSegment(input.fileName, 'scene-anchor.jpg');
  const suffix = Math.random().toString(36).slice(2, 10);
  return [
    userId,
    folder,
    `${Date.now()}-${suffix}-${safeFileName}`,
  ].filter(Boolean).join('/');
}

function extensionForContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('avif')) return 'avif';
  if (normalized.includes('svg')) return 'svg';
  return 'jpg';
}

export async function uploadSceneAnchorAsset(input: SceneAnchorAssetUploadInput) {
  const bucket = textValue(input.bucket) || SCENE_ANCHOR_ASSET_BUCKET;
  const storageClient = await sceneAnchorStorageClient({
    envSource: input.envSource,
    storageClient: input.storageClient,
    supabaseModuleLoader: input.supabaseModuleLoader,
  });
  const objectPath = sceneAnchorObjectPath(input);

  try {
    const bucketClient = storageClient.storage.from(bucket);
    const { error } = await bucketClient.upload(objectPath, input.buffer, {
      contentType: input.contentType,
      upsert: false,
    });
    if (error) {
      throw error;
    }

    const { data: signedData, error: signedUrlError } =
      await bucketClient.createSignedUrl(objectPath, 60 * 60 * 24 * 7);
    if (signedData?.signedUrl && isValidHttpUrl(signedData.signedUrl)) {
      return {
        objectPath,
        publicUrl: signedData.signedUrl,
        bucket,
        privateUrlsRedacted: true,
      };
    }

    const { data } = bucketClient.getPublicUrl(objectPath);
    if (data?.publicUrl && isValidHttpUrl(data.publicUrl)) {
      return {
        objectPath,
        publicUrl: data.publicUrl,
        bucket,
        privateUrlsRedacted: true,
      };
    }

    throw signedUrlError ?? new Error('Scene-anchor upload did not return a provider-accessible HTTPS URL.');
  } catch (error) {
    const type = textValue((error as { name?: unknown }).name) || 'scene_anchor_storage_upload_failed';
    throw sceneAnchorAssetPersistError({
      type,
      cause: error,
      message: `Scene anchor was generated, but Lumora could not persist it for Kling. ${redactSceneAnchorAssetText(error)}.`,
    });
  }
}

export async function persistSceneAnchorProviderImage(input: SceneAnchorProviderImageInput) {
  if (!input.storageClient) {
    const missingConfig = sceneAnchorAssetStorageMissingConfig(input.envSource ?? process.env);
    if (missingConfig.length) {
      throw sceneAnchorAssetPersistError({
        type: 'scene_anchor_storage_config_missing',
        missingConfig,
        message: `The scene anchor was generated, but the Create runtime is missing Supabase storage configuration. Missing config: ${missingConfig.join(', ')}.`,
      });
    }
  }
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(input.imageUrl, { method: 'GET' }).catch((error) => {
    throw sceneAnchorAssetDownloadError({
      type: 'scene_anchor_provider_image_fetch_failed',
      cause: error,
      message: `Scene-anchor provider image could not be downloaded from ${input.imageUrl}. ${redactSceneAnchorAssetText(error)}.`,
    });
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
    throw sceneAnchorAssetDownloadError({
      type: 'scene_anchor_provider_image_invalid',
      status: response.status,
      contentType,
      message: `Scene-anchor provider image could not be downloaded or verified as an image from ${input.imageUrl}.`,
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > SCENE_ANCHOR_ASSET_MAX_BYTES) {
    throw sceneAnchorAssetDownloadError({
      type: 'scene_anchor_provider_image_size_invalid',
      contentType,
      message: `Scene-anchor provider image failed size validation from ${input.imageUrl}.`,
    });
  }

  const persisted = await uploadSceneAnchorAsset({
    userId: input.userId,
    fileName: `kling-scene-anchor.${extensionForContentType(contentType)}`,
    contentType,
    buffer,
    folder: 'kling-scene-anchors',
    envSource: input.envSource,
    storageClient: input.storageClient,
    supabaseModuleLoader: input.supabaseModuleLoader,
  });
  return {
    url: persisted.publicUrl,
    objectPath: persisted.objectPath,
    bucket: persisted.bucket,
    contentType,
    sizeBytes: buffer.length,
    privateUrlsRedacted: true,
  };
}
