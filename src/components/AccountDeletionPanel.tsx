import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../hooks/useSession';
import {
  clearLumoraLocalData,
  hasRecentSignIn,
  permanentlyDeleteAccount,
  reauthenticateWithPassword,
} from '../lib/accountSafety';
import { supabase } from '../lib/supabase';

export default function AccountDeletionPanel() {
  const { user, session, refreshSession } = useSession();
  const authUser = session?.user ?? user;
  const [activeSession, setActiveSession] = useState(session);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setActiveSession(session), [session]);
  const recentlyAuthenticated = useMemo(() => hasRecentSignIn(activeSession), [activeSession]);
  const ready = recentlyAuthenticated && understood && confirmation === 'DELETE' && !busy;

  async function verifyPassword() {
    if (!authUser?.email || !password) {
      setMessage('Enter your current password. Link-only accounts should sign out and sign in again instead.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const nextSession = await reauthenticateWithPassword(authUser.email, password);
      setActiveSession(nextSession);
      setPassword('');
      setMessage('Identity confirmed. Finish the deletion confirmation within 10 minutes.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your identity could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!ready) return;
    const finalConfirmation = window.confirm(
      'Permanently delete your Lumora account and associated content? This cannot be undone.',
    );
    if (!finalConfirmation) return;

    setBusy(true);
    setMessage('');
    try {
      await permanentlyDeleteAccount();
      await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined);
      await clearLumoraLocalData();
      window.location.replace('/account/delete?deleted=1');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your account was not deleted.');
      await refreshSession().then(setActiveSession).catch(() => undefined);
      setBusy(false);
    }
  }

  if (!authUser) return null;

  return (
    <section className="account-danger-zone lumora-card">
      <div>
        <span className="eyebrow">permanent account deletion</span>
        <h2>Delete Lumora account</h2>
      </div>
      <p>
        This permanently removes your account, profile, drafts, AI Cast references, generated media, and published content.
        Limited safety or transaction records may be retained when legally required, with account identifiers removed where possible.
      </p>
      <p className="muted">
        App Store or Google Play subscriptions must be canceled separately in your store subscription settings.
      </p>

      <div className="reauth-card">
        <strong>1. Confirm your identity</strong>
        {recentlyAuthenticated ? (
          <p className="success-copy">Recently signed in. Identity check is current.</p>
        ) : (
          <>
            <p className="muted">
              Enter your current password. If you use an email link, sign out, sign in again, and return to this page within 10 minutes.
            </p>
            <label className="field-block">
              <span>Current password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="button" className="ghost-btn" onClick={() => void verifyPassword()} disabled={busy || !password}>
              Verify password
            </button>
          </>
        )}
      </div>

      <div className="reauth-card">
        <strong>2. Confirm permanent deletion</strong>
        <label className="confirmation-check">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          <span>I understand that this account and its associated content cannot be restored.</span>
        </label>
        <label className="field-block">
          <span>Type DELETE</span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </label>
      </div>

      <button type="button" className="danger-btn" disabled={!ready} onClick={() => void deleteAccount()}>
        {busy ? 'Deleting account...' : 'Permanently delete account'}
      </button>
      {message ? <p className="content-safety-message">{message}</p> : null}
    </section>
  );
}
