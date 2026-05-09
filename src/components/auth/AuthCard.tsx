import { useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AUTH_CALLBACK_PATH, getAuthCallbackUrl, rememberAuthRedirectPath } from '../../hooks/useSession';
import { supabase } from '../../lib/supabase';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [showPasswordAuth, setShowPasswordAuth] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!supabase) return;
    if (!email.trim()) {
      setMessage('Enter your email to get a sign-in link.');
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
    setMessage(error ? error.message : 'Check your email for a sign-in link.');
  }

  async function signInWithPassword() {
    if (!supabase) return;
    if (!email.trim() || !password) {
      setPasswordMessage('Enter an email and password to sign in.');
      return;
    }

    setBusy(true);
    setPasswordMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      setPasswordMessage(error ? error.message : 'Signed in with password.');
    } finally {
      setBusy(false);
    }
  }

  async function signUpWithPassword() {
    if (!supabase) return;
    if (!email.trim() || !password) {
      setPasswordMessage('Enter an email and password to create a test account.');
      return;
    }

    setBusy(true);
    setPasswordMessage('');

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      setPasswordMessage(
        error
          ? error.message
          : 'Account created. If confirmation is enabled, check your email before signing in.',
      );
    } finally {
      setBusy(false);
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
        <label className="field-block">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <div className="button-row">
          <button type="button" className="primary-btn" onClick={signIn}>Send sign-in link</button>
        </div>
        {message ? <p className="muted">{message}</p> : null}

        <div style={{ display: 'grid', gap: '12px', marginTop: '16px' }}>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setShowPasswordAuth((current) => !current);
              setPasswordMessage('');
            }}
            style={{ width: 'fit-content' }}
          >
            {showPasswordAuth ? 'Hide password sign-in' : 'Use password instead'}
          </button>

          {showPasswordAuth ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              <label className="field-block">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void signInWithPassword()}
                  disabled={busy}
                >
                  {busy ? 'Working...' : 'Sign in with password'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void signUpWithPassword()}
                  disabled={busy}
                >
                  Create test account
                </button>
              </div>
              {passwordMessage ? <p className="muted">{passwordMessage}</p> : null}
            </div>
          ) : null}
        </div>
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
