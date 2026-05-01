import { supabase } from '../../lib/supabase';
import { useSession } from '../../hooks/useSession';

export default function AuthCard() {
  const { configured, loading, user } = useSession();

  async function signIn() {
    if (!supabase) return;
    await supabase.auth.signInWithOtp({
      email: 'creator@example.com',
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
          <h2>Local profile data is ready</h2>
        </div>
        <p>Profile, projects, and self character data are stored locally for this build.</p>
        <div className="button-row">
          <button type="button" className="primary-btn" onClick={signIn}>Send sign-in link</button>
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
