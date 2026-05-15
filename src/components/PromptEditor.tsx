import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { STYLE_PRESETS, selectedStylePrompt } from '../lib/stylePresets';

export default function PromptEditor() {
  const {
    activePrompt,
    selectedStyles,
    draftTitle,
    setActivePrompt,
    toggleSelectedStyle,
    setDraftTitle,
  } = useAppStore();

  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const savedPrompt = localStorage.getItem('remixPrompt');
    const savedTitle = localStorage.getItem('remixTitle');

    if (savedPrompt || savedTitle) {
      if (savedPrompt) {
        setActivePrompt(savedPrompt);
      }

      if (savedTitle) {
        setDraftTitle(savedTitle);
      }

      localStorage.removeItem('remixPrompt');
      localStorage.removeItem('remixTitle');
    }
  }, [setActivePrompt, setDraftTitle]);

  async function handleGenerate() {
    setBusy(true);
    setStatus('Sending your scene to the cinematic renderer...');
    try {
      const stylePreset = selectedStylePrompt(selectedStyles, activePrompt);
      const result = await api.createGeneration({
        title: draftTitle,
        prompt: activePrompt,
        ...(stylePreset ? { stylePreset } : {}),
        outputType: 'video',
      });
      setStatus('Scene queued for rendering.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to start the render.');
    } finally {
      setBusy(false);
    }
  }

  function handleSaveDraft() {
    const draft = {
      id: `draft-${Date.now()}`,
      title: draftTitle || 'Untitled concept',
      prompt: activePrompt,
      createdAt: new Date().toISOString(),
    };
    const raw = localStorage.getItem('lumora_drafts');
    const parsed = raw ? JSON.parse(raw) : [];
    const existing = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem('lumora_drafts', JSON.stringify([draft, ...existing]));
    setStatus('Draft saved locally.');
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
        <span>Style presets</span>
        <div className="chip-row wrap">
          {STYLE_PRESETS.map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={selectedStyles.includes(style)}
              className={`chip ${selectedStyles.includes(style) ? 'active' : ''}`}
              onClick={() => toggleSelectedStyle(style)}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="button-row">
        <button type="button" className="primary-btn" onClick={handleGenerate} disabled={busy}>
          {busy ? 'Sending...' : 'Generate concept'}
        </button>
        <button type="button" className="ghost-btn" onClick={handleSaveDraft}>
          Save draft
        </button>
      </div>
      {status ? <p className="muted">{status}</p> : null}
    </section>
  );
}
