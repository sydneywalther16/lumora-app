import { useEffect, useState } from 'react';
import { AUTH_CALLBACK_PATH, consumeAuthRedirectPath } from '../hooks/useSession';
import { supabase } from '../lib/supabase';

function getHashParams(url: URL) {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}

function logExchangeResult(input: {
  session: boolean;
  userId?: string | null;
  skipped?: boolean;
  reason?: string;
  error?: string | null;
}) {
  console.log('EXCHANGE RESULT', {
    session: input.session,
    userId: input.userId ?? null,
    skipped: input.skipped ?? false,
    reason: input.reason ?? null,
    error: input.error ?? null,
  });
}

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Checking session...');

  useEffect(() => {
    let active = true;

    async function finishAuthCallback() {
      const callbackUrl = window.location.href;
      console.log('AUTH CALLBACK URL', callbackUrl);

      if (!supabase) {
        console.warn('AUTH REDIRECT URL WARNING', {
          message: 'Supabase is not configured for this app.',
          callbackUrl,
        });
        if (active) setStatus('Supabase is not configured.');
        window.setTimeout(() => window.location.replace('/profile'), 900);
        return;
      }

      try {
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const hashParams = getHashParams(url);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (url.pathname !== AUTH_CALLBACK_PATH) {
          console.warn('AUTH REDIRECT URL WARNING', {
            callbackPath: url.pathname,
            expectedPath: AUTH_CALLBACK_PATH,
          });
        }

        if (!code && !accessToken) {
          console.warn('AUTH REDIRECT URL WARNING', {
            message: 'Auth callback opened without ?code= or #access_token.',
            callbackUrl,
          });
        }

        if (active) setStatus('Restoring your Lumora session...');

        const initialSessionResult = await supabase.auth.getSession();
        if (initialSessionResult.error) {
          console.error('AUTH CALLBACK INITIAL SESSION ERROR', initialSessionResult.error);
        }

        if (initialSessionResult.data.session) {
          logExchangeResult({
            session: true,
            userId: initialSessionResult.data.session.user.id,
            skipped: true,
            reason: code ? 'session already detected from PKCE callback' : 'session already restored',
            error: initialSessionResult.error?.message ?? null,
          });
        } else if (code) {
          const exchangeResult = await supabase.auth.exchangeCodeForSession(code);
          logExchangeResult({
            session: Boolean(exchangeResult.data.session),
            userId: exchangeResult.data.session?.user.id ?? exchangeResult.data.user?.id ?? null,
            error: exchangeResult.error?.message ?? null,
          });

          if (exchangeResult.error) {
            throw exchangeResult.error;
          }
        } else if (accessToken && refreshToken) {
          const exchangeResult = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          logExchangeResult({
            session: Boolean(exchangeResult.data.session),
            userId: exchangeResult.data.session?.user.id ?? null,
            reason: 'hash token session saved',
            error: exchangeResult.error?.message ?? null,
          });

          if (exchangeResult.error) {
            throw exchangeResult.error;
          }
        } else {
          logExchangeResult({
            session: false,
            skipped: true,
            reason: 'no auth code or token in callback URL',
          });
        }

        const sessionResult = await supabase.auth.getSession();
        console.log('SESSION AFTER CALLBACK', {
          session: Boolean(sessionResult.data.session),
          userId: sessionResult.data.session?.user.id ?? null,
          error: sessionResult.error?.message ?? null,
        });

        if (sessionResult.error) {
          throw sessionResult.error;
        }

        const redirectPath = sessionResult.data.session ? consumeAuthRedirectPath('/profile') : '/profile';
        window.location.replace(redirectPath);
      } catch (error) {
        console.error('AUTH CALLBACK ERROR', error);
        if (active) {
          setStatus(error instanceof Error ? error.message : 'Unable to finish sign-in.');
        }
        window.setTimeout(() => window.location.replace('/profile'), 1400);
      }
    }

    void finishAuthCallback();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <section className="headline-card" style={{ width: '100%', textAlign: 'center' }}>
        <span className="eyebrow">creator access</span>
        <h1 style={{ marginTop: '8px' }}>Checking session...</h1>
        <p className="muted">{status}</p>
      </section>
    </div>
  );
}
