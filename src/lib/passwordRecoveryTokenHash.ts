import type { SupabaseClient } from '@supabase/supabase-js';

export type PasswordRecoveryTokenInput = {
  hasRecoveryType: boolean;
  tokenHash: string | null;
};

export type PasswordRecoveryVerificationResult = 'invalid' | 'valid';

const resetConfirmationParamNames = ['token_hash', 'type'];

function hashParams(url: URL) {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}

export function parsePasswordRecoveryToken(url: URL): PasswordRecoveryTokenInput {
  const fragmentParams = hashParams(url);
  const tokenHash = url.searchParams.get('token_hash') ?? fragmentParams.get('token_hash');
  const authType = url.searchParams.get('type') ?? fragmentParams.get('type');

  return {
    hasRecoveryType: authType === 'recovery',
    tokenHash,
  };
}

export function hasPasswordRecoveryToken(input: PasswordRecoveryTokenInput): boolean {
  return Boolean(input.tokenHash && input.hasRecoveryType);
}

export function passwordResetConfirmSafePath(url: URL): string {
  const nextUrl = new URL(url.href);
  const fragmentParams = hashParams(nextUrl);

  resetConfirmationParamNames.forEach((paramName) => {
    nextUrl.searchParams.delete(paramName);
    fragmentParams.delete(paramName);
  });

  nextUrl.hash = fragmentParams.size > 0 ? `#${fragmentParams.toString()}` : '';
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export function cleanPasswordResetConfirmUrl(url: URL = new URL(window.location.href)) {
  window.history.replaceState({}, document.title, passwordResetConfirmSafePath(url));
}

export function createPasswordRecoveryVerifier(
  client: SupabaseClient,
  input: PasswordRecoveryTokenInput,
) {
  let tokenHash = input.tokenHash;
  let verificationPromise: Promise<PasswordRecoveryVerificationResult> | null = null;

  return {
    verify(): Promise<PasswordRecoveryVerificationResult> {
      if (verificationPromise) return verificationPromise;
      if (!tokenHash || !input.hasRecoveryType) return Promise.resolve('invalid');

      const tokenToVerify = tokenHash;
      verificationPromise = (async () => {
        try {
          const { data, error } = await client.auth.verifyOtp({
            token_hash: tokenToVerify,
            type: 'recovery',
          });

          return error || !data.session?.user ? 'invalid' : 'valid';
        } catch {
          return 'invalid';
        } finally {
          tokenHash = null;
        }
      })();

      return verificationPromise;
    },
  };
}
