import { useState } from 'react';
import CharacterCapture from '../components/CharacterCapture';
import CharacterLibrary from '../components/CharacterLibrary';

export default function CharacterCapturePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">capture</span>
          <h2>Character capture</h2>
        </div>
        <p>Upload consented reference images, optional media, and keep your character profiles private by default.</p>
      </section>

      <CharacterCapture onCreated={() => setRefreshKey((current) => current + 1)} />
      <CharacterLibrary refreshKey={refreshKey} />
    </div>
  );
}
