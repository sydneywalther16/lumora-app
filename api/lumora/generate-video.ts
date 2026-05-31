import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
};

type ReplicateModelIdentifier = `${string}/${string}` | `${string}/${string}:${string}`;

type GenerateVideoBody = {
  prompt?: unknown;
  userId?: unknown;
  identityId?: unknown;
  identityPrompt?: unknown;
  consistencyPrompt?: unknown;
  generationConsistencyPrompt?: unknown;
  characterDescription?: unknown;
  keyframeUrl?: unknown;
  referenceImageUrl?: unknown;
  referenceImages?: unknown;
  additionalReferenceImageUrls?: unknown;
  canonicalReferenceSet?: unknown;
  referenceImageUrls?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  style?: unknown;
  camera?: unknown;
  mood?: unknown;
  audio?: unknown;
  provider?: unknown;
  engine?: unknown;
  generationMode?: unknown;
  exactLikenessRoute?: unknown;
  exactLikenessReady?: unknown;
  exactLikenessCanaryStatus?: unknown;
  allowIdentityOnlyKlingFallback?: unknown;
  viralPresetUsed?: unknown;
  promptPolished?: unknown;
};

type ReplicateClient = {
  run: (model: ReplicateModelIdentifier, options: { input: Record<string, unknown> }) => Promise<unknown>;
};

type ReplicateRunResult = {
  videoUrl: string;
  model: ReplicateModelIdentifier;
  rawOutput: unknown;
  attempts: unknown[];
  durationSent: number | null;
  finalInputKeys?: string[];
};

type GenerationModeUsed =
  | 'seedance-multimodal-reference'
  | 'identity-image-to-video'
  | 'reference-image-to-video'
  | 'kling-exact-likeness-reference';

type KlingCreateReferenceRole =
  | 'front_angle'
  | 'side_angle_left'
  | 'side_angle_right'
  | 'full_body'
  | 'additional_reference'
  | 'identity_sheet'
  | 'scene_anchor';

type KlingCreateReferenceEntry = {
  role: KlingCreateReferenceRole;
  label: string;
  url: string;
  token: string;
};

type KlingCreateReferenceStrategy =
  | 'direct_identity_references'
  | 'scene_anchor_still'
  | 'composite_identity_sheet'
  | 'front_only_fallback';

type KlingSceneAnchorStrategy =
  | 'direct_identity_references'
  | 'scene_anchor_still'
  | 'composite_identity_sheet'
  | 'front_only_fallback';

type KlingPrimaryVideoInputType =
  | 'scene_anchor'
  | 'identity_reference'
  | 'identity_sheet'
  | 'unknown';

type KlingPrimaryVideoInputSource =
  | 'scene_anchor'
  | 'front_identity_reference'
  | 'side_identity_reference'
  | 'full_body_identity_reference'
  | 'additional_identity_reference'
  | 'identity_sheet'
  | 'unknown';

type KlingIdentityReferenceMode =
  | 'stage1_only'
  | 'video_stage_secondary'
  | 'identity_prompt_only';

type KlingFrameSource =
  | 'scene_anchor'
  | 'video_frame'
  | 'provider_poster'
  | 'provider_video'
  | 'identity_reference'
  | 'identity_sheet'
  | 'unknown';

type KlingStage2ProviderRouteType =
  | 'image_to_video'
  | 'reference_to_video'
  | 'unknown';

type KlingSceneIntent =
  | 'portrait_closeup'
  | 'seated'
  | 'standing'
  | 'walking'
  | 'full_body'
  | 'medium_full'
  | 'open_space_environment'
  | 'motion_light'
  | 'motion_medium';

type KlingFramingIntent =
  | 'portrait_closeup'
  | 'seated_medium'
  | 'standing_medium_full'
  | 'walking_full_body'
  | 'open_space_medium_full'
  | 'full_body_scene'
  | 'medium_full_scene';

type KlingSceneIntentAnalysis = {
  sceneIntent: KlingSceneIntent[];
  framingIntent: KlingFramingIntent;
  prefersFullBodyPrimary: boolean;
  compositionNeutralized: boolean;
};

type KlingSceneAnchorValidation = {
  faceVisible: boolean;
  fullBodyVisible: boolean;
  environmentMatch: boolean;
  outfitMatch: boolean;
  noFurnitureCarryover: boolean;
  noPortraitCrop: boolean;
  passed: boolean;
  score: number;
  attempts: number;
  regenerated: boolean;
  heuristicOnly: boolean;
  failureReasons: string[];
};

type SceneAnchorFailureCategory =
  | 'scene_anchor_provider_disabled'
  | 'scene_anchor_provider_not_configured'
  | 'scene_anchor_provider_not_implemented'
  | 'scene_anchor_fal_key_missing'
  | 'scene_anchor_input_schema'
  | 'scene_anchor_model_schema_unmapped'
  | 'scene_anchor_fal_submit_failed'
  | 'scene_anchor_fal_poll_failed'
  | 'scene_anchor_output_missing'
  | 'scene_anchor_output_parse_failed'
  | 'scene_anchor_asset_download_failed'
  | 'scene_anchor_asset_persist_failed'
  | 'scene_anchor_provider_moderation_block'
  | 'scene_anchor_generation_failed'
  | 'scene_anchor_validation_failed';

type SceneAnchorProviderStatus = {
  sceneAnchorEnabled: boolean;
  configured: boolean;
  provider: 'fal' | 'openai' | 'none' | string | null;
  model: string | null;
  implemented: boolean;
  fallbackMode: 'pause' | 'identity_only' | string;
  reason: string;
  failureCategory: SceneAnchorFailureCategory | null;
};

type KlingSceneAnchorVideoStatus = {
  configured: boolean;
  implemented: boolean;
  model: string | null;
  routeType: KlingStage2ProviderRouteType;
  reason: string;
  failureCategory: string | null;
};

type KlingCreateReferencePlan = {
  primaryReference: KlingCreateReferenceEntry;
  references: KlingCreateReferenceEntry[];
  additionalReferences: KlingCreateReferenceEntry[];
  providerPrimaryReference: KlingCreateReferenceEntry;
  providerAdditionalReferences: KlingCreateReferenceEntry[];
  validationReferences: KlingCreateReferenceEntry[];
  promptGuidance: string;
  identityPrompt: string;
  scenePrompt: string;
  motionPrompt: string;
  providerPrompt: string;
  sceneAnchorPrompt: string;
  plannedStrategy: KlingCreateReferenceStrategy;
  sceneAnchorStrategy: KlingSceneAnchorStrategy;
  sceneAnchorGenerated: boolean;
  sceneAnchorProvider: string | null;
  sceneAnchorReason: string | null;
  sceneAnchorFailureCategory: SceneAnchorFailureCategory | null;
  sceneAnchorRequired: boolean;
  sceneAnchorPersisted: boolean;
  sceneAnchorFailureReason: string | null;
  sceneAnchorValidation: KlingSceneAnchorValidation | null;
  sceneAnchorHttpStatus: number | null;
  sceneAnchorErrorType: string | null;
  sceneAnchorErrorMessage: string | null;
  sceneAnchorErrorBodyRedacted: string | null;
  sceneAnchorPayloadFieldNames: string[] | null;
  sceneAnchorReferenceCount: number | null;
  sceneAnchorSubmittedReferenceCount: number | null;
  sceneAnchorReferenceRolesUsed: string[] | null;
  sceneAnchorDroppedReferenceRoles: string[] | null;
  sceneAnchorProviderReferenceLimit: number | null;
  sceneAnchorOutputParsed: boolean | null;
  primaryInputType: 'scene_anchor_still' | 'identity_sheet' | 'identity_reference';
  primaryVideoInputType: KlingPrimaryVideoInputType;
  primaryVideoInputSource: KlingPrimaryVideoInputSource;
  identityReferencesPassedToVideoStage: boolean;
  identityReferenceCount: number;
  identityReferenceMode: KlingIdentityReferenceMode;
  startFrameSource: KlingFrameSource;
  posterFrameSource: KlingFrameSource;
  firstFrameSource: KlingFrameSource;
  stage2ProviderModel: string | null;
  stage2ProviderRouteType: KlingStage2ProviderRouteType;
  rawReferenceVisualInputsSentToStage2: boolean;
  fallbackAllowed: boolean;
  sceneIntent: KlingSceneIntent[];
  framingIntent: KlingFramingIntent;
  primaryReferenceRole: KlingCreateReferenceRole;
  supportingReferenceRoles: KlingCreateReferenceRole[];
  compositionNeutralized: boolean;
  userSpecifiedOutfit: boolean;
  outfitTermsDetected: string[];
  referenceOutfitCarryoverSuppressed: boolean;
  compositionCarryoverSuppressed: boolean;
  riskyReferenceArtifacts: string[];
  environmentTermsDetected: string[];
  frontOnlyFallback: boolean;
};

const SEEDANCE_MODEL = 'bytedance/seedance-2.0' as ReplicateModelIdentifier;
const KLING_IMAGE_TO_VIDEO_MODEL = 'kwaivgi/kling-v2.1' as ReplicateModelIdentifier;
const KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL = 'kwaivgi/kling-v2.5-turbo-pro' as ReplicateModelIdentifier;
const SEEDANCE_IDENTITY_PROMPT =
  'Use the provided reference images only as identity references. Do not animate or copy any single source image. Generate a new photorealistic person matching the same identity in the requested scene.';
const SAFE_IDENTITY_PROMPT_PREFIX =
  'Create a safe, fully clothed, photorealistic cinematic video of the identity reference person. Preserve likeness. No nudity, no sexual content, no minors, no suggestive posing.';
export const KLING_EXACT_LIKENESS_PROMPT_PREFIX =
  'Create a fully clothed cinematic video of the saved self-character reference person. Preserve likeness with calm everyday body language, natural movement, and gentle framing.';
const KLING_EXACT_LIKENESS_CONSISTENCY_PROMPT =
  'Use the saved self-character references as the identity guide for face shape, hairstyle, hair color, skin tone, eye area, proportions, and overall likeness. Generate a new scene rather than copying the source image.';
const KLING_EXACT_LIKENESS_IDENTITY_GUIDANCE =
  'Use the referenced self character\'s facial identity, hair color, face shape, eye color, and body proportions. Preserve identity across motion. Adapt clothing to the scene prompt when the user specifies clothing.';
const SAFE_PROMPT_REPLACEMENT = 'stylish, cinematic, confident, editorial, fashion-inspired';
const SENSITIVE_FILTER_ERROR = 'Generation blocked by provider safety filter';
const SENSITIVE_FILTER_SUGGESTION =
  'Try a safer prompt: fully clothed, cinematic, editorial, non-suggestive.';
const PROVIDER_QUEUE_BUSY_MESSAGE = 'Provider queue is busy. Retrying generation...';
const SINGLE_PROVIDER_MODE = true;
const REPLICATE_THROTTLED_ERROR = 'Replicate is temporarily throttling this account';
const REPLICATE_THROTTLED_SUGGESTION =
  'Wait a minute and try again. No fallback providers were attempted.';
const KLING_FALLBACK_DELAY_MS = 5_000;
const KLING_SECONDARY_FALLBACK_DELAY_MS = 8_000;
const DEFAULT_REPLICATE_RETRY_AFTER_MS = 6_000;
const sensitivePromptTerms = [
  'sexy',
  'nude',
  'nudity',
  'lingerie',
  'minors',
  'minor',
  'nsfw',
  'onlyfans',
  'sex',
  'sexual',
  'seducing',
  'seductive',
  'suggestive',
  'provocative',
  'adult',
] as const;

type LumoraGenerationGlobals = typeof globalThis & {
  __lumoraActiveGenerationUsers?: Set<string>;
  __lumoraReplicatePredictionQueue?: Promise<unknown>;
};

const lumoraGenerationGlobals = globalThis as LumoraGenerationGlobals;
const activeGenerationUsers =
  lumoraGenerationGlobals.__lumoraActiveGenerationUsers ??= new Set<string>();

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') return undefined;

  if (value instanceof URL) return value.toString();

  if (value instanceof Error) {
    const errorRecord: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };

    for (const key of Object.getOwnPropertyNames(value)) {
      if (!(key in errorRecord)) {
        errorRecord[key] = safeJsonValue((value as unknown as Record<string, unknown>)[key], seen);
      }
    }

    return errorRecord;
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      type: value.type,
      size: value.size,
    };
  }

  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item, seen) ?? null);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const safeEntry = safeJsonValue(entry, seen);
      return typeof safeEntry === 'undefined' ? [] : [[key, safeEntry]];
    }),
  );
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const vercelRes = res as Partial<VercelResponse>;
  const safePayload = safeJsonValue(payload) ?? null;

  if (typeof vercelRes.status === 'function' && typeof vercelRes.json === 'function') {
    vercelRes.status(statusCode).json(safePayload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  try {
    res.end(JSON.stringify(safePayload));
  } catch {
    res.end(JSON.stringify({ error: 'Unable to serialize JSON response.' }));
  }
}

async function readBody(req: VercelRequest): Promise<GenerateVideoBody> {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8')) as GenerateVideoBody;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body as GenerateVideoBody;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as GenerateVideoBody;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GenerateVideoBody;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function errorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'ready'].includes(value.trim().toLowerCase());
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizePromptText(value: string): string {
  let sanitized = value;

  for (const term of sensitivePromptTerms) {
    sanitized = sanitized.replace(
      new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'),
      SAFE_PROMPT_REPLACEMENT,
    );
  }

  return sanitized
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function activeGenerationUserKey(body: GenerateVideoBody): string {
  return (
    textValue(body.userId) ||
    textValue(body.identityId) ||
    'local'
  ).toLowerCase();
}

function acquireActiveGeneration(userKey: string): boolean {
  if (activeGenerationUsers.has(userKey)) return false;
  activeGenerationUsers.add(userKey);
  return true;
}

function releaseActiveGeneration(userKey: string) {
  activeGenerationUsers.delete(userKey);
}

function publicImageUrl(value: unknown): string {
  const url = textValue(value);
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('file:')) return '';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('localhost') || lowerUrl.includes('undefined')) return '';
  const cleanUrl = url.split('?')[0];
  if (url.includes('expires=') || url.includes('token=')) {
    console.log('REFERENCE URL HAD TEMP QUERY, USING CLEAN URL:', cleanUrl);
  }
  return cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') ? cleanUrl : '';
}

function safeUrlLabel(index: number) {
  return `[reference-url-${index + 1}-redacted]`;
}

function referenceUrlMap(value: unknown): Record<string, string> {
  const record = objectRecord(value);
  const nested = objectRecord(record.referenceImageUrls);
  const source = Object.keys(nested).length > 0 ? nested : record;
  const aliases: Record<string, string[]> = {
    manualReferenceImageUrl: ['manualReferenceImageUrl', 'manualReferenceUrl', 'manual'],
    frontFace: ['frontFaceUrl', 'frontFacePath', 'frontFace', 'frontImageUrl', 'frontImagePath', 'frontImage', 'front', 'face', 'primary'],
    fullBody: ['fullBodyUrl', 'fullBodyPath', 'fullBody', 'body', 'full'],
    leftAngle: ['leftAngleUrl', 'leftAnglePath', 'leftAngle', 'left'],
    rightAngle: ['rightAngleUrl', 'rightAnglePath', 'rightAngle', 'right'],
    expressive: ['expressiveUrl', 'expressivePath', 'expressive', 'expression'],
  };

  return Object.fromEntries(
    Object.entries(aliases).flatMap(([slot, keys]) => {
      const url = keys.map((key) => publicImageUrl(source[key])).find(Boolean);
      return url ? [[slot, url]] : [];
    }),
  );
}

function uniqueReferenceEntries(entries: KlingCreateReferenceEntry[]): KlingCreateReferenceEntry[] {
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    if (!entry.url || seen.has(entry.url)) return [];
    seen.add(entry.url);
    return [entry];
  }).map((entry, index) => ({
    ...entry,
    token: `@Element${index + 1}`,
  }));
}

function hasAnyPromptTerm(prompt: string, terms: string[]) {
  return terms.some((term) => prompt.includes(term));
}

function hasPromptPattern(prompt: string, pattern: RegExp) {
  return pattern.test(prompt);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dataUrlFromSvg(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function isDataImageUrl(value: string) {
  return /^data:image\/(?:svg\+xml|png|jpe?g|webp);base64,/i.test(value);
}

function isValidProviderImageInput(value: string) {
  return isValidHttpUrl(value) || isDataImageUrl(value);
}

function parseBase64DataUrl(value: string): { contentType: string; buffer: Buffer } | null {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1] ?? 'application/octet-stream',
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function sceneAnchorFallbackMode(envSource: NodeJS.ProcessEnv = process.env) {
  const mode = textValue(envSource.SCENE_ANCHOR_FALLBACK_MODE || 'pause').toLowerCase();
  return mode === 'identity_only' ? 'identity_only' : 'pause';
}

function configuredSceneAnchorFalKey(envSource: NodeJS.ProcessEnv = process.env) {
  const key = textValue(envSource.FAL_KEY) || textValue(envSource.KLING_API_KEY);
  return key || null;
}

function falSceneAnchorAuthorizationHeader(key: string) {
  if (/^(Key|Bearer)\s+/i.test(key.trim())) return key.trim();
  return `Key ${key.trim()}`;
}

function redactSceneAnchorProviderText(value: unknown, maxLength = 1000) {
  const text = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? JSON.stringify(safeJsonValue(value))
      : String(value ?? '');
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:Key|Bearer)\s+[A-Za-z0-9._:-]{12,}/gi, '[redacted-auth]')
    .replace(/[A-Za-z0-9_-]{16,}:[A-Za-z0-9._:-]{16,}/g, '[redacted-key]')
    .slice(0, maxLength);
}

export function sceneAnchorProviderStatus(envSource: NodeJS.ProcessEnv = process.env): SceneAnchorProviderStatus {
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
      failureCategory: 'scene_anchor_provider_disabled',
    };
  }
  if (provider === 'openai') {
    return {
      sceneAnchorEnabled: true,
      configured: Boolean(model && envSource.OPENAI_API_KEY),
      provider,
      model: model || textValue(envSource.OPENAI_IMAGE_MODEL) || null,
      implemented: false,
      fallbackMode,
      reason: 'scene_anchor_provider_configured_not_implemented',
      failureCategory: 'scene_anchor_provider_not_implemented',
    };
  }
  if (provider !== 'fal') {
    return {
      sceneAnchorEnabled: true,
      configured: Boolean(model),
      provider,
      model: model || null,
      implemented: false,
      fallbackMode,
      reason: 'scene_anchor_provider_configured_not_implemented',
      failureCategory: 'scene_anchor_provider_not_implemented',
    };
  }
  if (!model) {
    return {
      sceneAnchorEnabled: true,
      configured: false,
      provider,
      model: null,
      implemented: true,
      fallbackMode,
      reason: 'scene_anchor_provider_not_configured',
      failureCategory: 'scene_anchor_provider_not_configured',
    };
  }
  if (!configuredSceneAnchorFalKey(envSource)) {
    return {
      sceneAnchorEnabled: true,
      configured: false,
      provider,
      model,
      implemented: true,
      fallbackMode,
      reason: 'scene_anchor_fal_key_missing',
      failureCategory: 'scene_anchor_fal_key_missing',
    };
  }
  return {
    sceneAnchorEnabled: true,
    configured: true,
    provider,
    model,
    implemented: true,
    fallbackMode,
    reason: 'scene_anchor_fal_provider_ready',
    failureCategory: null,
  };
}

function falQueueUrl(model: string, suffix = '') {
  return `https://queue.fal.run/${model}${suffix}`;
}

function falRequestId(value: unknown) {
  const record = objectRecord(value);
  return textValue(record.request_id) || textValue(record.requestId) || textValue(record.id) || null;
}

function rawFalQueueUrl(value: unknown) {
  const url = textValue(value);
  return /^https:\/\/queue\.fal\.run\//i.test(url) ? url : null;
}

function modelSupportsFalSceneAnchorReferences(model: string) {
  const normalized = model.toLowerCase();
  return (
    normalized === 'fal-ai/vidu/reference-to-image' ||
    normalized === 'fal-ai/vidu/q2/reference-to-image' ||
    normalized === 'fal-ai/minimax/image-01/subject-reference' ||
    normalized.includes('/kontext/max/multi') ||
    normalized.includes('flux-pro/kontext/max/multi')
  );
}

function sceneAnchorReferenceLimitForModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized === 'fal-ai/vidu/reference-to-image' || normalized === 'fal-ai/vidu/q2/reference-to-image') return 3;
  if (normalized.includes('/kontext/max/multi') || normalized.includes('flux-pro/kontext/max/multi')) return 4;
  return null;
}

function preferredSceneAnchorReferenceScore(reference: KlingCreateReferenceEntry) {
  if (reference.role === 'front_angle') return 0;
  if (reference.role === 'full_body') return 1;
  if (reference.role === 'side_angle_left') return 2;
  if (reference.role === 'side_angle_right') return 3;
  if (reference.role === 'identity_sheet') return 4;
  return 5;
}

export function planFalSceneAnchorReferences(input: {
  model: string;
  identityReferences: KlingCreateReferenceEntry[];
}) {
  const providerReferenceLimit = sceneAnchorReferenceLimitForModel(input.model);
  const planned = input.identityReferences.filter((reference) => isValidHttpUrl(reference.url));
  const ordered = [...planned].sort((a, b) => {
    const scoreDiff = preferredSceneAnchorReferenceScore(a) - preferredSceneAnchorReferenceScore(b);
    return scoreDiff || input.identityReferences.indexOf(a) - input.identityReferences.indexOf(b);
  });
  const submitted = typeof providerReferenceLimit === 'number'
    ? ordered.slice(0, providerReferenceLimit)
    : ordered;
  const submittedSet = new Set(submitted.map((reference) => `${reference.role}:${reference.url}`));
  const dropped = ordered.filter((reference) => !submittedSet.has(`${reference.role}:${reference.url}`));
  return {
    plannedReferences: planned,
    submittedReferences: submitted,
    droppedReferences: dropped,
    plannedReferenceCount: planned.length,
    submittedReferenceCount: submitted.length,
    droppedReferenceRoles: dropped.map((reference) => reference.role),
    submittedReferenceRoles: submitted.map((reference) => reference.role),
    providerReferenceLimit,
    privateUrlsRedacted: true,
  };
}

export function buildFalSceneAnchorPayload(input: {
  model: string;
  prompt: string;
  identityReferences: KlingCreateReferenceEntry[];
}) {
  const referencePlan = planFalSceneAnchorReferences(input);
  const urls = referencePlan.submittedReferences.map((reference) => reference.url);
  const primaryUrl = urls[0] ?? '';
  const model = input.model.toLowerCase();
  if (!urls.length) {
    throw Object.assign(new Error('No provider-accessible identity references are available for scene-anchor generation.'), {
      failureCategory: 'scene_anchor_provider_not_configured',
    });
  }
  if (model === 'fal-ai/vidu/reference-to-image' || model === 'fal-ai/vidu/q2/reference-to-image') {
    return {
      prompt: input.prompt,
      reference_image_urls: urls,
      aspect_ratio: '9:16',
    };
  }
  if (model === 'fal-ai/minimax/image-01/subject-reference') {
    return {
      prompt: input.prompt,
      image_url: primaryUrl,
      aspect_ratio: '9:16',
      num_images: 1,
      prompt_optimizer: true,
    };
  }
  if (model.includes('/kontext/max/multi') || model.includes('flux-pro/kontext/max/multi')) {
    return {
      prompt: input.prompt,
      image_urls: urls.slice(0, 4),
      aspect_ratio: '9:16',
      num_images: 1,
      output_format: 'jpeg',
    };
  }
  throw Object.assign(new Error(`Scene-anchor fal model schema is not mapped for ${input.model}.`), {
    failureCategory: 'scene_anchor_model_schema_unmapped',
  });
}

function sceneAnchorPayloadShapeSummary(payload: unknown) {
  const record = objectRecord(payload);
  return {
    fieldNames: Object.keys(record).sort(),
    imageUrlCount: Array.isArray(record.image_urls) ? record.image_urls.length : 0,
    referenceImageUrlCount: Array.isArray(record.reference_image_urls) ? record.reference_image_urls.length : 0,
    hasSingleImageUrl: Boolean(record.image_url),
    hasPrompt: Boolean(textValue(record.prompt)),
    privateUrlsRedacted: true,
  };
}

function klingSceneAnchorVideoModelStatus(envSource: NodeJS.ProcessEnv = process.env): KlingSceneAnchorVideoStatus {
  const model = textValue(envSource.KLING_SCENE_ANCHOR_VIDEO_MODEL);
  if (!model) {
    return {
      configured: false,
      implemented: false,
      model: null,
      routeType: 'image_to_video',
      reason: 'kling_scene_anchor_video_model_missing',
      failureCategory: 'kling_scene_anchor_video_model_not_configured',
    };
  }
  if (!configuredSceneAnchorFalKey(envSource)) {
    return {
      configured: false,
      implemented: false,
      model,
      routeType: 'image_to_video',
      reason: 'kling_scene_anchor_video_fal_key_missing',
      failureCategory: 'kling_scene_anchor_video_fal_key_missing',
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
    routeType: 'image_to_video',
    reason: implemented
      ? 'kling_scene_anchor_video_model_ready'
      : 'kling_scene_anchor_video_model_schema_unmapped',
    failureCategory: implemented ? null : 'kling_scene_anchor_video_model_unsupported',
  };
}

function normalizeKlingSceneAnchorVideoDuration(value: unknown): '5' | '10' {
  const duration = normalizeDuration(value);
  return duration > 5 ? '10' : '5';
}

export function buildKlingSceneAnchorImageToVideoPayload(input: {
  model: string;
  prompt: string;
  sceneAnchorUrl: string;
  duration?: unknown;
}) {
  const normalizedModel = input.model.toLowerCase();
  const duration = normalizeKlingSceneAnchorVideoDuration(input.duration);
  if (
    normalizedModel === 'fal-ai/kling-video/v2.1/master/image-to-video' ||
    normalizedModel === 'fal-ai/kling-video/v2.1/standard/image-to-video'
  ) {
    return {
      prompt: input.prompt,
      image_url: input.sceneAnchorUrl,
      duration,
    };
  }
  if (
    normalizedModel === 'fal-ai/kling-video/o1/image-to-video' ||
    normalizedModel === 'fal-ai/kling-video/o1/standard/image-to-video'
  ) {
    return {
      prompt: input.prompt,
      start_image_url: input.sceneAnchorUrl,
      duration,
    };
  }
  throw Object.assign(new Error(`Kling scene-anchor image-to-video schema is not mapped for ${input.model}.`), {
    failureCategory: 'kling_scene_anchor_video_model_unsupported',
  });
}

function klingSceneAnchorVideoPayloadShapeSummary(payload: unknown) {
  const record = objectRecord(payload);
  return {
    fieldNames: Object.keys(record).sort(),
    hasPrompt: Boolean(textValue(record.prompt)),
    hasImageUrl: Boolean(record.image_url),
    hasStartImageUrl: Boolean(record.start_image_url),
    hasReferenceImages: Boolean(record.reference_images) || Boolean(record.image_urls) || Boolean(record.elements),
    duration: textValue(record.duration) || null,
    privateUrlsRedacted: true,
  };
}

function outputShapeLabel(output: unknown) {
  if (Array.isArray(output)) return `array(${output.length})`;
  if (output && typeof output === 'object') {
    return `object(${Object.keys(output as Record<string, unknown>).slice(0, 10).sort().join(',')})`;
  }
  return typeof output;
}

function isSceneAnchorModerationError(value: unknown) {
  const lower = redactSceneAnchorProviderText(value, 2000).toLowerCase();
  return lower.includes('moderation') ||
    lower.includes('safety') ||
    lower.includes('sensitive') ||
    lower.includes('flagged') ||
    lower.includes('policy');
}

function sceneAnchorProviderHttpErrorCategory(status: number, payload?: unknown): SceneAnchorFailureCategory {
  if (isSceneAnchorModerationError(payload)) return 'scene_anchor_provider_moderation_block';
  if (status === 400 || status === 422) return 'scene_anchor_input_schema';
  if (status === 404) return 'scene_anchor_model_schema_unmapped';
  if (status === 401 || status === 403) return 'scene_anchor_fal_key_missing';
  if (status >= 500 || status === 429) return 'scene_anchor_fal_submit_failed';
  return 'scene_anchor_generation_failed';
}

async function falSceneAnchorJson<T>(input: {
  path: string;
  method: string;
  body?: unknown;
  key: string;
  fetchImpl?: typeof fetch;
}) {
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(input.path, {
    method: input.method,
    headers: {
      Authorization: falSceneAnchorAuthorizationHeader(input.key),
      'Content-Type': 'application/json',
      'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600 }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(redactSceneAnchorProviderText(payload) || 'Fal scene-anchor request failed.'), {
      failureCategory: sceneAnchorProviderHttpErrorCategory(response.status, payload),
      falHttpStatus: response.status,
      falErrorType: textValue(objectRecord(payload).type) || textValue(objectRecord(payload).error_type) || null,
      falErrorMessage: redactSceneAnchorProviderText(
        textValue(objectRecord(payload).message) ||
        textValue(objectRecord(payload).error) ||
        payload,
      ),
      falErrorBodyRedacted: redactSceneAnchorProviderText(payload),
      endpointUsed: input.path.replace(/https:\/\/queue\.fal\.run\/.+$/i, 'https://queue.fal.run/[model]'),
      payloadShapeSummary: input.body === undefined ? null : sceneAnchorPayloadShapeSummary(input.body),
    });
  }
  return payload as T;
}

function sceneAnchorStatusFromResponse(response: unknown) {
  const record = objectRecord(response);
  if (typeof record.status === 'string') return record.status;
  if (record.completed === true) return 'COMPLETED';
  return null;
}

function sceneAnchorTerminalStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'COMPLETED' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'FAILED' ||
    normalized === 'CANCELED' ||
    normalized === 'CANCELLED';
}

function sceneAnchorSucceededStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'COMPLETED' || normalized === 'SUCCEEDED';
}

function isLikelyImageUrl(url: string) {
  const normalized = url.split('?')[0].toLowerCase();
  return /\.(png|jpe?g|webp|avif)$/i.test(normalized) ||
    normalized.includes('/image') ||
    normalized.includes('_image.');
}

export function parseSceneAnchorImageOutput(output: unknown): { url: string; contentType: string | null } | null {
  const directUrl = maybeUrl(output);
  if (directUrl && isValidHttpUrl(directUrl) && isLikelyImageUrl(directUrl)) {
    return { url: directUrl, contentType: null };
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const parsed = parseSceneAnchorImageOutput(item);
      if (parsed) return parsed;
    }
    return null;
  }
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  const contentType =
    textValue(record.content_type) ||
    textValue(record.contentType) ||
    textValue(record.mime_type) ||
    textValue(record.mimeType) ||
    textValue(record.media_type) ||
    textValue(record.mediaType) ||
    null;
  const url = maybeUrl(record.url);
  if (url && isValidHttpUrl(url) && (contentType?.toLowerCase().startsWith('image/') || isLikelyImageUrl(url))) {
    return { url, contentType };
  }
  for (const key of ['image', 'images', 'output', 'data', 'result', 'file', 'files', 'asset', 'assets']) {
    const parsed = parseSceneAnchorImageOutput(record[key]);
    if (parsed) return parsed;
  }
  return null;
}

function sceneAnchorOutputLooksImageLike(output: unknown): boolean {
  if (!output) return false;
  const record = objectRecord(output);
  const text = redactSceneAnchorProviderText(output, 2000).toLowerCase();
  return Boolean(
    record.image ||
    record.images ||
    record.output ||
    record.data ||
    record.result ||
    record.url ||
    text.includes('image/') ||
    text.includes('.png') ||
    text.includes('.jpg') ||
    text.includes('.jpeg') ||
    text.includes('.webp'),
  );
}

async function pollFalSceneAnchorImage(input: {
  model: string;
  submitted: unknown;
  key: string;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}) {
  const requestId = falRequestId(input.submitted);
  const submittedImage = parseSceneAnchorImageOutput(input.submitted);
  if (submittedImage) return { output: input.submitted, image: submittedImage, requestId, status: sceneAnchorStatusFromResponse(input.submitted) };
  if (!requestId) {
    throw Object.assign(new Error('Fal scene-anchor submission did not return a request id or image output.'), {
      failureCategory: 'scene_anchor_fal_submit_failed',
    });
  }
  const statusUrl = rawFalQueueUrl(objectRecord(input.submitted).status_url) ?? falQueueUrl(input.model, `/requests/${encodeURIComponent(requestId)}/status`);
  const responseUrl = rawFalQueueUrl(objectRecord(input.submitted).response_url) ?? falQueueUrl(input.model, `/requests/${encodeURIComponent(requestId)}/response`);
  const sleepForPoll = input.sleepFn ?? sleep;
  let latest: unknown = input.submitted;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    latest = await falSceneAnchorJson<unknown>({
      path: statusUrl,
      method: 'GET',
      key: input.key,
      fetchImpl: input.fetchImpl,
    });
    const image = parseSceneAnchorImageOutput(latest);
    if (image) return { output: latest, image, requestId, status: sceneAnchorStatusFromResponse(latest) };
    const status = sceneAnchorStatusFromResponse(latest);
    if (sceneAnchorTerminalStatus(status)) {
      if (!sceneAnchorSucceededStatus(status)) {
        throw Object.assign(new Error(redactSceneAnchorProviderText(latest) || 'Fal scene-anchor generation failed.'), {
          failureCategory: isSceneAnchorModerationError(latest)
            ? 'scene_anchor_provider_moderation_block'
            : 'scene_anchor_generation_failed',
          providerStatus: status,
          providerErrorSummary: redactSceneAnchorProviderText(latest),
        });
      }
      const result = await falSceneAnchorJson<unknown>({
        path: responseUrl,
        method: 'GET',
        key: input.key,
        fetchImpl: input.fetchImpl,
      });
      const resultImage = parseSceneAnchorImageOutput(result);
      if (resultImage) return { output: result, image: resultImage, requestId, status };
      throw Object.assign(new Error('Fal scene-anchor response did not include an image URL.'), {
        failureCategory: sceneAnchorOutputLooksImageLike(result)
          ? 'scene_anchor_output_parse_failed'
          : 'scene_anchor_output_missing',
        providerStatus: status,
        providerOutputShape: outputShapeLabel(result),
        sceneAnchorOutputParsed: false,
        providerErrorSummary: redactSceneAnchorProviderText(result),
      });
    }
    await sleepForPoll(3_000);
  }
  throw Object.assign(new Error('Fal scene-anchor generation timed out before returning an image.'), {
    failureCategory: 'scene_anchor_fal_poll_failed',
  });
}

function imageExtensionForContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('avif')) return 'avif';
  return 'jpg';
}

async function downloadAndPersistSceneAnchorImage(input: {
  userId: string;
  imageUrl: string;
  fetchImpl?: typeof fetch;
  uploader?: (asset: {
    userId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
    folder: string;
  }) => Promise<{ publicUrl: string }>;
}) {
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(input.imageUrl, { method: 'GET' });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
    throw Object.assign(new Error('Scene-anchor provider image could not be downloaded or verified as an image.'), {
      failureCategory: 'scene_anchor_asset_download_failed',
      status: response.status,
      contentType,
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
    throw Object.assign(new Error('Scene-anchor provider image failed size validation.'), {
      failureCategory: 'scene_anchor_asset_download_failed',
      contentType,
      sizeBytes: buffer.length,
    });
  }
  try {
    const uploader = input.uploader ?? (async (asset: {
      userId: string;
      fileName: string;
      contentType: string;
      buffer: Buffer;
      folder: string;
    }) => {
      const { uploadGeneratedAsset } = await import('../../backend/src/services/storageService');
      return uploadGeneratedAsset(asset);
    });
    const persisted = await uploader({
      userId: input.userId,
      fileName: `kling-scene-anchor.${imageExtensionForContentType(contentType)}`,
      contentType,
      buffer,
      folder: 'kling-scene-anchors',
    });
    if (!isValidHttpUrl(persisted.publicUrl)) {
      throw new Error('Scene-anchor upload did not return a provider-accessible HTTPS URL.');
    }
    return {
      url: persisted.publicUrl,
      contentType,
      sizeBytes: buffer.length,
    };
  } catch (error) {
    throw Object.assign(new Error(errorMessage(error)), {
      failureCategory: 'scene_anchor_asset_persist_failed',
    });
  }
}

export async function createFalSceneAnchorStill(input: {
  prompt: string;
  identityReferences: KlingCreateReferenceEntry[];
  attempt: number;
  userId: string;
  fetchImpl?: typeof fetch;
  uploader?: (asset: {
    userId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
    folder: string;
  }) => Promise<{ publicUrl: string }>;
  sleepFn?: (ms: number) => Promise<void>;
}) {
  const status = sceneAnchorProviderStatus();
  if (!status.configured || status.provider !== 'fal' || !status.model) {
    throw Object.assign(new Error('Scene-anchor fal provider is not configured.'), {
      failureCategory: status.failureCategory ?? 'scene_anchor_provider_not_configured',
      providerStatus: status,
    });
  }
  if (!modelSupportsFalSceneAnchorReferences(status.model)) {
    throw Object.assign(new Error(`Scene-anchor fal model schema is not mapped for ${status.model}.`), {
      failureCategory: 'scene_anchor_model_schema_unmapped',
      providerStatus: status,
    });
  }
  const key = configuredSceneAnchorFalKey();
  if (!key) {
    throw Object.assign(new Error('Fal key is missing for scene-anchor generation.'), {
      failureCategory: 'scene_anchor_fal_key_missing',
      providerStatus: status,
    });
  }
  const payload = buildFalSceneAnchorPayload({
    model: status.model,
    prompt: input.prompt,
    identityReferences: input.identityReferences,
  });
  const referencePlan = planFalSceneAnchorReferences({
    model: status.model,
    identityReferences: input.identityReferences,
  });
  const submitted = await falSceneAnchorJson<unknown>({
    path: falQueueUrl(status.model),
    method: 'POST',
    body: payload,
    key,
    fetchImpl: input.fetchImpl,
  }).catch((error) => {
    throw Object.assign(new Error(errorMessage(error)), {
      ...objectRecord(error),
      failureCategory: objectRecord(error).failureCategory ?? 'scene_anchor_fal_submit_failed',
      sceneAnchorPayloadShapeSummary: sceneAnchorPayloadShapeSummary(payload),
      sceneAnchorReferencePlan: {
        plannedReferenceCount: referencePlan.plannedReferenceCount,
        submittedReferenceCount: referencePlan.submittedReferenceCount,
        droppedReferenceRoles: referencePlan.droppedReferenceRoles,
        providerReferenceLimit: referencePlan.providerReferenceLimit,
        submittedReferenceRoles: referencePlan.submittedReferenceRoles,
        privateUrlsRedacted: true,
      },
    });
  });
  const result = await pollFalSceneAnchorImage({
    model: status.model,
    submitted,
    key,
    fetchImpl: input.fetchImpl,
    sleepFn: input.sleepFn,
  }).catch((error) => {
    throw Object.assign(new Error(errorMessage(error)), {
      ...objectRecord(error),
      failureCategory: objectRecord(error).failureCategory ?? 'scene_anchor_fal_poll_failed',
      sceneAnchorPayloadShapeSummary: sceneAnchorPayloadShapeSummary(payload),
      sceneAnchorReferencePlan: {
        plannedReferenceCount: referencePlan.plannedReferenceCount,
        submittedReferenceCount: referencePlan.submittedReferenceCount,
        droppedReferenceRoles: referencePlan.droppedReferenceRoles,
        providerReferenceLimit: referencePlan.providerReferenceLimit,
        submittedReferenceRoles: referencePlan.submittedReferenceRoles,
        privateUrlsRedacted: true,
      },
    });
  });
  const persisted = await downloadAndPersistSceneAnchorImage({
    userId: input.userId,
    imageUrl: result.image.url,
    fetchImpl: input.fetchImpl,
    uploader: input.uploader,
  });
  return {
    url: persisted.url,
    provider: 'fal',
    model: status.model,
    persisted: true,
    rawOutput: {
      provider: 'fal',
      requestId: result.requestId,
      providerStatus: result.status,
      outputShape: outputShapeLabel(result.output),
      payloadShape: sceneAnchorPayloadShapeSummary(payload),
      referencePlan: {
        plannedReferenceCount: referencePlan.plannedReferenceCount,
        submittedReferenceCount: referencePlan.submittedReferenceCount,
        droppedReferenceRoles: referencePlan.droppedReferenceRoles,
        providerReferenceLimit: referencePlan.providerReferenceLimit,
        submittedReferenceRoles: referencePlan.submittedReferenceRoles,
        privateUrlsRedacted: true,
      },
      outputParsed: true,
      imagePersisted: true,
      imageContentType: persisted.contentType,
      imageSizeBytes: persisted.sizeBytes,
      privateUrlsRedacted: true,
    },
  };
}

async function pollFalKlingSceneAnchorVideo(input: {
  model: string;
  submitted: unknown;
  key: string;
}) {
  const requestId = falRequestId(input.submitted);
  const submittedVideoUrl = await outputUrl(input.submitted);
  if (submittedVideoUrl) {
    return {
      output: input.submitted,
      videoUrl: submittedVideoUrl,
      requestId,
      status: sceneAnchorStatusFromResponse(input.submitted),
    };
  }
  if (!requestId) {
    throw Object.assign(new Error('Fal Kling scene-anchor video submission did not return a request id or video output.'), {
      failureCategory: 'kling_scene_anchor_video_submit_failed',
    });
  }

  const statusUrl = rawFalQueueUrl(objectRecord(input.submitted).status_url) ??
    falQueueUrl(input.model, `/requests/${encodeURIComponent(requestId)}/status`);
  const responseUrl = rawFalQueueUrl(objectRecord(input.submitted).response_url) ??
    falQueueUrl(input.model, `/requests/${encodeURIComponent(requestId)}/response`);
  let latest: unknown = input.submitted;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    latest = await falSceneAnchorJson<unknown>({
      path: statusUrl,
      method: 'GET',
      key: input.key,
    });
    const latestVideoUrl = await outputUrl(latest);
    if (latestVideoUrl) {
      return {
        output: latest,
        videoUrl: latestVideoUrl,
        requestId,
        status: sceneAnchorStatusFromResponse(latest),
      };
    }
    const status = sceneAnchorStatusFromResponse(latest);
    if (sceneAnchorTerminalStatus(status)) {
      if (!sceneAnchorSucceededStatus(status)) {
        throw Object.assign(new Error(redactSceneAnchorProviderText(latest) || 'Fal Kling scene-anchor video generation failed.'), {
          failureCategory: 'kling_scene_anchor_video_generation_failed',
          providerStatus: status,
        });
      }
      const result = await falSceneAnchorJson<unknown>({
        path: responseUrl,
        method: 'GET',
        key: input.key,
      });
      const resultVideoUrl = await outputUrl(result);
      if (resultVideoUrl) {
        return {
          output: result,
          videoUrl: resultVideoUrl,
          requestId,
          status,
        };
      }
      throw Object.assign(new Error('Fal Kling scene-anchor video response did not include a video URL.'), {
        failureCategory: 'kling_scene_anchor_video_output_missing',
        providerStatus: status,
        providerOutputShape: outputShapeLabel(result),
      });
    }
    await sleep(3_000);
  }

  throw Object.assign(new Error('Fal Kling scene-anchor video generation timed out before returning a video.'), {
    failureCategory: 'kling_scene_anchor_video_poll_failed',
  });
}

async function runFalKlingSceneAnchorImageToVideo(input: {
  prompt: string;
  sceneAnchorUrl: string;
  durationSent: number | null;
}): Promise<ReplicateRunResult> {
  const status = klingSceneAnchorVideoModelStatus();
  if (!status.configured || !status.model) {
    throw Object.assign(new Error('Scene anchor video model is not configured.'), {
      failureCategory: status.failureCategory ?? 'kling_scene_anchor_video_model_not_configured',
      providerStatus: status,
    });
  }
  const key = configuredSceneAnchorFalKey();
  if (!key) {
    throw Object.assign(new Error('Fal key is missing for Kling scene-anchor image-to-video.'), {
      failureCategory: 'kling_scene_anchor_video_fal_key_missing',
      providerStatus: status,
    });
  }
  const payload = buildKlingSceneAnchorImageToVideoPayload({
    model: status.model,
    prompt: input.prompt,
    sceneAnchorUrl: input.sceneAnchorUrl,
    duration: input.durationSent,
  });
  const endpoint = falQueueUrl(status.model);
  const attempts: unknown[] = [];
  try {
    const submitted = await falSceneAnchorJson<unknown>({
      path: endpoint,
      method: 'POST',
      body: payload,
      key,
    });
    const result = await pollFalKlingSceneAnchorVideo({
      model: status.model,
      submitted,
      key,
    });
    attempts.push({
      provider: 'fal',
      model: status.model,
      inputKeys: Object.keys(payload),
      success: true,
      routeType: 'image_to_video',
      requestId: result.requestId,
    });
    return {
      videoUrl: result.videoUrl,
      model: status.model as ReplicateModelIdentifier,
      rawOutput: {
        provider: 'fal',
        requestId: result.requestId,
        providerStatus: result.status,
        outputShape: outputShapeLabel(result.output),
        payloadShape: klingSceneAnchorVideoPayloadShapeSummary(payload),
        stage2ProviderRouteType: 'image_to_video',
        primaryVideoInputType: 'scene_anchor',
        rawReferenceVisualInputsSentToStage2: false,
        privateUrlsRedacted: true,
      },
      attempts,
      durationSent: Number(payload.duration),
      finalInputKeys: Object.keys(payload),
    };
  } catch (error) {
    attempts.push({
      provider: 'fal',
      model: status.model,
      inputKeys: Object.keys(payload),
      success: false,
      routeType: 'image_to_video',
      details: safeJsonValue(error),
    });
    throw Object.assign(new Error(errorMessage(error)), {
      provider: 'fal',
      model: status.model,
      details: {
        error: safeJsonValue(error),
        attempts,
        payloadShape: klingSceneAnchorVideoPayloadShapeSummary(payload),
        privateUrlsRedacted: true,
      },
      failureCategory: objectRecord(error).failureCategory ?? 'kling_scene_anchor_video_generation_failed',
    });
  }
}

export function detectKlingOutfitIntent(prompt: string) {
  const normalizedPrompt = prompt.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const outfitNouns = [
    'dress',
    'gown',
    'suit',
    'tuxedo',
    'robe',
    'coat',
    'jacket',
    'blazer',
    'skirt',
    'jeans',
    'pants',
    'trousers',
    'top',
    'shirt',
    'sweater',
    'hoodie',
    'uniform',
    'outfit',
  ];
  const descriptors = [
    'flowing',
    'ivory',
    'white',
    'black',
    'red',
    'blue',
    'green',
    'gold',
    'silver',
    'silk',
    'satin',
    'linen',
    'casual',
    'formal',
    'elegant',
    'red carpet',
    'storybook',
  ];
  const terms = new Set<string>();
  const descriptorPattern = descriptors
    .sort((a, b) => b.length - a.length)
    .map((descriptor) => escapeRegExp(descriptor).replace(/\\ /g, '\\s+'))
    .join('|');
  const nounPattern = outfitNouns
    .map((noun) => escapeRegExp(noun).replace(/\\ /g, '\\s+'))
    .join('|');
  const outfitPattern = new RegExp(
    `\\b((?:(?:${descriptorPattern})\\s+){0,4}(?:${nounPattern}))\\b`,
    'gi',
  );

  let match: RegExpExecArray | null;
  while ((match = outfitPattern.exec(normalizedPrompt))) {
    const term = match[1]?.replace(/\s+/g, ' ').trim();
    if (term) terms.add(term);
  }

  const flowingIvoryDress = normalizedPrompt.match(/\bflowing\s+ivory\s+dress\b/i);
  if (flowingIvoryDress) terms.add(flowingIvoryDress[0].toLowerCase());

  return {
    userSpecifiedOutfit: terms.size > 0,
    outfitTermsDetected: Array.from(terms),
  };
}

export function detectKlingEnvironmentIntent(prompt: string) {
  const normalizedPrompt = prompt.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const environmentTerms = [
    'flower garden',
    'garden',
    'meadow',
    'field',
    'forest',
    'park',
    'beach',
    'plaza',
    'courtyard',
    'greenhouse',
    'sunlit garden',
    'golden hour',
    'outdoor',
    'outside',
    'open space',
  ];
  return {
    environmentDetected: environmentTerms.some((term) => normalizedPrompt.includes(term)),
    environmentTermsDetected: environmentTerms.filter((term) => normalizedPrompt.includes(term)),
  };
}

function detectRiskyReferenceArtifacts(sceneIntent: KlingSceneIntentAnalysis) {
  const artifacts = new Set<string>();
  if (sceneIntent.compositionNeutralized) {
    artifacts.add('source_background');
    artifacts.add('source_outfit');
  }
  if (
    sceneIntent.sceneIntent.includes('walking') ||
    sceneIntent.sceneIntent.includes('standing') ||
    sceneIntent.sceneIntent.includes('open_space_environment')
  ) {
    artifacts.add('chair');
    artifacts.add('seated_pose');
    artifacts.add('sidewalk_or_street');
    artifacts.add('bag_or_purse');
    artifacts.add('studio_backdrop');
    artifacts.add('tight_portrait_crop');
    artifacts.add('furniture');
  }
  return Array.from(artifacts);
}

function buildCompositeIdentitySheetDataUrl(references: KlingCreateReferenceEntry[]) {
  const cells = references.slice(0, 4);
  const width = 1024;
  const height = 1024;
  const cellWidth = width / Math.max(1, cells.length);
  const imageElements = cells.map((reference, index) => {
    const x = index * cellWidth;
    const label = reference.role === 'front_angle'
      ? 'front'
      : reference.role === 'side_angle_left'
        ? 'left side'
        : reference.role === 'side_angle_right'
          ? 'right side'
          : reference.role === 'full_body'
            ? 'full body'
            : 'identity';
    return `
      <g>
        <clipPath id="clip${index}"><rect x="${x + 14}" y="52" width="${cellWidth - 28}" height="850" rx="22"/></clipPath>
        <rect x="${x + 14}" y="52" width="${cellWidth - 28}" height="850" rx="22" fill="#f6f1e8"/>
        <image href="${escapeXml(reference.url)}" x="${x + 14}" y="52" width="${cellWidth - 28}" height="850" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${index})"/>
        <rect x="${x + 14}" y="52" width="${cellWidth - 28}" height="850" rx="22" fill="none" stroke="#d9cec0" stroke-width="3"/>
        <text x="${x + cellWidth / 2}" y="952" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#4f463d">${escapeXml(label)}</text>
      </g>
    `;
  }).join('\n');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#fbf8f1"/>
      <text x="${width / 2}" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#6c5e51">identity reference sheet</text>
      ${imageElements}
    </svg>
  `;
  return dataUrlFromSvg(svg);
}

function buildKlingSceneAnchorPrompt(input: {
  userPrompt: string;
  sceneIntent: KlingSceneIntentAnalysis;
  outfitTerms: string[];
  environmentTerms: string[];
  retryIndex?: number;
}) {
  const fullBodyScene = input.sceneIntent.prefersFullBodyPrimary || input.sceneIntent.compositionNeutralized;
  const framing = fullBodyScene
    ? 'full-body or three-quarter full-body cinematic scene anchor, medium-wide opening frame, visible ground and environment'
    : input.sceneIntent.framingIntent === 'portrait_closeup'
      ? 'portrait scene anchor matching the requested close-up framing'
      : 'medium-full cinematic scene anchor with visible environment';
  const outfit = input.outfitTerms.length
    ? `Requested outfit must be visible and prioritized: ${input.outfitTerms.join(', ')}.`
    : 'Use scene-appropriate wardrobe from the user prompt and avoid carrying source reference clothing unless requested.';
  const environment = input.environmentTerms.length
    ? `Requested environment must be visible: ${input.environmentTerms.join(', ')}.`
    : 'Show the requested environment clearly around the subject.';
  const retryGuidance = input.retryIndex && input.retryIndex > 0
    ? 'Regenerate with stronger full-body staging, clearer environment visibility, and stronger outfit adherence.'
    : '';

  return [
    'Create a new scene anchor still for a Kling exact-likeness video render.',
    'Use the saved self-character references only for identity traits: face identity, hair color and style, skin tone, eye area, body proportions, and silhouette.',
    `Scene request: ${sanitizePromptText(input.userPrompt)}.`,
    framing,
    environment,
    outfit,
    fullBodyScene
      ? 'Stage the character standing or beginning to walk naturally through open space with relaxed posture, relaxed arm movement, gentle hair motion, clear silhouette, and visible garden or environment around the body.'
      : 'Stage the character in the requested composition while keeping identity consistent.',
    'Keep the composition freshly staged inside the requested scene.',
    'Keep the frame free of chair backs, furniture, studio backdrop, seated pose, tight portrait crop, sidewalk carryover, bags, and source-photo background props unless the user requested them.',
    'Opening frame should not be a tight close-up portrait for walking, standing, open-space, or full-body prompts.',
    'Soft cinematic storybook realism, natural lighting, coherent environment, provider-safe fully clothed styling.',
    retryGuidance,
  ].filter(Boolean).join(' ');
}

function validateKlingSceneAnchorStill(input: {
  plan: KlingCreateReferencePlan;
  attempt: number;
  anchorUrl: string;
}): KlingSceneAnchorValidation {
  const isSceneMotion = input.plan.sceneIntent.some((intent) =>
    ['walking', 'standing', 'full_body', 'open_space_environment', 'motion_light', 'motion_medium'].includes(intent),
  );
  const prompt = `${input.plan.sceneAnchorPrompt} ${input.plan.scenePrompt} ${input.plan.motionPrompt}`.toLowerCase();
  const faceVisible = /face identity|face|hair|eye|identity traits/.test(prompt);
  const fullBodyVisible = !isSceneMotion || /full-body|three-quarter|medium-wide|visible ground/.test(prompt);
  const environmentMatch = input.plan.environmentTermsDetected.length === 0 ||
    input.plan.environmentTermsDetected.some((term) => prompt.includes(term.toLowerCase()));
  const outfitMatch = !input.plan.userSpecifiedOutfit ||
    input.plan.outfitTermsDetected.some((term) => prompt.includes(term.toLowerCase()));
  const noFurnitureCarryover = /free of chair backs|free of .*furniture|freshly staged/.test(prompt);
  const noPortraitCrop = !isSceneMotion || /not be a tight close-up portrait|medium-wide|full-body/.test(prompt);
  const flags = [
    faceVisible,
    fullBodyVisible,
    environmentMatch,
    outfitMatch,
    noFurnitureCarryover,
    noPortraitCrop,
  ];
  const failureReasons = [
    faceVisible ? '' : 'face_visible',
    fullBodyVisible ? '' : 'full_body_visible',
    environmentMatch ? '' : 'environment_match',
    outfitMatch ? '' : 'outfit_match',
    noFurnitureCarryover ? '' : 'no_furniture_carryover',
    noPortraitCrop ? '' : 'no_portrait_crop',
  ].filter(Boolean);
  const score = flags.filter(Boolean).length;

  return {
    faceVisible,
    fullBodyVisible,
    environmentMatch,
    outfitMatch,
    noFurnitureCarryover,
    noPortraitCrop,
    passed: Boolean(input.anchorUrl) && score === flags.length,
    score,
    attempts: input.attempt,
    regenerated: input.attempt > 1,
    heuristicOnly: true,
    failureReasons,
  };
}

function primaryVideoSourceForReference(reference: KlingCreateReferenceEntry | null | undefined): KlingPrimaryVideoInputSource {
  if (!reference) return 'unknown';
  if (reference.role === 'scene_anchor') return 'scene_anchor';
  if (reference.role === 'identity_sheet') return 'identity_sheet';
  if (reference.role === 'front_angle') return 'front_identity_reference';
  if (reference.role === 'full_body') return 'full_body_identity_reference';
  if (reference.role === 'side_angle_left' || reference.role === 'side_angle_right') return 'side_identity_reference';
  if (reference.role === 'additional_reference') return 'additional_identity_reference';
  return 'unknown';
}

function syncKlingVideoStageMetadata(plan: KlingCreateReferencePlan) {
  const sceneAnchorIsReady = plan.sceneAnchorGenerated && plan.providerPrimaryReference.role === 'scene_anchor';
  const sceneAnchorPlanned = plan.providerPrimaryReference.role === 'scene_anchor' || plan.primaryInputType === 'scene_anchor_still';
  const primaryIsIdentitySheet = plan.providerPrimaryReference.role === 'identity_sheet';
  const primaryInputType: KlingPrimaryVideoInputType = sceneAnchorPlanned
    ? 'scene_anchor'
    : primaryIsIdentitySheet
      ? 'identity_sheet'
      : plan.primaryInputType === 'identity_sheet'
        ? 'identity_sheet'
        : 'identity_reference';
  const identityRefsPassed = !sceneAnchorPlanned && plan.providerAdditionalReferences.length > 0;

  plan.primaryVideoInputType = primaryInputType;
  plan.primaryVideoInputSource = sceneAnchorPlanned
    ? 'scene_anchor'
    : primaryVideoSourceForReference(plan.providerPrimaryReference);
  plan.identityReferencesPassedToVideoStage = identityRefsPassed;
  plan.identityReferenceCount = plan.references.length;
  plan.identityReferenceMode = sceneAnchorPlanned
    ? 'stage1_only'
    : identityRefsPassed
      ? 'video_stage_secondary'
      : 'identity_prompt_only';
  plan.startFrameSource = sceneAnchorPlanned
    ? 'scene_anchor'
    : primaryInputType === 'identity_sheet'
      ? 'identity_sheet'
      : 'identity_reference';
  plan.posterFrameSource = 'video_frame';
  plan.firstFrameSource = sceneAnchorPlanned ? 'scene_anchor' : 'provider_video';
  plan.stage2ProviderModel = sceneAnchorPlanned
    ? klingSceneAnchorVideoModelStatus().model
    : null;
  plan.stage2ProviderRouteType = sceneAnchorPlanned ? 'image_to_video' : 'reference_to_video';
  plan.rawReferenceVisualInputsSentToStage2 = identityRefsPassed;
  return plan;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringArrayOrNull(value: unknown) {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length ? strings : null;
}

function objectRecordWithKeys(value: unknown) {
  const record = objectRecord(value);
  return Object.keys(record).length ? record : null;
}

function applySceneAnchorFailureDiagnostics(plan: KlingCreateReferencePlan, error: unknown) {
  const record = objectRecord(error);
  const payloadShape =
    objectRecordWithKeys(record.sceneAnchorPayloadShapeSummary) ??
    objectRecordWithKeys(record.payloadShapeSummary) ??
    objectRecordWithKeys(objectRecord(record.details).payloadShape) ??
    {};
  const referencePlan = objectRecord(record.sceneAnchorReferencePlan);
  plan.sceneAnchorHttpStatus = numberOrNull(record.falHttpStatus ?? record.statusCode ?? record.status);
  plan.sceneAnchorErrorType =
    textValue(record.falErrorType) ||
    textValue(record.errorType) ||
    textValue(record.name) ||
    null;
  plan.sceneAnchorErrorMessage = redactSceneAnchorProviderText(
    textValue(record.falErrorMessage) ||
    textValue(record.providerErrorSummary) ||
    errorMessage(error),
    700,
  );
  plan.sceneAnchorErrorBodyRedacted = redactSceneAnchorProviderText(
    record.falErrorBodyRedacted ?? record.errorBody ?? record.body ?? null,
    1200,
  ) || null;
  plan.sceneAnchorPayloadFieldNames = stringArrayOrNull(payloadShape.fieldNames);
  plan.sceneAnchorReferenceCount =
    numberOrNull(referencePlan.plannedReferenceCount) ??
    (plan.references.length || null);
  plan.sceneAnchorSubmittedReferenceCount =
    numberOrNull(referencePlan.submittedReferenceCount) ??
    numberOrNull(payloadShape.referenceImageUrlCount) ??
    numberOrNull(payloadShape.imageUrlCount);
  plan.sceneAnchorReferenceRolesUsed =
    stringArrayOrNull(referencePlan.submittedReferenceRoles) ??
    plan.references.map((reference) => reference.role);
  plan.sceneAnchorDroppedReferenceRoles = stringArrayOrNull(referencePlan.droppedReferenceRoles);
  plan.sceneAnchorProviderReferenceLimit = numberOrNull(referencePlan.providerReferenceLimit);
  plan.sceneAnchorOutputParsed = typeof record.sceneAnchorOutputParsed === 'boolean'
    ? record.sceneAnchorOutputParsed
    : null;
}

function buildKlingStageTwoPromptGuidance(plan: KlingCreateReferencePlan) {
  const sceneAnchorIsReady = plan.sceneAnchorGenerated && plan.providerPrimaryReference.role === 'scene_anchor';
  const identitySupport = sceneAnchorIsReady
    ? 'Saved identity references are baked into the scene anchor from Stage 1; use them as continuity guidance only, not as video-stage start frames.'
    : plan.providerAdditionalReferences.length
      ? `Use ${plan.providerAdditionalReferences.map((reference) => reference.token).join(', ')} as secondary identity support only for face, hair, proportions, and silhouette continuity.`
      : 'Use saved identity references as secondary identity support only when available.';
  const outfit = plan.userSpecifiedOutfit
    ? `Keep the requested outfit visible and dominant: ${plan.outfitTermsDetected.join(', ')}.`
    : 'Keep wardrobe driven by the scene prompt rather than copied from identity references.';
  const environment = plan.environmentTermsDetected.length
    ? `Keep the requested environment visible: ${plan.environmentTermsDetected.join(', ')}.`
    : 'Keep the requested environment visible around the subject.';

  return [
    plan.identityPrompt,
    plan.scenePrompt,
    plan.motionPrompt,
    sceneAnchorIsReady
      ? 'Stage 2 Kling video: animate this exact staged scene. Begin directly from the provided scene anchor as the opening frame and primary start image.'
      : 'Stage 2 Kling video: use @Element1 as the primary visual input.',
    identitySupport,
    outfit,
    environment,
    sceneAnchorIsReady
      ? 'Preserve the existing outfit, environment, framing, and clean silhouette from the scene anchor while keeping the same character identity, copper hair, face, and body proportions.'
      : 'Animate the provided visual input into natural motion while preserving the saved self-character identity.',
    'For walking, standing, open-space, or full-body prompts, open in medium-wide or full-body framing with visible ground, visible environment, clear silhouette, relaxed arm movement, and gentle hair motion.',
    sceneAnchorIsReady
      ? 'Do not transition from a portrait/reference image. Do not introduce a front-facing portrait opening.'
      : '',
    'Keep the frame free of chair backs, furniture, seated pose, tight portrait crop, neutral studio backdrop, and source-photo background props unless the user requested them.',
  ].filter(Boolean).join(' ');
}

function directIdentityProviderReferences(plan: KlingCreateReferencePlan) {
  const frontReference = plan.references.find((reference) => reference.role === 'front_angle') ?? plan.primaryReference;
  return uniqueReferenceEntries([
    frontReference,
    ...plan.references.filter((reference) => reference.url !== frontReference.url),
  ]).slice(0, 4);
}

function applyExplicitKlingIdentityOnlyFallback(plan: KlingCreateReferencePlan): KlingCreateReferencePlan {
  const directReferences = directIdentityProviderReferences(plan);
  plan.providerPrimaryReference = directReferences[0] ?? plan.primaryReference;
  plan.providerAdditionalReferences = directReferences.slice(1);
  plan.validationReferences = directReferences;
  plan.plannedStrategy = directReferences.length > 1 ? 'direct_identity_references' : 'front_only_fallback';
  plan.sceneAnchorStrategy = plan.plannedStrategy;
  plan.sceneAnchorRequired = false;
  plan.sceneAnchorGenerated = false;
  plan.sceneAnchorPersisted = false;
  plan.sceneAnchorProvider = null;
  plan.sceneAnchorReason = 'identity_only_fallback_explicitly_selected';
  plan.sceneAnchorFailureCategory = null;
  plan.sceneAnchorFailureReason =
    'Scene-anchor generation was bypassed by explicit identity-only fallback. This can copy reference pose, outfit, or background more strongly.';
  plan.primaryInputType = 'identity_reference';
  plan.fallbackAllowed = true;
  plan.frontOnlyFallback = directReferences.length <= 1;
  plan.supportingReferenceRoles = directReferences.slice(1).map((reference) => reference.role);
  plan.referenceOutfitCarryoverSuppressed = false;
  plan.compositionCarryoverSuppressed = false;
  plan.promptGuidance = [
    plan.identityPrompt,
    plan.scenePrompt,
    plan.motionPrompt,
    'Identity-only Kling fallback: use saved references only for identity while building the requested scene. This fallback may copy reference-photo pose, outfit, or background more strongly than scene-anchor mode.',
  ].filter(Boolean).join(' ');
  return syncKlingVideoStageMetadata(plan);
}

export async function prepareKlingCreateReferencePlanForProvider(input: {
  plan: KlingCreateReferencePlan | null;
  userId: string;
  allowIdentityOnlyFallback?: boolean;
  sceneAnchorGenerator?: (asset: {
    prompt: string;
    identityReferences: KlingCreateReferenceEntry[];
    attempt: number;
    userId: string;
  }) => Promise<{ url: string; provider: string; model?: string | null; rawOutput?: unknown; persisted?: boolean }>;
  uploader?: (asset: {
    userId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
    folder: string;
  }) => Promise<{ publicUrl: string }>;
}): Promise<KlingCreateReferencePlan | null> {
  if (!input.plan) return null;
  const plan = input.plan;
  if (plan.sceneAnchorRequired && plan.sceneAnchorStrategy === 'scene_anchor_still') {
    if (input.allowIdentityOnlyFallback) {
      return applyExplicitKlingIdentityOnlyFallback(plan);
    }
    const sceneAnchorProvider = sceneAnchorProviderStatus();
    if (!input.sceneAnchorGenerator && (!sceneAnchorProvider.configured || !sceneAnchorProvider.implemented)) {
      plan.sceneAnchorGenerated = false;
      plan.sceneAnchorProvider = sceneAnchorProvider.provider;
      plan.sceneAnchorReason = sceneAnchorProvider.reason;
      plan.sceneAnchorFailureCategory = sceneAnchorProvider.failureCategory;
      plan.sceneAnchorPersisted = false;
      plan.sceneAnchorFailureReason = sceneAnchorProvider.reason === 'scene_anchor_provider_disabled'
        ? 'Scene-anchor provider is not configured. Configure a scene-anchor image provider, or use identity-only fallback.'
        : 'Scene-anchor generation is configured but not ready. Configure SCENE_ANCHOR_MODEL and fal credentials before Kling animation.';
      plan.sceneAnchorValidation = {
        faceVisible: false,
        fullBodyVisible: false,
        environmentMatch: false,
        outfitMatch: false,
        noFurnitureCarryover: false,
        noPortraitCrop: false,
        passed: false,
        score: 0,
        attempts: 0,
        regenerated: false,
        heuristicOnly: true,
        failureReasons: [sceneAnchorProvider.reason],
      };
      return syncKlingVideoStageMetadata(plan);
    }

    const generator = input.sceneAnchorGenerator ?? (async (asset: {
      prompt: string;
      identityReferences: KlingCreateReferenceEntry[];
      attempt: number;
      userId: string;
    }) => {
      return createFalSceneAnchorStill({
        prompt: asset.prompt,
        identityReferences: asset.identityReferences,
        attempt: asset.attempt,
        userId: input.userId,
        uploader: input.uploader,
      });
    });

    let lastValidation: KlingSceneAnchorValidation | null = null;
    let lastError: unknown = null;
    for (const attempt of [1, 2, 3]) {
      try {
        const prompt = attempt === 1
          ? plan.sceneAnchorPrompt
          : buildKlingSceneAnchorPrompt({
              userPrompt: textValue(input.plan?.scenePrompt) || plan.scenePrompt,
              sceneIntent: {
                sceneIntent: plan.sceneIntent,
                framingIntent: plan.framingIntent,
                prefersFullBodyPrimary: plan.primaryReferenceRole === 'full_body',
                compositionNeutralized: plan.compositionNeutralized,
              },
              outfitTerms: plan.outfitTermsDetected,
              environmentTerms: plan.environmentTermsDetected,
              retryIndex: attempt - 1,
            });
        const generated = await generator({
          prompt,
          identityReferences: plan.references,
          attempt,
          userId: input.userId,
        });
        if (!isValidHttpUrl(generated.url)) {
          throw new Error('Scene-anchor provider returned a non-HTTPS image URL.');
        }
        const validation = validateKlingSceneAnchorStill({
          plan,
          attempt,
          anchorUrl: generated.url,
        });
        lastValidation = validation;
        if (!validation.passed && attempt < 3) continue;
        if (!validation.passed) {
          plan.sceneAnchorGenerated = false;
          plan.sceneAnchorProvider = generated.provider;
          plan.sceneAnchorReason = 'scene_anchor_validation_failed';
          plan.sceneAnchorFailureCategory = 'scene_anchor_validation_failed';
          plan.sceneAnchorPersisted = generated.persisted !== false;
          plan.sceneAnchorFailureReason =
            'Scene-anchor generation did not pass framing, outfit, environment, or carryover checks.';
          plan.sceneAnchorValidation = validation;
          return syncKlingVideoStageMetadata(plan);
        }

        plan.providerPrimaryReference = {
          role: 'scene_anchor',
          label: 'scene anchor still',
          url: generated.url,
          token: '@Element1',
        };
        plan.providerAdditionalReferences = [];
        plan.validationReferences = [plan.providerPrimaryReference];
        plan.sceneAnchorGenerated = true;
        plan.sceneAnchorProvider = generated.provider;
        plan.sceneAnchorReason = 'scene_anchor_generated_and_validated';
        plan.sceneAnchorFailureCategory = null;
        plan.sceneAnchorPersisted = generated.persisted !== false;
        plan.sceneAnchorFailureReason = null;
        plan.sceneAnchorValidation = validation;
        const rawOutput = objectRecord(generated.rawOutput);
        const rawReferencePlan = objectRecord(rawOutput.referencePlan);
        const rawPayloadShape = objectRecord(rawOutput.payloadShape);
        plan.sceneAnchorHttpStatus = null;
        plan.sceneAnchorErrorType = null;
        plan.sceneAnchorErrorMessage = null;
        plan.sceneAnchorErrorBodyRedacted = null;
        plan.sceneAnchorPayloadFieldNames = stringArrayOrNull(rawPayloadShape.fieldNames);
        plan.sceneAnchorReferenceCount =
          numberOrNull(rawReferencePlan.plannedReferenceCount) ?? plan.references.length;
        plan.sceneAnchorSubmittedReferenceCount =
          numberOrNull(rawReferencePlan.submittedReferenceCount) ??
          numberOrNull(rawPayloadShape.referenceImageUrlCount) ??
          numberOrNull(rawPayloadShape.imageUrlCount);
        plan.sceneAnchorReferenceRolesUsed =
          stringArrayOrNull(rawReferencePlan.submittedReferenceRoles) ??
          plan.references.map((reference) => reference.role);
        plan.sceneAnchorDroppedReferenceRoles = stringArrayOrNull(rawReferencePlan.droppedReferenceRoles);
        plan.sceneAnchorProviderReferenceLimit = numberOrNull(rawReferencePlan.providerReferenceLimit);
        plan.sceneAnchorOutputParsed = Boolean(rawOutput.outputParsed ?? true);
        plan.primaryInputType = 'scene_anchor_still';
        plan.frontOnlyFallback = false;
        plan.referenceOutfitCarryoverSuppressed = plan.userSpecifiedOutfit;
        plan.compositionCarryoverSuppressed = plan.compositionNeutralized;
        syncKlingVideoStageMetadata(plan);
        plan.promptGuidance = buildKlingStageTwoPromptGuidance(plan);
        return plan;
      } catch (error) {
        lastError = error;
      }
    }

    plan.sceneAnchorGenerated = false;
    plan.sceneAnchorProvider = sceneAnchorProvider.provider;
    plan.sceneAnchorReason = 'scene_anchor_generation_failed';
    plan.sceneAnchorFailureCategory = (textValue(objectRecord(lastError).failureCategory) as SceneAnchorFailureCategory) || 'scene_anchor_generation_failed';
    plan.sceneAnchorPersisted = false;
    plan.sceneAnchorFailureReason =
      `Scene anchor generation failed. Retry scene anchor, use identity-only fallback, or edit scene. ${errorMessage(lastError)}.`;
    applySceneAnchorFailureDiagnostics(plan, lastError);
    plan.sceneAnchorValidation = lastValidation ?? {
      faceVisible: false,
      fullBodyVisible: false,
      environmentMatch: false,
      outfitMatch: false,
      noFurnitureCarryover: false,
      noPortraitCrop: false,
      passed: false,
      score: 0,
      attempts: 0,
      regenerated: false,
      heuristicOnly: true,
      failureReasons: ['scene_anchor_generation_failed'],
    };
    return syncKlingVideoStageMetadata(plan);
  }

  if (!isDataImageUrl(plan.providerPrimaryReference.url)) return syncKlingVideoStageMetadata(plan);

  const parsed = parseBase64DataUrl(plan.providerPrimaryReference.url);
  if (!parsed) {
    const directReferences = directIdentityProviderReferences(plan);
    plan.providerPrimaryReference = directReferences[0] ?? plan.primaryReference;
    plan.providerAdditionalReferences = directReferences.slice(1);
    plan.validationReferences = directReferences;
    plan.plannedStrategy = 'direct_identity_references';
    plan.sceneAnchorStrategy = 'direct_identity_references';
    plan.sceneAnchorProvider = null;
    plan.sceneAnchorReason = 'composite_identity_sheet_invalid_direct_identity_fallback';
    plan.sceneAnchorFailureCategory = null;
    plan.sceneAnchorPersisted = false;
    plan.referenceOutfitCarryoverSuppressed = false;
    plan.compositionCarryoverSuppressed = false;
    return syncKlingVideoStageMetadata(plan);
  }

  try {
    const upload = input.uploader
      ? await input.uploader({
          userId: input.userId,
          fileName: 'kling-composite-identity-sheet.svg',
          contentType: parsed.contentType,
          buffer: parsed.buffer,
          folder: 'kling-scene-anchors',
        })
      : await (async () => {
          const { uploadGeneratedAsset } = await import('../../backend/src/services/storageService');
          return uploadGeneratedAsset({
            userId: input.userId,
            fileName: 'kling-composite-identity-sheet.svg',
            contentType: parsed.contentType,
            buffer: parsed.buffer,
            folder: 'kling-scene-anchors',
          });
        })();

    if (!isValidHttpUrl(upload.publicUrl)) {
      throw new Error('Composite identity sheet upload did not return a provider-accessible HTTPS URL.');
    }

    plan.providerPrimaryReference = {
      ...plan.providerPrimaryReference,
      url: upload.publicUrl,
    };
    plan.validationReferences = [
      {
        ...plan.providerPrimaryReference,
        url: upload.publicUrl,
      },
    ];
    plan.sceneAnchorProvider = 'lumora_composite_identity_sheet';
    plan.sceneAnchorReason = 'composite_identity_sheet_materialized';
    plan.sceneAnchorFailureCategory = null;
    plan.sceneAnchorPersisted = true;
    return syncKlingVideoStageMetadata(plan);
  } catch (error) {
    console.warn('Kling composite identity sheet materialization failed; falling back to direct identity references.', {
      error: errorMessage(error),
      privateUrlsRedacted: true,
    });
    const directReferences = directIdentityProviderReferences(plan);
    plan.providerPrimaryReference = directReferences[0] ?? plan.primaryReference;
    plan.providerAdditionalReferences = directReferences.slice(1);
    plan.validationReferences = directReferences;
    plan.plannedStrategy = directReferences.length > 1 ? 'direct_identity_references' : 'front_only_fallback';
    plan.sceneAnchorStrategy = plan.plannedStrategy;
    plan.sceneAnchorGenerated = false;
    plan.sceneAnchorProvider = null;
    plan.sceneAnchorReason = 'composite_identity_sheet_upload_failed_direct_identity_fallback';
    plan.sceneAnchorFailureCategory = 'scene_anchor_asset_persist_failed';
    plan.sceneAnchorPersisted = false;
    plan.fallbackAllowed = directReferences.length <= 1;
    plan.supportingReferenceRoles = directReferences.slice(1).map((reference) => reference.role);
    plan.referenceOutfitCarryoverSuppressed = false;
    plan.compositionCarryoverSuppressed = false;
    return syncKlingVideoStageMetadata(plan);
  }
}

export function analyzeKlingSceneIntent(prompt: string): KlingSceneIntentAnalysis {
  const normalizedPrompt = ` ${prompt.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')} `;
  const intents = new Set<KlingSceneIntent>();

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' portrait ',
      ' close up ',
      ' closeup ',
      ' headshot ',
      ' selfie ',
      ' talking head ',
      ' face close ',
      ' shoulders up ',
      ' bust shot ',
    ])
  ) {
    intents.add('portrait_closeup');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' seated ',
      ' sitting ',
      ' sits ',
      ' chair ',
      ' sofa ',
      ' couch ',
      ' bench ',
      ' at a table ',
      ' dining table ',
    ])
  ) {
    intents.add('seated');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' walk ',
      ' walks ',
      ' walking ',
      ' stroll ',
      ' strolls ',
      ' strolling ',
      ' stride ',
      ' striding ',
      ' steps through ',
      ' moving through ',
      ' wanders ',
      ' wandering ',
    ]) ||
    hasPromptPattern(normalizedPrompt, /\bwalk(?:s|ing)?\b/)
  ) {
    intents.add('walking');
    intents.add('motion_light');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' standing ',
      ' stands ',
      ' stand ',
      ' upright ',
      ' posing in ',
      ' posed in ',
    ])
  ) {
    intents.add('standing');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' full body ',
      ' full-body ',
      ' full figure ',
      ' whole body ',
      ' head to toe ',
      ' head-to-toe ',
      ' wide shot ',
    ])
  ) {
    intents.add('full_body');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' medium full ',
      ' medium-full ',
      ' medium shot ',
      ' three quarter ',
      ' three-quarter ',
      ' knees up ',
      ' waist up ',
    ])
  ) {
    intents.add('medium_full');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' garden ',
      ' meadow ',
      ' field ',
      ' forest ',
      ' park ',
      ' beach ',
      ' street ',
      ' plaza ',
      ' courtyard ',
      ' open space ',
      ' outdoor ',
      ' outside ',
      ' through a ',
      ' through the ',
      ' around the ',
    ])
  ) {
    intents.add('open_space_environment');
  }

  if (
    hasAnyPromptTerm(normalizedPrompt, [
      ' dance ',
      ' dancing ',
      ' running ',
      ' run ',
      ' twirl ',
      ' twirling ',
      ' spins ',
      ' spinning ',
    ])
  ) {
    intents.add('motion_medium');
  }

  const hasPortrait = intents.has('portrait_closeup');
  const hasSeated = intents.has('seated');
  const hasWalking = intents.has('walking');
  const hasFullBody = intents.has('full_body');
  const hasOpenSpace = intents.has('open_space_environment');
  const hasStanding = intents.has('standing');

  const framingIntent: KlingFramingIntent = hasPortrait && !hasWalking && !hasFullBody && !hasOpenSpace && !hasStanding
    ? 'portrait_closeup'
    : hasSeated && !hasWalking && !hasStanding && !hasFullBody
      ? 'seated_medium'
      : hasWalking
        ? 'walking_full_body'
        : hasFullBody
          ? 'full_body_scene'
          : hasOpenSpace
            ? 'open_space_medium_full'
            : hasStanding
              ? 'standing_medium_full'
              : 'medium_full_scene';

  const prefersFullBodyPrimary = (
    framingIntent === 'walking_full_body' ||
    framingIntent === 'full_body_scene' ||
    framingIntent === 'open_space_medium_full' ||
    framingIntent === 'standing_medium_full'
  );

  return {
    sceneIntent: Array.from(intents),
    framingIntent,
    prefersFullBodyPrimary,
    compositionNeutralized: prefersFullBodyPrimary || hasOpenSpace || hasWalking,
  };
}

export function buildKlingCreateReferencePlan(input: {
  body: GenerateVideoBody;
  primaryReference: string;
  exactLikenessReady: boolean;
}): KlingCreateReferencePlan | null {
  const primary = publicImageUrl(input.primaryReference);
  if (!primary) return null;

  const urls = referenceUrlMap(input.body.referenceImageUrls);
  const userPrompt = textValue(input.body.prompt);
  const sceneIntent = analyzeKlingSceneIntent(userPrompt);
  const outfitIntent = detectKlingOutfitIntent(userPrompt);
  const environmentIntent = detectKlingEnvironmentIntent(userPrompt);
  const riskyReferenceArtifacts = detectRiskyReferenceArtifacts(sceneIntent);
  const explicitAdditional = Array.isArray(input.body.additionalReferenceImageUrls)
    ? input.body.additionalReferenceImageUrls.map(publicImageUrl)
    : [];
  const referenceImages = Array.isArray(input.body.referenceImages)
    ? input.body.referenceImages.map(publicImageUrl)
    : [];
  const canonicalReferences = Array.isArray(input.body.canonicalReferenceSet)
    ? input.body.canonicalReferenceSet.map(publicImageUrl)
    : [];
  const roleUrls = new Set([
    urls.frontFace || primary,
    urls.leftAngle,
    urls.rightAngle,
    urls.fullBody,
  ].filter(Boolean));
  const extraReferences = [
    ...canonicalReferences,
    ...explicitAdditional,
    ...referenceImages,
  ].filter((url) => url && !roleUrls.has(url));
  const roleEntries: Record<'front_angle' | 'side_angle_left' | 'side_angle_right' | 'full_body', KlingCreateReferenceEntry> = {
    front_angle: {
      role: 'front_angle',
      label: 'front',
      url: urls.frontFace || primary,
      token: '@Element1',
    },
    side_angle_left: {
      role: 'side_angle_left',
      label: 'left side',
      url: urls.leftAngle,
      token: '@Element2',
    },
    side_angle_right: {
      role: 'side_angle_right',
      label: 'right side',
      url: urls.rightAngle,
      token: '@Element3',
    },
    full_body: {
      role: 'full_body',
      label: 'full body',
      url: urls.fullBody,
      token: '@Element4',
    },
  };
  const primaryRole: KlingCreateReferenceRole =
    sceneIntent.prefersFullBodyPrimary && roleEntries.full_body.url
      ? 'full_body'
      : 'front_angle';
  const orderedRoleEntries = primaryRole === 'full_body'
    ? [
        roleEntries.full_body,
        roleEntries.front_angle,
        roleEntries.side_angle_left,
        roleEntries.side_angle_right,
      ]
    : [
        roleEntries.front_angle,
        roleEntries.side_angle_left,
        roleEntries.side_angle_right,
        roleEntries.full_body,
      ];
  const references = uniqueReferenceEntries([
    ...orderedRoleEntries,
    ...extraReferences.map((url) => ({
      role: 'additional_reference' as const,
      label: 'saved reference',
      url,
      token: '@Element',
    })),
  ]).slice(0, 4);

  const [primaryReference] = references;
  if (!primaryReference) return null;

  const additionalReferences = references.slice(1);
  const sceneAnchorProvider = sceneAnchorProviderStatus();
  const promptLooksLikeReferenceMatch = hasAnyPromptTerm(` ${userPrompt.toLowerCase()} `, [
    ' match the reference ',
    ' same outfit ',
    ' same clothes ',
    ' same clothing ',
    ' same background ',
    ' recreate the photo ',
    ' like the reference photo ',
    ' identity test ',
    ' likeness test ',
  ]);
  const shouldUseSceneAnchor = (
    input.exactLikenessReady &&
    !promptLooksLikeReferenceMatch &&
    (
      sceneIntent.prefersFullBodyPrimary ||
      sceneIntent.compositionNeutralized ||
      outfitIntent.userSpecifiedOutfit
    ) &&
    sceneIntent.framingIntent !== 'portrait_closeup'
  );
  const directIdentityAllowed = !shouldUseSceneAnchor;
  const plannedStrategy: KlingCreateReferenceStrategy = references.length === 1
    ? 'front_only_fallback'
    : shouldUseSceneAnchor
        ? 'scene_anchor_still'
        : 'direct_identity_references';
  const sceneAnchorStrategy: KlingSceneAnchorStrategy = plannedStrategy;
  const providerPrimaryReference: KlingCreateReferenceEntry = plannedStrategy === 'scene_anchor_still'
      ? {
          role: 'scene_anchor',
          label: 'scene anchor still',
          url: primaryReference.url,
          token: '@Element1',
        }
      : primaryReference;
  const providerAdditionalReferences = plannedStrategy === 'direct_identity_references' || plannedStrategy === 'front_only_fallback'
    ? additionalReferences
    : [];
  const validationReferences = [providerPrimaryReference, ...providerAdditionalReferences]
    .filter((reference) => !isDataImageUrl(reference.url));
  const sideTokens = references
    .filter((entry) => entry.role === 'side_angle_left' || entry.role === 'side_angle_right')
    .map((entry) => entry.token);
  const fullBodyReference = references.find((entry) => entry.role === 'full_body') ?? null;
  const frontReference = references.find((entry) => entry.role === 'front_angle') ?? null;
  const fullBodyToken = fullBodyReference?.token ?? null;
  const frontToken = frontReference?.token ?? null;
  const sceneStagingGuidance = sceneIntent.prefersFullBodyPrimary
    ? [
        'Stage the subject standing and moving naturally through open space in a fresh requested environment.',
        'Use medium-full or full-body framing with visible environment around the subject, natural arm swing, relaxed posture, soft body movement, and a clean unobstructed silhouette.',
        'Keep the subject clearly separated from the background and compose a coherent cinematic scene rather than an animated portrait.',
      ].join(' ')
    : sceneIntent.framingIntent === 'portrait_closeup'
      ? 'Use portrait framing only because the scene asks for a close portrait composition.'
      : 'Use medium-full cinematic staging when the prompt does not explicitly ask for a tight portrait.';
  const compositionNeutralizationGuidance = sceneIntent.compositionNeutralized
    ? [
        'Treat saved references as identity-only guidance, not composition anchors.',
        'Compose a fresh scene with the subject staged independently inside the requested environment.',
        'Use identity cues from the references while leaving source-photo furniture, seat-back shapes, studio framing, and seated posture out of the new scene unless the prompt asks for them.',
      ].join(' ')
    : 'Treat saved references as identity-only guidance for likeness while composing the requested scene.';
  const outfitGuidance = outfitIntent.userSpecifiedOutfit
    ? `Prioritize the user-requested outfit over reference clothing: ${outfitIntent.outfitTermsDetected.join(', ')}.`
    : 'Use scene-appropriate wardrobe from the user prompt, and only carry reference clothing forward when the user asks for it.';
  const identityPrompt = [
    KLING_EXACT_LIKENESS_IDENTITY_GUIDANCE,
    'Identity references define facial identity, hair, eyes, body proportions, and motion continuity only.',
  ].join(' ');
  const scenePrompt = [
    `Scene prompt: ${sanitizePromptText(userPrompt)}`,
    outfitGuidance,
    'Build a new scene matching the requested environment, outfit, lighting, and cinematic mood.',
  ].join(' ');
  const motionPrompt = sceneIntent.prefersFullBodyPrimary
    ? 'Motion prompt: standing or walking naturally through open space with relaxed posture, natural arm swing, soft body movement, visible environment, and gentle camera motion.'
    : 'Motion prompt: natural motion and gentle camera movement appropriate to the requested framing.';
  const providerPrompt = [
    'Use identity references for character identity only.',
    plannedStrategy === 'scene_anchor_still'
      ? 'Animate from the scene anchor still as the primary composition input.'
      : 'Build a new scene matching the scene prompt.',
    'Keep the requested outfit and environment dominant over reference-photo clothing or background.',
    'Use a clean unobstructed silhouette and subject-background separation for full-body or open-space scenes.',
  ].join(' ');
  const sceneAnchorPrompt = shouldUseSceneAnchor
    ? buildKlingSceneAnchorPrompt({
        userPrompt,
        sceneIntent,
        outfitTerms: outfitIntent.outfitTermsDetected,
        environmentTerms: environmentIntent.environmentTermsDetected,
      })
    : '';
  const promptGuidance = input.exactLikenessReady
    ? [
        identityPrompt,
        fullBodyReference && primaryReference.role === 'full_body'
          ? `Use ${fullBodyReference.token} as the full-figure identity and proportion guide.`
          : '',
        frontToken
          ? `Use ${frontToken} as the primary face identity.`
          : `Use ${primaryReference.token} as the primary identity guide.`,
        sideTokens.length
          ? `Use ${sideTokens.join(' and ')} for side/profile consistency.`
          : '',
        fullBodyToken && primaryReference.role !== 'full_body'
          ? `Use ${fullBodyToken} for body proportion and outfit silhouette only.`
          : '',
        scenePrompt,
        motionPrompt,
        sceneAnchorPrompt
          ? 'Stage 1 scene anchor: use the generated scene anchor as the video opening composition.'
          : '',
        providerPrompt,
        compositionNeutralizationGuidance,
        sceneStagingGuidance,
      ].filter(Boolean).join(' ')
    : '';

  const plan: KlingCreateReferencePlan = {
    primaryReference,
    references,
    additionalReferences,
    providerPrimaryReference,
    providerAdditionalReferences,
    validationReferences,
    promptGuidance,
    identityPrompt,
    scenePrompt,
    motionPrompt,
    providerPrompt,
    sceneAnchorPrompt,
    plannedStrategy,
    sceneAnchorStrategy,
    sceneAnchorGenerated: false,
    sceneAnchorProvider: sceneAnchorProvider.provider,
    sceneAnchorReason: plannedStrategy === 'scene_anchor_still'
      ? sceneAnchorProvider.reason
      : directIdentityAllowed
          ? 'direct_identity_reference_scene'
          : null,
    sceneAnchorFailureCategory: plannedStrategy === 'scene_anchor_still'
      ? sceneAnchorProvider.failureCategory
      : null,
    sceneAnchorRequired: plannedStrategy === 'scene_anchor_still',
    sceneAnchorPersisted: false,
    sceneAnchorFailureReason: null,
    sceneAnchorValidation: null,
    sceneAnchorHttpStatus: null,
    sceneAnchorErrorType: null,
    sceneAnchorErrorMessage: null,
    sceneAnchorErrorBodyRedacted: null,
    sceneAnchorPayloadFieldNames: null,
    sceneAnchorReferenceCount: null,
    sceneAnchorSubmittedReferenceCount: null,
    sceneAnchorReferenceRolesUsed: null,
    sceneAnchorDroppedReferenceRoles: null,
    sceneAnchorProviderReferenceLimit: null,
    sceneAnchorOutputParsed: null,
    primaryInputType: plannedStrategy === 'scene_anchor_still'
      ? 'scene_anchor_still'
      : 'identity_reference',
    primaryVideoInputType: plannedStrategy === 'scene_anchor_still'
      ? 'scene_anchor'
      : providerPrimaryReference.role === 'identity_sheet'
        ? 'identity_sheet'
        : 'identity_reference',
    primaryVideoInputSource: plannedStrategy === 'scene_anchor_still'
      ? 'scene_anchor'
      : primaryVideoSourceForReference(providerPrimaryReference),
    identityReferencesPassedToVideoStage: providerAdditionalReferences.length > 0,
    identityReferenceCount: references.length,
    identityReferenceMode: providerAdditionalReferences.length > 0
      ? 'video_stage_secondary'
      : 'identity_prompt_only',
    startFrameSource: plannedStrategy === 'scene_anchor_still'
      ? 'scene_anchor'
      : providerPrimaryReference.role === 'identity_sheet'
        ? 'identity_sheet'
        : 'identity_reference',
    posterFrameSource: 'video_frame',
    firstFrameSource: plannedStrategy === 'scene_anchor_still' ? 'scene_anchor' : 'provider_video',
    stage2ProviderModel: plannedStrategy === 'scene_anchor_still'
      ? klingSceneAnchorVideoModelStatus().model
      : null,
    stage2ProviderRouteType: plannedStrategy === 'scene_anchor_still'
      ? 'image_to_video'
      : 'reference_to_video',
    rawReferenceVisualInputsSentToStage2: providerAdditionalReferences.length > 0,
    fallbackAllowed: plannedStrategy === 'front_only_fallback',
    sceneIntent: sceneIntent.sceneIntent,
    framingIntent: sceneIntent.framingIntent,
    primaryReferenceRole: primaryReference.role,
    supportingReferenceRoles: additionalReferences.map((reference) => reference.role),
    compositionNeutralized: sceneIntent.compositionNeutralized,
    userSpecifiedOutfit: outfitIntent.userSpecifiedOutfit,
    outfitTermsDetected: outfitIntent.outfitTermsDetected,
    referenceOutfitCarryoverSuppressed: outfitIntent.userSpecifiedOutfit && shouldUseSceneAnchor,
    compositionCarryoverSuppressed: sceneIntent.compositionNeutralized && shouldUseSceneAnchor,
    riskyReferenceArtifacts,
    environmentTermsDetected: environmentIntent.environmentTermsDetected,
    frontOnlyFallback: plannedStrategy === 'front_only_fallback',
  };

  return syncKlingVideoStageMetadata(plan);
}

function firstReferenceImageUrl(
  body: GenerateVideoBody,
  options: { includeKeyframe?: boolean } = {},
): string {
  if (options.includeKeyframe !== false) {
    const keyframe = publicImageUrl(body.keyframeUrl);
    if (keyframe) return keyframe;
  }

  const explicit = publicImageUrl(body.referenceImageUrl);
  if (explicit) return explicit;

  const urls = referenceUrlMap(body.referenceImageUrls);
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl).find(Boolean)
    : '';

  return (
    urls.manualReferenceImageUrl ||
    urls.frontFace ||
    urls.fullBody ||
    urls.leftAngle ||
    urls.rightAngle ||
    urls.expressive ||
    Object.values(urls).find(Boolean) ||
    referenceImages ||
    ''
  );
}

function additionalReferenceImageUrls(body: GenerateVideoBody, primaryReference: string): string[] {
  const urls = referenceUrlMap(body.referenceImageUrls);
  const explicitAdditional = Array.isArray(body.additionalReferenceImageUrls)
    ? body.additionalReferenceImageUrls.map(publicImageUrl)
    : [];
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl)
    : [];
  const canonicalReferences = Array.isArray(body.canonicalReferenceSet)
    ? body.canonicalReferenceSet.map(publicImageUrl)
    : [];
  const candidates = [
    ...canonicalReferences,
    ...explicitAdditional,
    urls.leftAngle,
    urls.rightAngle,
    urls.fullBody,
    ...referenceImages,
  ];
  const seen = new Set<string>();

  return candidates.flatMap((url) => {
    if (!url || url === primaryReference || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

export function klingReferenceDiagnostics(input: {
  plan: KlingCreateReferencePlan | null;
  referenceStrategy: KlingCreateReferenceStrategy;
  exactLikenessRoute: string | null;
  providerRoute: string;
  viralPresetUsed?: string | null;
  promptPolished?: boolean;
}) {
  const references = input.plan?.references ?? [];
  const supportingReferenceRoles = input.plan?.supportingReferenceRoles ?? [];
  const fellBackToFrontOnly = input.plan
    ? input.plan.references.length === 1 && input.plan.primaryReferenceRole === 'front_angle'
    : input.referenceStrategy === 'front_only_fallback';
  return {
    exactRouteActive: input.exactLikenessRoute === 'kling_reference',
    exactRouteReason: input.exactLikenessRoute === 'kling_reference'
      ? 'Kling exact likeness route is canary-proven.'
      : null,
    sceneIntent: input.plan?.sceneIntent ?? [],
    framingIntent: input.plan?.framingIntent ?? null,
    referenceStrategy: input.referenceStrategy,
    sceneAnchorStrategy: input.plan?.sceneAnchorStrategy ?? null,
    sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
    sceneAnchorModel: sceneAnchorProviderStatus().model,
    sceneAnchorGenerated: Boolean(input.plan?.sceneAnchorGenerated),
    sceneAnchorPersisted: Boolean(input.plan?.sceneAnchorPersisted),
    sceneAnchorProvider: input.plan?.sceneAnchorProvider ?? null,
    sceneAnchorReason: input.plan?.sceneAnchorReason ?? null,
    sceneAnchorFailureCategory: input.plan?.sceneAnchorFailureCategory ?? null,
    sceneAnchorRequired: Boolean(input.plan?.sceneAnchorRequired),
    sceneAnchorValidation: input.plan?.sceneAnchorValidation ?? null,
    sceneAnchorHttpStatus: input.plan?.sceneAnchorHttpStatus ?? null,
    sceneAnchorErrorType: input.plan?.sceneAnchorErrorType ?? null,
    sceneAnchorErrorMessage: input.plan?.sceneAnchorErrorMessage ?? null,
    sceneAnchorErrorBodyRedacted: input.plan?.sceneAnchorErrorBodyRedacted ?? null,
    sceneAnchorPayloadFieldNames: input.plan?.sceneAnchorPayloadFieldNames ?? null,
    sceneAnchorReferenceCount: input.plan?.sceneAnchorReferenceCount ?? null,
    sceneAnchorSubmittedReferenceCount: input.plan?.sceneAnchorSubmittedReferenceCount ?? null,
    sceneAnchorReferenceRolesUsed: input.plan?.sceneAnchorReferenceRolesUsed ?? null,
    sceneAnchorDroppedReferenceRoles: input.plan?.sceneAnchorDroppedReferenceRoles ?? null,
    sceneAnchorProviderReferenceLimit: input.plan?.sceneAnchorProviderReferenceLimit ?? null,
    sceneAnchorOutputParsed: input.plan?.sceneAnchorOutputParsed ?? null,
    primaryInputType: input.plan?.primaryInputType ?? null,
    primaryVideoInputType: input.plan?.primaryVideoInputType ?? null,
    primaryVideoInputSource: input.plan?.primaryVideoInputSource ?? null,
    identityReferencesPassedToVideoStage: Boolean(input.plan?.identityReferencesPassedToVideoStage),
    identityReferenceCount: input.plan?.identityReferenceCount ?? references.length,
    identityReferenceMode: input.plan?.identityReferenceMode ?? null,
    startFrameSource: input.plan?.startFrameSource ?? null,
    posterFrameSource: input.plan?.posterFrameSource ?? null,
    firstFrameSource: input.plan?.firstFrameSource ?? null,
    stage2ProviderModel: input.plan?.stage2ProviderModel ?? null,
    stage2ProviderRouteType: input.plan?.stage2ProviderRouteType ?? null,
    rawReferenceVisualInputsSentToStage2: Boolean(input.plan?.rawReferenceVisualInputsSentToStage2),
    referenceRolesUsed: references.map((reference) => reference.role),
    referenceCount: references.length,
    primaryReferenceRole: input.plan?.primaryReferenceRole ?? null,
    supportingReferenceRoles,
    usedMultiReferencePlan: references.length > 1 && input.referenceStrategy !== 'front_only_fallback',
    fellBackToFrontOnly,
    compositionNeutralized: Boolean(input.plan?.compositionNeutralized),
    userSpecifiedOutfit: Boolean(input.plan?.userSpecifiedOutfit),
    outfitTermsDetected: input.plan?.outfitTermsDetected ?? [],
    referenceOutfitCarryoverSuppressed: Boolean(input.plan?.referenceOutfitCarryoverSuppressed),
    compositionCarryoverSuppressed: Boolean(input.plan?.compositionCarryoverSuppressed),
    riskyReferenceArtifacts: input.plan?.riskyReferenceArtifacts ?? [],
    environmentTermsDetected: input.plan?.environmentTermsDetected ?? [],
    frontOnlyFallback: Boolean(input.plan?.frontOnlyFallback),
    carryoverSuppressionApplied: Boolean(
      input.plan?.referenceOutfitCarryoverSuppressed ||
      input.plan?.compositionCarryoverSuppressed,
    ),
    referencePurpose: 'identity_only',
    exactLikenessRoute: input.exactLikenessRoute,
    exactProvider: input.exactLikenessRoute === 'kling_reference' ? 'kling' : null,
    providerRoute: input.providerRoute,
    sceneAnchorConfigured: sceneAnchorProviderStatus().configured,
    lastRenderReferenceStrategy: input.referenceStrategy,
    audioConfigured: false,
    viralPresetUsed: input.viralPresetUsed ?? null,
    promptPolished: Boolean(input.promptPolished),
    privateUrlsRedacted: true,
    referenceUrlLabels: references.map((_reference, index) => safeUrlLabel(index)),
  };
}

function uniqueHttpUrls(values: string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((url) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function seedanceReferenceImages(body: GenerateVideoBody): string[] {
  const urls = referenceUrlMap(body.referenceImageUrls);
  const explicitReferences = Array.isArray(body.referenceImages)
    ? body.referenceImages.map(publicImageUrl)
    : [];
  const canonicalReferences = Array.isArray(body.canonicalReferenceSet)
    ? body.canonicalReferenceSet.map(publicImageUrl)
    : [];

  return uniqueHttpUrls([
    urls.frontFace,
    urls.leftAngle,
    urls.rightAngle,
    urls.fullBody,
    ...explicitReferences,
    ...canonicalReferences,
  ]);
}

function normalizeAspectRatio(value: unknown): string {
  const aspectRatio = textValue(value);
  return ['9:16', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '9:16';
}

function normalizeDuration(value: unknown): number {
  const duration = typeof value === 'number'
    ? value
    : Number.parseInt(textValue(value), 10);

  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 8;
}

export function buildKlingVideoStageRequestInput(input: {
  prompt: string;
  startImageUrl: string;
  additionalReferences?: string[];
  identityReferencesPassedToVideoStage?: boolean;
}) {
  const additionalReferences = input.identityReferencesPassedToVideoStage === false
    ? []
    : input.additionalReferences ?? [];

  return {
    prompt: input.prompt,
    start_image: input.startImageUrl,
    ...(additionalReferences.length ? { reference_images: additionalReferences } : {}),
  };
}

function isSeedanceEngine(body: GenerateVideoBody): boolean {
  const engine = textValue(body.engine).toLowerCase();
  return engine === 'seedance-2.0' || engine === 'seedance';
}

export function isKlingExactLikenessRequest(input: {
  engine: string;
  exactLikenessRoute?: string;
  exactLikenessReady?: boolean;
  exactLikenessCanaryStatus?: string;
}) {
  return (
    input.engine === 'replicate' &&
    input.exactLikenessRoute === 'kling_reference' &&
    (input.exactLikenessReady === true || input.exactLikenessCanaryStatus === 'canary_succeeded')
  );
}

export function buildFinalPrompt(input: {
  prompt: string;
  characterDescription: string;
  identityPrompt: string;
  consistencyPrompt: string;
  engine: string;
  style: string;
  camera: string;
  mood: string;
  aspectRatio: string;
  exactLikenessRoute?: string;
  exactLikenessReady?: boolean;
  exactLikenessCanaryStatus?: string;
}) {
  const klingExactLikeness = isKlingExactLikenessRequest(input);
  const consistencyPrompt = klingExactLikeness
    ? KLING_EXACT_LIKENESS_CONSISTENCY_PROMPT
    : input.consistencyPrompt || (input.engine === 'seedance-2.0'
      ? SEEDANCE_IDENTITY_PROMPT
      : 'Create a new photorealistic character render based on the provided identity references. Do not simply animate or copy the source photo. Use the references only to preserve identity: face shape, hair color, hairstyle, skin tone, eye area, proportions, makeup style, and overall likeness. Place this same person into the requested new scene.');

  return [
    klingExactLikeness ? KLING_EXACT_LIKENESS_PROMPT_PREFIX : SAFE_IDENTITY_PROMPT_PREFIX,
    sanitizePromptText(consistencyPrompt),
    input.identityPrompt ? `Identity prompt: ${sanitizePromptText(input.identityPrompt)}` : '',
    sanitizePromptText(`${input.characterDescription} ${input.prompt}`.trim()),
    input.style ? `Style: ${sanitizePromptText(input.style)}` : '',
    input.camera ? `Camera: ${sanitizePromptText(input.camera)}` : '',
    input.mood ? `Mood: ${sanitizePromptText(input.mood)}` : '',
    input.aspectRatio === '9:16' ? 'vertical video' : `${input.aspectRatio} video`,
    'Cinematic lighting, realistic motion, high detail.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.toString();
  return null;
}

async function outputUrl(output: unknown): Promise<string | null> {
  const directUrl = maybeUrl(output);
  if (directUrl) return directUrl;

  if (Array.isArray(output)) {
    for (const item of output) {
      const itemUrl = await outputUrl(item);
      if (itemUrl) return itemUrl;
    }
    return null;
  }

  if (!output || typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  for (const key of ['videoUrl', 'video', 'output', 'url']) {
    const value = record[key];
    const url = maybeUrl(value);
    if (url) return url;

    if (typeof value === 'function') {
      try {
        const resolvedValue = await value.call(output);
        const resolvedUrl = maybeUrl(resolvedValue) ?? await outputUrl(resolvedValue);
        if (resolvedUrl) return resolvedUrl;
      } catch (error) {
        console.warn('Unable to read Replicate output URL:', error);
      }
    }

    if (value && typeof value === 'object') {
      const nestedUrl = await outputUrl(value);
      if (nestedUrl) return nestedUrl;
    }
  }

  return null;
}

function modelErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes('credit') || lower.includes('billing') || lower.includes('payment')) {
    return 'Replicate generation failed because billing, credits, or payment setup needs attention.';
  }
  return message;
}

function isBillingOrCreditError(error: unknown): boolean {
  const lower = JSON.stringify(safeJsonValue(error) ?? '').toLowerCase();
  return lower.includes('credit') || lower.includes('billing') || lower.includes('payment');
}

function isSensitiveFilterError(error: unknown): boolean {
  const lower = [
    errorMessage(error),
    JSON.stringify(safeJsonValue(error) ?? ''),
  ].join(' ').toLowerCase();

  return (
    lower.includes('flagged as sensitive') ||
    lower.includes('e005') ||
    lower.includes('sensitive')
  );
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function retryAfterMillisecondsFromValue(value: unknown): number | null {
  const seconds = numericValue(value);
  if (seconds !== null && seconds >= 0) return Math.ceil(seconds * 1_000);

  if (typeof value === 'string' && value.trim()) {
    const retryDate = Date.parse(value);
    if (Number.isFinite(retryDate)) {
      return Math.max(0, retryDate - Date.now());
    }
  }

  return null;
}

function headerRetryAfterMilliseconds(headers: unknown): number | null {
  if (!headers) return null;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const retryAfter = getter.call(headers, 'retry-after') ?? getter.call(headers, 'Retry-After');
    const parsed = retryAfterMillisecondsFromValue(retryAfter);
    if (parsed !== null) return parsed;
  }

  const headerRecord = objectRecord(headers);
  return retryAfterMillisecondsFromValue(
    headerRecord['retry-after'] ??
      headerRecord['Retry-After'] ??
      headerRecord.retry_after ??
      headerRecord.retryAfter,
  );
}

function retryAfterMilliseconds(error: unknown): number | null {
  const record = objectRecord(error);
  const response = objectRecord(record.response);
  const details = objectRecord(record.details);
  const detailError = objectRecord(details.error);
  const detailResponse = objectRecord(detailError.response);

  const directCandidates = [
    record.retry_after,
    record.retryAfter,
    record.retryAfterSeconds,
    record['retry-after'],
    response.retry_after,
    response.retryAfter,
    response.retryAfterSeconds,
    response['retry-after'],
    detailError.retry_after,
    detailError.retryAfter,
    detailError.retryAfterSeconds,
    detailError['retry-after'],
    detailResponse.retry_after,
    detailResponse.retryAfter,
    detailResponse.retryAfterSeconds,
    detailResponse['retry-after'],
  ];

  for (const candidate of directCandidates) {
    const parsed = retryAfterMillisecondsFromValue(candidate);
    if (parsed !== null) return parsed;
  }

  const serializedError = JSON.stringify(safeJsonValue(error) ?? '');
  const serializedRetryAfter = serializedError.match(/retry[_ -]?after["'\s:=]+(\d+(?:\.\d+)?)/i);
  if (serializedRetryAfter?.[1]) {
    const parsed = retryAfterMillisecondsFromValue(serializedRetryAfter[1]);
    if (parsed !== null) return parsed;
  }

  return (
    headerRetryAfterMilliseconds(record.headers) ??
    headerRetryAfterMilliseconds(response.headers) ??
    headerRetryAfterMilliseconds(detailError.headers) ??
    headerRetryAfterMilliseconds(detailResponse.headers)
  );
}

function errorStatusCode(error: unknown): number | null {
  const record = objectRecord(error);
  const response = objectRecord(record.response);
  const details = objectRecord(record.details);
  const detailError = objectRecord(details.error);
  const detailResponse = objectRecord(detailError.response);

  for (const candidate of [
    record.status,
    record.statusCode,
    record.code,
    response.status,
    response.statusCode,
    detailError.status,
    detailError.statusCode,
    detailError.code,
    detailResponse.status,
    detailResponse.statusCode,
  ]) {
    const numeric = numericValue(candidate);
    if (numeric !== null) return numeric;
  }

  return null;
}

function isRateLimitError(error: unknown): boolean {
  const lower = [
    errorMessage(error),
    JSON.stringify(safeJsonValue(error) ?? ''),
  ].join(' ').toLowerCase();

  return (
    errorStatusCode(error) === 429 ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('throttl')
  );
}

function klingGenerationErrorCategory(error: unknown): string {
  const lower = [
    errorMessage(error),
    JSON.stringify(safeJsonValue(error) ?? ''),
  ].join(' ').toLowerCase();
  const statusCode = errorStatusCode(error);

  if (isBillingOrCreditError(error)) return 'kling_billing_required';
  if (isSensitiveFilterError(error)) return 'kling_provider_safety_filter';
  if (lower.includes('scene_anchor_video_model_not_configured')) return 'kling_scene_anchor_video_model_not_configured';
  if (lower.includes('scene_anchor_video_model_unsupported')) return 'kling_scene_anchor_video_model_unsupported';
  if (lower.includes('scene_anchor_video_output_missing')) return 'kling_scene_anchor_video_output_missing';
  if (lower.includes('scene_anchor_video_poll_failed')) return 'kling_scene_anchor_video_poll_failed';
  if (statusCode === 400 || statusCode === 422 || lower.includes('invalid input') || lower.includes('validation')) {
    return 'kling_input_schema';
  }
  if (statusCode === 429 || isRateLimitError(error)) return 'kling_rate_limited';
  if (
    (statusCode !== null && statusCode >= 500) ||
    lower.includes('temporarily unavailable') ||
    lower.includes('provider unavailable') ||
    lower.includes('upstream unavailable')
  ) {
    return 'kling_provider_unavailable';
  }

  return 'kling_provider_failed';
}

function uniqueModels(models: ReplicateModelIdentifier[]): ReplicateModelIdentifier[] {
  return Array.from(new Set(models));
}

function isValidHttpUrl(url: string) {
  return typeof url === 'string' &&
    url.startsWith('https://');
}

async function validateReferenceImageUrl(referenceImageUrl: string): Promise<{
  ok: boolean;
  status: number | null;
  contentType: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    console.log('VALIDATING REFERENCE URL', { hasReferenceImage: Boolean(referenceImageUrl), method: 'HEAD', privateUrlsRedacted: true });
    const response = await fetch(referenceImageUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const validation = {
      ok: response.status === 200 && contentType.toLowerCase().startsWith('image/'),
      status: response.status,
      contentType,
    };

    console.log('VALIDATION RESULT', {
      status: validation.status,
      contentType: validation.contentType,
      ok: validation.ok,
      privateUrlsRedacted: true,
    });

    return validation;
  } catch (error) {
    console.log('VALIDATION RESULT', {
      ok: false,
      error: errorMessage(error),
      privateUrlsRedacted: true,
    });

    return {
      ok: false,
      status: null,
      contentType: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function enqueueReplicatePrediction<T>(operation: () => Promise<T>): Promise<T> {
  const queue = lumoraGenerationGlobals.__lumoraReplicatePredictionQueue ?? Promise.resolve();
  const queuedOperation = queue.then(operation, operation);
  lumoraGenerationGlobals.__lumoraReplicatePredictionQueue = queuedOperation.then(
    () => undefined,
    () => undefined,
  );
  return queuedOperation;
}

async function runReplicate(input: {
  replicate: ReplicateClient;
  model: ReplicateModelIdentifier;
  requestInput: Record<string, unknown>;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  referenceImageUrl: string;
  fallbackToStartImageOnly?: boolean;
}) {
  console.log('LUMORA PROVIDER', {
    provider: 'replicate',
    model: input.model,
    mode: input.generationModeUsed,
    inputKeys: Object.keys(input.requestInput),
  });

  if (input.generationModeUsed === 'seedance-multimodal-reference') {
    console.log('SEEDANCE INPUT', {
      inputKeys: Object.keys(input.requestInput),
      referenceCount: Array.isArray(input.requestInput.reference_images)
        ? input.requestInput.reference_images.length
        : 0,
      privateUrlsRedacted: true,
    });
  } else if (input.generationModeUsed) {
    console.log('SENDING IMAGE TO KLING:', {
      hasReferenceImage: Boolean(input.referenceImageUrl),
      privateUrlsRedacted: true,
    });
  }

  const attempts: unknown[] = [];
  const shouldTryStartImageOnly =
    input.fallbackToStartImageOnly === true &&
    Array.isArray(input.requestInput.reference_images) &&
    input.requestInput.reference_images.length > 0;
  const requestInputs = shouldTryStartImageOnly
    ? [
        input.requestInput,
        Object.fromEntries(
          Object.entries(input.requestInput).filter(([key]) => key !== 'reference_images'),
        ),
      ]
    : [input.requestInput];

  for (const [index, requestInput] of requestInputs.entries()) {
    try {
      const output = await enqueueReplicatePrediction(() =>
        input.replicate.run(input.model, { input: requestInput }),
      );
      if (input.generationModeUsed === 'seedance-multimodal-reference') {
        console.log('SEEDANCE RESPONSE', safeJsonValue(output));
      }
      const videoUrl = await outputUrl(output);
      if (!videoUrl) {
        throw new Error(`No video URL returned. Raw output: ${JSON.stringify(safeJsonValue(output))}`);
      }

      attempts.push({
        model: input.model,
        inputKeys: Object.keys(requestInput),
        success: true,
      });

      return {
        videoUrl,
        model: input.model,
        rawOutput: output,
        attempts,
        durationSent: input.durationSent,
        finalInputKeys: Object.keys(requestInput),
      } satisfies ReplicateRunResult;
    } catch (error) {
      const rateLimited = isRateLimitError(error);
      const retryAfterMs = retryAfterMilliseconds(error);
      console.error('REPLICATE ERROR:', error);
      if (rateLimited) {
        console.warn('THROTTLED:', {
          model: input.model,
          status: errorStatusCode(error) ?? 429,
          retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
        });
      }
      attempts.push({
        model: input.model,
        inputKeys: Object.keys(requestInput),
        success: false,
        rateLimited,
        retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
        details: safeJsonValue(error),
      });

      if (rateLimited) {
        throw Object.assign(new Error(modelErrorMessage(error)), {
          provider: 'replicate',
          model: input.model,
          rateLimited: true,
          retryAfterMs,
          retryAfterSeconds: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
          details: {
            error: safeJsonValue(error),
            attempts,
          },
        });
      }

      if (index < requestInputs.length - 1) {
        console.warn('Kling rejected reference_images; retrying with start_image only.');
        continue;
      }

      throw Object.assign(new Error(modelErrorMessage(error)), {
        provider: 'replicate',
        model: input.model,
        details: {
          error: safeJsonValue(error),
          attempts,
        },
      });
    }
  }

  throw new Error('Replicate generation failed without a completed attempt.');
}

async function runReplicateWithRateLimitRetry(input: {
  replicate: ReplicateClient;
  model: ReplicateModelIdentifier;
  requestInput: Record<string, unknown>;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  referenceImageUrl: string;
  fallbackToStartImageOnly?: boolean;
}) {
  try {
    return await runReplicate(input);
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    const retryAfterMs = retryAfterMilliseconds(error) ?? DEFAULT_REPLICATE_RETRY_AFTER_MS;
    console.log('WAITING:', {
      reason: 'replicate-429',
      model: input.model,
      milliseconds: retryAfterMs,
      seconds: retryAfterMs / 1_000,
    });
    await sleep(retryAfterMs);
    console.warn('RETRYING MODEL:', {
      model: input.model,
      mode: input.generationModeUsed,
    });

    return await runReplicate(input);
  }
}

async function runKlingImageToVideo(input: {
  replicate: ReplicateClient;
  prompt: string;
  referenceImageUrl: string;
  additionalReferences: string[];
  primaryModel?: ReplicateModelIdentifier;
  durationSent: number | null;
  generationModeUsed: GenerationModeUsed;
  fallbackFromModel?: ReplicateModelIdentifier;
  providerFallback?: boolean;
  safetyFallback?: boolean;
  fallbackToStartImageOnly?: boolean;
  identityReferencesPassedToVideoStage?: boolean;
}) {
  const models = uniqueModels([
    input.primaryModel ?? KLING_IMAGE_TO_VIDEO_MODEL,
    KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
  ]);
  const failures: Array<{
    model: ReplicateModelIdentifier;
    safetyFiltered: boolean;
    details: unknown;
  }> = [];

  for (const [modelIndex, model] of models.entries()) {
    const isFirstProviderFallback = (input.providerFallback === true || input.safetyFallback === true) && modelIndex === 0;
    if (isFirstProviderFallback) {
      console.warn('SWITCHING PROVIDER:', {
        from: input.fallbackFromModel ?? SEEDANCE_MODEL,
        to: model,
      });
      console.log('WAITING:', {
        reason: 'kling-v2.1-fallback',
        milliseconds: KLING_FALLBACK_DELAY_MS,
        seconds: KLING_FALLBACK_DELAY_MS / 1_000,
      });
      await sleep(KLING_FALLBACK_DELAY_MS);
    } else if (modelIndex > 0) {
      console.warn('SWITCHING PROVIDER:', {
        from: models[modelIndex - 1],
        to: model,
      });
      console.log('WAITING:', {
        reason: 'kling-v2.5-fallback',
        milliseconds: KLING_SECONDARY_FALLBACK_DELAY_MS,
        seconds: KLING_SECONDARY_FALLBACK_DELAY_MS / 1_000,
      });
      await sleep(KLING_SECONDARY_FALLBACK_DELAY_MS);
    }

    const requestInput = buildKlingVideoStageRequestInput({
      prompt: input.prompt,
      startImageUrl: input.referenceImageUrl,
      additionalReferences: input.additionalReferences,
      identityReferencesPassedToVideoStage: input.identityReferencesPassedToVideoStage,
    });

    try {
      return await runReplicateWithRateLimitRetry({
        replicate: input.replicate,
        model,
        requestInput,
        durationSent: input.durationSent,
        generationModeUsed: input.generationModeUsed,
        referenceImageUrl: input.referenceImageUrl,
        fallbackToStartImageOnly: input.fallbackToStartImageOnly ?? true,
      });
    } catch (error) {
      failures.push({
        model,
        safetyFiltered: isSensitiveFilterError(error),
        details: safeJsonValue(error),
      });
      console.warn('Kling image-to-video attempt failed', {
        model,
        safetyFiltered: isSensitiveFilterError(error),
        providerFallback: input.providerFallback ?? input.safetyFallback ?? false,
      });
    }
  }

  if (failures.length > 0 && failures.every((failure) => failure.safetyFiltered)) {
    throw Object.assign(new Error(SENSITIVE_FILTER_ERROR), {
      provider: 'replicate',
      model: failures[failures.length - 1]?.model ?? KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
      safetyFiltered: true,
      details: { attempts: failures },
    });
  }

  throw Object.assign(new Error('Kling image-to-video generation failed.'), {
    provider: 'replicate',
    model: failures[failures.length - 1]?.model ?? KLING_IMAGE_TO_VIDEO_FALLBACK_MODEL,
    details: { attempts: failures },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('LUMORA GENERATE START');

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    let body: GenerateVideoBody;
    try {
      body = await readBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: 'Invalid JSON body',
        details: safeJsonValue(error),
      });
    }

    const prompt = textValue(body.prompt);
    if (!prompt) {
      return sendJson(res, 400, { error: 'Missing prompt' });
    }

    const token = process.env.REPLICATE_API_TOKEN;

    const generationUserKey = activeGenerationUserKey(body);
    if (!acquireActiveGeneration(generationUserKey)) {
      return sendJson(res, 409, {
        error: PROVIDER_QUEUE_BUSY_MESSAGE,
      });
    }

    try {
    const engine = textValue(body.engine).toLowerCase() || 'replicate';
    const useSeedance = SINGLE_PROVIDER_MODE ? false : isSeedanceEngine(body);
    const seedanceReferences = seedanceReferenceImages(body);
    const primaryReferenceImageUrl = useSeedance
      ? seedanceReferences[0] ?? ''
      : firstReferenceImageUrl(body, { includeKeyframe: false });
    const keyframeUrl = publicImageUrl(body.keyframeUrl);
    const referenceImageUrl = SINGLE_PROVIDER_MODE
      ? keyframeUrl || primaryReferenceImageUrl
      : useSeedance
        ? primaryReferenceImageUrl
        : firstReferenceImageUrl(body);
    const exactLikenessRoute = textValue(body.exactLikenessRoute);
    const exactLikenessCanaryStatus = textValue(body.exactLikenessCanaryStatus);
    const exactLikenessReady = booleanValue(body.exactLikenessReady) || exactLikenessCanaryStatus === 'canary_succeeded';
    const viralPresetUsed = textValue(body.viralPresetUsed) || null;
    const promptPolished = booleanValue(body.promptPolished);
    const klingExactLikenessRequest = isKlingExactLikenessRequest({
      engine: 'replicate',
      exactLikenessRoute,
      exactLikenessReady,
      exactLikenessCanaryStatus,
    });
    let klingReferencePlan = klingExactLikenessRequest
      ? buildKlingCreateReferencePlan({
          body,
          primaryReference: primaryReferenceImageUrl || referenceImageUrl,
          exactLikenessReady,
        })
      : null;
    const sceneAnchorProviderReadiness = sceneAnchorProviderStatus();
    const sceneAnchorVideoReadiness = klingReferencePlan?.sceneAnchorRequired
      ? klingSceneAnchorVideoModelStatus()
      : null;
    if (
      klingReferencePlan?.sceneAnchorRequired &&
      !booleanValue(body.allowIdentityOnlyKlingFallback) &&
      sceneAnchorProviderReadiness.configured &&
      sceneAnchorProviderReadiness.implemented &&
      !sceneAnchorVideoReadiness?.configured
    ) {
      const videoFailureCategory =
        sceneAnchorVideoReadiness?.failureCategory ?? 'kling_scene_anchor_video_model_not_configured';
      return sendJson(res, 424, {
        success: false,
        error: videoFailureCategory === 'kling_scene_anchor_video_model_not_configured'
          ? 'Scene anchor video model is not configured.'
          : 'Scene anchor video model is not supported yet.',
        errorCategory: videoFailureCategory,
        providerStatus: 'scene_anchor_video_model_unavailable',
        displayEngine: 'Kling exact likeness',
        generationMode: 'kling-exact-likeness-reference',
        exactLikenessRoute: 'kling_reference',
        exactLikenessAvailable: true,
        sceneAnchorStrategy: klingReferencePlan.sceneAnchorStrategy,
        sceneAnchorEnabled: sceneAnchorProviderReadiness.sceneAnchorEnabled,
        sceneAnchorModel: sceneAnchorProviderReadiness.model,
        sceneAnchorGenerated: false,
        sceneAnchorPersisted: false,
        sceneAnchorProvider: sceneAnchorProviderReadiness.provider,
        sceneAnchorReason: sceneAnchorVideoReadiness?.reason ?? 'kling_scene_anchor_video_model_missing',
        sceneAnchorFailureCategory: videoFailureCategory,
        primaryInputType: klingReferencePlan.primaryInputType,
        primaryVideoInputType: 'scene_anchor',
        primaryVideoInputSource: 'scene_anchor',
        identityReferencesPassedToVideoStage: false,
        identityReferenceCount: klingReferencePlan.references.length,
        identityReferenceMode: 'stage1_only',
        startFrameSource: 'scene_anchor',
        posterFrameSource: 'video_frame',
        firstFrameSource: 'scene_anchor',
        stage2ProviderModel: sceneAnchorVideoReadiness?.model ?? null,
        stage2ProviderRouteType: 'image_to_video',
        rawReferenceVisualInputsSentToStage2: false,
        frontOnlyFallback: false,
        referenceStrategy: klingReferencePlan.plannedStrategy,
        referenceRolesUsed: klingReferencePlan.references.map((reference) => reference.role),
        referenceCount: klingReferencePlan.references.length,
        sceneIntent: klingReferencePlan.sceneIntent,
        framingIntent: klingReferencePlan.framingIntent,
        primaryReferenceRole: klingReferencePlan.primaryReferenceRole,
        supportingReferenceRoles: klingReferencePlan.supportingReferenceRoles,
        userSpecifiedOutfit: klingReferencePlan.userSpecifiedOutfit,
        outfitTermsDetected: klingReferencePlan.outfitTermsDetected,
        environmentTermsDetected: klingReferencePlan.environmentTermsDetected,
        referenceOutfitCarryoverSuppressed: klingReferencePlan.referenceOutfitCarryoverSuppressed,
        compositionCarryoverSuppressed: klingReferencePlan.compositionCarryoverSuppressed,
        audioConfigured: false,
        viralPresetUsed,
        promptPolished,
        klingReferenceDiagnostics: klingReferenceDiagnostics({
          plan: klingReferencePlan,
          referenceStrategy: klingReferencePlan.plannedStrategy,
          exactLikenessRoute: 'kling_reference',
          providerRoute: 'fal_kling_scene_anchor_image_to_video',
          viralPresetUsed,
          promptPolished,
        }),
        recommendedNextAction: 'Configure KLING_SCENE_ANCHOR_VIDEO_MODEL or explicitly choose identity-only Kling fallback.',
        privateUrlsRedacted: true,
      });
    }
    klingReferencePlan = await prepareKlingCreateReferencePlanForProvider({
      plan: klingReferencePlan,
      userId: (textValue(body.userId) || generationUserKey || 'local').replace(/[^a-zA-Z0-9_-]/g, '-'),
      allowIdentityOnlyFallback: booleanValue(body.allowIdentityOnlyKlingFallback),
    });
    const providerReferenceImageUrl = klingReferencePlan?.providerPrimaryReference.url ?? referenceImageUrl;
    const additionalReferences = klingReferencePlan
      ? klingReferencePlan?.providerAdditionalReferences.map((reference) => reference.url) ?? []
      : additionalReferenceImageUrls(body, referenceImageUrl);
    const identityReferencesPassedToVideoStage = klingReferencePlan
      ? klingReferencePlan.identityReferencesPassedToVideoStage
      : additionalReferences.length > 0;
    const responseReferenceImageUrl = klingReferencePlan?.primaryReference.url ?? providerReferenceImageUrl;
    const responseAdditionalReferenceImageUrls = klingReferencePlan
      ? klingReferencePlan.additionalReferences.map((reference) => reference.url)
      : additionalReferences;
    const referencesToValidate = klingReferencePlan?.validationReferences ?? [
      { role: 'front_angle' as const, label: 'reference', url: providerReferenceImageUrl, token: '@Element1' },
      ...additionalReferences.map((url, index) => ({
        role: 'additional_reference' as const,
        label: `reference ${index + 2}`,
        url,
        token: `@Element${index + 2}`,
      })),
    ];
    const sceneAnchorImageToVideoStageActive = Boolean(
      klingReferencePlan?.sceneAnchorGenerated &&
      klingReferencePlan.sceneAnchorPersisted &&
      klingReferencePlan.primaryVideoInputType === 'scene_anchor' &&
      klingReferencePlan.stage2ProviderRouteType === 'image_to_video',
    );
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const durationSent = normalizeDuration(body.duration);
    const finalPrompt = buildFinalPrompt({
      prompt: klingReferencePlan?.promptGuidance
        ? `${prompt}\n\nKling identity guidance: ${klingReferencePlan.promptGuidance}`
        : prompt,
      characterDescription: textValue(body.characterDescription),
      identityPrompt: textValue(body.identityPrompt),
      consistencyPrompt: textValue(body.consistencyPrompt) || textValue(body.generationConsistencyPrompt),
      engine: SINGLE_PROVIDER_MODE ? 'replicate' : engine,
      style: textValue(body.style),
      camera: textValue(body.camera),
      mood: textValue(body.mood),
      aspectRatio,
      exactLikenessRoute,
      exactLikenessReady,
      exactLikenessCanaryStatus,
    });
    const promptForModel = finalPrompt;

    console.log('FINAL INPUT:', {
      prompt: promptForModel,
      hasReferenceImage: Boolean(referenceImageUrl),
      hasKeyframeUrl: Boolean(keyframeUrl),
      additionalReferenceCount: additionalReferences.length,
      seedanceReferenceCount: seedanceReferences.length,
      engine,
      exactLikenessRoute,
      exactLikenessReady,
      referenceStrategy: klingReferencePlan?.plannedStrategy ?? null,
      sceneAnchorStrategy: klingReferencePlan?.sceneAnchorStrategy ?? null,
      sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
      sceneAnchorModel: sceneAnchorProviderStatus().model,
      sceneAnchorGenerated: Boolean(klingReferencePlan?.sceneAnchorGenerated),
      sceneAnchorPersisted: Boolean(klingReferencePlan?.sceneAnchorPersisted),
      sceneAnchorProvider: klingReferencePlan?.sceneAnchorProvider ?? null,
      sceneAnchorFailureCategory: klingReferencePlan?.sceneAnchorFailureCategory ?? null,
      sceneAnchorValidation: klingReferencePlan?.sceneAnchorValidation ?? null,
      primaryInputType: klingReferencePlan?.primaryInputType ?? null,
      userSpecifiedOutfit: Boolean(klingReferencePlan?.userSpecifiedOutfit),
      outfitTermsDetected: klingReferencePlan?.outfitTermsDetected ?? [],
      environmentTermsDetected: klingReferencePlan?.environmentTermsDetected ?? [],
      compositionCarryoverSuppressed: Boolean(klingReferencePlan?.compositionCarryoverSuppressed),
      sceneIntent: klingReferencePlan?.sceneIntent ?? [],
      framingIntent: klingReferencePlan?.framingIntent ?? null,
      primaryReferenceRole: klingReferencePlan?.primaryReferenceRole ?? null,
      primaryVideoInputType: klingReferencePlan?.primaryVideoInputType ?? null,
      primaryVideoInputSource: klingReferencePlan?.primaryVideoInputSource ?? null,
      identityReferencesPassedToVideoStage,
      identityReferenceCount: klingReferencePlan?.identityReferenceCount ?? additionalReferences.length + 1,
      startFrameSource: klingReferencePlan?.startFrameSource ?? null,
      posterFrameSource: klingReferencePlan?.posterFrameSource ?? null,
      firstFrameSource: klingReferencePlan?.firstFrameSource ?? null,
      stage2ProviderModel: klingReferencePlan?.stage2ProviderModel ?? null,
      stage2ProviderRouteType: klingReferencePlan?.stage2ProviderRouteType ?? null,
      rawReferenceVisualInputsSentToStage2: Boolean(klingReferencePlan?.rawReferenceVisualInputsSentToStage2),
      referenceRolesUsed: klingReferencePlan?.references.map((reference) => reference.role) ?? [],
      privateUrlsRedacted: true,
    });

    if (klingReferencePlan?.sceneAnchorRequired && !klingReferencePlan.sceneAnchorGenerated) {
      const sceneAnchorFailureCategory =
        klingReferencePlan.sceneAnchorFailureCategory ??
        (klingReferencePlan.sceneAnchorReason === 'scene_anchor_generation_failed'
          ? 'scene_anchor_generation_failed'
          : 'scene_anchor_provider_not_configured');
      const errorCategory = sceneAnchorFailureCategory;
      return sendJson(res, 424, {
        success: false,
        error: klingReferencePlan.sceneAnchorFailureReason ||
          'Scene anchor generation failed. Retry scene anchor, use identity-only fallback, or edit scene.',
        errorCategory,
        providerStatus: 'scene_anchor_unavailable',
        displayEngine: 'Kling exact likeness',
        generationMode: 'kling-exact-likeness-reference',
        exactLikenessRoute: 'kling_reference',
        exactLikenessAvailable: true,
        sceneAnchorStrategy: klingReferencePlan.sceneAnchorStrategy,
        sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
        sceneAnchorModel: sceneAnchorProviderStatus().model,
        sceneAnchorGenerated: false,
        sceneAnchorPersisted: Boolean(klingReferencePlan.sceneAnchorPersisted),
        sceneAnchorProvider: klingReferencePlan.sceneAnchorProvider,
        sceneAnchorReason: klingReferencePlan.sceneAnchorReason,
        sceneAnchorFailureCategory,
        sceneAnchorHttpStatus: klingReferencePlan.sceneAnchorHttpStatus,
        sceneAnchorErrorType: klingReferencePlan.sceneAnchorErrorType,
        sceneAnchorErrorMessage: klingReferencePlan.sceneAnchorErrorMessage,
        sceneAnchorErrorBodyRedacted: klingReferencePlan.sceneAnchorErrorBodyRedacted,
        sceneAnchorPayloadFieldNames: klingReferencePlan.sceneAnchorPayloadFieldNames,
        sceneAnchorReferenceCount: klingReferencePlan.sceneAnchorReferenceCount,
        sceneAnchorSubmittedReferenceCount: klingReferencePlan.sceneAnchorSubmittedReferenceCount,
        sceneAnchorReferenceRolesUsed: klingReferencePlan.sceneAnchorReferenceRolesUsed,
        sceneAnchorDroppedReferenceRoles: klingReferencePlan.sceneAnchorDroppedReferenceRoles,
        sceneAnchorProviderReferenceLimit: klingReferencePlan.sceneAnchorProviderReferenceLimit,
        sceneAnchorOutputParsed: klingReferencePlan.sceneAnchorOutputParsed,
        sceneAnchorValidation: klingReferencePlan.sceneAnchorValidation,
        primaryInputType: klingReferencePlan.primaryInputType,
        primaryVideoInputType: klingReferencePlan.primaryVideoInputType,
        primaryVideoInputSource: klingReferencePlan.primaryVideoInputSource,
        identityReferencesPassedToVideoStage: klingReferencePlan.identityReferencesPassedToVideoStage,
        identityReferenceCount: klingReferencePlan.identityReferenceCount,
        identityReferenceMode: klingReferencePlan.identityReferenceMode,
        startFrameSource: klingReferencePlan.startFrameSource,
        posterFrameSource: klingReferencePlan.posterFrameSource,
        firstFrameSource: klingReferencePlan.firstFrameSource,
        frontOnlyFallback: false,
        referenceStrategy: klingReferencePlan.plannedStrategy,
        referenceRolesUsed: klingReferencePlan.references.map((reference) => reference.role),
        referenceCount: klingReferencePlan.references.length,
        sceneIntent: klingReferencePlan.sceneIntent,
        framingIntent: klingReferencePlan.framingIntent,
        primaryReferenceRole: klingReferencePlan.primaryReferenceRole,
        supportingReferenceRoles: klingReferencePlan.supportingReferenceRoles,
        userSpecifiedOutfit: klingReferencePlan.userSpecifiedOutfit,
        outfitTermsDetected: klingReferencePlan.outfitTermsDetected,
        environmentTermsDetected: klingReferencePlan.environmentTermsDetected,
        referenceOutfitCarryoverSuppressed: klingReferencePlan.referenceOutfitCarryoverSuppressed,
        compositionCarryoverSuppressed: klingReferencePlan.compositionCarryoverSuppressed,
        audioConfigured: false,
        viralPresetUsed,
        promptPolished,
        klingReferenceDiagnostics: klingReferenceDiagnostics({
          plan: klingReferencePlan,
          referenceStrategy: klingReferencePlan.plannedStrategy,
          exactLikenessRoute: 'kling_reference',
          providerRoute: 'fal_scene_anchor_image_generation',
          viralPresetUsed,
          promptPolished,
        }),
        recommendedNextAction: sceneAnchorFailureCategory === 'scene_anchor_input_schema' ||
          sceneAnchorFailureCategory === 'scene_anchor_model_schema_unmapped'
          ? 'Fix the scene-anchor provider payload shape before retrying.'
          : sceneAnchorFailureCategory === 'scene_anchor_output_parse_failed'
            ? 'Update output parsing or inspect the redacted provider response shape before retrying.'
            : sceneAnchorFailureCategory === 'scene_anchor_provider_moderation_block'
              ? 'Edit the scene-anchor prompt and keep using provider-safe staging.'
              : 'Check scene-anchor diagnostics before retrying, or explicitly choose identity-only fallback.',
        privateUrlsRedacted: true,
      });
    }

    if (sceneAnchorImageToVideoStageActive && klingReferencePlan) {
      if (!isValidHttpUrl(providerReferenceImageUrl)) {
        return sendJson(res, 400, {
          error: 'Scene anchor image is not provider-accessible.',
          received: '[redacted-scene-anchor-url]',
        });
      }

      const referenceValidation = await validateReferenceImageUrl(providerReferenceImageUrl);
      if (!referenceValidation.ok) {
        return sendJson(res, 400, {
          error: 'Scene anchor image is not accessible',
          referenceImageUrl: '[redacted-scene-anchor-url]',
          status: referenceValidation.status,
          contentType: referenceValidation.contentType,
        });
      }

      console.log('FINAL INPUT SENT TO KLING SCENE ANCHOR I2V', {
        prompt: promptForModel,
        inputKeys: ['prompt', klingReferencePlan.stage2ProviderModel?.includes('/o1/') ? 'start_image_url' : 'image_url', 'duration'],
        stage2ProviderModel: klingReferencePlan.stage2ProviderModel,
        stage2ProviderRouteType: 'image_to_video',
        primaryVideoInputType: 'scene_anchor',
        identityReferencesPassedToVideoStage: false,
        rawReferenceVisualInputsSentToStage2: false,
        privateUrlsRedacted: true,
      });

      const result = await runFalKlingSceneAnchorImageToVideo({
        prompt: promptForModel,
        sceneAnchorUrl: providerReferenceImageUrl,
        durationSent,
      });

      console.log('FINAL VIDEO URL:', result.videoUrl);

      return sendJson(res, 200, {
        success: true,
        videoUrl: result.videoUrl,
        provider: 'fal',
        model: result.model,
        displayEngine: 'Kling exact likeness',
        generationMode: 'kling-exact-likeness-reference',
        generationModeUsed: 'kling-exact-likeness-reference',
        hasReferenceImage: true,
        modelUsed: result.model,
        durationSent: result.durationSent,
        identityId: textValue(body.identityId) || null,
        keyframeUrl: null,
        exactLikenessRoute: 'kling_reference',
        exactLikenessAvailable: true,
        exactLikenessReason: 'Kling exact likeness route is canary-proven.',
        referenceImageUrl: responseReferenceImageUrl,
        additionalReferenceImageUrls: responseAdditionalReferenceImageUrls,
        referenceStrategy: klingReferencePlan.plannedStrategy,
        referenceRolesUsed: klingReferencePlan.references.map((reference) => reference.role),
        referenceCount: klingReferencePlan.references.length,
        sceneAnchorStrategy: klingReferencePlan.sceneAnchorStrategy,
        sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
        sceneAnchorModel: sceneAnchorProviderStatus().model,
        sceneAnchorGenerated: true,
        sceneAnchorPersisted: true,
        sceneAnchorProvider: klingReferencePlan.sceneAnchorProvider,
        sceneAnchorReason: klingReferencePlan.sceneAnchorReason,
        sceneAnchorFailureCategory: null,
        sceneAnchorHttpStatus: klingReferencePlan.sceneAnchorHttpStatus,
        sceneAnchorErrorType: klingReferencePlan.sceneAnchorErrorType,
        sceneAnchorErrorMessage: klingReferencePlan.sceneAnchorErrorMessage,
        sceneAnchorErrorBodyRedacted: klingReferencePlan.sceneAnchorErrorBodyRedacted,
        sceneAnchorPayloadFieldNames: klingReferencePlan.sceneAnchorPayloadFieldNames,
        sceneAnchorReferenceCount: klingReferencePlan.sceneAnchorReferenceCount,
        sceneAnchorSubmittedReferenceCount: klingReferencePlan.sceneAnchorSubmittedReferenceCount,
        sceneAnchorReferenceRolesUsed: klingReferencePlan.sceneAnchorReferenceRolesUsed,
        sceneAnchorDroppedReferenceRoles: klingReferencePlan.sceneAnchorDroppedReferenceRoles,
        sceneAnchorProviderReferenceLimit: klingReferencePlan.sceneAnchorProviderReferenceLimit,
        sceneAnchorOutputParsed: klingReferencePlan.sceneAnchorOutputParsed,
        sceneAnchorValidation: klingReferencePlan.sceneAnchorValidation,
        primaryInputType: klingReferencePlan.primaryInputType,
        primaryVideoInputType: 'scene_anchor',
        primaryVideoInputSource: 'scene_anchor',
        identityReferencesPassedToVideoStage: false,
        identityReferenceCount: klingReferencePlan.identityReferenceCount,
        identityReferenceMode: 'stage1_only',
        startFrameSource: 'scene_anchor',
        posterFrameSource: 'video_frame',
        firstFrameSource: 'scene_anchor',
        stage2ProviderModel: result.model,
        stage2ProviderRouteType: 'image_to_video',
        rawReferenceVisualInputsSentToStage2: false,
        sceneIntent: klingReferencePlan.sceneIntent,
        framingIntent: klingReferencePlan.framingIntent,
        primaryReferenceRole: klingReferencePlan.primaryReferenceRole,
        supportingReferenceRoles: klingReferencePlan.supportingReferenceRoles,
        usedMultiReferencePlan: klingReferencePlan.references.length > 1,
        fellBackToFrontOnly: false,
        compositionNeutralized: Boolean(klingReferencePlan.compositionNeutralized),
        userSpecifiedOutfit: Boolean(klingReferencePlan.userSpecifiedOutfit),
        outfitTermsDetected: klingReferencePlan.outfitTermsDetected,
        environmentTermsDetected: klingReferencePlan.environmentTermsDetected,
        referenceOutfitCarryoverSuppressed: Boolean(klingReferencePlan.referenceOutfitCarryoverSuppressed),
        compositionCarryoverSuppressed: Boolean(klingReferencePlan.compositionCarryoverSuppressed),
        frontOnlyFallback: false,
        audioConfigured: false,
        viralPresetUsed,
        promptPolished,
        klingReferenceDiagnostics: klingReferenceDiagnostics({
          plan: klingReferencePlan,
          referenceStrategy: klingReferencePlan.plannedStrategy,
          exactLikenessRoute: 'kling_reference',
          providerRoute: 'fal_kling_scene_anchor_image_to_video',
          viralPresetUsed,
          promptPolished,
        }),
        finalPrompt: promptForModel,
        warnings: [],
        rawOutput: {
          provider: safeJsonValue(result.rawOutput),
          attempts: result.attempts,
        },
      });
    }

    if (SINGLE_PROVIDER_MODE) {
      console.log('SINGLE PROVIDER MODE ACTIVE', {
        requestedEngine: engine,
        skippedSeedance: true,
        skippedFallbackProviders: true,
      });

      if (!isValidProviderImageInput(providerReferenceImageUrl)) {
        return sendJson(res, 400, {
          error: 'Invalid reference image URL',
          received: '[redacted-reference-url]',
        });
      }

      for (const [index, reference] of referencesToValidate.entries()) {
        if (!isValidHttpUrl(reference.url)) {
          return sendJson(res, 400, {
            error: index === 0 ? 'Invalid reference image URL' : 'Invalid additional reference image URL',
            referenceImageUrl: safeUrlLabel(index),
          });
        }

        const referenceValidation = await validateReferenceImageUrl(reference.url);
        if (!referenceValidation.ok) {
          return sendJson(res, 400, {
            error: index === 0 ? 'Reference image not accessible' : 'Additional reference image not accessible',
            referenceImageUrl: safeUrlLabel(index),
            status: referenceValidation.status,
            contentType: referenceValidation.contentType,
          });
        }
      }

      const model = (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || KLING_IMAGE_TO_VIDEO_MODEL) as ReplicateModelIdentifier;
      const requestInput = buildKlingVideoStageRequestInput({
        prompt: promptForModel,
        startImageUrl: providerReferenceImageUrl,
        additionalReferences,
        identityReferencesPassedToVideoStage,
      });
      const generationModeUsed: GenerationModeUsed = klingExactLikenessRequest
        ? 'kling-exact-likeness-reference'
        : keyframeUrl
        ? 'identity-image-to-video'
        : 'reference-image-to-video';

      console.log('MODEL ATTEMPTED', {
        provider: 'replicate',
        model,
      });
      console.log('FINAL INPUT SENT TO SINGLE PROVIDER', {
        prompt: requestInput.prompt,
        inputKeys: Object.keys(requestInput),
        referenceCount: 1 + additionalReferences.length,
        identityReferencesPassedToVideoStage,
        privateUrlsRedacted: true,
      });

      if (!token) {
        return sendJson(res, 500, { error: 'Missing REPLICATE_API_TOKEN' });
      }
      const { default: Replicate } = await import('replicate');
      const replicate = new Replicate({ auth: token }) as ReplicateClient;

      try {
        const result = await runReplicate({
          replicate,
          model,
          requestInput,
          durationSent: null,
          generationModeUsed,
          referenceImageUrl: providerReferenceImageUrl,
          fallbackToStartImageOnly: false,
        });

        console.log('FINAL VIDEO URL:', result.videoUrl);

        return sendJson(res, 200, {
          success: true,
          videoUrl: result.videoUrl,
          provider: 'replicate',
          model: result.model,
          displayEngine: generationModeUsed === 'kling-exact-likeness-reference'
            ? 'Kling exact likeness'
            : generationModeUsed === 'identity-image-to-video'
            ? 'Lumora identity reference'
            : 'Reference image-to-video',
          generationMode: generationModeUsed,
          generationModeUsed,
          hasReferenceImage: true,
          modelUsed: result.model,
          durationSent: result.durationSent,
          identityId: textValue(body.identityId) || null,
          keyframeUrl: keyframeUrl || null,
          exactLikenessRoute: klingExactLikenessRequest ? 'kling_reference' : null,
          exactLikenessAvailable: klingExactLikenessRequest,
          exactLikenessReason: klingExactLikenessRequest ? 'Kling exact likeness route is canary-proven.' : null,
          referenceImageUrl: responseReferenceImageUrl || primaryReferenceImageUrl || referenceImageUrl,
          additionalReferenceImageUrls: responseAdditionalReferenceImageUrls,
          referenceStrategy: klingReferencePlan?.plannedStrategy ?? (additionalReferences.length ? 'direct_identity_references' : 'front_only_fallback'),
          referenceRolesUsed: klingReferencePlan?.references.map((reference) => reference.role) ?? ['front_angle'],
          referenceCount: klingReferencePlan?.references.length ?? 1,
          sceneAnchorStrategy: klingReferencePlan?.sceneAnchorStrategy ?? null,
          sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
          sceneAnchorModel: sceneAnchorProviderStatus().model,
          sceneAnchorGenerated: Boolean(klingReferencePlan?.sceneAnchorGenerated),
          sceneAnchorPersisted: Boolean(klingReferencePlan?.sceneAnchorPersisted),
          sceneAnchorProvider: klingReferencePlan?.sceneAnchorProvider ?? null,
          sceneAnchorReason: klingReferencePlan?.sceneAnchorReason ?? null,
          sceneAnchorFailureCategory: klingReferencePlan?.sceneAnchorFailureCategory ?? null,
          sceneAnchorValidation: klingReferencePlan?.sceneAnchorValidation ?? null,
          primaryInputType: klingReferencePlan?.primaryInputType ?? null,
          primaryVideoInputType: klingReferencePlan?.primaryVideoInputType ?? null,
          primaryVideoInputSource: klingReferencePlan?.primaryVideoInputSource ?? null,
          identityReferencesPassedToVideoStage,
          identityReferenceCount: klingReferencePlan?.identityReferenceCount ?? 1 + additionalReferences.length,
          identityReferenceMode: klingReferencePlan?.identityReferenceMode ?? null,
          startFrameSource: klingReferencePlan?.startFrameSource ?? null,
          posterFrameSource: klingReferencePlan?.posterFrameSource ?? null,
          firstFrameSource: klingReferencePlan?.firstFrameSource ?? null,
          stage2ProviderModel: klingReferencePlan?.stage2ProviderModel ?? result.model,
          stage2ProviderRouteType: klingReferencePlan?.stage2ProviderRouteType ?? 'reference_to_video',
          rawReferenceVisualInputsSentToStage2: Boolean(klingReferencePlan?.rawReferenceVisualInputsSentToStage2),
          sceneIntent: klingReferencePlan?.sceneIntent ?? [],
          framingIntent: klingReferencePlan?.framingIntent ?? null,
          primaryReferenceRole: klingReferencePlan?.primaryReferenceRole ?? null,
          supportingReferenceRoles: klingReferencePlan?.supportingReferenceRoles ?? [],
          usedMultiReferencePlan: (klingReferencePlan?.references.length ?? 0) > 1,
          fellBackToFrontOnly: Boolean(klingReferencePlan && klingReferencePlan.references.length === 1 && klingReferencePlan.primaryReferenceRole === 'front_angle'),
          compositionNeutralized: Boolean(klingReferencePlan?.compositionNeutralized),
          userSpecifiedOutfit: Boolean(klingReferencePlan?.userSpecifiedOutfit),
          outfitTermsDetected: klingReferencePlan?.outfitTermsDetected ?? [],
          environmentTermsDetected: klingReferencePlan?.environmentTermsDetected ?? [],
          referenceOutfitCarryoverSuppressed: Boolean(klingReferencePlan?.referenceOutfitCarryoverSuppressed),
          compositionCarryoverSuppressed: Boolean(klingReferencePlan?.compositionCarryoverSuppressed),
          frontOnlyFallback: Boolean(klingReferencePlan?.frontOnlyFallback),
          klingReferenceDiagnostics: klingReferenceDiagnostics({
            plan: klingReferencePlan,
            referenceStrategy: klingReferencePlan?.plannedStrategy ?? (result.finalInputKeys?.includes('reference_images')
              ? 'direct_identity_references'
              : 'front_only_fallback'),
            exactLikenessRoute: klingExactLikenessRequest ? 'kling_reference' : null,
            providerRoute: 'replicate_kling_image_to_video',
            viralPresetUsed,
            promptPolished,
          }),
          finalPrompt: promptForModel,
          warnings: [],
          rawOutput: {
            provider: safeJsonValue(result.rawOutput),
            attempts: result.attempts,
          },
        });
      } catch (singleProviderError) {
        console.warn('NO FALLBACK ATTEMPTED', {
          model,
          singleProviderMode: true,
          rateLimited: isRateLimitError(singleProviderError),
        });

        if (isRateLimitError(singleProviderError)) {
          const errorRecord = objectRecord(singleProviderError);
          const retryAfterMs =
            numericValue(errorRecord.retryAfterMs) ??
            retryAfterMilliseconds(singleProviderError);
          return sendJson(res, 429, {
            error: REPLICATE_THROTTLED_ERROR,
            retryAfter: retryAfterMs !== null ? retryAfterMs / 1_000 : null,
            suggestion: REPLICATE_THROTTLED_SUGGESTION,
          });
        }

        throw singleProviderError;
      }
    }

    if (useSeedance) {
      if (seedanceReferences.length < 3) {
        return sendJson(res, 400, {
          error: 'Seedance 2.0 Identity requires front, left, and right reference images.',
          received: seedanceReferences,
          engine,
          model: SEEDANCE_MODEL,
        });
      }

      for (const seedanceReference of seedanceReferences) {
        if (!isValidHttpUrl(seedanceReference)) {
          return sendJson(res, 400, {
            error: 'Invalid Seedance reference image URL',
            received: seedanceReference,
            engine,
            model: SEEDANCE_MODEL,
          });
        }

        const validation = await validateReferenceImageUrl(seedanceReference);
        if (!validation.ok) {
          return sendJson(res, 400, {
            error: 'Seedance reference image not accessible',
            referenceImageUrl: seedanceReference,
            status: validation.status,
            contentType: validation.contentType,
            engine,
            model: SEEDANCE_MODEL,
          });
        }
      }

      const requestInput = {
        prompt: promptForModel,
        reference_images: seedanceReferences,
        duration: durationSent,
        aspect_ratio: aspectRatio,
      };

      console.log('GENERATION ENGINE USED', {
        engine: 'seedance-2.0',
        provider: 'replicate',
        model: SEEDANCE_MODEL,
      });
      console.log('SEEDANCE INPUT', {
        prompt: requestInput.prompt,
        inputKeys: Object.keys(requestInput),
        referenceCount: seedanceReferences.length,
        duration: requestInput.duration,
        aspectRatio: requestInput.aspect_ratio,
        privateUrlsRedacted: true,
      });

      if (!token) {
        return sendJson(res, 500, { error: 'Missing REPLICATE_API_TOKEN' });
      }
      const { default: Replicate } = await import('replicate');
      const replicate = new Replicate({ auth: token }) as ReplicateClient;

      try {
        const result = await runReplicateWithRateLimitRetry({
          replicate,
          model: SEEDANCE_MODEL,
          requestInput,
          durationSent,
          generationModeUsed: 'seedance-multimodal-reference',
          referenceImageUrl,
          fallbackToStartImageOnly: false,
        });

        console.log('FINAL VIDEO URL:', result.videoUrl);

        return sendJson(res, 200, {
          success: true,
          videoUrl: result.videoUrl,
          provider: 'replicate',
          model: result.model,
          displayEngine: 'seedance',
          generationMode: 'seedance-multimodal-reference',
          generationModeUsed: 'seedance-multimodal-reference',
          hasReferenceImage: true,
          modelUsed: result.model,
          durationSent: result.durationSent,
          identityId: textValue(body.identityId) || null,
          keyframeUrl: null,
          referenceImageUrl,
          referenceImages: seedanceReferences,
          additionalReferenceImageUrls: seedanceReferences.slice(1),
          finalPrompt: promptForModel,
          warnings: [],
          rawOutput: {
            provider: safeJsonValue(result.rawOutput),
            attempts: result.attempts,
          },
        });
      } catch (seedanceError) {
        const seedanceSafetyFiltered = isSensitiveFilterError(seedanceError);
        const seedanceRateLimited = isRateLimitError(seedanceError);
        if (!seedanceSafetyFiltered && !seedanceRateLimited) {
          throw seedanceError;
        }

        console.warn('Seedance generation failed without image-to-video fallback.', {
          model: SEEDANCE_MODEL,
          referenceImageCount: seedanceReferences.length,
          privateUrlsRedacted: true,
          safetyFiltered: seedanceSafetyFiltered,
          rateLimited: seedanceRateLimited,
        });

        return sendJson(res, seedanceRateLimited ? 429 : 400, {
          success: false,
          videoUrl: '',
          provider: 'replicate',
          model: SEEDANCE_MODEL,
          displayEngine: 'seedance',
          generationMode: 'seedance-multimodal-reference',
          generationModeUsed: 'seedance-multimodal-reference',
          hasReferenceImage: seedanceReferences.length > 0,
          modelUsed: SEEDANCE_MODEL,
          durationSent,
          identityId: textValue(body.identityId) || null,
          keyframeUrl: null,
          referenceImageUrl: null,
          referenceImages: seedanceReferences,
          additionalReferenceImageUrls: seedanceReferences,
          finalPrompt: promptForModel,
          warnings: [seedanceRateLimited ? PROVIDER_QUEUE_BUSY_MESSAGE : SENSITIVE_FILTER_ERROR],
          error: seedanceRateLimited ? PROVIDER_QUEUE_BUSY_MESSAGE : SENSITIVE_FILTER_ERROR,
          suggestion: seedanceRateLimited ? undefined : SENSITIVE_FILTER_SUGGESTION,
          rawOutput: {
            failedProvider: {
              provider: 'replicate',
              model: SEEDANCE_MODEL,
              error: safeJsonValue(seedanceError),
            },
          },
        });
      }
    }

    if (!isValidProviderImageInput(providerReferenceImageUrl)) {
      return sendJson(res, 400, {
        error: 'Invalid reference image URL',
        received: '[redacted-reference-url]',
      });
    }

    for (const [index, reference] of referencesToValidate.entries()) {
      if (!isValidHttpUrl(reference.url)) {
        return sendJson(res, 400, {
          error: index === 0 ? 'Invalid reference image URL' : 'Invalid additional reference image URL',
          received: safeUrlLabel(index),
        });
      }
    }

    for (const [index, reference] of referencesToValidate.entries()) {
      const referenceValidation = await validateReferenceImageUrl(reference.url);
      if (!referenceValidation.ok) {
        return sendJson(res, 400, {
          error: index === 0 ? 'Reference image not accessible' : 'Additional reference image not accessible',
          referenceImageUrl: safeUrlLabel(index),
          status: referenceValidation.status,
          contentType: referenceValidation.contentType,
        });
      }
    }

    const model = (process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || KLING_IMAGE_TO_VIDEO_MODEL) as ReplicateModelIdentifier;
    const requestInput = buildKlingVideoStageRequestInput({
      prompt: promptForModel,
      startImageUrl: providerReferenceImageUrl,
      additionalReferences,
      identityReferencesPassedToVideoStage,
    });
    const generationModeUsed: GenerationModeUsed = klingExactLikenessRequest
      ? 'kling-exact-likeness-reference'
      : keyframeUrl
        ? 'identity-image-to-video'
        : 'reference-image-to-video';

    console.log('GENERATION DEBUG', {
      hasReferenceImage: Boolean(referenceImageUrl),
      additionalReferenceCount: additionalReferences.length,
      modelUsed: model,
      finalPrompt: promptForModel,
      generationModeUsed,
      identityId: textValue(body.identityId),
      identityReferencesPassedToVideoStage,
      privateUrlsRedacted: true,
    });
    console.log('GENERATION ENGINE USED', {
      engine: 'kling',
      provider: 'replicate',
      model,
    });
    console.log('FINAL INPUT SENT TO KLING', {
      prompt: requestInput.prompt,
      inputKeys: Object.keys(requestInput),
      referenceCount: 1 + additionalReferences.length,
      identityReferencesPassedToVideoStage,
      privateUrlsRedacted: true,
    });

    if (!token) {
      return sendJson(res, 500, { error: 'Missing REPLICATE_API_TOKEN' });
    }
    const { default: Replicate } = await import('replicate');
    const replicate = new Replicate({ auth: token }) as ReplicateClient;

    const result = await runKlingImageToVideo({
      replicate,
      prompt: promptForModel,
      referenceImageUrl: providerReferenceImageUrl,
      additionalReferences,
      primaryModel: model,
      durationSent: null,
      generationModeUsed,
      fallbackToStartImageOnly: !klingExactLikenessRequest || additionalReferences.length === 0 || identityReferencesPassedToVideoStage === false,
      identityReferencesPassedToVideoStage,
    });

    console.log('FINAL VIDEO URL:', result.videoUrl);

    return sendJson(res, 200, {
      success: true,
      videoUrl: result.videoUrl,
      provider: 'replicate',
      model: result.model,
      displayEngine: generationModeUsed === 'kling-exact-likeness-reference' ? 'Kling exact likeness' : generationModeUsed,
      generationMode: generationModeUsed,
      generationModeUsed,
      hasReferenceImage: true,
      modelUsed: result.model,
      durationSent: result.durationSent,
      identityId: textValue(body.identityId) || null,
      keyframeUrl: keyframeUrl || null,
      exactLikenessRoute: klingExactLikenessRequest ? 'kling_reference' : null,
      exactLikenessAvailable: klingExactLikenessRequest,
      exactLikenessReason: klingExactLikenessRequest ? 'Kling exact likeness route is canary-proven.' : null,
      referenceImageUrl: responseReferenceImageUrl,
      additionalReferenceImageUrls: responseAdditionalReferenceImageUrls,
      referenceStrategy: klingReferencePlan?.plannedStrategy ?? (additionalReferences.length ? 'direct_identity_references' : 'front_only_fallback'),
      referenceRolesUsed: klingReferencePlan?.references.map((reference) => reference.role) ?? ['front_angle'],
      referenceCount: klingReferencePlan?.references.length ?? 1,
      sceneIntent: klingReferencePlan?.sceneIntent ?? [],
      framingIntent: klingReferencePlan?.framingIntent ?? null,
      primaryReferenceRole: klingReferencePlan?.primaryReferenceRole ?? null,
      supportingReferenceRoles: klingReferencePlan?.supportingReferenceRoles ?? [],
      usedMultiReferencePlan: (klingReferencePlan?.references.length ?? 0) > 1,
      fellBackToFrontOnly: Boolean(klingReferencePlan && klingReferencePlan.references.length === 1 && klingReferencePlan.primaryReferenceRole === 'front_angle'),
      compositionNeutralized: Boolean(klingReferencePlan?.compositionNeutralized),
      sceneAnchorStrategy: klingReferencePlan?.sceneAnchorStrategy ?? null,
      sceneAnchorEnabled: sceneAnchorProviderStatus().sceneAnchorEnabled,
      sceneAnchorModel: sceneAnchorProviderStatus().model,
      sceneAnchorGenerated: Boolean(klingReferencePlan?.sceneAnchorGenerated),
      sceneAnchorPersisted: Boolean(klingReferencePlan?.sceneAnchorPersisted),
      sceneAnchorProvider: klingReferencePlan?.sceneAnchorProvider ?? null,
      sceneAnchorReason: klingReferencePlan?.sceneAnchorReason ?? null,
      sceneAnchorFailureCategory: klingReferencePlan?.sceneAnchorFailureCategory ?? null,
      sceneAnchorValidation: klingReferencePlan?.sceneAnchorValidation ?? null,
      primaryInputType: klingReferencePlan?.primaryInputType ?? null,
      primaryVideoInputType: klingReferencePlan?.primaryVideoInputType ?? null,
      primaryVideoInputSource: klingReferencePlan?.primaryVideoInputSource ?? null,
      identityReferencesPassedToVideoStage,
      identityReferenceCount: klingReferencePlan?.identityReferenceCount ?? 1 + additionalReferences.length,
      identityReferenceMode: klingReferencePlan?.identityReferenceMode ?? null,
      startFrameSource: klingReferencePlan?.startFrameSource ?? null,
      posterFrameSource: klingReferencePlan?.posterFrameSource ?? null,
      firstFrameSource: klingReferencePlan?.firstFrameSource ?? null,
      stage2ProviderModel: klingReferencePlan?.stage2ProviderModel ?? result.model,
      stage2ProviderRouteType: klingReferencePlan?.stage2ProviderRouteType ?? 'reference_to_video',
      rawReferenceVisualInputsSentToStage2: Boolean(klingReferencePlan?.rawReferenceVisualInputsSentToStage2),
      userSpecifiedOutfit: Boolean(klingReferencePlan?.userSpecifiedOutfit),
      outfitTermsDetected: klingReferencePlan?.outfitTermsDetected ?? [],
      environmentTermsDetected: klingReferencePlan?.environmentTermsDetected ?? [],
      referenceOutfitCarryoverSuppressed: Boolean(klingReferencePlan?.referenceOutfitCarryoverSuppressed),
      compositionCarryoverSuppressed: Boolean(klingReferencePlan?.compositionCarryoverSuppressed),
      frontOnlyFallback: Boolean(klingReferencePlan?.frontOnlyFallback),
      audioConfigured: false,
      viralPresetUsed,
      promptPolished,
      klingReferenceDiagnostics: klingReferenceDiagnostics({
        plan: klingReferencePlan,
        referenceStrategy: klingReferencePlan?.plannedStrategy ?? (result.finalInputKeys?.includes('reference_images')
          ? 'direct_identity_references'
          : 'front_only_fallback'),
        exactLikenessRoute: klingExactLikenessRequest ? 'kling_reference' : null,
        providerRoute: 'replicate_kling_image_to_video',
        viralPresetUsed,
        promptPolished,
      }),
      finalPrompt: promptForModel,
      warnings: [],
      rawOutput: {
        provider: safeJsonValue(result.rawOutput),
        attempts: result.attempts,
      },
    });
    } finally {
      releaseActiveGeneration(generationUserKey);
    }
  } catch (error) {
    console.error('LUMORA GENERATE ERROR:', error);
    const errorRecord = objectRecord(error);

    if (errorRecord.safetyFiltered === true || isSensitiveFilterError(error)) {
      return sendJson(res, 422, {
        error: SENSITIVE_FILTER_ERROR,
        errorCategory: 'kling_provider_safety_filter',
        providerStatus: 'moderation_failed',
        suggestion: SENSITIVE_FILTER_SUGGESTION,
      });
    }

    if (errorRecord.rateLimited === true || isRateLimitError(error)) {
      return sendJson(res, 429, {
        error: PROVIDER_QUEUE_BUSY_MESSAGE,
        details: safeJsonValue(errorRecord.details ?? error),
        provider: textValue(errorRecord.provider) || 'replicate',
        model: textValue(errorRecord.model) || null,
      });
    }

    return sendJson(res, 500, {
      error: errorMessage(error),
      errorCategory: klingGenerationErrorCategory(error),
      details: safeJsonValue(errorRecord.details ?? error),
      stack: errorStack(error),
      provider: textValue(errorRecord.provider) || 'replicate',
      model: textValue(errorRecord.model) || null,
      suggestion: isBillingOrCreditError(error)
        ? 'Check Replicate billing, credits, or API token access.'
        : 'If the image-to-video model rejected the reference image input, try the fallback model or inspect details for the exact Replicate error.',
    });
  }
}
