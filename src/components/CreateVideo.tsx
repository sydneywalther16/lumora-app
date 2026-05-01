import { useState } from 'react';
import { type GenerationResponse, type VideoAspectRatio, type VideoEngine } from '../lib/api';
import { saveStudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { useAppStore } from '../store/useAppStore';

type CreateVideoProps = {
  refreshKey?: number;
  characterId: string | null;
  characterName: string | null;
  characterAvatar: string | null;
  isDefaultSelfCharacter: boolean;
};

const stylePresets = ['Editorial Drama', 'Virtual Sitcom', 'Luxury POV', 'Cinematic Sunset'];
const durations = [4, 8, 12, 16];
const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const engines: VideoEngine[] = ['veo', 'runway', 'mock', 'openai'];

function createLocalGenerationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `local-generation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CreateVideo({
  refreshKey = 0,
  characterId,
  characterName,
  characterAvatar,
  isDefaultSelfCharacter,
}: CreateVideoProps) {
  const {
    activePrompt,
    selectedStyle,
    draftTitle,
    setActivePrompt,
    setSelectedStyle,
    setDraftTitle,
  } = useAppStore();

  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('9:16');
  const [engine, setEngine] = useState<VideoEngine>('mock');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setStatus('Generating draft render...');
    try {
      const profile = loadLumoraProfile();
      const now = new Date().toISOString();
      const generationId = createLocalGenerationId();
      const result: GenerationResponse = {
        id: generationId,
        jobId: generationId,
        status: 'completed',
        engine,
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        prompt: activePrompt,
        outputUrl: '/demo-video.mp4',
        message: 'Local draft render created.',
        createdAt: now,
      };
      setGenerationResult(result);

      if (result.status === 'completed' && result.outputUrl) {
        saveStudioProject({
          id: result.jobId,
          title: draftTitle,
          prompt: result.prompt,
          videoUrl: result.outputUrl,
          status: result.status,
          provider: result.engine,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          creatorName: profile.displayName || 'Lumora Creator',
          creatorUsername: profile.username || 'lumora.creator',
          creatorAvatar: profile.avatar || null,
          createdAt: result.createdAt,
        });
      }

      setStatus('Draft render ready');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create draft render');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="create-video-stack">
      <section className="editor-card">
        <div>
          <span className="eyebrow">video</span>
          <h3>Create video</h3>
        </div>

        <label className="field-block">
          <span>Project title</span>
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Title" />
        </label>

        <label className="field-block">
          <span>Core prompt</span>
          <textarea value={activePrompt} onChange={(event) => setActivePrompt(event.target.value)} rows={6} />
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

        <div className="field-block">
          <span>Duration</span>
          <div className="chip-row wrap">
            {durations.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${duration === option ? 'active' : ''}`}
                onClick={() => setDuration(option)}
              >
                {option}s
              </button>
            ))}
          </div>
        </div>

        <div className="field-block">
          <span>Aspect ratio</span>
          <div className="chip-row wrap">
            {aspectRatios.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${aspectRatio === option ? 'active' : ''}`}
                onClick={() => setAspectRatio(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <label className="field-block">
          <span>Engine</span>
          <select value={engine} onChange={(event) => setEngine(event.target.value as VideoEngine)}>
            {engines.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {characterName ? (
          <div className="selected-character">
            <span className="eyebrow">selected</span>
            <strong>{isDefaultSelfCharacter ? 'Created as self' : characterName}</strong>
            {!isDefaultSelfCharacter ? null : (
              <span className="muted" style={{ display: 'block', marginTop: '6px' }}>
                Using your creator self by default.
              </span>
            )}
          </div>
        ) : null}

        <div className="button-row">
          <button type="button" className="primary-btn" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Submitting...' : 'Generate video'}
          </button>
          <button type="button" className="ghost-btn">
            Save draft
          </button>
        </div>
        {status ? <p className="muted">{status}</p> : null}
      </section>

      {generationResult ? (
        <section className="editor-card video-result-card">
          <div className="row-between">
            <div>
              <span className="eyebrow">result</span>
              <h3>Video generated</h3>
            </div>
            <span className="tiny-pill">{generationResult.engine.toUpperCase()}</span>
          </div>
          {isDefaultSelfCharacter ? (
            <p><strong>Created as self</strong></p>
          ) : generationResult.characterName ? (
            <p>Character: <strong>{generationResult.characterName}</strong></p>
          ) : null}
          {generationResult.message ? <p>{generationResult.message}</p> : null}
          <p>Prompt: {generationResult.prompt}</p>
          <div className="video-preview">
            <div className="video-preview-inner">
              <span>Mock video output</span>
              <small>{generationResult.outputUrl}</small>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
