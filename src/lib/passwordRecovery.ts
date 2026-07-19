import type { Session, SupabaseClient } from '@supabase/supabase-js';

export type PasswordRecoveryInput = {
  accessToken: string | null;
  authType: string | null;
  code: string | null;
  hasAuthError: boolean;
  refreshToken: string | null;
  tokenHash: string | null;
};

export type PasswordRecoveryResult = {
  session: Session | null;
  status: 'invalid' | 'manual' | 'valid';
};

const recoveryParamNames = [
  'access_token',
  'code',
  'error',
  'error_code',
  'error_description',
  'expires_at',
  'expires_in',
  'refresh_token',
  'token_hash',
  'token_type',
  'type',
];

let recoveryHandoffPromise: Promise<PasswordRecoveryResult> | null = null;

function hashParams(url: URL) {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}

export function parsePasswordRecoveryUrl(url: URL): PasswordRecoveryInput {
  const searchParams = url.searchParams;
  const fragmentParams = hashParams(url);

  return {
    code: searchParams.get('code') ?? fragmentParams.get('code'),
    accessToken: fragmentParams.get('access_token') ?? searchParams.get('access_token'),
    refreshToken: fragmentParams.get('refresh_token') ?? searchParams.get('refresh_token'),
    tokenHash: searchParams.get('token_hash') ?? fragmentParams.get('token_hash'),
    authType: searchParams.get('type') ?? fragmentParams.get('type'),
    hasAuthError: ['error', 'error_code', 'error_description'].some(
      (paramName) => searchParams.has(paramName) || fragmentParams.has(paramName),
    ),
  };
}

export function hasPasswordRecoveryIntent(input: PasswordRecoveryInput): boolean {
  return Boolean(
    input.code
      || input.tokenHash
      || (input.accessToken && input.refreshToken)
      || input.authType === 'recovery'
      || input.hasAuthError,
  );
}

export function cleanPasswordRecoveryUrl(url: URL = new URL(window.location.href)) {
  const nextUrl = new URL(url.href);
  const fragmentParams = hashParams(nextUrl);

  recoveryParamNames.forEach((paramName) => {
    nextUrl.searchParams.delete(paramName);
    fragmentParams.delete(paramName);
  });

  nextUrl.hash = fragmentParams.size > 0 ? `#${fragmentParams.toString()}` : '';
  const safePath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  window.history.replaceState({}, document.title, safePath);
}

export async function processPasswordRecovery(
  client: SupabaseClient,
  input: PasswordRecoveryInput,
): Promise<PasswordRecoveryResult> {
  if (!hasPasswordRecoveryIntent(input)) {
    return { session: null, status: 'manual' };
  }

  if (input.hasAuthError) {
    return { session: null, status: 'invalid' };
  }

  let recoveryEventSession: Session | null = null;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'PASSWORD_RECOVERY' && nextSession) {
      recoveryEventSession = nextSession;
    }
  });

  try {
    if (input.code) {
      const { data, error } = await client.auth.exchangeCodeForSession(input.code);
      const session = data.session ?? recoveryEventSession;
      return error || !session
        ? { session: null, status: 'invalid' }
        : { session, status: 'valid' };
    }

    if (input.tokenHash && input.authType === 'recovery') {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: 'recovery',
      });
      const session = data.session ?? recoveryEventSession;
      return error || !session
        ? { session: null, status: 'invalid' }
        : { session, status: 'valid' };
    }

    if (input.accessToken && input.refreshToken && input.authType === 'recovery') {
      const { data, error } = await client.auth.setSession({
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
      });
      const session = data.session ?? recoveryEventSession;
      return error || !session
        ? { session: null, status: 'invalid' }
        : { session, status: 'valid' };
    }

    if (recoveryEventSession) {
      return { session: recoveryEventSession, status: 'valid' };
    }

    return { session: null, status: 'invalid' };
  } catch {
    return { session: null, status: 'invalid' };
  } finally {
    subscription.unsubscribe();
  }
}

export function processPasswordRecoveryOnce(
  client: SupabaseClient,
  input: PasswordRecoveryInput,
): Promise<PasswordRecoveryResult> {
  if (!hasPasswordRecoveryIntent(input)) {
    return Promise.resolve({ session: null, status: 'manual' });
  }

  if (!recoveryHandoffPromise) {
    recoveryHandoffPromise = processPasswordRecovery(client, input);
  }

  return recoveryHandoffPromise;
}
