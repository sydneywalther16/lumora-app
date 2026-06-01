export type CreateRuntimeSceneAnchorStatus = {
  ok: true;
  runtime: string;
  sceneAnchorEnabled: boolean;
  sceneAnchorProvider: string;
  sceneAnchorModel: string | null;
  sceneAnchorFallbackMode: string;
  sceneAnchorConfigured: boolean;
  sceneAnchorImplemented: boolean;
  sceneAnchorReason: string;
  missingConfig: string[];
  falKeyPresent: boolean;
  klingApiKeyPresent: boolean;
  sceneAnchorFalCredentialPresent: boolean;
  klingEnabled: boolean;
  klingProvider: string | null;
  klingReferenceModel: string | null;
  klingSceneAnchorVideoModel: string | null;
  klingSceneAnchorVideoModelConfigured: boolean;
  klingSceneAnchorVideoModelImplemented: boolean;
  klingSceneAnchorVideoModelReason: string;
  enableRenderProbe: boolean;
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

export type CreateRuntimeSceneAnchorFailureStatus = {
  ok: false;
  error: 'runtime_status_failed';
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

function configuredSceneAnchorFalKey(envSource: NodeJS.ProcessEnv = process.env) {
  return textValue(envSource.FAL_KEY) || textValue(envSource.KLING_API_KEY) || null;
}

function sceneAnchorMissingConfig(envSource: NodeJS.ProcessEnv = process.env) {
  const missing: string[] = [];
  const enabled = booleanValue(envSource.SCENE_ANCHOR_ENABLED);
  const provider = (textValue(envSource.SCENE_ANCHOR_PROVIDER) || 'fal').toLowerCase();
  const model = textValue(envSource.SCENE_ANCHOR_MODEL);
  if (!enabled) missing.push('SCENE_ANCHOR_ENABLED');
  if (enabled && provider !== 'none') {
    if (!model) missing.push('SCENE_ANCHOR_MODEL');
    if (provider === 'fal' && !textValue(envSource.FAL_KEY) && !textValue(envSource.KLING_API_KEY)) {
      missing.push('FAL_KEY or KLING_API_KEY');
    }
    if (provider === 'openai' && !textValue(envSource.OPENAI_API_KEY)) {
      missing.push('OPENAI_API_KEY');
    }
  }
  return Array.from(new Set(missing));
}

function sceneAnchorProviderStatus(envSource: NodeJS.ProcessEnv = process.env) {
  const enabled = booleanValue(envSource.SCENE_ANCHOR_ENABLED);
  const provider = (textValue(envSource.SCENE_ANCHOR_PROVIDER) || 'fal').toLowerCase();
  const model = textValue(envSource.SCENE_ANCHOR_MODEL);
  const fallbackMode = sceneAnchorFallbackMode(envSource);
  if (!enabled || provider === 'none') {
    return {
      sceneAnchorEnabled: false,
      configured: false,
      provider: provider === 'none' ? 'none' : provider,
      model: model || null,
      implemented: provider === 'fal',
      fallbackMode,
      reason: 'scene_anchor_provider_disabled',
    };
  }
  if (provider === 'fal') {
    const hasKey = Boolean(configuredSceneAnchorFalKey(envSource));
    return {
      sceneAnchorEnabled: true,
      configured: Boolean(model && hasKey),
      provider,
      model: model || null,
      implemented: true,
      fallbackMode,
      reason: !model
        ? 'scene_anchor_provider_not_configured'
        : !hasKey
          ? 'scene_anchor_fal_key_missing'
          : 'scene_anchor_fal_provider_ready',
    };
  }
  if (provider === 'openai') {
    return {
      sceneAnchorEnabled: true,
      configured: Boolean((model || textValue(envSource.OPENAI_IMAGE_MODEL)) && textValue(envSource.OPENAI_API_KEY)),
      provider,
      model: model || textValue(envSource.OPENAI_IMAGE_MODEL) || null,
      implemented: false,
      fallbackMode,
      reason: 'scene_anchor_provider_configured_not_implemented',
    };
  }
  return {
    sceneAnchorEnabled: true,
    configured: Boolean(model),
    provider,
    model: model || null,
    implemented: false,
    fallbackMode,
    reason: 'scene_anchor_provider_configured_not_implemented',
  };
}

function klingSceneAnchorVideoModelStatus(envSource: NodeJS.ProcessEnv = process.env) {
  const model = textValue(envSource.KLING_SCENE_ANCHOR_VIDEO_MODEL);
  if (!model) {
    return {
      configured: false,
      implemented: false,
      model: null,
      reason: 'kling_scene_anchor_video_model_missing',
    };
  }
  if (!configuredSceneAnchorFalKey(envSource)) {
    return {
      configured: false,
      implemented: false,
      model,
      reason: 'kling_scene_anchor_video_fal_key_missing',
    };
  }
  const normalized = model.toLowerCase();
  const implemented =
    normalized === 'fal-ai/kling-video/v2.1/master/image-to-video' ||
    normalized === 'fal-ai/kling-video/v2.1/standard/image-to-video' ||
    normalized === 'fal-ai/kling-video/o1/image-to-video' ||
    normalized === 'fal-ai/kling-video/o1/standard/image-to-video';
  return {
    configured: implemented,
    implemented,
    model,
    reason: implemented
      ? 'kling_scene_anchor_video_model_ready'
      : 'kling_scene_anchor_video_model_schema_unmapped',
  };
}

export function buildCreateRuntimeSceneAnchorStatus(
  envSource: NodeJS.ProcessEnv = process.env,
): CreateRuntimeSceneAnchorStatus {
  const sceneAnchor = sceneAnchorProviderStatus(envSource);
  const stage2 = klingSceneAnchorVideoModelStatus(envSource);
  const missingConfig = sceneAnchorMissingConfig(envSource);
  const runtime = detectCreateRuntime(envSource);
  const sceneAnchorReady = sceneAnchor.sceneAnchorEnabled && sceneAnchor.configured && sceneAnchor.implemented;
  const stage2Ready = stage2.configured && stage2.implemented;
  const recommendedNextAction = !sceneAnchorReady
    ? `Set missing scene-anchor env vars on the Create runtime (${runtime === 'vercel' ? 'Vercel' : runtime}), then redeploy. Render diagnostics do not prove Create runtime config.`
    : !stage2Ready
      ? `Set KLING_SCENE_ANCHOR_VIDEO_MODEL on the Create runtime (${runtime === 'vercel' ? 'Vercel' : runtime}), then redeploy.`
      : 'Create runtime scene-anchor config is ready. If Create still pauses, inspect the per-render sceneAnchorFailureCategory and redacted provider message.';
  return {
    ok: true,
    runtime,
    sceneAnchorEnabled: sceneAnchor.sceneAnchorEnabled,
    sceneAnchorProvider: sceneAnchor.provider,
    sceneAnchorModel: sceneAnchor.model,
    sceneAnchorFallbackMode: sceneAnchor.fallbackMode,
    sceneAnchorConfigured: sceneAnchor.configured,
    sceneAnchorImplemented: sceneAnchor.implemented,
    sceneAnchorReason: sceneAnchor.reason,
    missingConfig,
    falKeyPresent: Boolean(textValue(envSource.FAL_KEY)),
    klingApiKeyPresent: Boolean(textValue(envSource.KLING_API_KEY)),
    sceneAnchorFalCredentialPresent: Boolean(configuredSceneAnchorFalKey(envSource)),
    klingEnabled: booleanValue(envSource.KLING_ENABLED),
    klingProvider: textValue(envSource.KLING_PROVIDER) || null,
    klingReferenceModel: textValue(envSource.KLING_REFERENCE_MODEL) || null,
    klingSceneAnchorVideoModel: stage2.model,
    klingSceneAnchorVideoModelConfigured: stage2.configured,
    klingSceneAnchorVideoModelImplemented: stage2.implemented,
    klingSceneAnchorVideoModelReason: stage2.reason,
    enableRenderProbe: booleanValue(envSource.ENABLE_RENDER_PROBE),
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

export function runtimeStatusFailurePayload(error: unknown): CreateRuntimeSceneAnchorFailureStatus {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Create runtime scene-anchor status failed.';
  return {
    ok: false,
    error: 'runtime_status_failed',
    message: message
      .replace(/https?:\/\/\S+/gi, '[redacted-url]')
      .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
      .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
      .slice(0, 700),
    secretsRedacted: true,
    privateUrlsRedacted: true,
  };
}

export function buildSceneAnchorRuntimeStatusResponse(
  builder: () => CreateRuntimeSceneAnchorStatus = () => buildCreateRuntimeSceneAnchorStatus(),
) {
  try {
    return builder();
  } catch (error) {
    return runtimeStatusFailurePayload(error);
  }
}
