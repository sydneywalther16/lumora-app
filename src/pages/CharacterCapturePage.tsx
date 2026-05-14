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
          <h2>Cast capture</h2>
        </div>
        <p>Upload consented reference images and optional media for reusable cinematic cast members.</p>
      </section>

      <CharacterCapture onCreated={() => setRefreshKey((current) => current + 1)} />
      <CharacterLibrary refreshKey={refreshKey} />
    </div>
  );
}
