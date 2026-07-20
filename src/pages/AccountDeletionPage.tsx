import { Link } from 'react-router-dom';
import AccountDeletionPanel from '../components/AccountDeletionPanel';
import BlockedCreatorsPanel from '../components/BlockedCreatorsPanel';
import AuthCard from '../components/auth/AuthCard';
import { useSession } from '../hooks/useSession';

export default function AccountDeletionPage() {
  const { authReady, configured, session, user } = useSession();
  const authUser = session?.user ?? user;
  const deleted = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('deleted') === '1';

  return (
    <div className="page lumora-page legal-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">account and data controls</span>
          <h2>Delete a Lumora account</h2>
        </div>
        <p>
          This public page explains Lumora account deletion and provides the same secure deletion path available inside Profile → Account.
        </p>
      </section>

      {deleted ? (
        <section className="headline-card lumora-card">
          <h2>Deletion completed</h2>
          <p>Your Lumora account and associated creator content were deleted. Any legally required limited records follow the retention rules described in the Privacy Policy.</p>
        </section>
      ) : null}

      {!authReady ? <p className="muted">Checking your account session...</p> : null}
      {authReady && !authUser ? (
        <>
          <section className="list-card lumora-card">
            <h3>Sign in to submit a deletion request</h3>
            <p>
              Authentication prevents someone else from deleting your account. After signing in, return to this page and complete the permanent-deletion confirmation.
            </p>
          </section>
          <AuthCard configured={configured} loading={false} user={user} session={session} />
        </>
      ) : null}

      {authReady && authUser ? (
        <>
          <BlockedCreatorsPanel />
          <AccountDeletionPanel />
        </>
      ) : null}

      <div className="button-row">
        <Link className="ghost-btn" to="/privacy">Privacy Policy</Link>
        <Link className="ghost-btn" to="/community-guidelines">Community Guidelines</Link>
        <Link className="ghost-btn" to="/home">Back to Lumora</Link>
      </div>
    </div>
  );
}
