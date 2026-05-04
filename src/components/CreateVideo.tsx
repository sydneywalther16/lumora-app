import { useState } from 'react';
import { type GenerationResponse, type ReferenceImageUrls, type VideoAspectRatio, type VideoEngine } from '../lib/api';
import { saveStudioProject, type StudioProject } from '../lib/projectStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadSupabaseProfile, saveSupabaseDraft, saveSupabaseProject } from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';
import { useAppStore } from '../store/useAppStore';

type CreateVideoProps = {
  refreshKey?: number;
  characterId: string | null;
  characterName: string | null;
  characterAvatar: string | null;
  isDefaultSelfCharacter: boolean;
  characterDescription?: string;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
};

const stylePresets = ['Editorial Drama', 'Virtual Sitcom', 'Luxury POV', 'Cinematic Sunset'];
const durations = [4, 8, 12, 16];
const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const engines: VideoEngine[] = ['sora-2', 'sora-2-pro', 'replicate'];

type GenerateVideoApiResponse = {
  videoUrl?: unknown;
  video?: unknown;
  provider?: string;
  model?: string;
  finalPrompt?: string;
  rawOutput?: unknown;
  referenceImageNote?: string;
  error?: string;
};

function createLocalGenerationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) =>
    (
      Number(character) ^
      (Math.random() * 16) >> (Number(character) / 4)
    ).toString(16),
  );
}

function saveLocalDraft(title: string, prompt: string) {
  const draft = {
    id: createLocalGenerationId(),
    title,
    prompt,
    createdAt: new Date().toISOString(),
  };
  const raw = localStorage.getItem('lumora_drafts');
  const parsed = raw ? JSON.parse(raw) : [];
  const existing = Array.isArray(parsed) ? parsed : [];
  localStorage.setItem('lumora_drafts', JSON.stringify([draft, ...existing]));
  return draft;
}

function buildCharacterDescription(input: {
  characterId: string | null;
  characterName: string | null;
  isDefaultSelfCharacter: boolean;
}) {
  if (!input.characterName) return '';
  return input.isDefaultSelfCharacter
    ? `Creator self character: ${input.characterName}`
    : `Featured character: ${input.characterName}${input.characterId ? ` (${input.characterId})` : ''}`;
}

function normalizeVideoUrl(video: unknown): string | null {
  if (typeof video === 'string') return video;
  if (video instanceof URL) return video.toString();
  if (Array.isArray(video)) {
    const firstUrl = video.find((item) => typeof item === 'string' || item instanceof URL);
    return normalizeVideoUrl(firstUrl);
  }
  return null;
}

export default function CreateVideo({
  refreshKey = 0,
  characterId,
  characterName,
  characterAvatar,
  isDefaultSelfCharacter,
  characterDescription,
  referenceImageUrl,
  referenceImageUrls,
}: CreateVideoProps) {
  const { user, session, loading: sessionLoading, configured } = useSession();
  const authUser = session?.user ?? user;
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
  const [engine, setEngine] = useState<VideoEngine>('sora-2');
  const [status, setStatus] = useState('');
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const actionBusy = busy || generationLoading;
  const isSoraEngine = engine === 'sora-2' || engine === 'sora-2-pro';
  const engineRoutingMessage =
    isSoraEngine
      ? 'Sora 2 is available only if this OpenAI API account has video access. Replicate remains fallback.'
      : 'Replicate is live for video generation and remains the fallback.';

  async function handleGenerate() {
    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    const currentPrompt = activePrompt;
    const selectedAspectRatio = aspectRatio;
    const selectedEngine = engine;
    const selectedCharacterDescription =
      characterDescription ||
      buildCharacterDescription({
        characterId,
        characterName,
        isDefaultSelfCharacter,
      });

    setGenerationLoading(true);
    setGenerationError('');
    setGeneratedVideoUrl(null);
    setFinalGeneratedPrompt('');
    setGenerationResult(null);
    setStatus('');

    try {
      const res = await fetch('/api/lumora/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentPrompt,
          characterId,
          characterDescription: selectedCharacterDescription,
          referenceImageUrl,
          referenceImages: referenceImageUrls ? ['front', 'left', 'right'] : referenceImageUrl ? [referenceImageUrl] : [],
          referenceImageUrls: referenceImageUrls
            ? {
                front: referenceImageUrls.frontFace,
                left: referenceImageUrls.leftAngle,
                right: referenceImageUrls.rightAngle,
                frontFace: referenceImageUrls.frontFace,
                leftAngle: referenceImageUrls.leftAngle,
                rightAngle: referenceImageUrls.rightAngle,
              }
            : undefined,
          aspectRatio: selectedAspectRatio,
          duration,
          style: selectedStyle,
          audio: true,
          provider: selectedEngine,
          engine: selectedEngine,
        }),
      });

      const data = await res.json() as GenerateVideoApiResponse;

      if (!res.ok) {
        throw new Error(data.error || 'Generation failed.');
      }

      const nextVideoUrl = normalizeVideoUrl(data.videoUrl ?? data.video);
      const generationProvider = data.provider === 'openai' ? 'openai' : 'replicate';

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('No usable video URL was returned from the generator.');
        return;
      }

      const nextFinalPrompt = data.finalPrompt || currentPrompt;
      setGeneratedVideoUrl(nextVideoUrl);
      setFinalGeneratedPrompt(nextFinalPrompt);

      const profile = authUser ? await loadSupabaseProfile(authUser.id) : loadLumoraProfile();
      const now = new Date().toISOString();
      const generationId = createLocalGenerationId();
      const result: GenerationResponse = {
        id: generationId,
        jobId: generationId,
        status: 'completed',
        engine: selectedEngine,
        characterId,
        characterName,
        characterAvatar,
        isDefaultSelfCharacter,
        prompt: currentPrompt,
        outputUrl: nextVideoUrl,
        message: generationProvider === 'openai'
          ? 'OpenAI Sora video render created.'
          : 'Replicate video render created.',
        createdAt: now,
      };
      setGenerationResult(result);

      if (result.status === 'completed' && result.outputUrl) {
        const studioProject: StudioProject = {
          id: result.jobId,
          title: draftTitle,
          caption: currentPrompt,
          prompt: result.prompt,
          finalPrompt: nextFinalPrompt,
          videoUrl: result.outputUrl,
          status: result.status,
          provider: generationProvider,
          engine: selectedEngine,
          aspectRatio: selectedAspectRatio,
          characterId,
          characterName,
          characterAvatar,
          isDefaultSelfCharacter,
          creatorName: profile.displayName || 'Lumora Creator',
          creatorUsername: profile.username || 'lumora.creator',
          creatorAvatar: profile.avatar || null,
          createdAt: result.createdAt,
          updatedAt: now,
        };

        if (authUser) {
          await saveSupabaseProject(authUser.id, studioProject);
        }

        if (!authUser) {
          saveStudioProject(studioProject);
        }
      }

      setStatus('Video generated and saved to Studio.');
    } catch (error) {
      console.error('Generation failed', error);
      const message = error instanceof Error ? error.message : 'Unable to create draft render';
      setGenerationError(
        isSoraEngine
          ? `${message} Try switching the engine to Replicate.`
          : message,
      );
    } finally {
      setGenerationLoading(false);
    }
  }

  async function handleSaveDraft() {
    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    setBusy(true);
    setStatus('Saving draft...');

    try {
      if (authUser) {
        await saveSupabaseDraft({
          userId: authUser.id,
          title: draftTitle,
          prompt: activePrompt,
          payload: {
            selectedStyle,
            duration,
            aspectRatio,
            engine,
            characterId,
            characterName,
            characterAvatar,
            isDefaultSelfCharacter,
          },
        });
        setStatus('Draft saved to your account.');
      } else {
        saveLocalDraft(draftTitle, activePrompt);
        setStatus('Draft saved locally.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save draft.');
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
          <small className="muted">{engineRoutingMessage}</small>
        </label>

        {isDefaultSelfCharacter ? (
          <p className="muted">
            For exact self-character likeness, use an image-to-video or reference-based model. Current Replicate model may only follow text traits.
          </p>
        ) : null}

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
          <button type="button" className="primary-btn" onClick={handleGenerate} disabled={actionBusy}>
            {generationLoading ? 'Rendering...' : 'Generate video'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={actionBusy}>
            Save draft
          </button>
        </div>
        {generationLoading ? <p className="muted">Rendering your concept...</p> : null}
        {generationError ? <p style={{ color: '#f07178' }}>{generationError}</p> : null}
        {status ? <p className="muted">{status}</p> : null}
        {generatedVideoUrl ? (
          <div style={{ display: 'grid', gap: '12px', marginTop: '14px' }}>
            <video
              src={generatedVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              style={{ width: '100%', borderRadius: 12 }}
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                window.location.href = '/studio';
              }}
              style={{ flex: 'unset', width: '100%' }}
            >
              View in Studio
            </button>
          </div>
        ) : null}
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
          {finalGeneratedPrompt ? (
            <p className="muted">Final prompt: {finalGeneratedPrompt}</p>
          ) : null}
          {generatedVideoUrl ? (
            <video
              src={generatedVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              style={{ width: '100%', borderRadius: 12 }}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
