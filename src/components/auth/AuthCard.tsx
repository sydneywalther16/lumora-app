import { useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  AUTH_CALLBACK_PATH,
  getAuthCallbackUrl,
  getPasswordResetConfirmUrl,
  rememberAuthRedirectPath,
} from '../../hooks/useSession';
import {
  FORGOT_PASSWORD_COOLDOWN_MESSAGE,
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  friendlyForgotPasswordError,
  validatePasswordConfirmation,
  validatePasswordInput,
} from '../../lib/authMessages';
import { supabase } from '../../lib/supabase';

const FORGOT_PASSWORD_CLIENT_COOLDOWN_MS = 30_000;

type Props = {
  configured?: boolean;
  loading?: boolean;
  user?: User | null;
  session?: Session | null;
};

export default function AuthCard(props: Props = {}) {
  const configured = props.configured ?? Boolean(supabase);
  const loading = props.loading ?? false;
  const user = props.session?.user ?? props.user ?? null;
  const [mode, setMode] = useState<'magic_link' | 'password_sign_in' | 'password_sign_up' | 'forgot_password'>('magic_link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotPasswordCooldownUntil, setForgotPasswordCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const forgotPasswordCooldownActive = useMemo(
    () => forgotPasswordCooldownUntil > now,
    [forgotPasswordCooldownUntil, now],
  );

  useEffect(() => {
    if (!forgotPasswordCooldownActive) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [forgotPasswordCooldownActive]);

  function setFriendlyMessage(nextMessage: string) {
    setMessage(nextMessage);
  }

  function switchMode(nextMode: 'magic_link' | 'password_sign_in' | 'password_sign_up' | 'forgot_password') {
    setMode(nextMode);
    setMessage('');
    setPassword('');
    setConfirmPassword('');
  }

  async function sendMagicLink() {
    if (!supabase) return;
    if (!email.trim()) {
      setFriendlyMessage('Enter your email to receive an email link.');
      return;
    }

    const returnTo = rememberAuthRedirectPath();
    const callbackUrl = getAuthCallbackUrl();

    if (!callbackUrl.endsWith(AUTH_CALLBACK_PATH)) {
      console.warn('AUTH REDIRECT URL WARNING', {
        callbackUrl,
        expectedPath: AUTH_CALLBACK_PATH,
        returnTo,
      });
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl },
    });
    setFriendlyMessage(error
      ? friendlyAuthError('magic_link', error.message)
      : 'Check your email for your sign-in link.');
  }

  async function signInWithPassword() {
    if (!supabase) return;
    if (!email.trim()) {
      setFriendlyMessage('Enter your email.');
      return;
    }

    const passwordValidation = validatePasswordInput(password);
    if (passwordValidation) {
      setFriendlyMessage(passwordValidation);
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      setFriendlyMessage(error ? friendlyAuthError('sign_in', error.message) : 'Signed in with password.');
    } finally {
      setBusy(false);
    }
  }

  async function signUpWithPassword() {
    if (!supabase) return;
    if (!email.trim()) {
      setFriendlyMessage('Enter your email.');
      return;
    }

    const confirmationError = validatePasswordConfirmation(password, confirmPassword);
    if (confirmationError) {
      setFriendlyMessage(confirmationError);
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
        },
      });

      setFriendlyMessage(
        error
          ? friendlyAuthError('sign_up', error.message)
          : 'Account created. Check your email to confirm, then sign in.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!supabase) return;
    if (busy) return;
    if (forgotPasswordCooldownActive) {
      setFriendlyMessage(FORGOT_PASSWORD_COOLDOWN_MESSAGE);
      return;
    }

    if (!email.trim()) {
      setFriendlyMessage('Enter your email.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getPasswordResetConfirmUrl(),
      });

      setFriendlyMessage(error
        ? friendlyForgotPasswordError(error.message)
        : 'Check your email for a password reset link.');
    } finally {
      setBusy(false);
      setForgotPasswordCooldownUntil(Date.now() + FORGOT_PASSWORD_CLIENT_COOLDOWN_MS);
      setNow(Date.now());
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
  }

  if (!configured) {
    return (
      <section className="headline-card">
        <div>
          <span className="eyebrow">auth</span>
          <h2>Connect Supabase to unlock real login</h2>
        </div>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable accounts.</p>
      </section>
    );
  }

  if (loading && !user) {
    return <section className="headline-card"><p>Checking session...</p></section>;
  }

  if (!user) {
    return (
      <section className="headline-card">
        <div>
          <span className="eyebrow">creator access</span>
          <h2>Sign in to save your creator workspace</h2>
        </div>
        <p>Profiles, self characters, projects, drafts, and posts sync to your account.</p>
        <p className="muted">Your private account details stay protected.</p>
        <label className="field-block">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {(mode === 'password_sign_in' || mode === 'password_sign_up') ? (
          <>
            <label className="field-block">
              <span>Password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete={mode === 'password_sign_in' ? 'current-password' : 'new-password'}
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
          </>
        ) : null}

        {mode === 'password_sign_up' ? (
          <>
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
          </>
        ) : null}

        <div className="button-row">
          {mode === 'magic_link' ? (
            <button type="button" className="primary-btn" onClick={() => void sendMagicLink()} disabled={busy}>
              {busy ? 'Working...' : 'Email link'}
            </button>
          ) : null}
          {mode === 'password_sign_in' ? (
            <button type="button" className="primary-btn" onClick={() => void signInWithPassword()} disabled={busy}>
              {busy ? 'Working...' : 'Password'}
            </button>
          ) : null}
          {mode === 'password_sign_up' ? (
            <button type="button" className="primary-btn" onClick={() => void signUpWithPassword()} disabled={busy}>
              {busy ? 'Working...' : 'Create account'}
            </button>
          ) : null}
          {mode === 'forgot_password' ? (
            <button
              type="button"
              className="primary-btn"
              onClick={() => void sendPasswordReset()}
              disabled={busy || forgotPasswordCooldownActive}
            >
              {busy ? 'Working...' : 'Forgot password?'}
            </button>
          ) : null}
        </div>

        <div className="button-row auth-mode-switcher">
          <button type="button" className="ghost-btn" onClick={() => switchMode('magic_link')} disabled={busy}>
            Email link
          </button>
          <button type="button" className="ghost-btn" onClick={() => switchMode('password_sign_in')} disabled={busy}>
            Password
          </button>
          <button type="button" className="ghost-btn" onClick={() => switchMode('password_sign_up')} disabled={busy}>
            Create account
          </button>
          <button type="button" className="ghost-btn" onClick={() => switchMode('forgot_password')} disabled={busy}>
            Forgot password?
          </button>
        </div>

        {message ? <p className="muted">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="headline-card">
      <div>
        <span className="eyebrow">signed in</span>
        <h2>Signed in as {user.email}</h2>
      </div>
      <p>Your account session is connected.</p>
      <div className="button-row">
        <button type="button" className="ghost-btn" onClick={signOut}>Sign out</button>
      </div>
    </section>
  );
}
