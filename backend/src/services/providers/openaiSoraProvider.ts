import { env } from '../../lib/env';
import { query } from '../db';
import {
  OPENAI_CHARACTER_VIDEO_USAGE_MAPPED,
  OPENAI_VIDEOS_DEPRECATED,
  OPENAI_VIDEOS_SHUTDOWN_DATE,
  OpenAIVideosRawClient,
  OpenAIVideosRawError,
  type OpenAIVideoFailureCategory,
} from './openaiVideosRawClient';

export const OPENAI_SORA_CHARACTER_CANARY_PROMPT =
  'The verified self character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft cinematic storybook style, gentle camera motion.';

export type OpenAISoraRoute = 'openai_sora_character' | 'seedance_text_guidance' | 'unavailable';

export type OpenAISoraProviderReadiness = {
  openaiVideoEnabled: boolean;
  openaiVideoModel: string;
  openaiVideoSize: string;
  openaiVideoSeconds: number;
  openaiCharacterEnabled: boolean;
  openaiApiKeyConfigured: boolean;
  openaiCharacterConfigured: boolean;
  openaiRawRestAvailable: boolean;
  openaiSdkVideosAvailable: boolean;
  apiReachable: boolean | null;
  openaiVideosDeprecated: boolean;
  shutdownDate: string;
  characterCreationSupported: boolean;
  characterVideoUsageMapped: boolean;
  sdkVideoSupported: boolean;
  sdkCharacterSupported: boolean;
  routeReady: boolean;
  status:
    | 'disabled'
    | 'missing_api_key'
    | 'character_creation_available_video_usage_unmapped'
    | 'ready';
  message: string;
  recommendedNextAction: string;
};

export type SoraCharacterSetupInput = {
  consentConfirmed: boolean;
  sourceUploadAssetId?: string | null;
  sourceVideoUrl?: string | null;
  sourceVideoBuffer?: Buffer | null;
  sourceVideoFilename?: string | null;
  sourceVideoContentType?: string | null;
  characterName?: string | null;
};

export type SoraCharacterIdentityPatch = {
  providerIdentityProvider: 'openai_sora';
  providerCharacterId: string | null;
  providerCharacterStatus: 'pending' | 'ready' | 'failed' | 'disabled';
  providerCharacterCreatedAt: string | null;
  providerCharacterLastVerifiedAt: string | null;
  likenessProviderStatus: string;
  likenessConsentAt: string;
  providerCharacterSourceAssetId: string | null;
};

export type SoraCreateRouteDecision = {
  selectedCreateLikenessRoute: OpenAISoraRoute;
  whyChosen: string;
  usingVerifiedSelfCharacter: boolean;
  fallbackAllowed: boolean;
};

export type SelfProviderCharacterDiagnostics = {
  schemaReady: boolean;
  selfProviderCharacterIdPresent: boolean;
  selfProviderCharacterStatus: string | null;
  selfProviderIdentityProvider: string | null;
  selfProviderCharacterIdRedacted: string | null;
  providerCharacterLastVerifiedAt: string | null;
  likenessProviderStatus: string | null;
  soraCharacterCanaryStatus: string | null;
};

export type OpenAISoraCharacterSetupResult = {
  ok: boolean;
  patch: SoraCharacterIdentityPatch;
  statusCode: number;
  message: string;
  failureCategory: OpenAIVideoFailureCategory | OpenAISoraProviderReadiness['status'] | null;
  providerCharacterIdPresent: boolean;
  providerCharacterIdRedacted: string | null;
};

export class OpenAISoraProviderError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'OpenAISoraProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function hasInstalledSdkVideoSupport() {
  return false;
}

function hasInstalledSdkCharacterSupport() {
  return false;
}

function optionalIdentitySchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes('42703') || lower.includes('42p01') || lower.includes('provider_character');
}

export function redactProviderCharacterId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 10) return '[redacted-id-present]';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function getOpenAISoraProviderReadiness(): OpenAISoraProviderReadiness {
  const sdkVideoSupported = hasInstalledSdkVideoSupport();
  const sdkCharacterSupported = hasInstalledSdkCharacterSupport();
  const openaiApiKeyConfigured = Boolean(env.OPENAI_API_KEY);
  const openaiRawRestAvailable = true;
  const characterCreationSupported = true;
  const characterVideoUsageMapped = OPENAI_CHARACTER_VIDEO_USAGE_MAPPED;
  const openaiCharacterConfigured =
    env.OPENAI_VIDEO_ENABLED &&
    env.OPENAI_VIDEO_CHARACTER_ENABLED &&
    openaiApiKeyConfigured;
  const base = {
    openaiVideoEnabled: env.OPENAI_VIDEO_ENABLED,
    openaiVideoModel: env.OPENAI_VIDEO_MODEL,
    openaiVideoSize: env.OPENAI_VIDEO_SIZE,
    openaiVideoSeconds: env.OPENAI_VIDEO_SECONDS,
    openaiCharacterEnabled: env.OPENAI_VIDEO_CHARACTER_ENABLED,
    openaiApiKeyConfigured,
    openaiCharacterConfigured,
    openaiRawRestAvailable,
    openaiSdkVideosAvailable: sdkVideoSupported,
    apiReachable: null,
    openaiVideosDeprecated: OPENAI_VIDEOS_DEPRECATED,
    shutdownDate: OPENAI_VIDEOS_SHUTDOWN_DATE,
    characterCreationSupported,
    characterVideoUsageMapped,
    sdkVideoSupported,
    sdkCharacterSupported,
  };

  if (!env.OPENAI_VIDEO_ENABLED || !env.OPENAI_VIDEO_CHARACTER_ENABLED) {
    return {
      ...base,
      openaiCharacterConfigured: false,
      routeReady: false,
      status: 'disabled',
      message: 'OpenAI video character routing is disabled by configuration.',
      recommendedNextAction: 'Enable OPENAI_VIDEO_ENABLED and OPENAI_VIDEO_CHARACTER_ENABLED to create a provider self character.',
    };
  }

  if (!openaiApiKeyConfigured) {
    return {
      ...base,
      openaiCharacterConfigured: false,
      routeReady: false,
      status: 'missing_api_key',
      message: 'OPENAI_API_KEY is required before OpenAI video character routing can run.',
      recommendedNextAction: 'Set OPENAI_API_KEY, OPENAI_VIDEO_ENABLED=true, and OPENAI_VIDEO_CHARACTER_ENABLED=true.',
    };
  }

  if (!characterVideoUsageMapped) {
    return {
      ...base,
      routeReady: false,
      status: 'character_creation_available_video_usage_unmapped',
      message: 'OpenAI raw Videos REST is configured for character creation, but video generation with stored character ids is not mapped yet.',
      recommendedNextAction: 'Create the verified self character if needed, then continue using Seedance text-first until character video usage is mapped.',
    };
  }

  return {
    ...base,
    routeReady: true,
    status: 'ready',
    message: 'OpenAI video character routing is configured through raw REST and ready.',
    recommendedNextAction: 'Run the Sora character canary before enabling production exact-likeness renders.',
  };
}

export function validateSoraCharacterConsent(input: Pick<SoraCharacterSetupInput, 'consentConfirmed'>) {
  if (!input.consentConfirmed) {
    throw new OpenAISoraProviderError(
      'sora_character_consent_required',
      'Consent confirmation is required before creating a verified self character.',
      400,
    );
  }
}

export function buildDisabledSoraCharacterIdentityPatch(
  input: SoraCharacterSetupInput,
  readiness = getOpenAISoraProviderReadiness(),
): SoraCharacterIdentityPatch {
  validateSoraCharacterConsent(input);
  const now = new Date().toISOString();
  const status = readiness.status === 'missing_api_key'
    ? 'failed'
    : 'disabled';

  return {
    providerIdentityProvider: 'openai_sora',
    providerCharacterId: null,
    providerCharacterStatus: status,
    providerCharacterCreatedAt: null,
    providerCharacterLastVerifiedAt: null,
    likenessProviderStatus: readiness.status,
    likenessConsentAt: now,
    providerCharacterSourceAssetId: input.sourceUploadAssetId ?? input.sourceVideoUrl ?? null,
  };
}

function buildSoraCharacterIdentityPatch(input: {
  providerCharacterId: string | null;
  providerCharacterStatus: SoraCharacterIdentityPatch['providerCharacterStatus'];
  likenessProviderStatus: string;
  sourceUploadAssetId?: string | null;
  sourceVideoUrl?: string | null;
  createdAt?: string | null;
}) {
  const now = new Date().toISOString();
  return {
    providerIdentityProvider: 'openai_sora',
    providerCharacterId: input.providerCharacterId,
    providerCharacterStatus: input.providerCharacterStatus,
    providerCharacterCreatedAt: input.createdAt ?? (input.providerCharacterId ? now : null),
    providerCharacterLastVerifiedAt: null,
    likenessProviderStatus: input.likenessProviderStatus,
    likenessConsentAt: now,
    providerCharacterSourceAssetId: input.sourceUploadAssetId ?? input.sourceVideoUrl ?? null,
  } satisfies SoraCharacterIdentityPatch;
}

const MAX_PROVIDER_IDENTITY_VIDEO_BYTES = 100 * 1024 * 1024;

async function loadIdentityVideo(input: SoraCharacterSetupInput) {
  if (input.sourceVideoBuffer?.length) {
    return {
      buffer: input.sourceVideoBuffer,
      filename: input.sourceVideoFilename ?? 'self-character-video.mp4',
      contentType: input.sourceVideoContentType ?? 'video/mp4',
    };
  }

  if (!input.sourceVideoUrl) {
    throw new OpenAISoraProviderError(
      'identity_video_required',
      'Upload a short self video before creating a verified self character.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetch(input.sourceVideoUrl);
  } catch {
    throw new OpenAISoraProviderError(
      'identity_video_download_failed',
      'Lumora could not download the self character video for provider setup.',
      400,
    );
  }

  if (!response.ok) {
    throw new OpenAISoraProviderError(
      'identity_video_download_failed',
      'Lumora could not access the self character video for provider setup.',
      400,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('video/')) {
    throw new OpenAISoraProviderError(
      'identity_video_invalid_content_type',
      'The verified self character upload must be a video file.',
      400,
    );
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_PROVIDER_IDENTITY_VIDEO_BYTES) {
    throw new OpenAISoraProviderError(
      'identity_video_too_large',
      'The verified self character video is too large for setup.',
      400,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new OpenAISoraProviderError(
      'identity_video_empty',
      'The verified self character video was empty.',
      400,
    );
  }
  if (buffer.length > MAX_PROVIDER_IDENTITY_VIDEO_BYTES) {
    throw new OpenAISoraProviderError(
      'identity_video_too_large',
      'The verified self character video is too large for setup.',
      400,
    );
  }

  return {
    buffer,
    filename: input.sourceVideoFilename ?? 'self-character-video.mp4',
    contentType,
  };
}

export async function createOpenAISoraCharacterIdentity(
  input: SoraCharacterSetupInput,
): Promise<OpenAISoraCharacterSetupResult> {
  validateSoraCharacterConsent(input);
  const readiness = getOpenAISoraProviderReadiness();

  if (!readiness.openaiCharacterConfigured || !env.OPENAI_API_KEY) {
    const patch = buildDisabledSoraCharacterIdentityPatch(input, readiness);
    return {
      ok: false,
      patch,
      statusCode: readiness.status === 'missing_api_key' ? 400 : 200,
      message: readiness.message,
      failureCategory: readiness.status,
      providerCharacterIdPresent: false,
      providerCharacterIdRedacted: null,
    };
  }

  try {
    const video = await loadIdentityVideo(input);
    const client = new OpenAIVideosRawClient({ apiKey: env.OPENAI_API_KEY });
    const character = await client.createCharacter({
      name: input.characterName?.trim() || 'Lumora self character',
      videoBuffer: video.buffer,
      filename: video.filename,
      contentType: video.contentType,
    });
    if (!character.id) {
      throw new OpenAIVideosRawError({
        code: 'openai_character_response_missing_id',
        category: 'openai_raw_api_error',
        message: 'OpenAI character creation did not return a provider character id.',
      });
    }
    const patch = buildSoraCharacterIdentityPatch({
      providerCharacterId: character.id,
      providerCharacterStatus: 'ready',
      likenessProviderStatus: readiness.characterVideoUsageMapped
        ? 'character_created_needs_canary'
        : 'character_created_usage_unmapped',
      sourceUploadAssetId: input.sourceUploadAssetId,
      sourceVideoUrl: input.sourceVideoUrl,
    });

    return {
      ok: true,
      patch,
      statusCode: 201,
      message: readiness.characterVideoUsageMapped
        ? 'Verified self character created. Run the canary before production use.'
        : 'Verified self character created. Video route not available yet.',
      failureCategory: null,
      providerCharacterIdPresent: true,
      providerCharacterIdRedacted: redactProviderCharacterId(character.id),
    };
  } catch (error) {
    if (error instanceof OpenAISoraProviderError) {
      throw error;
    }
    if (error instanceof OpenAIVideosRawError) {
      const patch = buildSoraCharacterIdentityPatch({
        providerCharacterId: null,
        providerCharacterStatus: 'failed',
        likenessProviderStatus: error.category,
        sourceUploadAssetId: input.sourceUploadAssetId,
        sourceVideoUrl: input.sourceVideoUrl,
      });

      return {
        ok: false,
        patch,
        statusCode: error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? 400 : 502,
        message: error.message,
        failureCategory: error.category,
        providerCharacterIdPresent: false,
        providerCharacterIdRedacted: null,
      };
    }
    throw error;
  }
}

export function chooseSoraSelfCharacterCreateRoute(input: {
  readiness?: OpenAISoraProviderReadiness;
  providerCharacterId?: string | null;
  providerCharacterStatus?: string | null;
  likenessProviderStatus?: string | null;
  allowFallback?: boolean;
}): SoraCreateRouteDecision {
  const readiness = input.readiness ?? getOpenAISoraProviderReadiness();
  const providerReady =
    readiness.routeReady &&
    Boolean(input.providerCharacterId) &&
    input.providerCharacterStatus === 'ready' &&
    input.likenessProviderStatus === 'canary_succeeded';

  if (providerReady) {
    return {
      selectedCreateLikenessRoute: 'openai_sora_character',
      whyChosen: 'Verified OpenAI self character route is configured, ready, and canary succeeded.',
      usingVerifiedSelfCharacter: true,
      fallbackAllowed: input.allowFallback ?? true,
    };
  }

  if (input.providerCharacterStatus === 'ready' && readiness.openaiCharacterConfigured) {
    return {
      selectedCreateLikenessRoute: 'seedance_text_guidance',
      whyChosen: 'Self character route needs a successful canary before production rendering.',
      usingVerifiedSelfCharacter: false,
      fallbackAllowed: true,
    };
  }

  if (readiness.status !== 'disabled' && readiness.status !== 'ready') {
    return {
      selectedCreateLikenessRoute: 'seedance_text_guidance',
      whyChosen: readiness.message,
      usingVerifiedSelfCharacter: false,
      fallbackAllowed: true,
    };
  }

  return {
    selectedCreateLikenessRoute: 'seedance_text_guidance',
    whyChosen: 'OpenAI self character route is unavailable, so Create uses Seedance text self guidance.',
    usingVerifiedSelfCharacter: false,
    fallbackAllowed: true,
  };
}

export async function getSelfProviderCharacterDiagnostics(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}): Promise<SelfProviderCharacterDiagnostics> {
  try {
    const params: unknown[] = [];
    const characterFilters: string[] = [];
    if (input.userId) {
      params.push(input.userId);
      characterFilters.push(`owner_user_id = $${params.length}`);
    }
    if (input.characterId) {
      params.push(input.characterId);
      characterFilters.push(`(id::text = $${params.length} or character_id = $${params.length})`);
    } else {
      characterFilters.push(`coalesce(is_self, false) = true or character_id = 'creator-self'`);
    }

    const characterResult = await query<{
      providerIdentityProvider: string | null;
      providerCharacterId: string | null;
      providerCharacterStatus: string | null;
      providerCharacterLastVerifiedAt: string | null;
      likenessProviderStatus: string | null;
    }>(
      `select
         provider_identity_provider as "providerIdentityProvider",
         provider_character_id as "providerCharacterId",
         provider_character_status as "providerCharacterStatus",
         provider_character_last_verified_at as "providerCharacterLastVerifiedAt",
         likeness_provider_status as "likenessProviderStatus"
       from character_profiles
       where ${characterFilters.map((filter) => `(${filter})`).join(' and ')}
       order by is_self desc, updated_at desc
       limit 1`,
      params,
    );
    const characterRow = characterResult.rows[0] ?? null;

    if (characterRow?.providerCharacterId || characterRow?.providerCharacterStatus) {
      return {
        schemaReady: true,
        selfProviderCharacterIdPresent: Boolean(characterRow.providerCharacterId),
        selfProviderCharacterStatus: characterRow.providerCharacterStatus,
        selfProviderIdentityProvider: characterRow.providerIdentityProvider,
        selfProviderCharacterIdRedacted: redactProviderCharacterId(characterRow.providerCharacterId),
        providerCharacterLastVerifiedAt: characterRow.providerCharacterLastVerifiedAt,
        likenessProviderStatus: characterRow.likenessProviderStatus,
        soraCharacterCanaryStatus: characterRow.likenessProviderStatus === 'canary_succeeded' ? 'succeeded' : characterRow.likenessProviderStatus,
      };
    }

    const selfParams: unknown[] = [];
    const selfFilters: string[] = [];
    if (input.userId) {
      selfParams.push(input.userId);
      selfFilters.push(`user_id = $${selfParams.length}`);
    }
    const selfResult = await query<typeof characterRow>(
      `select
         provider_identity_provider as "providerIdentityProvider",
         provider_character_id as "providerCharacterId",
         provider_character_status as "providerCharacterStatus",
         provider_character_last_verified_at as "providerCharacterLastVerifiedAt",
         likeness_provider_status as "likenessProviderStatus"
       from self_characters
       ${selfFilters.length ? `where ${selfFilters.join(' and ')}` : ''}
       order by updated_at desc
       limit 1`,
      selfParams,
    );
    const selfRow = selfResult.rows[0] ?? null;

    return {
      schemaReady: true,
      selfProviderCharacterIdPresent: Boolean(selfRow?.providerCharacterId),
      selfProviderCharacterStatus: selfRow?.providerCharacterStatus ?? null,
      selfProviderIdentityProvider: selfRow?.providerIdentityProvider ?? null,
      selfProviderCharacterIdRedacted: redactProviderCharacterId(selfRow?.providerCharacterId),
      providerCharacterLastVerifiedAt: selfRow?.providerCharacterLastVerifiedAt ?? null,
      likenessProviderStatus: selfRow?.likenessProviderStatus ?? null,
      soraCharacterCanaryStatus: selfRow?.likenessProviderStatus === 'canary_succeeded' ? 'succeeded' : selfRow?.likenessProviderStatus ?? null,
    };
  } catch (error) {
    if (optionalIdentitySchemaError(error)) {
      return {
        schemaReady: false,
        selfProviderCharacterIdPresent: false,
        selfProviderCharacterStatus: null,
        selfProviderIdentityProvider: null,
        selfProviderCharacterIdRedacted: null,
        providerCharacterLastVerifiedAt: null,
        likenessProviderStatus: null,
        soraCharacterCanaryStatus: null,
      };
    }
    throw error;
  }
}

export async function startOpenAISoraSelfCharacterCanary(input: {
  userId?: string | null;
  characterId?: string | null;
}) {
  const readiness = getOpenAISoraProviderReadiness();
  const identity = await getSelfProviderCharacterDiagnostics(input);
  const route = chooseSoraSelfCharacterCreateRoute({
    readiness,
    providerCharacterId: identity.selfProviderCharacterIdPresent ? 'present' : null,
    providerCharacterStatus: identity.selfProviderCharacterStatus,
    likenessProviderStatus: identity.likenessProviderStatus,
  });

  if (!readiness.routeReady) {
    if (readiness.openaiCharacterConfigured && !readiness.characterVideoUsageMapped) {
      return {
        ok: false,
        error: 'character_video_usage_unmapped',
        status: 'character_video_usage_unmapped',
        provider: 'openai_sora',
        model: readiness.openaiVideoModel,
        output_url_present: false,
        parsed_video_url_present: false,
        failureCategory: 'unsupported_until_character_usage_mapped',
        recommendedNextAction: 'Character creation is available, but video generation with a stored character id is not mapped yet. Continue using Seedance text-first or configure another likeness provider.',
        openaiRawRestAvailable: readiness.openaiRawRestAvailable,
        openaiSdkVideosAvailable: readiness.openaiSdkVideosAvailable,
        characterCreationSupported: readiness.characterCreationSupported,
        characterVideoUsageMapped: readiness.characterVideoUsageMapped,
        selfProviderCharacterIdPresent: identity.selfProviderCharacterIdPresent,
        route,
        message: 'Character creation is available, but video generation with a stored character id is not mapped yet.',
        warning: 'This may consume provider credits when a supported provider route is enabled.',
      };
    }

    return {
      ok: false,
      status: readiness.status,
      provider: 'openai_sora',
      model: readiness.openaiVideoModel,
      output_url_present: false,
      parsed_video_url_present: false,
      failureCategory: readiness.status,
      recommendedNextAction: 'Enable OPENAI_VIDEO_ENABLED and OPENAI_VIDEO_CHARACTER_ENABLED after OpenAI video character support is configured.',
      openaiRawRestAvailable: readiness.openaiRawRestAvailable,
      openaiSdkVideosAvailable: readiness.openaiSdkVideosAvailable,
      characterCreationSupported: readiness.characterCreationSupported,
      characterVideoUsageMapped: readiness.characterVideoUsageMapped,
      selfProviderCharacterIdPresent: identity.selfProviderCharacterIdPresent,
      route,
      warning: 'This may consume provider credits when a supported provider route is enabled.',
    };
  }

  if (!identity.selfProviderCharacterIdPresent) {
    return {
      ok: false,
      status: 'missing_provider_character',
      provider: 'openai_sora',
      model: readiness.openaiVideoModel,
      output_url_present: false,
      parsed_video_url_present: false,
      failureCategory: 'missing_provider_character',
      recommendedNextAction: 'Create a verified self character before running the OpenAI character canary.',
      openaiRawRestAvailable: readiness.openaiRawRestAvailable,
      openaiSdkVideosAvailable: readiness.openaiSdkVideosAvailable,
      characterCreationSupported: readiness.characterCreationSupported,
      characterVideoUsageMapped: readiness.characterVideoUsageMapped,
      selfProviderCharacterIdPresent: false,
      route,
      warning: 'This may consume provider credits when a supported provider route is enabled.',
    };
  }

  return {
    ok: false,
    status: 'configured_but_not_implemented',
    provider: 'openai_sora',
    model: readiness.openaiVideoModel,
    output_url_present: false,
    parsed_video_url_present: false,
    failureCategory: 'openai_video_character_unsupported',
    recommendedNextAction: 'Implement the documented OpenAI Videos/Characters request payload before enabling paid canaries.',
    route,
    prompt: OPENAI_SORA_CHARACTER_CANARY_PROMPT,
    warning: 'This may consume provider credits when a supported provider route is enabled.',
  };
}
