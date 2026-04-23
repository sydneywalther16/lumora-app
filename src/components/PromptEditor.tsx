import { useEffect, useState } from 'react';
import { api } from '../lib/api';
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

  useEffect(() => {
    const savedPrompt = localStorage.getItem('remixPrompt');
    const savedTitle = localStorage.getItem('remixTitle');

    if (savedPrompt) {
      setActivePrompt(savedPrompt);
      localStorage.removeItem('remixPrompt');
    }

    if (savedTitle) {
      setDraftTitle(savedTitle);
      localStorage.removeItem('remixTitle');
    }
  }, [setActivePrompt, setDraftTitle]);

  async function handleGenerate() {
    setBusy(true);
    setStatus('Submitting generation job…');
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
