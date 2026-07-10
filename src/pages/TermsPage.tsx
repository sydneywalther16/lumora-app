import { Link } from 'react-router-dom';

export default function TermsPage() {
  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">terms</span>
          <h2>Lumora Beta Terms</h2>
        </div>
        <p>These beta terms are a plain-language summary for early access use.</p>
      </section>

      <section className="list-stack">
        <article className="list-card lumora-card">
          <h3>Beta product</h3>
          <p>Lumora is in beta preview and features may change while we improve reliability.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Media rights</h3>
          <p>You must only upload or reference media that you have rights to use.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Render paths</h3>
          <p>Seedance Fast is the safest first real render path. Demo Mode previews without real render credits.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Output quality</h3>
          <p>AI outputs may be imperfect and should be reviewed before publication.</p>
        </article>
      </section>

      <div className="button-row" style={{ marginTop: '12px' }}>
        <Link className="ghost-btn" to="/home">Back to Home</Link>
        <Link className="ghost-btn" to="/privacy">Privacy</Link>
      </div>
    </div>
  );
}
