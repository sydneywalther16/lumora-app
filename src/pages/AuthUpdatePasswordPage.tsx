import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { supabase } from '../lib/supabase';
import {
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  validatePasswordConfirmation,
} from '../lib/authMessages';

const INVALID_RESET_LINK_MESSAGE = 'This reset link expired or could not be verified. Request a new one.';

function parseRecoveryParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  );

  return {
    code: searchParams.get('code') ?? hashParams.get('code'),
    accessToken: hashParams.get('access_token') ?? searchParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token') ?? searchParams.get('refresh_token'),
    tokenHash: searchParams.get('token_hash') ?? hashParams.get('token_hash'),
    authType: searchParams.get('type') ?? hashParams.get('type'),
  };
}

function hasRecoveryIntent(params: ReturnType<typeof parseRecoveryParams>) {
  return Boolean(
    params.code
      || (params.accessToken && params.refreshToken)
      || params.tokenHash
      || params.authType === 'recovery',
  );
}

export default function AuthUpdatePasswordPage() {
  const { loading, session, refreshSession } = useSession();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [invalidRecoveryLink, setInvalidRecoveryLink] = useState(false);

  const recoveryParams = useMemo(() => parseRecoveryParams(), []);
  const recoveryIntent = useMemo(() => hasRecoveryIntent(recoveryParams), [recoveryParams]);

  useEffect(() => {
    if (!supabase) {
      setCheckingRecovery(false);
      return;
    }

    const client = supabase;

    let mounted = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' && nextSession) {
        setHasRecoverySession(true);
        setInvalidRecoveryLink(false);
        setCheckingRecovery(false);
      }
    });

    async function resolveRecoverySession() {
      try {
        const refreshedSession = await refreshSession();
        if (!mounted) return;

        if (refreshedSession?.user) {
          setHasRecoverySession(true);
          setInvalidRecoveryLink(false);
          return;
        }

        const { data, error } = await client.auth.getSession();
        if (!mounted) return;

        if (error) {
          setInvalidRecoveryLink(recoveryIntent);
          return;
        }

        if (data.session?.user) {
          setHasRecoverySession(true);
          setInvalidRecoveryLink(false);
          return;
        }

        setInvalidRecoveryLink(recoveryIntent);
      } finally {
        if (mounted) {
          setCheckingRecovery(false);
        }
      }
    }

    void resolveRecoverySession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [recoveryIntent, refreshSession]);

  const hasSession = Boolean(session?.user) || hasRecoverySession;

  async function handleUpdatePassword() {
    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    const validationError = validatePasswordConfirmation(password, confirmPassword);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(friendlyAuthError('update_password', error.message));
        return;
      }

      setMessage('Password updated. You can continue using Lumora.');
      setPassword('');
      setConfirmPassword('');
    } finally {
      setBusy(false);
    }
  }

  if (checkingRecovery || loading) {
    return (
      <div className="page" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
        <section className="headline-card" style={{ width: '100%', textAlign: 'center' }}>
          <span className="eyebrow">auth</span>
          <h1 style={{ marginTop: '8px' }}>Checking reset link...</h1>
        </section>
      </div>
    );
  }

  return (
    <div className="page" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <section className="headline-card" style={{ width: 'min(520px, 100%)' }}>
        <div>
          <span className="eyebrow">auth</span>
          <h2>Update password</h2>
        </div>
        <p>We'll never ask for your provider keys or render credentials.</p>

        {!hasSession ? (
          <>
            <p className="muted">
              {invalidRecoveryLink
                ? INVALID_RESET_LINK_MESSAGE
                : 'Open the password reset link from your email to continue.'}
            </p>
            <div className="button-row">
              <Link to="/profile" className="ghost-btn">Back to profile</Link>
            </div>
          </>
        ) : (
          <>
            <label className="field-block">
              <span>New password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
              />
            </label>
            <div className="button-row" style={{ marginTop: '-8px' }}>
              <button
                type="button"
                className="text-btn"
                onClick={() => setShowPassword((current) => !current)}
                style={{ width: 'fit-content', padding: 0 }}
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>

            <label className="field-block">
              <span>Confirm new password</span>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
              />
            </label>
            <div className="button-row" style={{ marginTop: '-8px' }}>
              <button
                type="button"
                className="text-btn"
                onClick={() => setShowConfirmPassword((current) => !current)}
                style={{ width: 'fit-content', padding: 0 }}
              >
                {showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              </button>
            </div>

            <div className="button-row">
              <button type="button" className="primary-btn" onClick={() => void handleUpdatePassword()} disabled={busy}>
                {busy ? 'Updating...' : 'Update password'}
              </button>
              <Link to="/profile" className="ghost-btn">Back to profile</Link>
            </div>
          </>
        )}

        {message ? <p className="muted">{message}</p> : null}
      </section>
    </div>
  );
}
