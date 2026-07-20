import { Link } from 'react-router-dom';

const effectiveDate = 'July 19, 2026';

export default function PrivacyPage() {
  return (
    <div className="page lumora-page legal-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">privacy policy</span>
          <h2>How Lumora handles your information</h2>
        </div>
        <p>Effective {effectiveDate}. This policy applies to the Lumora website and mobile applications.</p>
      </section>

      <section className="list-stack legal-section-stack">
        <article className="list-card lumora-card">
          <h3>Information we collect</h3>
          <p>We collect account details such as your email address and authentication records; profile information; prompts; projects; drafts; AI Cast characters; reference photos, capture videos, and voice samples you choose to provide; generated images and videos; published posts; device and diagnostic data; subscription status; and safety reports or blocks.</p>
          <p>Payment card details are processed by the applicable app store or payment provider. Lumora does not store full payment card numbers.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>How we use information</h3>
          <p>We use information to authenticate accounts, provide and save creative workflows, generate requested media, maintain character and story continuity, publish content you approve, prevent abuse, process entitlements, provide support, improve reliability, and meet legal obligations.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>AI and service providers</h3>
          <p>Prompts and media needed to fulfill a generation request may be sent to contracted AI, cloud hosting, storage, authentication, analytics, moderation, and payment providers. These providers process information for the requested service under their applicable agreements and safeguards.</p>
          <p>Do not submit secrets, financial credentials, medical records, or other sensitive information that is not necessary for your creation.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Public content and social features</h3>
          <p>Drafts and private reference media are not public. When you choose Public and publish, the post, generated media, creator profile details, caption, and engagement information can be viewed by others. Other users can report public content and block its creator.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Safety reports and retention</h3>
          <p>Reports may be retained as needed to investigate abuse, protect users, handle disputes, enforce our rules, and comply with law. If a reporting account is deleted, Lumora removes its account identifier from the report where possible. Transaction, fraud-prevention, security, or legal records may be retained for the period reasonably required by law or legitimate safety needs.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Account deletion</h3>
          <p>You can permanently delete your account in Profile → Account or through our public deletion page. Deletion removes the authentication account and associated profile, drafts, projects, AI Cast references, generated media, and published content, subject to limited legal or safety retention described above.</p>
          <Link className="primary-btn" to="/account/delete">Account and deletion controls</Link>
        </article>

        <article className="list-card lumora-card">
          <h3>Your choices</h3>
          <p>You can edit profile information, keep drafts private, choose post visibility, delete your account, report content, block or unblock creators, and manage mobile permissions in your device settings. You can cancel an app-store subscription from the store account that billed it.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Security and international processing</h3>
          <p>We use access controls, encrypted transport, private storage for sensitive reference media, and server-only administrative credentials. No system is perfectly secure. Providers may process information in countries other than where you live, subject to applicable safeguards.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Children</h3>
          <p>Lumora is not directed to children under 13. Do not use Lumora if you are under 13. If local law requires parental permission for a teenager to use an online service, that permission is required.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Updates and privacy requests</h3>
          <p>We may update this policy as Lumora changes and will revise the effective date. The account and deletion page is the current verified path for account-data requests. A public support email will be listed after its inbound mailbox is verified.</p>
        </article>
      </section>

      <div className="button-row">
        <Link className="ghost-btn" to="/support">Support</Link>
        <Link className="ghost-btn" to="/terms">Terms</Link>
        <Link className="ghost-btn" to="/community-guidelines">Community Guidelines</Link>
        <Link className="ghost-btn" to="/home">Back to Lumora</Link>
      </div>
    </div>
  );
}
