import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  validatePasswordConfirmation,
} from '../lib/authMessages';

type RecoveryNavigationState = {
  passwordRecoveryVerified?: boolean;
};

export default function AuthUpdatePasswordPage() {
  const location = useLocation();
  const recoveryWasVerified = Boolean(
    (location.state as RecoveryNavigationState | null)?.passwordRecoveryVerified,
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(recoveryWasVerified);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    if (!recoveryWasVerified || !supabase) {
      setCheckingRecovery(false);
      return;
    }

    const client = supabase;
    let mounted = true;

    async function confirmRecoverySession() {
      const { data, error } = await client.auth.getSession();
      if (!mounted) return;

      setHasRecoverySession(!error && Boolean(data.session?.user));
      setCheckingRecovery(false);
    }

    void confirmRecoverySession();

    return () => {
      mounted = false;
    };
  }, [recoveryWasVerified]);

  async function handleUpdatePassword() {
    if (!supabase || !hasRecoverySession) {
      setMessage('Open the password reset link from your email to continue.');
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

      setPasswordUpdated(true);
      setHasRecoverySession(false);
      setPassword('');
      setConfirmPassword('');
    } finally {
      setBusy(false);
    }
  }

  if (checkingRecovery) {
    return (
      <div className="page" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
        <section className="headline-card" style={{ width: '100%', textAlign: 'center' }}>
          <span className="eyebrow">auth</span>
          <h1 style={{ marginTop: '8px' }}>Checking reset session...</h1>
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

        {passwordUpdated ? (
          <>
            <p className="muted">Password updated. You can continue using Lumora.</p>
            <div className="button-row">
              <Link to="/profile" className="primary-btn">Continue to profile</Link>
            </div>
          </>
        ) : null}

        {!passwordUpdated && !hasRecoverySession ? (
          <>
            <p className="muted">Open the password reset link from your email to continue.</p>
            <div className="button-row">
              <Link to="/profile" className="ghost-btn">Back to profile</Link>
            </div>
          </>
        ) : null}

        {!passwordUpdated && hasRecoverySession ? (
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
              <span>Confirm password</span>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm password"
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
        ) : null}

        {message ? <p className="muted">{message}</p> : null}
      </section>
    </div>
  );
}
