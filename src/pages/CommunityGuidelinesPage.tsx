import { Link } from 'react-router-dom';

export default function CommunityGuidelinesPage() {
  return (
    <div className="page lumora-page legal-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">community guidelines</span>
          <h2>Create boldly. Protect real people.</h2>
        </div>
        <p>These rules apply to public posts, creator profiles, AI Cast characters, captions, and interactions on Lumora.</p>
      </section>

      <section className="list-stack legal-section-stack">
        <article className="list-card lumora-card">
          <h3>Consent and identity</h3>
          <p>Use your own likeness or media you have permission to use. Do not impersonate, exploit, or deceptively depict a real person. Never create sexual or intimate content involving a person without their explicit consent.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Protect minors</h3>
          <p>Sexual content involving minors, grooming, exploitation, or child sexual abuse material is prohibited and may be reported to appropriate authorities.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>No abuse or dangerous harm</h3>
          <p>Do not publish targeted harassment, hateful attacks, credible threats, graphic glorification of violence, instructions for serious wrongdoing, self-harm encouragement, scams, malware, or deliberate dangerous misinformation.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Respect privacy and rights</h3>
          <p>Do not reveal private personal information, publish stolen material, infringe copyright or trademark rights, or use reference media that you are not authorized to use.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Keep discovery useful</h3>
          <p>Avoid spam, engagement manipulation, repetitive misleading posts, or attempts to bypass moderation. Clearly review AI outputs before publishing them.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Report and block</h3>
          <p>Use Safety on any public feed card or preview to report content or block its creator. Reports are reviewed for appropriate action. Blocking hides that creator’s content without notifying them. You can manage blocked creators under Account controls.</p>
          <Link className="ghost-btn" to="/account/delete">Account and block controls</Link>
        </article>
        <article className="list-card lumora-card">
          <h3>Enforcement</h3>
          <p>Depending on severity, context, and history, Lumora may reduce distribution, remove content, restrict publishing, suspend an account, preserve relevant evidence, or contact authorities when legally required. Repeated or severe violations can lead to permanent removal.</p>
        </article>
      </section>

      <div className="button-row">
        <Link className="ghost-btn" to="/terms">Terms</Link>
        <Link className="ghost-btn" to="/privacy">Privacy Policy</Link>
        <Link className="ghost-btn" to="/home">Back to Lumora</Link>
      </div>
    </div>
  );
}
