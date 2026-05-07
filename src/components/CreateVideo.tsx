import { useState } from 'react';
import {
  type GenerationMode,
  type GenerationResponse,
  type ReferenceImageUrls,
  type VideoAspectRatio,
  type VideoEngine,
} from '../lib/api';
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
  referenceLoading?: boolean;
  referenceLabel?: string | null;
  forceSelfMode?: boolean;
};

const stylePresets = ['Editorial Drama', 'Virtual Sitcom', 'Luxury POV', 'Cinematic Sunset'];
const durations = [4, 8, 12, 16];
const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
const engines: VideoEngine[] = ['replicate', 'sora-2', 'sora-2-pro'];
const engineLabels: Record<VideoEngine, string> = {
  replicate: 'Kling image-to-video',
  'sora-2': 'Sora 2',
  'sora-2-pro': 'Sora 2 Pro',
  veo: 'Veo',
  runway: 'Runway',
  mock: 'Mock',
  openai: 'OpenAI',
};
const referenceImageLabels: Partial<Record<keyof ReferenceImageUrls, string>> = {
  frontFace: 'Front face',
  fullBody: 'Full body',
  leftAngle: 'Left angle',
  rightAngle: 'Right angle',
  expressive: 'Expression',
};

type GenerateVideoApiResponse = {
  videoUrl?: unknown;
  video?: unknown;
  provider?: string;
  model?: string;
  finalPrompt?: string;
  rawOutput?: unknown;
  referenceImageNote?: string;
  referenceImageUrl?: unknown;
  generationMode?: GenerationMode;
  displayEngine?: string;
  warnings?: unknown;
  error?: string;
  details?: unknown;
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

function cleanReferenceUrl(value?: string | null): string | null {
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function renderableReferenceImageUrl(value?: string | null): string | null {
  const cleaned = cleanReferenceUrl(value);
  if (!cleaned) return null;
  return cleaned;
}

function pickReferenceImage(input: {
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
}): { url: string | null; label: string | null } {
  const explicitUrl = cleanReferenceUrl(input.referenceImageUrl);
  if (explicitUrl) return { url: explicitUrl, label: 'Selected reference' };

  const urls = input.referenceImageUrls;
  if (!urls) return { url: null, label: null };

  const orderedSlots: Array<keyof ReferenceImageUrls> = [
    'frontFace',
    'fullBody',
    'leftAngle',
    'rightAngle',
    'expressive',
  ];

  for (const slot of orderedSlots) {
    const url = cleanReferenceUrl(urls[slot]);
    if (url) {
      return {
        url,
        label: referenceImageLabels[slot] ?? 'Reference image',
      };
    }
  }

  return { url: null, label: null };
}

function referenceImagePayload(urls?: Partial<ReferenceImageUrls> | null) {
  if (!urls) return undefined;

  return {
    front: cleanReferenceUrl(urls.frontFace),
    frontFace: cleanReferenceUrl(urls.frontFace),
    fullBody: cleanReferenceUrl(urls.fullBody),
    left: cleanReferenceUrl(urls.leftAngle),
    leftAngle: cleanReferenceUrl(urls.leftAngle),
    right: cleanReferenceUrl(urls.rightAngle),
    rightAngle: cleanReferenceUrl(urls.rightAngle),
    expressive: cleanReferenceUrl(urls.expressive),
  };
}

function formatWarnings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function formatUnknownDetail(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseGenerateResponse(text: string): {
  data: GenerateVideoApiResponse;
  parseError: string | null;
} {
  if (!text.trim()) {
    return {
      data: {},
      parseError: 'Generator returned an empty response.',
    };
  }

  try {
    return {
      data: JSON.parse(text) as GenerateVideoApiResponse,
      parseError: null,
    };
  } catch {
    return {
      data: { error: text },
      parseError: text,
    };
  }
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
  referenceLoading = false,
  referenceLabel,
  forceSelfMode = false,
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
  const [engine, setEngine] = useState<VideoEngine>('replicate');
  const [status, setStatus] = useState('');
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [finalGeneratedPrompt, setFinalGeneratedPrompt] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const [generatedDisplayEngine, setGeneratedDisplayEngine] = useState('');
  const [generatedReferenceImageUrl, setGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [generatedMode, setGeneratedMode] = useState<GenerationMode | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const primaryReferenceImage = pickReferenceImage({ referenceImageUrl, referenceImageUrls });
  const hasSelfCharacter = forceSelfMode || isDefaultSelfCharacter;
  const selectedSelfReferenceImageUrl = primaryReferenceImage.url ||
    (hasSelfCharacter ? cleanReferenceUrl(characterAvatar) : null);
  const selfReferenceMode = hasSelfCharacter;
  const selectedGenerationMode: GenerationMode = selfReferenceMode
    ? 'self-reference-video'
    : primaryReferenceImage.url
      ? 'image-to-video'
      : 'text-to-video-fallback';
  const referencePayload = referenceImagePayload(referenceImageUrls);
  const isTextFallbackMode = !hasSelfCharacter && !referenceLoading && selectedGenerationMode === 'text-to-video-fallback';
  const referenceThumbnailUrl = renderableReferenceImageUrl(primaryReferenceImage.url);
  const generatedReferenceThumbnailUrl = renderableReferenceImageUrl(generatedReferenceImageUrl);
  const actionBusy = busy || generationLoading || (!hasSelfCharacter && referenceLoading);
  const isSoraEngine = engine === 'sora-2' || engine === 'sora-2-pro';
  const engineRoutingMessage =
    isSoraEngine
      ? 'Self likeness mode currently routes through Replicate image-to-video. Sora remains optional elsewhere.'
      : 'Kling runs through Replicate and uses your self-character reference image first.';

  async function handleGenerate() {
    if (configured && sessionLoading && !authUser) {
      setStatus('Checking your account session. Try again in a moment.');
      return;
    }

    const currentPrompt = activePrompt;
    const selectedAspectRatio = aspectRatio;
    const selectedEngine = engine;
    const selectedReferenceImageUrl = selectedSelfReferenceImageUrl;
    const selectedGenerationMode = selfReferenceMode
      ? 'self-reference-video'
      : selectedReferenceImageUrl
        ? 'image-to-video'
        : 'text-to-video-fallback';
    const selectedCharacterDescription =
      characterDescription ||
      buildCharacterDescription({
        characterId,
        characterName,
        isDefaultSelfCharacter: hasSelfCharacter,
      });

    console.log('FORCED SELF MODE:', {
      hasSelfCharacter,
      referenceImageUrl: selectedReferenceImageUrl,
    });

    setGenerationLoading(true);
    setGenerationError('');
    setGeneratedVideoUrl(null);
    setFinalGeneratedPrompt('');
    setGeneratedModel('');
    setGeneratedDisplayEngine('');
    setGeneratedReferenceImageUrl(null);
    setGeneratedMode(null);
    setGenerationWarnings([]);
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
          referenceImageUrl: selectedReferenceImageUrl,
          referenceImages: referencePayload
            ? ['frontFace', 'leftAngle', 'rightAngle', 'fullBody']
            : selectedReferenceImageUrl
              ? [selectedReferenceImageUrl]
              : [],
          referenceImageUrls: referencePayload,
          aspectRatio: selectedAspectRatio,
          duration,
          style: selectedStyle,
          audio: true,
          provider: 'replicate',
          engine: selectedEngine,
          generationMode: selectedGenerationMode,
        }),
      });

      const responseText = await res.text();
      const { data, parseError } = parseGenerateResponse(responseText);

      if (!res.ok) {
        const detail = formatUnknownDetail(data.details);
        throw new Error(
          [data.error || parseError || 'Generation failed.', detail]
            .filter(Boolean)
            .join(' Details: '),
        );
      }

      if (parseError) {
        throw new Error(parseError);
      }

      const nextVideoUrl = normalizeVideoUrl(data.videoUrl ?? data.video);
      const generationProvider = data.provider === 'openai' ? 'openai' : 'replicate';
      const nextGenerationMode = data.generationMode || selectedGenerationMode;
      const nextDisplayEngine =
        data.displayEngine || (nextGenerationMode === 'text-to-video-fallback' ? 'text fallback' : 'kling');
      const nextReferenceImageUrl = cleanReferenceUrl(normalizeVideoUrl(data.referenceImageUrl) || selectedReferenceImageUrl);
      const nextWarnings = [
        ...formatWarnings(data.warnings),
        ...(data.referenceImageNote ? [data.referenceImageNote] : []),
      ];

      if (!nextVideoUrl) {
        console.error('No video returned', data);
        setGenerationError('No usable video URL was returned from the generator.');
        return;
      }

      const nextFinalPrompt = data.finalPrompt || currentPrompt;
      setGeneratedVideoUrl(nextVideoUrl);
      setFinalGeneratedPrompt(nextFinalPrompt);
      setGeneratedModel(data.model || '');
      setGeneratedDisplayEngine(nextDisplayEngine);
      setGeneratedReferenceImageUrl(nextReferenceImageUrl);
      setGeneratedMode(nextGenerationMode);
      setGenerationWarnings(nextWarnings);

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
        generationMode: nextGenerationMode,
        model: data.model || null,
        displayEngine: nextDisplayEngine,
        referenceImageUrl: nextReferenceImageUrl,
        message: nextGenerationMode === 'text-to-video-fallback'
          ? 'Replicate text-only fallback render created. Likeness is not guaranteed.'
          : 'Replicate self-reference video render created.',
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
          model: data.model || null,
          displayEngine: nextDisplayEngine,
          generationMode: nextGenerationMode,
          referenceImageUrl: nextReferenceImageUrl,
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
          ? `${message} Self-character likeness is currently routed through Replicate.`
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
            displayEngine: engine === 'replicate' ? 'kling' : engine,
            characterId,
            characterName,
            characterAvatar,
            isDefaultSelfCharacter,
            generationMode: selectedGenerationMode,
            referenceImageUrl: selectedSelfReferenceImageUrl,
            referenceImageUrls: referencePayload,
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
                {engineLabels[option] ?? option}
              </option>
            ))}
          </select>
          <small className="muted">{engineRoutingMessage}</small>
        </label>

        <div className="reference-mode-card">
          <div className="reference-mode-copy">
            <span className="eyebrow">
              {selfReferenceMode
                  ? 'Self likeness mode'
                : referenceLoading
                  ? 'Checking self reference'
                  : isTextFallbackMode
                    ? 'Text-only fallback'
                    : 'Image-to-video'}
            </span>
            <strong>
              {selfReferenceMode
                ? 'Using your saved self character'
                : referenceLoading
                  ? 'Looking for saved self-character photos'
                : isTextFallbackMode
                  ? 'Likeness not guaranteed'
                  : 'Using a reference image'}
            </strong>
            <span className="muted">
              {referenceLoading
                ? 'Lumora is checking front, full-body, angle, avatar, and media URL fields.'
                : selfReferenceMode
                ? 'Reference image locked. Ready for likeness rendering.'
                : isTextFallbackMode
                  ? 'Text-only fallback uses Luma and supports 5s or 9s renders.'
                  : 'Replicate will condition the video on the selected image.'}
            </span>
          </div>
          {referenceThumbnailUrl ? (
            <img
              src={referenceThumbnailUrl}
              alt=""
              className="reference-mode-thumb"
            />
          ) : selfReferenceMode ? (
            <div className="reference-mode-thumb reference-mode-placeholder" aria-hidden="true">
              Reference image loaded
            </div>
          ) : null}
          {primaryReferenceImage.label || selfReferenceMode ? (
            <span className="tiny-pill reference-mode-pill">
              {referenceLabel || primaryReferenceImage.label || 'Saved self character'}
            </span>
          ) : null}
        </div>

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
            {generationLoading
              ? 'Rendering...'
              : selfReferenceMode
                ? 'Generate with self character'
                : referenceLoading
                  ? 'Checking self character...'
                : isTextFallbackMode
                  ? 'Generate text-only fallback'
                  : 'Generate video'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => void handleSaveDraft()} disabled={actionBusy}>
            Save draft
          </button>
        </div>
        {generationLoading ? <p className="muted">Rendering your concept...</p> : null}
        {generationError ? <p style={{ color: '#f07178' }}>{generationError}</p> : null}
        {generationWarnings.length ? (
          <div className="generation-warning-list">
            {generationWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
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
            <span className="tiny-pill">
              {(generatedDisplayEngine || generatedModel || generationResult.engine).toUpperCase()}
            </span>
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
          {generatedMode ? (
            <p className="muted">Generation mode: {generatedMode}</p>
          ) : null}
          {generatedReferenceThumbnailUrl ? (
            <div className="reference-result-row">
              <img src={generatedReferenceThumbnailUrl} alt="" />
              <span className="muted">Reference image used for likeness</span>
            </div>
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
