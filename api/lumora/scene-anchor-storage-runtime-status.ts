type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status?: (code: number) => VercelResponse;
  json?: (payload: unknown) => void;
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  end?: (body?: string) => void;
};

type StorageRuntimeStatus = {
  ok: boolean;
  endpointLoaded: boolean;
  storageAdapterModuleLoaded: boolean;
  supabaseModuleLoadable: boolean;
  supabaseUrlPresent: boolean;
  supabaseServiceRoleKeyPresent: boolean;
  bucketName: string;
  configured: boolean;
  missingConfig?: string[];
  message?: string | null;
  secretsRedacted: boolean;
  privateUrlsRedacted: boolean;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => safeJsonValue(entry, seen) ?? null);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const safeEntry = safeJsonValue(entry, seen);
      return typeof safeEntry === 'undefined' ? [] : [[key, safeEntry]];
    }),
  );
}

function redactStorageRuntimeMessage(value: unknown, maxLength = 700) {
  const text = value instanceof Error
    ? value.message
    : typeof value === 'string'
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

function missingStorageConfig(envSource: NodeJS.ProcessEnv = process.env) {
  return [
    textValue(envSource.SUPABASE_URL) ? null : 'SUPABASE_URL',
    textValue(envSource.SUPABASE_SERVICE_ROLE_KEY) ? null : 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((item): item is string => Boolean(item));
}

function failedStorageRuntimeStatus(error: unknown, envSource: NodeJS.ProcessEnv = process.env): StorageRuntimeStatus {
  const missingConfig = missingStorageConfig(envSource);
  return {
    ok: false,
    endpointLoaded: true,
    storageAdapterModuleLoaded: false,
    supabaseModuleLoadable: false,
    supabaseUrlPresent: Boolean(textValue(envSource.SUPABASE_URL)),
    supabaseServiceRoleKeyPresent: Boolean(textValue(envSource.SUPABASE_SERVICE_ROLE_KEY)),
    bucketName: 'lumora-assets',
    configured: false,
    missingConfig,
    message: redactStorageRuntimeMessage(error),
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

export async function buildSceneAnchorStorageRuntimeEndpointPayload(
  envSource: NodeJS.ProcessEnv = process.env,
  adapterLoader: () => Promise<{
    buildSceneAnchorStorageRuntimeStatus: (input?: {
      envSource?: NodeJS.ProcessEnv;
    }) => Promise<StorageRuntimeStatus>;
  }> = async () => import('./sceneAnchorAssetStorage'),
) {
  try {
    const adapter = await adapterLoader();
    return await adapter.buildSceneAnchorStorageRuntimeStatus({ envSource });
  } catch (error) {
    return failedStorageRuntimeStatus(error, envSource);
  }
}

function sendJson(res: VercelResponse, statusCode: number, payload: unknown) {
  const safePayload = safeJsonValue(payload) ?? null;
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const next = res.status(statusCode);
    if (typeof next.json === 'function') next.json(safePayload);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader?.('Content-Type', 'application/json');
  res.end?.(JSON.stringify(safePayload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, {
      ok: false,
      endpointLoaded: true,
      storageAdapterModuleLoaded: false,
      supabaseModuleLoadable: false,
      supabaseUrlPresent: Boolean(textValue(process.env.SUPABASE_URL)),
      supabaseServiceRoleKeyPresent: Boolean(textValue(process.env.SUPABASE_SERVICE_ROLE_KEY)),
      bucketName: 'lumora-assets',
      configured: false,
      error: 'method_not_allowed',
      secretsRedacted: true,
      privateUrlsRedacted: true,
    });
  }

  return sendJson(res, 200, await buildSceneAnchorStorageRuntimeEndpointPayload());
}
