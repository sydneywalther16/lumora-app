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

type RuntimeStatusHelper = {
  buildCreateRuntimeSceneAnchorStatus: () => Record<string, unknown>;
};

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

function runtimeStatusFailed(error: unknown, helperLoaded: boolean) {
  return {
    ok: false,
    error: 'runtime_status_failed',
    message: redactRuntimeStatusMessage(error),
    endpointLoaded: true,
    helperLoaded,
    runtimeStatusBuilt: false,
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
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

export async function buildSceneAnchorRuntimeEndpointPayload(
  loadHelper: () => Promise<RuntimeStatusHelper> = async () => import('./runtimeSceneAnchorStatus'),
) {
  let helperLoaded = false;
  try {
    const helper = await loadHelper();
    helperLoaded = true;
    const status = helper.buildCreateRuntimeSceneAnchorStatus();
    return {
      ...status,
      endpointLoaded: true,
      helperLoaded: true,
      runtimeStatusBuilt: true,
      secretsRedacted: true,
      privateUrlsRedacted: true,
    };
  } catch (error) {
    return runtimeStatusFailed(error, helperLoaded);
  }
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
    return sendJson(res, 200, await buildSceneAnchorRuntimeEndpointPayload());
  } catch (error) {
    return sendJson(res, 200, runtimeStatusFailed(error, false));
  }
}
