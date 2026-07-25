import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { shouldShowInstallAction } from '../lib/nativeUi';

export default function InstallPage() {
  if (!shouldShowInstallAction(Capacitor.isNativePlatform())) {
    return (
      <div className="page lumora-page">
        <section className="headline-card lumora-card lumora-card-hero">
          <div>
            <span className="eyebrow">Lumora app</span>
            <h2>You are already using Lumora</h2>
          </div>
          <p>Open Stage to create a scene or return Home to browse your feed.</p>
        </section>
        <div className="button-row">
          <Link className="primary-btn" to="/create">Open Lumora Stage</Link>
          <Link className="ghost-btn" to="/home">Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">install</span>
          <h2>Install Lumora on your phone</h2>
        </div>
        <p>Use Lumora as an installable beta app with quick access to Create, Stage, and Drafts.</p>
      </section>

      <section className="list-stack">
        <article className="list-card lumora-card">
          <h3>iPhone (Safari)</h3>
          <p>Open Lumora in Safari, tap Share, then choose Add to Home Screen.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Android (Chrome)</h3>
          <p>Open Lumora in Chrome, then tap Install app or Add to Home Screen.</p>
        </article>
        <article className="list-card lumora-card">
          <h3>Beta reminder</h3>
          <p>Demo Mode is a no-credit Stage preview. Real provider renders may use credits or cost.</p>
        </article>
      </section>

      <div className="button-row" style={{ marginTop: '12px' }}>
        <Link className="ghost-btn" to="/create">Open Create</Link>
        <Link className="ghost-btn" to="/home">Back to Home</Link>
      </div>
    </div>
  );
}
