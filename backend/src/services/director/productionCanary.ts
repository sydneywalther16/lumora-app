import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../lib/env';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import {
  GEMINI_OMNI_FLASH_MODEL,
  nanoBananaAdapter,
  omniFlashAdapter,
} from './adapters';
import {
  DIRECTOR_CANARY_MAXIMUM_COST_USD,
  DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD,
  DIRECTOR_CANARY_SCENE,
  directorCanarySceneHash,
  runDirectorCanarySequence,
  type DirectorCanaryAuthorization,
  type DirectorCanaryFailureCategory,
  type DirectorInteractionSummaries,
} from './canary';
import { createDirectorCostTelemetry, type DirectorCostTelemetry } from './budget';
import { buildDirectorProductionDryRun } from './dryRunDiagnostics';
import type { DirectorPlan } from './contracts';
import {
  createGoogleMediaClient,
  type DirectorProviderSafeFailureMetadata,
} from './googleMedia';
import {
  directorFileNameFromUri,
  inlineDirectorOutputBytes,
  pollDirectorMediaFile,
  type DirectorMediaOutput,
} from './output';

const REFERENCE_BUCKET = 'character-reference-images';
const ANCHOR_BUCKET = 'lumora-assets';
const VIDEO_BUCKET = 'generated-videos';
const CANARY_AUTHORIZATION_TABLE = 'director_canary_authorizations';

export type DirectorAuthorizationRow = {
  id: string;
  user_id: string;
  scene_hash: string;
  status: 'authorized' | 'running' | 'completed' | 'failed';
  maximum_cost_usd: number | string;
  maximum_anchor_requests: number;
  maximum_video_requests: number;
  maximum_retry_requests: number;
  maximum_fallback_requests: number;
  maximum_repair_requests: number;
  idempotency_key: string;
  expires_at: string;
  consumed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  telemetry?: unknown;
  failure_category?: string | null;
  result_project_id?: string | null;
  estimated_cost_usd?: number | string | null;
  actual_cost_usd?: number | string | null;
};

type SelfCharacterRow = {
  id: string;
  name: string;
  thumbnail_url: string | null;
  reference_image_urls: Record<string, unknown> | null;
};

export type DirectorCanaryPublicResult = {
  status: 'processing' | 'completed' | 'failed';
  message: string;
  error?: string;
  draftSaved: boolean;
  projectId: string | null;
  videoUrl: string | null;
  publicCaption: string;
  syntheticDisclosure: 'Synthetic portrayal';
};

export type ProductionDirectorCanaryExecution = {
  httpStatus: number;
  publicResult: DirectorCanaryPublicResult;
  internalDiagnostics: {
    authorizationState:
      | 'claimed'
      | 'missing'
      | 'expired'
      | 'idempotent_running'
      | 'idempotent_terminal';
    failureCategory: DirectorCanaryFailureCategory | null;
    providerRequestCount: number;
    providerRetryCount: number;
    providerFallbackCount: number;
    repairRequestCount: number;
    estimatedCostUsd: number | null;
    actualCostUsd: number | null;
  };
};

export type DirectorAuthorizationClaimStore = {
  claim(input: {
    authorizationId: string;
    userId: string;
    sceneHash: string;
    idempotencyKey: string;
  }): Promise<DirectorAuthorizationRow | null>;
  find(input: {
    authorizationId: string;
    userId: string;
    sceneHash: string;
    idempotencyKey: string;
  }): Promise<DirectorAuthorizationRow | null>;
};

export type DirectorAuthorizationClaimResolution =
  | { kind: 'claimed'; row: DirectorAuthorizationRow }
  | { kind: 'missing'; row: null }
  | { kind: 'expired'; row: DirectorAuthorizationRow }
  | { kind: 'idempotent_running'; row: DirectorAuthorizationRow }
  | { kind: 'idempotent_terminal'; row: DirectorAuthorizationRow };

export type DirectorAuthorizationLookupStore = {
  findEligible(input: {
    userId: string;
    sceneHash: string;
    now: Date;
  }): Promise<DirectorAuthorizationRow[]>;
};

export type DirectorAuthorizationLookupResolution =
  | { kind: 'resolved'; row: DirectorAuthorizationRow }
  | { kind: 'missing'; row: null }
  | { kind: 'multiple'; row: null }
  | { kind: 'expired'; row: DirectorAuthorizationRow }
  | { kind: 'invalid'; row: DirectorAuthorizationRow };

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExactCanaryLimits(row: DirectorAuthorizationRow) {
  return (
    Number(row.maximum_cost_usd) === DIRECTOR_CANARY_MAXIMUM_COST_USD &&
    row.maximum_anchor_requests === 1 &&
    row.maximum_video_requests === 1 &&
    row.maximum_retry_requests === 0 &&
    row.maximum_fallback_requests === 0 &&
    row.maximum_repair_requests === 0
  );
}

export async function resolveDirectorCanaryStoredAuthorization(
  store: DirectorAuthorizationLookupStore,
  input: {
    userId: string;
    sceneHash: string;
  },
  now = new Date(),
): Promise<DirectorAuthorizationLookupResolution> {
  const rows = await store.findEligible({ ...input, now });
  if (rows.length === 0) return { kind: 'missing', row: null };
  if (rows.length !== 1) return { kind: 'multiple', row: null };

  const row = rows[0];
  const expiresAt = new Date(row.expires_at).getTime();
  const createdAt = new Date(row.created_at).getTime();
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(createdAt) ||
    expiresAt <= now.getTime() ||
    createdAt <= now.getTime() - 30 * 60_000
  ) {
    return { kind: 'expired', row };
  }
  if (
    row.user_id !== input.userId ||
    row.scene_hash !== input.sceneHash ||
    row.status !== 'authorized' ||
    row.consumed_at !== null ||
    !text(row.id) ||
    !text(row.idempotency_key) ||
    !hasExactCanaryLimits(row)
  ) {
    return { kind: 'invalid', row };
  }
  return { kind: 'resolved', row };
}

function telemetryFromUnknown(value: unknown): DirectorCostTelemetry {
  const empty = createDirectorCostTelemetry();
  if (!value || typeof value !== 'object') return empty;
  const record = value as Record<string, unknown>;
  const requests = record.requestsByOperation && typeof record.requestsByOperation === 'object'
    ? record.requestsByOperation as Record<string, unknown>
    : {};
  return {
    ...empty,
    providerRequestCount: numeric(record.providerRequestCount) ?? 0,
    providerRetryCount: numeric(record.providerRetryCount) ?? 0,
    providerFallbackCount: numeric(record.providerFallbackCount) ?? 0,
    repairRequestCount: numeric(record.repairRequestCount) ?? 0,
    requestsByOperation: {
      scene_anchor: numeric(requests.scene_anchor) ?? 0,
      primary_video: numeric(requests.primary_video) ?? 0,
      fallback_video: numeric(requests.fallback_video) ?? 0,
      repair_edit: numeric(requests.repair_edit) ?? 0,
    },
    budgetDecisionIds: [],
    events: [],
  };
}

export async function resolveDirectorCanaryAuthorizationClaim(
  store: DirectorAuthorizationClaimStore,
  input: {
    authorizationId: string;
    userId: string;
    sceneHash: string;
    idempotencyKey: string;
  },
  now = new Date(),
): Promise<DirectorAuthorizationClaimResolution> {
  const claimed = await store.claim(input);
  if (claimed) return { kind: 'claimed', row: claimed };

  const existing = await store.find(input);
  if (!existing) return { kind: 'missing', row: null };
  if (
    existing.status === 'authorized' &&
    new Date(existing.expires_at).getTime() <= now.getTime()
  ) {
    return { kind: 'expired', row: existing };
  }
  if (existing.status === 'running') {
    return { kind: 'idempotent_running', row: existing };
  }
  return { kind: 'idempotent_terminal', row: existing };
}

function firstRow(value: unknown): DirectorAuthorizationRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object'
    ? candidate as DirectorAuthorizationRow
    : null;
}

const supabaseAuthorizationStore: DirectorAuthorizationClaimStore = {
  async claim(input) {
    if (!supabaseAdmin) return null;
    const { data, error } = await supabaseAdmin.rpc('claim_director_canary_authorization', {
      p_authorization_id: input.authorizationId,
      p_user_id: input.userId,
      p_scene_hash: input.sceneHash,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return null;
    return firstRow(data);
  },
  async find(input) {
    if (!supabaseAdmin) return null;
    const { data, error } = await supabaseAdmin
      .from(CANARY_AUTHORIZATION_TABLE)
      .select('*')
      .eq('id', input.authorizationId)
      .eq('user_id', input.userId)
      .eq('scene_hash', input.sceneHash)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (error || !data) return null;
    return data as DirectorAuthorizationRow;
  },
};

const supabaseAuthorizationLookupStore: DirectorAuthorizationLookupStore = {
  async findEligible(input) {
    if (!supabaseAdmin) return [];
    const { data, error } = await supabaseAdmin
      .from(CANARY_AUTHORIZATION_TABLE)
      .select('*')
      .eq('user_id', input.userId)
      .eq('scene_hash', input.sceneHash)
      .eq('status', 'authorized')
      .is('consumed_at', null)
      .gt('expires_at', input.now.toISOString())
      .gt('created_at', new Date(input.now.getTime() - 30 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(2);
    if (error || !Array.isArray(data)) return [];
    return data as DirectorAuthorizationRow[];
  },
};

export async function resolveProductionDirectorCanaryAuthorization(input: {
  userId: string;
  now?: Date;
}) {
  return resolveDirectorCanaryStoredAuthorization(
    supabaseAuthorizationLookupStore,
    {
      userId: input.userId,
      sceneHash: directorCanarySceneHash(),
    },
    input.now,
  );
}

function authorizationFromRow(row: DirectorAuthorizationRow): DirectorCanaryAuthorization | null {
  if (
    row.status !== 'running' ||
    !row.consumed_at ||
    Number(row.maximum_cost_usd) !== 2 ||
    row.maximum_anchor_requests !== 1 ||
    row.maximum_video_requests !== 1 ||
    row.maximum_retry_requests !== 0 ||
    row.maximum_fallback_requests !== 0 ||
    row.maximum_repair_requests !== 0
  ) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    sceneHash: row.scene_hash,
    status: 'running',
    maximumCostUsd: 2,
    maximumAnchorRequests: 1,
    maximumVideoRequests: 1,
    maximumRetryRequests: 0,
    maximumFallbackRequests: 0,
    maximumRepairRequests: 0,
    idempotencyKey: row.idempotency_key,
    recordedAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function internalDiagnostics(
  authorizationState: ProductionDirectorCanaryExecution['internalDiagnostics']['authorizationState'],
  telemetry: DirectorCostTelemetry,
  input: {
    failureCategory?: DirectorCanaryFailureCategory | null;
    estimatedCostUsd?: number | null;
    actualCostUsd?: number | null;
  } = {},
): ProductionDirectorCanaryExecution['internalDiagnostics'] {
  return {
    authorizationState,
    failureCategory: input.failureCategory ?? null,
    providerRequestCount: telemetry.providerRequestCount,
    providerRetryCount: telemetry.providerRetryCount,
    providerFallbackCount: telemetry.providerFallbackCount,
    repairRequestCount: telemetry.repairRequestCount,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    actualCostUsd: input.actualCostUsd ?? null,
  };
}

function publicFailureMessage(category: DirectorCanaryFailureCategory, anchorSucceeded: boolean) {
  if (category === 'provider_rate_limit') {
    return 'Lumora’s studio is busy right now. Your scene is safely preserved.';
  }
  if (anchorSucceeded) {
    return 'Lumora could not finish this scene. Your idea is safely preserved.';
  }
  if (category === 'authorization_expired') {
    return 'This one-time Lumora authorization has expired.';
  }
  if (
    category === 'authorization_missing' ||
    category === 'authorization_invalid' ||
    category === 'authorization_consumed' ||
    category === 'idempotency_conflict'
  ) {
    return 'This Lumora Director request is not authorized.';
  }
  return 'Lumora could not build this scene. Your idea is safely preserved.';
}

function failedExecution(input: {
  authorizationState: ProductionDirectorCanaryExecution['internalDiagnostics']['authorizationState'];
  failureCategory: DirectorCanaryFailureCategory;
  telemetry?: DirectorCostTelemetry;
  plan: DirectorPlan;
  anchorSucceeded?: boolean;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  httpStatus?: number;
}): ProductionDirectorCanaryExecution {
  const telemetry = input.telemetry ?? createDirectorCostTelemetry();
  const message = publicFailureMessage(input.failureCategory, Boolean(input.anchorSucceeded));
  return {
    httpStatus: input.httpStatus ?? 409,
    publicResult: {
      status: 'failed',
      message,
      error: message,
      draftSaved: false,
      projectId: null,
      videoUrl: null,
      publicCaption: input.plan.publicCaption,
      syntheticDisclosure: 'Synthetic portrayal',
    },
    internalDiagnostics: internalDiagnostics(input.authorizationState, telemetry, {
      failureCategory: input.failureCategory,
      estimatedCostUsd: input.estimatedCostUsd,
      actualCostUsd: input.actualCostUsd,
    }),
  };
}

async function loadFrontReference(userId: string) {
  if (!supabaseAdmin) throw new Error('front_reference_missing');
  const { data, error } = await supabaseAdmin
    .from('self_characters')
    .select('id,name,thumbnail_url,reference_image_urls')
    .eq('user_id', userId)
    .eq('status', 'ready')
    .eq('visibility', 'private')
    .maybeSingle();
  if (error || !data) throw new Error('front_reference_missing');
  const character = data as SelfCharacterRow;
  const urls = character.reference_image_urls ?? {};
  const objectPath = text(urls.frontFacePath);
  if (
    !objectPath ||
    !objectPath.startsWith(`${userId}/`) ||
    !/\.(?:jpe?g|png|webp)$/i.test(objectPath)
  ) {
    throw new Error('front_reference_invalid');
  }
  const { data: blob, error: downloadError } = await supabaseAdmin.storage
    .from(REFERENCE_BUCKET)
    .download(objectPath);
  if (downloadError || !blob) throw new Error('front_reference_missing');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error('front_reference_invalid');
  }
  const extension = objectPath.split('.').pop()?.toLowerCase();
  const mimeType = extension === 'png'
    ? 'image/png'
    : extension === 'webp'
      ? 'image/webp'
      : 'image/jpeg';
  return {
    character,
    urls,
    bytes,
    mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    hashPrefix: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
  };
}

function extensionForMime(mimeType: string, kind: 'image' | 'video') {
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webm')) return 'webm';
  return kind === 'image' ? 'jpg' : 'mp4';
}

async function uploadBytes(input: {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  if (!supabaseAdmin) throw new Error('persistence_failed');
  const { error } = await supabaseAdmin.storage
    .from(input.bucket)
    .upload(input.path, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
  if (error) throw new Error('persistence_failed');
  return supabaseAdmin.storage.from(input.bucket).getPublicUrl(input.path).data.publicUrl;
}

async function resolveProviderMediaBytes(output: DirectorMediaOutput, apiKey: string) {
  if (output.data) return inlineDirectorOutputBytes(output);
  if (!output.uri) throw new Error('Provider media is unavailable.');
  const client = createGoogleMediaClient(apiKey);
  const fileName = directorFileNameFromUri(output.uri);
  await pollDirectorMediaFile({
    fileName,
    getFile: (name) => client.files.get({ name }),
    maximumPolls: 52,
    intervalMs: 5_000,
  });
  const downloadPath = join(tmpdir(), `lumora-director-${randomUUID()}`);
  try {
    await client.files.download({
      file: output.uri,
      downloadPath,
    });
    return new Uint8Array(await readFile(downloadPath));
  } finally {
    await unlink(downloadPath).catch(() => undefined);
  }
}

export function directorOperationalTelemetry(
  telemetry: DirectorCostTelemetry,
  providerFailureMetadata?: DirectorProviderSafeFailureMetadata | null,
  interactionSummaries?: DirectorInteractionSummaries,
) {
  return {
    providerRequestCount: telemetry.providerRequestCount,
    providerRetryCount: telemetry.providerRetryCount,
    providerFallbackCount: telemetry.providerFallbackCount,
    repairRequestCount: telemetry.repairRequestCount,
    requestsByOperation: telemetry.requestsByOperation,
    events: telemetry.events,
    ...(providerFailureMetadata ? { providerFailure: providerFailureMetadata } : {}),
    ...(interactionSummaries && Object.keys(interactionSummaries).length
      ? { interactionResponses: interactionSummaries }
      : {}),
  };
}

export function mergeDirectorCanaryJobInteractionTelemetry(
  sceneMetadata: unknown,
  interactionSummaries: DirectorInteractionSummaries,
) {
  const existing = sceneMetadata && typeof sceneMetadata === 'object'
    ? sceneMetadata as Record<string, unknown>
    : {};
  return {
    ...existing,
    interactionResponses: interactionSummaries,
  };
}

async function createExecutionJob(
  authorization: DirectorCanaryAuthorization,
  plan: DirectorPlan,
) {
  if (!supabaseAdmin) throw new Error('persistence_failed');
  const { error } = await supabaseAdmin
    .from('generation_jobs')
    .insert({
      id: authorization.id,
      user_id: authorization.userId,
      provider: 'google',
      provider_name: 'google',
      provider_model: GEMINI_OMNI_FLASH_MODEL,
      output_type: 'video',
      prompt: DIRECTOR_CANARY_SCENE,
      status: 'processing',
      duration_seconds: 4,
      aspect_ratio: '9:16',
      privacy: 'private',
      render_mode: 'lumora-director-v1-canary',
      retry_count: 0,
      started_at: authorization.consumedAt,
      scene_metadata: {
        directorPlan: plan,
        syntheticDisclosure: plan.syntheticDisclosure,
        authorizationId: authorization.id,
      },
    });
  if (error) throw new Error('persistence_failed');
}

async function updateExecutionJob(input: {
  authorizationId: string;
  status: 'completed' | 'failed';
  projectId?: string | null;
  videoUrl?: string | null;
  failureCategory?: DirectorCanaryFailureCategory | null;
  telemetry: DirectorCostTelemetry;
  interactionSummaries?: DirectorInteractionSummaries;
}) {
  if (!supabaseAdmin) return;
  let sceneMetadata: Record<string, unknown> | null = null;
  if (input.interactionSummaries && Object.keys(input.interactionSummaries).length) {
    const { data, error } = await supabaseAdmin
      .from('generation_jobs')
      .select('scene_metadata')
      .eq('id', input.authorizationId)
      .maybeSingle();
    if (!error && data) {
      sceneMetadata = mergeDirectorCanaryJobInteractionTelemetry(
        data.scene_metadata,
        input.interactionSummaries,
      );
    }
  }
  await supabaseAdmin
    .from('generation_jobs')
    .update({
      status: input.status,
      project_id: input.projectId ?? null,
      result_asset_url: input.videoUrl ?? null,
      output_url: input.videoUrl ?? null,
      video_url: input.videoUrl ?? null,
      error_category: input.failureCategory ?? null,
      ...(sceneMetadata ? { scene_metadata: sceneMetadata } : {}),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.authorizationId);
}

async function updateAuthorization(input: {
  authorizationId: string;
  status: 'completed' | 'failed';
  telemetry: DirectorCostTelemetry;
  providerFailureMetadata?: DirectorProviderSafeFailureMetadata | null;
  interactionSummaries?: DirectorInteractionSummaries;
  failureCategory?: DirectorCanaryFailureCategory | null;
  projectId?: string | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
}) {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from(CANARY_AUTHORIZATION_TABLE)
    .update({
      status: input.status,
      telemetry: directorOperationalTelemetry(
        input.telemetry,
        input.providerFailureMetadata,
        input.interactionSummaries,
      ),
      failure_category: input.failureCategory ?? null,
      result_project_id: input.projectId ?? null,
      estimated_cost_usd: input.estimatedCostUsd ?? null,
      actual_cost_usd: input.actualCostUsd ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.authorizationId)
    .eq('status', 'running');
}

async function persistProject(input: {
  userId: string;
  character: SelfCharacterRow;
  referenceImageUrls: Record<string, unknown>;
  publicCaption: string;
  anchorUrl: string;
  videoUrl: string;
}) {
  if (!supabaseAdmin) throw new Error('persistence_failed');
  const frontReferenceUrl = text(input.referenceImageUrls.frontFaceUrl) ??
    text(input.referenceImageUrls.frontFace);
  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      user_id: input.userId,
      title: 'Candlelit mansion scene',
      prompt: input.publicCaption,
      caption: input.publicCaption,
      final_prompt: input.publicCaption,
      style_preset: 'lumora-director-v1',
      status: 'completed',
      provider: 'google',
      engine: 'lumora-director-v1',
      display_engine: 'Lumora Director',
      model: GEMINI_OMNI_FLASH_MODEL,
      generation_mode: 'director-v1-single-candidate-synthetic',
      output_type: 'video',
      video_url: input.videoUrl,
      cover_asset_url: input.videoUrl,
      thumbnail_url: input.anchorUrl,
      poster_url: input.anchorUrl,
      thumbnail_source: 'generated_poster',
      character_id: input.character.id,
      identity_id: input.character.id,
      character_name: input.character.name,
      character_avatar: input.character.thumbnail_url ?? frontReferenceUrl,
      is_default_self_character: true,
      privacy: 'private',
      visibility: 'private',
      duration_seconds: 4,
      aspect_ratio: '9:16',
      keyframe_url: input.anchorUrl,
      reference_image_url: frontReferenceUrl,
      reference_image_urls: input.referenceImageUrls,
      additional_reference_image_urls: [],
      is_posted: false,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || typeof data?.id !== 'string') throw new Error('persistence_failed');
  return data.id;
}

async function replayTerminal(
  row: DirectorAuthorizationRow,
  plan: DirectorPlan,
): Promise<ProductionDirectorCanaryExecution> {
  const telemetry = telemetryFromUnknown(row.telemetry);
  if (row.status === 'completed' && row.result_project_id && supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('id,video_url,caption')
      .eq('id', row.result_project_id)
      .eq('user_id', row.user_id)
      .maybeSingle();
    if (data && typeof data.id === 'string' && typeof data.video_url === 'string') {
      return {
        httpStatus: 200,
        publicResult: {
          status: 'completed',
          message: 'Your scene is ready in Drafts.',
          draftSaved: true,
          projectId: data.id,
          videoUrl: data.video_url,
          publicCaption: text(data.caption) ?? plan.publicCaption,
          syntheticDisclosure: 'Synthetic portrayal',
        },
        internalDiagnostics: internalDiagnostics('idempotent_terminal', telemetry, {
          estimatedCostUsd: numeric(row.estimated_cost_usd),
          actualCostUsd: numeric(row.actual_cost_usd),
        }),
      };
    }
  }
  const category = (text(row.failure_category) ?? 'authorization_consumed') as DirectorCanaryFailureCategory;
  return failedExecution({
    authorizationState: 'idempotent_terminal',
    failureCategory: category,
    telemetry,
    plan,
    estimatedCostUsd: numeric(row.estimated_cost_usd),
    actualCostUsd: numeric(row.actual_cost_usd),
  });
}

export async function executeProductionDirectorCanary(input: {
  userId: string;
  authorizationId: string;
  idempotencyKey: string;
  authorizationStore?: DirectorAuthorizationClaimStore;
}): Promise<ProductionDirectorCanaryExecution> {
  const plan = buildDirectorProductionDryRun(DIRECTOR_CANARY_SCENE).plan;
  const emptyTelemetry = createDirectorCostTelemetry();
  if (
    !supabaseAdmin ||
    !env.GOOGLE_API_KEY ||
    !input.authorizationId.trim() ||
    !input.idempotencyKey.trim()
  ) {
    return failedExecution({
      authorizationState: 'missing',
      failureCategory: 'authorization_invalid',
      plan,
      httpStatus: 409,
    });
  }

  const claim = await resolveDirectorCanaryAuthorizationClaim(
    input.authorizationStore ?? supabaseAuthorizationStore,
    {
      authorizationId: input.authorizationId,
      userId: input.userId,
      sceneHash: directorCanarySceneHash(),
      idempotencyKey: input.idempotencyKey,
    },
  );
  if (claim.kind === 'missing') {
    return failedExecution({
      authorizationState: 'missing',
      failureCategory: 'authorization_missing',
      plan,
    });
  }
  if (claim.kind === 'expired') {
    return failedExecution({
      authorizationState: 'expired',
      failureCategory: 'authorization_expired',
      plan,
    });
  }
  if (claim.kind === 'idempotent_running') {
    return {
      httpStatus: 202,
      publicResult: {
        status: 'processing',
        message: 'Lumora is directing your scene',
        draftSaved: false,
        projectId: null,
        videoUrl: null,
        publicCaption: plan.publicCaption,
        syntheticDisclosure: 'Synthetic portrayal',
      },
      internalDiagnostics: internalDiagnostics(
        'idempotent_running',
        telemetryFromUnknown(claim.row.telemetry),
      ),
    };
  }
  if (claim.kind === 'idempotent_terminal') {
    return replayTerminal(claim.row, plan);
  }

  const authorization = authorizationFromRow(claim.row);
  if (!authorization) {
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory: 'authorization_invalid',
      plan,
    });
  }
  if (
    authorization.maximumCostUsd > DIRECTOR_CANARY_MAXIMUM_COST_USD ||
    DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD > authorization.maximumCostUsd
  ) {
    await updateAuthorization({
      authorizationId: authorization.id,
      status: 'failed',
      telemetry: emptyTelemetry,
      failureCategory: 'budget_guard',
      estimatedCostUsd: DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD,
    });
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory: 'budget_guard',
      telemetry: emptyTelemetry,
      plan,
      estimatedCostUsd: DIRECTOR_CANARY_PROJECTED_MAXIMUM_COST_USD,
    });
  }

  try {
    await createExecutionJob(authorization, plan);
  } catch {
    await updateAuthorization({
      authorizationId: authorization.id,
      status: 'failed',
      telemetry: emptyTelemetry,
      failureCategory: 'persistence_failed',
    });
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory: 'persistence_failed',
      plan,
    });
  }

  let frontReference: Awaited<ReturnType<typeof loadFrontReference>>;
  try {
    frontReference = await loadFrontReference(input.userId);
  } catch (error) {
    const failureCategory = error instanceof Error && error.message === 'front_reference_invalid'
      ? 'front_reference_invalid'
      : 'front_reference_missing';
    await Promise.all([
      updateAuthorization({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: emptyTelemetry,
        failureCategory,
      }),
      updateExecutionJob({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: emptyTelemetry,
        failureCategory,
      }),
    ]);
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory,
      plan,
    });
  }

  let anchorUrl: string | null = null;
  const sequence = await runDirectorCanarySequence({
    apiKey: env.GOOGLE_API_KEY,
    authorization,
    plan,
    frontReference: {
      data: Buffer.from(frontReference.bytes).toString('base64'),
      mimeType: frontReference.mimeType,
      ownershipConfirmed: true,
      role: 'front_face',
      hashPrefix: frontReference.hashPrefix,
    },
    dependencies: {
      runAnchor: nanoBananaAdapter.execute,
      runVideo: omniFlashAdapter.execute,
      resolveMediaBytes: (output) => resolveProviderMediaBytes(output, env.GOOGLE_API_KEY as string),
      persistAnchor: async ({ interactionId, bytes, mimeType }) => {
        const path =
          `${input.userId}/director/${authorization.id}/${interactionId}.` +
          extensionForMime(mimeType, 'image');
        anchorUrl = await uploadBytes({
          bucket: ANCHOR_BUCKET,
          path,
          bytes,
          contentType: mimeType,
        });
      },
    },
  });

  if (sequence.ok === false) {
    await Promise.all([
      updateAuthorization({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: sequence.telemetry,
        providerFailureMetadata: sequence.providerFailureMetadata,
        interactionSummaries: sequence.interactionSummaries,
        failureCategory: sequence.failureCategory,
        estimatedCostUsd: sequence.estimatedCostUsd,
        actualCostUsd: sequence.actualCostUsd,
      }),
      updateExecutionJob({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: sequence.telemetry,
        interactionSummaries: sequence.interactionSummaries,
        failureCategory: sequence.failureCategory,
      }),
    ]);
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory: sequence.failureCategory,
      telemetry: sequence.telemetry,
      plan,
      anchorSucceeded: sequence.anchorSuccess,
      estimatedCostUsd: sequence.estimatedCostUsd,
      actualCostUsd: sequence.actualCostUsd,
    });
  }

  try {
    if (!anchorUrl) throw new Error('persistence_failed');
    const videoPath =
      `${input.userId}/director/${authorization.id}/${sequence.videoInteractionId}.` +
      extensionForMime(sequence.videoMimeType, 'video');
    const videoUrl = await uploadBytes({
      bucket: VIDEO_BUCKET,
      path: videoPath,
      bytes: sequence.videoBytes,
      contentType: sequence.videoMimeType,
    });
    const projectId = await persistProject({
      userId: input.userId,
      character: frontReference.character,
      referenceImageUrls: frontReference.urls,
      publicCaption: sequence.publicCaption,
      anchorUrl,
      videoUrl,
    });
    await Promise.all([
      updateAuthorization({
        authorizationId: authorization.id,
        status: 'completed',
        telemetry: sequence.telemetry,
        interactionSummaries: sequence.interactionSummaries,
        projectId,
        estimatedCostUsd: sequence.estimatedCostUsd,
        actualCostUsd: sequence.actualCostUsd,
      }),
      updateExecutionJob({
        authorizationId: authorization.id,
        status: 'completed',
        telemetry: sequence.telemetry,
        interactionSummaries: sequence.interactionSummaries,
        projectId,
        videoUrl,
      }),
    ]);
    return {
      httpStatus: 200,
      publicResult: {
        status: 'completed',
        message: 'Your scene is ready in Drafts.',
        draftSaved: true,
        projectId,
        videoUrl,
        publicCaption: sequence.publicCaption,
        syntheticDisclosure: 'Synthetic portrayal',
      },
      internalDiagnostics: internalDiagnostics('claimed', sequence.telemetry, {
        estimatedCostUsd: sequence.estimatedCostUsd,
        actualCostUsd: sequence.actualCostUsd,
      }),
    };
  } catch {
    await Promise.all([
      updateAuthorization({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: sequence.telemetry,
        interactionSummaries: sequence.interactionSummaries,
        failureCategory: 'persistence_failed',
        estimatedCostUsd: sequence.estimatedCostUsd,
        actualCostUsd: sequence.actualCostUsd,
      }),
      updateExecutionJob({
        authorizationId: authorization.id,
        status: 'failed',
        telemetry: sequence.telemetry,
        interactionSummaries: sequence.interactionSummaries,
        failureCategory: 'persistence_failed',
      }),
    ]);
    return failedExecution({
      authorizationState: 'claimed',
      failureCategory: 'persistence_failed',
      telemetry: sequence.telemetry,
      plan,
      anchorSucceeded: true,
      estimatedCostUsd: sequence.estimatedCostUsd,
      actualCostUsd: sequence.actualCostUsd,
    });
  }
}
