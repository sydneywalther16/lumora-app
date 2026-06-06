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
  supabaseModuleLoadable: boolean;
  supabaseUrlPresent: boolean;
  supabaseServiceRoleKeyPresent: boolean;
  bucketName: string;
  configured: boolean;
  missingConfig?: string[];
  message?: string | null;
  recommendedNextAction?: string;
  secretsRedacted: boolean;
  privateUrlsRedacted: boolean;
};

const SCENE_ANCHOR_STORAGE_BUCKET = 'lumora-assets';
const SUPABASE_STORAGE_CONFIG_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

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

function storageRuntimeRecommendedNextAction(input: {
  missingConfig: string[];
  supabaseModuleLoadable: boolean;
}) {
  if (input.missingConfig.length) {
    return `Add ${SUPABASE_STORAGE_CONFIG_KEYS.join(' and ')} to Vercel, redeploy, then retry.`;
  }
  if (!input.supabaseModuleLoadable) {
    return 'Ensure @supabase/supabase-js is installed and bundled for the Vercel Create runtime, redeploy, then retry.';
  }
  return 'Scene-anchor storage is configured.';
}

function storageRuntimeStatus(input: {
  envSource?: NodeJS.ProcessEnv;
  supabaseModuleLoadable: boolean;
  message?: string | null;
}): StorageRuntimeStatus {
  const envSource = input.envSource ?? process.env;
  const missingConfig = missingStorageConfig(envSource);
  const configured = input.supabaseModuleLoadable && missingConfig.length === 0;
  return {
    ok: configured,
    endpointLoaded: true,
    supabaseModuleLoadable: input.supabaseModuleLoadable,
    supabaseUrlPresent: Boolean(textValue(envSource.SUPABASE_URL)),
    supabaseServiceRoleKeyPresent: Boolean(textValue(envSource.SUPABASE_SERVICE_ROLE_KEY)),
    bucketName: SCENE_ANCHOR_STORAGE_BUCKET,
    configured,
    missingConfig,
    message: input.message ?? null,
    recommendedNextAction: storageRuntimeRecommendedNextAction({
      missingConfig,
      supabaseModuleLoadable: input.supabaseModuleLoadable,
    }),
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

export async function buildSceneAnchorStorageRuntimeEndpointPayload(
  envSource: NodeJS.ProcessEnv = process.env,
  supabaseModuleLoader: () => Promise<unknown> = async () => import('@supabase/supabase-js'),
) {
  try {
    await supabaseModuleLoader();
    return storageRuntimeStatus({
      envSource,
      supabaseModuleLoadable: true,
    });
  } catch (error) {
    return storageRuntimeStatus({
      envSource,
      supabaseModuleLoadable: false,
      message: redactStorageRuntimeMessage(error),
    });
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
      supabaseModuleLoadable: false,
      supabaseUrlPresent: Boolean(textValue(process.env.SUPABASE_URL)),
      supabaseServiceRoleKeyPresent: Boolean(textValue(process.env.SUPABASE_SERVICE_ROLE_KEY)),
      bucketName: SCENE_ANCHOR_STORAGE_BUCKET,
      configured: false,
      error: 'method_not_allowed',
      recommendedNextAction: 'Use GET for the scene-anchor storage runtime status endpoint.',
      secretsRedacted: true,
      privateUrlsRedacted: true,
    });
  }

  return sendJson(res, 200, await buildSceneAnchorStorageRuntimeEndpointPayload());
}
