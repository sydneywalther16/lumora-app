export const PRODUCTION_APP_ORIGIN = 'https://lumora-app-topaz.vercel.app';
export const SAFE_NATIVE_STATUS_PATH = '/api/lumora/scene-anchor-runtime-status';

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function resolveApiUrl(path: string, isNativePlatform: boolean): string {
  const normalizedPath = normalizePath(path);
  return isNativePlatform ? `${PRODUCTION_APP_ORIGIN}${normalizedPath}` : normalizedPath;
}

export function buildSafeHealthFallback(input: {
  ok?: boolean;
  sceneAnchorEnabled?: boolean;
  sceneAnchorProvider?: string;
  sceneAnchorModel?: string | null;
  sceneAnchorConfigured?: boolean;
  sceneAnchorFallbackMode?: string;
  generationProviders?: Array<{
    id: string;
    ready: boolean;
    status: 'ready' | 'not_configured' | 'placeholder';
  }>;
  missingRecommended?: string[];
}) {
  const generationProviders = Array.isArray(input.generationProviders) && input.generationProviders.length
    ? input.generationProviders
    : [{ id: 'demo-mode', ready: true, status: 'ready' as const }];

  return {
    service: 'lumora-production-status',
    checkedAt: new Date().toISOString(),
    ok: input.ok === true,
    mode: 'production-fallback',
    configured: {},
    missingRecommended: input.missingRecommended ?? [],
    generationProviders,
    sceneAnchorEnabled: input.sceneAnchorEnabled,
    sceneAnchorProvider: input.sceneAnchorProvider,
    sceneAnchorModel: input.sceneAnchorModel,
    sceneAnchorConfigured: input.sceneAnchorConfigured,
    sceneAnchorFallbackMode: input.sceneAnchorFallbackMode,
  };
}
