import { supabase } from '../../lib/supabase';
import { useSession } from '../../hooks/useSession';

export default function AuthCard() {
  const { configured, loading, user } = useSession();

  async function signIn() {
    if (!supabase) return;
    await supabase.auth.signInWithOtp({
      email: 'creator@lumora.app',
      options: { emailRedirectTo: window.location.origin },
    });
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
        <p>Add your public Supabase URL and anon key in `.env` to enable sign in.</p>
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
          <h2>Sign in to sync your studio</h2>
        </div>
        <p>Email magic-link auth is wired. Replace the placeholder email with your own UX flow.</p>
        <div className="button-row">
          <button type="button" className="primary-btn" onClick={signIn}>Try magic-link sign in</button>
        </div>
      </section>
    );
  }

  return (
    <section className="headline-card">
      <div>
        <span className="eyebrow">signed in</span>
        <h2>{user.email}</h2>
      </div>
      <p>Your account session is connected. Protected API calls can now use your access token.</p>
      <div className="button-row">
        <button type="button" className="ghost-btn" onClick={signOut}>Sign out</button>
      </div>
    </section>
  );
}
