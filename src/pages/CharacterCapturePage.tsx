import { useState } from 'react';
import CharacterCapture from '../components/CharacterCapture';
import CharacterLibrary from '../components/CharacterLibrary';

export default function CharacterCapturePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="page lumora-page">
      <section className="headline-card lumora-card lumora-card-hero">
        <div>
          <span className="eyebrow">capture</span>
          <h2>Cast capture</h2>
        </div>
        <p>Add scene references and optional media for reusable cinematic cast members.</p>
      </section>

      <CharacterCapture onCreated={() => setRefreshKey((current) => current + 1)} />
      <CharacterLibrary refreshKey={refreshKey} />
    </div>
  );
}
