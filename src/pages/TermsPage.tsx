import { Link } from 'react-router-dom';

const effectiveDate = 'July 19, 2026';

export default function TermsPage() {
  return (
    <div className="page lumora-page legal-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">terms of use</span>
          <h2>Lumora Terms</h2>
        </div>
        <p>Effective {effectiveDate}. By creating an account or using Lumora, you agree to these Terms.</p>
      </section>

      <section className="list-stack legal-section-stack">
        <article className="list-card lumora-card">
          <h3>Eligibility and accounts</h3>
          <p>You must be at least 13 and legally able to accept these Terms. If local law requires parental permission, a parent or guardian must approve your use. Keep your account secure, provide accurate information, and tell us if you suspect unauthorized access.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Your content and permissions</h3>
          <p>You retain your rights in content you submit. You grant Lumora a limited permission to host, process, reproduce, adapt, and transmit that content only as needed to operate, secure, and improve the service and to display content you choose to publish.</p>
          <p>You must own the content you submit or have all necessary rights and consent, including permission from any identifiable person. Do not create a self character from another person or imitate a real person without authorization.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>AI-generated results</h3>
          <p>AI results may be inaccurate, unexpected, or similar to other outputs. Review every result before using or publishing it. Lumora does not guarantee that an output is unique, error-free, or suitable for a particular purpose.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Community use</h3>
          <p>Public content must follow the Community Guidelines. Lumora provides reporting and blocking controls. We may limit distribution, remove content, restrict features, preserve evidence, or suspend accounts when reasonably necessary for safety, rights protection, legal compliance, or enforcement.</p>
          <Link className="ghost-btn" to="/community-guidelines">Read Community Guidelines</Link>
        </article>

        <article className="list-card lumora-card">
          <h3>Prohibited use</h3>
          <p>Do not use Lumora for unlawful activity, sexual exploitation, non-consensual intimate imagery, child sexual abuse material, credible threats, targeted harassment, hateful abuse, fraud, deceptive impersonation, privacy violations, malicious code, rights infringement, or attempts to bypass security or moderation.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Subscriptions and third-party services</h3>
          <p>Paid features, prices, renewal terms, refunds, and cancellation are shown by the store or checkout provider before purchase. App-store subscriptions are managed through that store. Some features use third-party AI and infrastructure services and may be temporarily unavailable.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Service changes and termination</h3>
          <p>We may change, suspend, or discontinue features and may restrict an account for material or repeated violations, security risk, nonpayment, or legal requirements. You can stop using Lumora at any time and permanently delete your account through the in-app or public deletion path.</p>
          <Link className="ghost-btn" to="/account/delete">Account and deletion controls</Link>
        </article>

        <article className="list-card lumora-card">
          <h3>Disclaimers and responsibility</h3>
          <p>Lumora is provided on an “as available” basis to the extent permitted by law. You are responsible for your prompts, source media, publication choices, and use of results. Nothing in these Terms limits rights or remedies that cannot legally be limited.</p>
        </article>

        <article className="list-card lumora-card">
          <h3>Changes and contact</h3>
          <p>We may update these Terms and will revise the effective date. The account and deletion page is the current verified route for account-data requests. A public support email will be added after its inbound mailbox is verified.</p>
        </article>
      </section>

      <div className="button-row">
        <Link className="ghost-btn" to="/support">Support</Link>
        <Link className="ghost-btn" to="/privacy">Privacy Policy</Link>
        <Link className="ghost-btn" to="/account/delete">Delete account</Link>
        <Link className="ghost-btn" to="/home">Back to Lumora</Link>
      </div>
    </div>
  );
}
