import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">privacy</span>
          <h2>Lumora Beta Privacy</h2>
        </div>
        <p>Lumora is a beta AI video creation tool. This page is a simple privacy summary for beta creators.</p>
      </section>

      <section className="list-stack">
        <article className="list-card lumora-card">
          <h3>What you share</h3>
          <p>Prompts, AI Cast references, and generated drafts are used to run the creation workflow and save your project state.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Your responsibility</h3>
          <p>Only upload or reference media that you have rights to use.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Beta notice</h3>
          <p>AI outputs may be imperfect. Demo Mode previews the flow without real render credits.</p>
        </article>
      </section>

      <p className="muted" style={{ marginTop: '10px' }}>
        Questions or feedback: beta@lumora.app
      </p>

      <div className="button-row" style={{ marginTop: '12px' }}>
        <Link className="ghost-btn" to="/home">Back to Home</Link>
        <Link className="ghost-btn" to="/terms">Read Terms</Link>
      </div>
    </div>
  );
}
