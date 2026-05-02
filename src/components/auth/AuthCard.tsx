import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../hooks/useSession';

export default function AuthCard() {
  const { configured, loading, user } = useSession();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function signIn() {
    if (!supabase) return;
    if (!email.trim()) {
      setMessage('Enter your email to get a sign-in link.');
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error ? error.message : 'Check your email for a sign-in link.');
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

  if (loading) {
    return <section className="headline-card"><p>Checking session…</p></section>;
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
      </section>
    );
  }

  return (
    <section className="headline-card">
      <div>
        <span className="eyebrow">signed in</span>
        <h2>{user.email}</h2>
      </div>
      <p>Your account session is connected.</p>
      <div className="button-row">
        <button type="button" className="ghost-btn" onClick={signOut}>Sign out</button>
      </div>
    </section>
  );
}
