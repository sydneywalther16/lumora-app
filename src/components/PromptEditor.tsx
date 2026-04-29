import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isSelfReady, loadProfile } from '../lib/localProfile';
import { useAppStore } from '../store/useAppStore';

const stylePresets = ['Editorial Drama', 'Virtual Sitcom', 'Luxury POV', 'Cinematic Sunset'];

export default function PromptEditor() {
  const {
    activePrompt,
    selectedStyle,
    draftTitle,
    setActivePrompt,
    setSelectedStyle,
    setDraftTitle,
  } = useAppStore();

  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [selfReady, setSelfReady] = useState(() => isSelfReady(loadProfile()));

  useEffect(() => {
    const saved = localStorage.getItem('remixTitle');
    if (saved) {
      setActivePrompt(saved);
      setDraftTitle(`Remix of ${saved.slice(0, 40)}`);
      localStorage.removeItem('remixTitle');
    }
  }, [setActivePrompt, setDraftTitle]);

  useEffect(() => {
    const refreshSelfStatus = () => {
      setSelfReady(isSelfReady(loadProfile()));
    };

    refreshSelfStatus();

    window.addEventListener('storage', refreshSelfStatus);
    window.addEventListener('lumoraProfileUpdated', refreshSelfStatus);

    return () => {
      window.removeEventListener('storage', refreshSelfStatus);
      window.removeEventListener('lumoraProfileUpdated', refreshSelfStatus);
    };
  }, []);

  async function handleGenerate() {
    const profile = loadProfile();

    if (!isSelfReady(profile)) {
      setStatus('Set up your default self character in Profile to create as yourself.');
      return;
    }

    setBusy(true);
    setStatus(
      profile.defaultSelfCharacterName
        ? `Using default self character: ${profile.defaultSelfCharacterName}`
        : 'Using default self character'
    );

    try {
      const result = await api.createGeneration({
        title: draftTitle,
        prompt: activePrompt,
        stylePreset: selectedStyle,
        outputType: 'video',
      });

      setStatus(`Queued: ${result.jobId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to queue generation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editor-card">
      <label className="field-block">
        <span>Project title</span>
        <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Title" />
      </label>

      <label className="field-block">
        <span>Core prompt</span>
        <textarea
          value={activePrompt}
          onChange={(e) => setActivePrompt(e.target.value)}
          rows={7}
        />
      </label>

      <div className="field-block">
        <span>Style preset</span>
        <div className="chip-row wrap">
          {stylePresets.map((style) => (
            <button
              key={style}
              type="button"
              className={`chip ${selectedStyle === style ? 'active' : ''}`}
              onClick={() => setSelectedStyle(style)}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="list-card" style={{ marginBottom: '14px' }}>
        <div className="row-between">
          <div>
            <span className="eyebrow">self character</span>
            <h3>{selfReady ? 'Ready to create as yourself' : 'Default self setup needed'}</h3>
          </div>

          <span className="tiny-pill" style={{ background: selfReady ? '#214331' : '#4b2f21' }}>
            {selfReady ? 'Ready' : 'Not ready'}
          </span>
        </div>

        <p className="muted">
          {selfReady
            ? 'No manual character selected, so Lumora will use your ready default self character.'
            : 'Set up your default self character in Profile to create as yourself.'}
        </p>
      </div>

      <div className="button-row">
        <button type="button" className="primary-btn" onClick={handleGenerate} disabled={busy}>
          {busy ? 'Submitting…' : 'Generate concept'}
        </button>
        <button type="button" className="ghost-btn">
          Save draft
        </button>
      </div>

      {status ? <p className="muted">{status}</p> : null}
    </section>
  );
}