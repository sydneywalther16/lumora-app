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

type RuntimeStatus = {
  ok: true;
  runtime: string;
  endpointLoaded: true;
  helperLoaded: true;
  runtimeStatusBuilt: true;
  sceneAnchorEnabled: boolean;
  sceneAnchorProvider: string;
  sceneAnchorModel: string | null;
  sceneAnchorFallbackMode: string;
  sceneAnchorConfigured: boolean;
  sceneAnchorImplemented: boolean;
  missingConfig: string[];
  falKeyPresent: boolean;
  klingApiKeyPresent: boolean;
  sceneAnchorFalCredentialPresent: boolean;
  klingEnabled: boolean;
  klingProvider: string | null;
  klingReferenceModel: string | null;
  klingSceneAnchorVideoModel: string | null;
  klingSceneAnchorVideoModelConfigured: boolean;
  enableRenderProbe: boolean;
  generationProviders: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured';
  }>;
  missingRecommended: string[];
  nodeEnv: string | null;
  build: {
    vercelEnv: string | null;
    vercelGitCommitSha: string | null;
    vercelGitCommitRef: string | null;
    vercelUrlPresent: boolean;
  };
  recommendedNextAction: string;
  secretsRedacted: true;
  privateUrlsRedacted: true;
};

type RuntimeFailureStatus = {
  ok: false;
  error: 'runtime_status_failed';
  endpointLoaded: true;
  helperLoaded: false;
  runtimeStatusBuilt: false;
  message: string;
  secretsRedacted: true;
  privateUrlsRedacted: true;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = textValue(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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

function redactRuntimeStatusMessage(value: unknown) {
  const message = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : 'Create runtime scene-anchor status failed.';
  return message
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
    .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
    .slice(0, 700);
}

function runtimeStatusFailed(error: unknown): RuntimeFailureStatus {
  return {
    ok: false,
    error: 'runtime_status_failed',
    endpointLoaded: true,
    helperLoaded: false,
    runtimeStatusBuilt: false,
    message: redactRuntimeStatusMessage(error),
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

function sceneAnchorFallbackMode(envSource: NodeJS.ProcessEnv = process.env) {
  const mode = textValue(envSource.SCENE_ANCHOR_FALLBACK_MODE || 'pause').toLowerCase();
  return mode === 'identity_only' ? 'identity_only' : 'pause';
}

function detectCreateRuntime(envSource: NodeJS.ProcessEnv = process.env) {
  if (booleanValue(envSource.VERCEL) || textValue(envSource.VERCEL_ENV) || textValue(envSource.VERCEL_URL)) return 'vercel';
  if (textValue(envSource.RENDER) || textValue(envSource.RENDER_SERVICE_ID) || textValue(envSource.RENDER_EXTERNAL_URL)) return 'render';
  if (textValue(envSource.AWS_LAMBDA_FUNCTION_NAME)) return 'serverless';
  return 'local';
}

function sceneAnchorCredentialPresent(envSource: NodeJS.ProcessEnv = process.env) {
  return Boolean(textValue(envSource.FAL_KEY) || textValue(envSource.KLING_API_KEY));
}

function sceneAnchorMissingConfig(envSource: NodeJS.ProcessEnv = process.env) {
  const missing: string[] = [];
  const enabled = booleanValue(envSource.SCENE_ANCHOR_ENABLED);
  const provider = (textValue(envSource.SCENE_ANCHOR_PROVIDER) || 'fal').toLowerCase();
  if (!enabled) missing.push('SCENE_ANCHOR_ENABLED');
  if (enabled && provider !== 'none') {
    if (!textValue(envSource.SCENE_ANCHOR_MODEL)) missing.push('SCENE_ANCHOR_MODEL');
    if (provider === 'fal' && !sceneAnchorCredentialPresent(envSource)) missing.push('FAL_KEY or KLING_API_KEY');
    if (provider === 'openai' && !textValue(envSource.OPENAI_API_KEY)) missing.push('OPENAI_API_KEY');
  }
  return Array.from(new Set(missing));
}

function implementedKlingSceneAnchorVideoModel(model: string) {
  const normalized = model.toLowerCase();
  return normalized === 'fal-ai/kling-video/v2.1/master/image-to-video' ||
    normalized === 'fal-ai/kling-video/v2.1/standard/image-to-video' ||
    normalized === 'fal-ai/kling-video/o1/image-to-video' ||
    normalized === 'fal-ai/kling-video/o1/standard/image-to-video';
}

export function buildCreateRuntimeSceneAnchorStatus(
  envSource: NodeJS.ProcessEnv = process.env,
): RuntimeStatus {
  const runtime = detectCreateRuntime(envSource);
  const sceneAnchorEnabled = booleanValue(envSource.SCENE_ANCHOR_ENABLED);
  const sceneAnchorProvider = (textValue(envSource.SCENE_ANCHOR_PROVIDER) || 'fal').toLowerCase();
  const sceneAnchorModel = textValue(envSource.SCENE_ANCHOR_MODEL) || null;
  const sceneAnchorFallback = sceneAnchorFallbackMode(envSource);
  const missingConfig = sceneAnchorMissingConfig(envSource);
  const falKeyPresent = Boolean(textValue(envSource.FAL_KEY));
  const klingApiKeyPresent = Boolean(textValue(envSource.KLING_API_KEY));
  const sceneAnchorFalCredentialPresent = sceneAnchorCredentialPresent(envSource);
  const sceneAnchorImplemented = sceneAnchorProvider === 'fal';
  const sceneAnchorConfigured = sceneAnchorEnabled &&
    sceneAnchorImplemented &&
    Boolean(sceneAnchorModel) &&
    sceneAnchorFalCredentialPresent;
  const klingSceneAnchorVideoModel = textValue(envSource.KLING_SCENE_ANCHOR_VIDEO_MODEL) || null;
  const klingSceneAnchorVideoModelConfigured = Boolean(
    klingSceneAnchorVideoModel &&
    sceneAnchorFalCredentialPresent &&
    implementedKlingSceneAnchorVideoModel(klingSceneAnchorVideoModel),
  );
  const replicateConfigured = Boolean(textValue(envSource.REPLICATE_API_TOKEN));
  const klingReferenceConfigured = Boolean(
    booleanValue(envSource.KLING_ENABLED) &&
    textValue(envSource.KLING_REFERENCE_MODEL) &&
    sceneAnchorFalCredentialPresent,
  );
  const generationProviders: RuntimeStatus['generationProviders'] = [
    {
      id: 'seedance-2.0',
      ready: replicateConfigured,
      status: replicateConfigured ? 'ready' : 'not_configured',
    },
    {
      id: 'seedance-quality',
      ready: replicateConfigured,
      status: replicateConfigured ? 'ready' : 'not_configured',
    },
    {
      id: 'kling-reference-beta',
      ready: klingReferenceConfigured,
      status: klingReferenceConfigured ? 'ready' : 'not_configured',
    },
    { id: 'demo-mode', ready: true, status: 'ready' },
  ];
  const missingRecommended = replicateConfigured ? [] : ['REPLICATE_API_TOKEN'];
  const recommendedNextAction = !sceneAnchorConfigured
    ? `Set missing scene-anchor env vars on the Create runtime (${runtime === 'vercel' ? 'Vercel' : runtime}), then redeploy. Render diagnostics do not prove Create runtime config.`
    : !klingSceneAnchorVideoModelConfigured
      ? `Set KLING_SCENE_ANCHOR_VIDEO_MODEL on the Create runtime (${runtime === 'vercel' ? 'Vercel' : runtime}), then redeploy.`
      : 'Create runtime scene-anchor config is ready. If Create still pauses, inspect the per-render sceneAnchorFailureCategory and redacted provider message.';

  return {
    ok: true,
    runtime,
    endpointLoaded: true,
    helperLoaded: true,
    runtimeStatusBuilt: true,
    sceneAnchorEnabled,
    sceneAnchorProvider,
    sceneAnchorModel,
    sceneAnchorFallbackMode: sceneAnchorFallback,
    sceneAnchorConfigured,
    sceneAnchorImplemented,
    missingConfig,
    falKeyPresent,
    klingApiKeyPresent,
    sceneAnchorFalCredentialPresent,
    klingEnabled: booleanValue(envSource.KLING_ENABLED),
    klingProvider: textValue(envSource.KLING_PROVIDER) || null,
    klingReferenceModel: textValue(envSource.KLING_REFERENCE_MODEL) || null,
    klingSceneAnchorVideoModel,
    klingSceneAnchorVideoModelConfigured,
    enableRenderProbe: booleanValue(envSource.ENABLE_RENDER_PROBE),
    generationProviders,
    missingRecommended,
    nodeEnv: textValue(envSource.NODE_ENV) || null,
    build: {
      vercelEnv: textValue(envSource.VERCEL_ENV) || null,
      vercelGitCommitSha: textValue(envSource.VERCEL_GIT_COMMIT_SHA) || null,
      vercelGitCommitRef: textValue(envSource.VERCEL_GIT_COMMIT_REF) || null,
      vercelUrlPresent: Boolean(textValue(envSource.VERCEL_URL)),
    },
    recommendedNextAction,
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

export function buildSceneAnchorRuntimeEndpointPayload(
  statusBuilder: () => RuntimeStatus = () => buildCreateRuntimeSceneAnchorStatus(),
) {
  try {
    return statusBuilder();
  } catch (error) {
    return runtimeStatusFailed(error);
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
  try {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      return sendJson(res, 405, {
        ok: false,
        error: 'method_not_allowed',
        endpointLoaded: true,
        helperLoaded: false,
        runtimeStatusBuilt: false,
        secretsRedacted: true,
        privateUrlsRedacted: true,
      });
    }
    return sendJson(res, 200, buildSceneAnchorRuntimeEndpointPayload());
  } catch (error) {
    return sendJson(res, 200, runtimeStatusFailed(error));
  }
}
