import { Link } from 'react-router-dom';

export default function SupportPage() {
  return (
    <div className="page lumora-page legal-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">support</span>
          <h2>Help with Lumora</h2>
        </div>
        <p>Use the verified self-service controls below while Lumora&apos;s public support mailbox completes inbound verification.</p>
      </section>

      <section className="list-stack legal-section-stack">
        <article className="list-card lumora-card">
          <h3>Account and data</h3>
          <p>Sign in to manage blocked creators, reauthenticate, or permanently delete your Lumora account and associated content.</p>
          <Link className="primary-btn" to="/account/delete">Account and deletion controls</Link>
        </article>

        <article className="list-card lumora-card">
          <h3>Safety</h3>
          <p>Use Safety on any public feed card or preview to report content or block a creator. Review the rules that apply to public posts and profiles.</p>
          <Link className="ghost-btn" to="/community-guidelines">Community Guidelines</Link>
        </article>

        <article className="list-card lumora-card">
          <h3>Sign-in help</h3>
          <p>Use Forgot password once from the sign-in screen, then open the newest recovery email. Never share a recovery link or token.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Public contact</h3>
          <p>The public support address will appear here only after inbound delivery has been verified and the mailbox is actively monitored.</p>
        </article>
      </section>

      <div className="button-row">
        <Link className="ghost-btn" to="/privacy">Privacy Policy</Link>
        <Link className="ghost-btn" to="/terms">Terms</Link>
        <Link className="ghost-btn" to="/home">Back to Lumora</Link>
      </div>
    </div>
  );
}
