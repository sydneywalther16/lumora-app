import { useEffect, useState } from 'react';
import { loadLumoraProfile } from '../lib/profileStorage';
import { CREATOR_SELF_CHARACTER_ID, getStoredCharacters } from '../lib/characterStorage';
import { savePostedItem } from '../lib/postStorage';
import { useSession } from '../hooks/useSession';
import {
  loadSupabaseCharacters,
  loadSupabaseProfile,
  loadSupabaseProfilePosts,
  saveSupabasePost,
} from '../lib/supabaseAppData';
import type { GenerationJob, LumoraPost, PrivacySetting } from '../lib/api';

type Props = {
  jobs: GenerationJob[];
};

const privacyOptions: PrivacySetting[] = ['private', 'approved_only', 'public'];

function formatStatus(status: string) {
  if (status === 'queued-demo') return 'Queued';
  if (status === 'processing') return 'Rendering';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return status;
}

function formatUpdated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function createLocalPostId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `local-post-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getPostedProjectIds(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem('lumora_posts') || '[]') as LumoraPost[];
    if (!Array.isArray(saved)) return [];

    return saved
      .map((post) => post.sourceGenerationId ?? post.id)
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

function getJobCharacterLabel(job: GenerationJob) {
  // Always prioritize isDefaultSelfCharacter flag
  if (Boolean(job.isDefaultSelfCharacter)) {
    return 'Created as self';
  }
  
  // Otherwise, show character name if available
  if (job.characterName) {
    return `Character: ${job.characterName}`;
  }
  
  // Fallback to title if it mentions a character
  if (job.title && job.title.startsWith('Character: ')) {
    return job.title;
  }
  
  // Default fallback
  return '';
}

export default function StudioList({ jobs }: Props) {
  const { user } = useSession();
  const [selectedJob, setSelectedJob] = useState<GenerationJob | null>(null);
  const [postedProjectIds, setPostedProjectIds] = useState<string[]>([]);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishPrivacy, setPublishPrivacy] = useState<PrivacySetting>('private');
  const [captionDraft, setCaptionDraft] = useState('');
  const [failedVideoIds, setFailedVideoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    async function loadPostedState() {
      try {
        const postedIds = user
          ? (await loadSupabaseProfilePosts(user.id))
              .map((post) => post.sourceGenerationId ?? post.id)
              .filter((value): value is string => Boolean(value))
          : getPostedProjectIds();
        if (active) setPostedProjectIds(postedIds);
      } catch {
        if (active) setPostedProjectIds(getPostedProjectIds());
      }
    }

    void loadPostedState();

    return () => {
      active = false;
    };
  }, [user]);

  function isPosted(projectId: string) {
    return postedProjectIds.includes(projectId);
  }

  function openJob(job: GenerationJob) {
    setPublishMessage(null);
    setPublishError(null);
    setPublishPrivacy('private');
    setCaptionDraft(job.caption || job.prompt || '');
    setSelectedJob(job);
  }

  async function postToFeed(job: GenerationJob, captionText: string) {
    setPublishMessage(null);
    setPublishError(null);

    const profile = user
      ? await loadSupabaseProfile(user.id).catch(() => loadLumoraProfile())
      : loadLumoraProfile();
    const storedCharacters = user
      ? await loadSupabaseCharacters(user.id).catch(() => getStoredCharacters())
      : getStoredCharacters();
    const currentCharacter = job.characterId
      ? storedCharacters.find((character) => character.id === job.characterId) ?? null
      : null;
    const isDefaultSelfCharacter = Boolean(
      job.isDefaultSelfCharacter ||
        (profile.defaultSelfCharacterId && job.characterId === profile.defaultSelfCharacterId)
    );
    const characterName = isDefaultSelfCharacter
      ? job.characterName || currentCharacter?.name || profile.defaultSelfCharacterName || profile.displayName
      : job.characterName || currentCharacter?.name || null;
    const characterAvatar =
      job.characterAvatar ||
      currentCharacter?.referenceImageUrls.frontFace ||
      (isDefaultSelfCharacter ? profile.defaultSelfCharacterAvatar : null);

    const post: LumoraPost = {
      id: createLocalPostId(),
      sourceGenerationId: job.id,
      title: job.title || null,
      caption: captionText,
      prompt: job.prompt || '',
      videoUrl: job.resultAssetUrl || '/demo-video.mp4',
      characterId: isDefaultSelfCharacter ? CREATOR_SELF_CHARACTER_ID : job.characterId || null,
      characterName,
      characterAvatar,
      provider: job.provider || 'mock',
      status: job.status || 'completed',
      privacy: publishPrivacy,
      createdAt: job.createdAt || new Date().toISOString(),
      creatorName: profile.displayName,
      creatorUsername: profile.username,
      creatorAvatar: profile.avatar || null,
      displayName: profile.displayName || 'Lumora Creator',
      username: profile.username || 'lumora.creator',
      avatar: profile.avatar || null,
      isDefaultSelfCharacter,
    };

    if (!post.id || !post.videoUrl) {
      setPublishError('Missing required data to post.');
      return;
    }

    if (isPosted(job.id)) {
      setPublishMessage('Already posted to Home feed.');
      return;
    }

    try {
      if (user) {
        await saveSupabasePost(user.id, post);
      } else {
        savePostedItem(post);
      }

      setPostedProjectIds((current) =>
        current.includes(job.id) ? current : [job.id, ...current]
      );
      setPublishMessage('Posted to Home feed.');
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? `Unable to post to Home feed: ${error.message}`
          : 'Unable to post to Home feed.'
      );
    }
  }

  async function shareAsset(job: GenerationJob) {
    if (!job.resultAssetUrl) return;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: job.title || 'Lumora concept',
          text: job.prompt || undefined,
          url: job.resultAssetUrl,
        });
        return;
      } catch {
        // Fall back to copying when native share is unavailable or dismissed.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(job.resultAssetUrl);
      alert('Asset URL copied to clipboard.');
      return;
    }

    alert(job.resultAssetUrl);
  }

  if (!jobs.length) {
    return (
      <section className="list-stack">
        <article className="list-card">
          <div className="row-between">
            <h3>No projects yet</h3>
            <span className="tiny-pill status-drafting">Ready</span>
          </div>
          <p>Your generated concepts will appear here once you queue one from Create.</p>
        </article>
      </section>
    );
  }

  return (
    <>
      <section className="list-stack">
        {jobs.map((job) => {
          const statusLabel = formatStatus(job.status);
          const videoFailed = failedVideoIds.has(job.id);

          return (
            <article
              className="list-card"
              key={job.id}
              style={{
                width: '100%',
                borderRadius: '28px',
                boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  openJob(job);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  marginBottom: '12px',
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {job.resultAssetUrl ? (
                  !videoFailed ? (
                    <video
                      controls
                      autoPlay
                      muted
                      loop
                      playsInline
                      poster="/demo-video.mp4"
                      onError={() => {
                        setFailedVideoIds((current) => new Set(current).add(job.id));
                      }}
                      style={{
                        width: '100%',
                        height: '260px',
                        objectFit: 'cover',
                        borderRadius: '16px',
                        display: 'block',
                        backgroundColor: '#06040e',
                      }}
                    >
                      <source src={job.resultAssetUrl} type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '260px',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        background: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src="/demo-video.mp4"
                        alt="Video thumbnail"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  )
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '260px',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.08))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#d3cdf3',
                      fontSize: '1rem',
                      textAlign: 'center',
                      padding: '12px',
                    }}
                  >
                    <div>
                      <strong>Processing</strong>
                      <p style={{ margin: '10px 0 0', color: '#bdb6dc' }}>
                        Your video is rendering. Check back momentarily.
                      </p>
                    </div>
                  </div>
                )}
              </button>

              <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{job.title}</h3>
                  <p style={{ margin: '6px 0 0', color: '#bdb6dc', overflowWrap: 'anywhere' }}>
                    {job.prompt}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className={`tiny-pill status-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
                  <span className="tiny-pill">{job.provider.toUpperCase()}</span>
                </div>
              </div>

              <div className="stats-row" style={{ marginTop: '14px', gap: '14px' }}>
                <span>{getJobCharacterLabel(job)}</span>
                <span>{job.resultAssetUrl ? 'Preview ready' : 'Processing...'}</span>
              </div>

              <div className="row-between muted-line" style={{ marginTop: '14px' }}>
                <span>Updated {formatUpdated(job.updatedAt)}</span>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {job.resultAssetUrl ? (
                    <>
                      <button type="button" className="text-btn" onClick={() => openJob(job)}>
                        Open
                      </button>

                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          localStorage.setItem('remixPrompt', job.prompt || job.title || '');
                          localStorage.setItem(
                            'remixTitle',
                            `Remix of ${job.title || 'Untitled concept'}`
                          );
                          window.location.href = '/create';
                        }}
                      >
                        Remix
                      </button>
                    </>
                  ) : (
                    <button type="button" className="text-btn" disabled>
                      Processing
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {selectedJob ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedJob(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(920px, 100%)',
              maxHeight: '92vh',
              overflow: 'auto',
              borderRadius: '24px',
              background: '#141018',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              padding: '18px',
              color: 'white',
            }}
          >
            <div className="row-between" style={{ marginBottom: '14px' }}>
              <div>
                <span className="eyebrow">concept preview</span>
                <h2 style={{ margin: '4px 0 0' }}>{selectedJob.title}</h2>
              </div>

              <button type="button" className="text-btn" onClick={() => setSelectedJob(null)}>
                Close
              </button>
            </div>

            {selectedJob.resultAssetUrl ? (
              <video
                controls
                autoPlay
                muted
                loop
                playsInline
                poster="/demo-video.mp4"
                style={{
                  width: '100%',
                  maxHeight: '62vh',
                  objectFit: 'contain',
                  borderRadius: '18px',
                  display: 'block',
                  background: '#000',
                }}
              >
                <source src={selectedJob.resultAssetUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            ) : null}

            <label className="field-block" style={{ marginTop: '14px' }}>
              <span>Post caption</span>
              <textarea
                value={captionDraft}
                onChange={(event) => setCaptionDraft(event.target.value)}
                rows={4}
                aria-label="Post caption"
                style={{ minHeight: '112px' }}
              />
            </label>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
              <label className="field-block" style={{ minWidth: '180px', margin: 0 }}>
                <span>Post privacy</span>
                <select
                  value={publishPrivacy}
                  onChange={(event) => setPublishPrivacy(event.target.value as PrivacySetting)}
                >
                  {privacyOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  void postToFeed(selectedJob, captionDraft);
                }}
                disabled={isPosted(selectedJob.id)}
              >
                {isPosted(selectedJob.id) ? 'Posted' : 'Post'}
              </button>

              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  localStorage.setItem('remixPrompt', selectedJob.prompt || selectedJob.title || '');
                  localStorage.setItem(
                    'remixTitle',
                    `Remix of ${selectedJob.title || 'Untitled concept'}`
                  );
                  window.location.href = '/create';
                }}
              >
                Remix This
              </button>

              <a href={selectedJob.resultAssetUrl || '#'} download className="ghost-btn">
                Download
              </a>

              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  void shareAsset(selectedJob);
                }}
              >
                Share
              </button>
            </div>

            {publishMessage ? (
              <p style={{ color: '#8bc34a', marginTop: '14px' }}>{publishMessage}</p>
            ) : null}
            {publishError ? (
              <p style={{ color: '#f07178', marginTop: '14px' }}>{publishError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
