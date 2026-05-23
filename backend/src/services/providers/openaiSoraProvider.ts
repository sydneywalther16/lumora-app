import { env } from '../../lib/env';
import { query } from '../db';

export const OPENAI_SORA_CHARACTER_CANARY_PROMPT =
  'The verified self character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft cinematic storybook style, gentle camera motion.';

export type OpenAISoraRoute = 'openai_sora_character' | 'seedance_text_guidance' | 'unavailable';

export type OpenAISoraProviderReadiness = {
  openaiVideoEnabled: boolean;
  openaiVideoModel: string;
  openaiCharacterEnabled: boolean;
  openaiApiKeyConfigured: boolean;
  openaiCharacterConfigured: boolean;
  sdkVideoSupported: boolean;
  sdkCharacterSupported: boolean;
  routeReady: boolean;
  status:
    | 'disabled'
    | 'missing_api_key'
    | 'configured_but_unsupported_by_current_sdk'
    | 'ready';
  message: string;
};

export type SoraCharacterSetupInput = {
  consentConfirmed: boolean;
  sourceUploadAssetId?: string | null;
  sourceVideoUrl?: string | null;
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
  const openaiCharacterConfigured =
    env.OPENAI_VIDEO_ENABLED &&
    env.OPENAI_VIDEO_CHARACTER_ENABLED &&
    openaiApiKeyConfigured;

  if (!env.OPENAI_VIDEO_ENABLED || !env.OPENAI_VIDEO_CHARACTER_ENABLED) {
    return {
      openaiVideoEnabled: env.OPENAI_VIDEO_ENABLED,
      openaiVideoModel: env.OPENAI_VIDEO_MODEL,
      openaiCharacterEnabled: env.OPENAI_VIDEO_CHARACTER_ENABLED,
      openaiApiKeyConfigured,
      openaiCharacterConfigured: false,
      sdkVideoSupported,
      sdkCharacterSupported,
      routeReady: false,
      status: 'disabled',
      message: 'OpenAI video character routing is disabled by configuration.',
    };
  }

  if (!openaiApiKeyConfigured) {
    return {
      openaiVideoEnabled: env.OPENAI_VIDEO_ENABLED,
      openaiVideoModel: env.OPENAI_VIDEO_MODEL,
      openaiCharacterEnabled: env.OPENAI_VIDEO_CHARACTER_ENABLED,
      openaiApiKeyConfigured,
      openaiCharacterConfigured: false,
      sdkVideoSupported,
      sdkCharacterSupported,
      routeReady: false,
      status: 'missing_api_key',
      message: 'OPENAI_API_KEY is required before OpenAI video character routing can run.',
    };
  }

  if (!sdkVideoSupported || !sdkCharacterSupported) {
    return {
      openaiVideoEnabled: env.OPENAI_VIDEO_ENABLED,
      openaiVideoModel: env.OPENAI_VIDEO_MODEL,
      openaiCharacterEnabled: env.OPENAI_VIDEO_CHARACTER_ENABLED,
      openaiApiKeyConfigured,
      openaiCharacterConfigured,
      sdkVideoSupported,
      sdkCharacterSupported,
      routeReady: false,
      status: 'configured_but_unsupported_by_current_sdk',
      message: 'OpenAI video character routing is configured, but the installed OpenAI SDK/API surface does not expose a supported Videos/Characters route.',
    };
  }

  return {
    openaiVideoEnabled: env.OPENAI_VIDEO_ENABLED,
    openaiVideoModel: env.OPENAI_VIDEO_MODEL,
    openaiCharacterEnabled: env.OPENAI_VIDEO_CHARACTER_ENABLED,
    openaiApiKeyConfigured,
    openaiCharacterConfigured,
    sdkVideoSupported,
    sdkCharacterSupported,
    routeReady: true,
    status: 'ready',
    message: 'OpenAI video character routing is configured and supported.',
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
  const status = readiness.status === 'missing_api_key' || readiness.status === 'configured_but_unsupported_by_current_sdk'
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
    return {
      ok: false,
      status: readiness.status,
      provider: 'openai_sora',
      model: readiness.openaiVideoModel,
      output_url_present: false,
      parsed_video_url_present: false,
      failureCategory: readiness.status,
      recommendedNextAction: readiness.status === 'configured_but_unsupported_by_current_sdk'
        ? 'Upgrade the OpenAI SDK/API integration to a documented Videos/Characters route before running a paid canary.'
        : 'Enable OPENAI_VIDEO_ENABLED and OPENAI_VIDEO_CHARACTER_ENABLED after OpenAI video character support is configured.',
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
