import { useEffect, useState } from 'react';
import { AUTH_CALLBACK_PATH, consumeAuthRedirectPath } from '../hooks/useSession';
import { supabase } from '../lib/supabase';

function getHashParams(url: URL) {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}

function logExchangeResult(input: {
  session: boolean;
  skipped?: boolean;
  hasAuthError?: boolean;
}) {
  console.log('EXCHANGE RESULT', {
    hasSession: input.session,
    skipped: input.skipped ?? false,
    hasAuthError: input.hasAuthError ?? false,
  });
}

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Checking session...');

  useEffect(() => {
    let active = true;

    async function finishAuthCallback() {
      const callbackUrl = new URL(window.location.href);
      console.log('AUTH CALLBACK PATH', {
        pathname: callbackUrl.pathname,
      });

      if (!supabase) {
        console.warn('AUTH REDIRECT URL WARNING', {
          message: 'Supabase is not configured for this app.',
          callbackPath: callbackUrl.pathname,
        });
        if (active) setStatus('Supabase is not configured.');
        window.setTimeout(() => window.location.replace('/profile'), 900);
        return;
      }

      try {
        const code = callbackUrl.searchParams.get('code');
        const hashParams = getHashParams(callbackUrl);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (callbackUrl.pathname !== AUTH_CALLBACK_PATH) {
          console.warn('AUTH REDIRECT URL WARNING', {
            callbackPath: callbackUrl.pathname,
            expectedPath: AUTH_CALLBACK_PATH,
          });
        }

        if (!code && !accessToken) {
          console.warn('AUTH REDIRECT URL WARNING', {
            message: 'Auth callback opened without ?code= or #access_token.',
            callbackPath: callbackUrl.pathname,
          });
        }

        if (active) setStatus('Restoring your Lumora session...');

        const initialSessionResult = await supabase.auth.getSession();
        if (initialSessionResult.error) {
          console.error('AUTH CALLBACK INITIAL SESSION ERROR', { hasAuthError: true });
        }

        if (initialSessionResult.data.session) {
          logExchangeResult({
            session: true,
            skipped: true,
            hasAuthError: Boolean(initialSessionResult.error),
          });
        } else if (code) {
          const exchangeResult = await supabase.auth.exchangeCodeForSession(code);
          logExchangeResult({
            session: Boolean(exchangeResult.data.session),
            hasAuthError: Boolean(exchangeResult.error),
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
            hasAuthError: Boolean(exchangeResult.error),
          });

          if (exchangeResult.error) {
            throw exchangeResult.error;
          }
        } else {
          logExchangeResult({
            session: false,
            skipped: true,
          });
        }

        const sessionResult = await supabase.auth.getSession();
        console.log('SESSION AFTER CALLBACK', {
          hasSession: Boolean(sessionResult.data.session),
          hasAuthError: Boolean(sessionResult.error),
        });

        if (sessionResult.error) {
          throw sessionResult.error;
        }

        const redirectPath = sessionResult.data.session ? consumeAuthRedirectPath('/profile') : '/profile';
        window.location.replace(redirectPath);
      } catch {
        console.error('AUTH CALLBACK ERROR', { hasAuthError: true });
        if (active) {
          setStatus('Unable to finish sign-in.');
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
