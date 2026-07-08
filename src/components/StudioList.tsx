import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadLumoraProfile } from '../lib/profileStorage';
import { CREATOR_SELF_CHARACTER_ID, getStoredCharacters } from '../lib/characterStorage';
import { savePostedItem } from '../lib/postStorage';
import { markStudioProjectPublished } from '../lib/projectStorage';
import { useSession } from '../hooks/useSession';
import {
  loadSupabaseCharacters,
  loadSupabaseProfile,
  loadSupabaseProfilePosts,
  publishDraft,
} from '../lib/supabaseAppData';
import type { GenerationJob, LumoraPost, PrivacySetting } from '../lib/api';
import GeneratedVideoPreview from './GeneratedVideoPreview';
import { withLumoraGeneratedPostFields } from '../lib/aiCastMedia';
import { resolveGeneratedVideoMedia } from '../lib/mediaThumbnail';
import { openContinueStory } from '../lib/continueStory';
import { trackCreatorEvent } from '../lib/creatorEvents';
import { buildSafeTakePrompt, creatorRenderStateCopy } from '../lib/renderStateCopy';
import { getVerifiedVideoOutputUrl, hasVerifiedVideoOutput, lighterCastGuidanceMessage } from '../lib/renderCompletion';
import { buildDraftAiCastLabels, buildViralCaptionSuggestions } from '../lib/aiCastExperience';

type Props = {
  jobs: GenerationJob[];
  onPublished?: (jobId: string) => void;
};

const privacyOptions: PrivacySetting[] = ['private', 'approved_only', 'public'];

function formatStatus(status: string) {
  if (status === 'draft') return 'Draft';
  if (status === 'queued-demo') return 'Queued';
  if (status === 'queued') return 'Queued';
  if (status === 'rendering') return 'Rendering';
  if (status === 'processing') return 'Rendering';
  if (status === 'verifying_output') return 'Verifying';
  if (status === 'paused') return 'Paused';
  if (status === 'rate_limited') return 'Cooling down';
  if (status === 'completed') return 'Completed';
  if (status === 'published') return 'Published';
  if (status === 'failed') return 'Paused';
  return status;
}

function draftStateCopy(job: GenerationJob) {
  const status = (job.status || '').toLowerCase();
  if (status === 'draft' && !hasVerifiedVideoOutput(job as unknown as Record<string, unknown>)) {
    return 'Saved scene draft. No video yet.';
  }
  if (status === 'rate_limited') return 'Render queue is cooling down. Lumora will resume automatically.';
  if (status === 'queued') return 'Queued for rendering. Lumora will keep checking.';
  if (status === 'rendering' || status === 'processing') return 'Rendering your cinematic moment.';
  if (status === 'verifying_output') return 'Checking that a playable video URL was saved.';
  if (status === 'paused' || status === 'failed') return 'Your scene is saved. Try a gentler cinematic direction.';
  if (hasVerifiedVideoOutput(job as unknown as Record<string, unknown>)) return 'AI cast video ready for its next move.';
  return 'Lumora is still shaping this AI scene.';
}

function primaryDraftAction(job: GenerationJob) {
  const status = (job.status || '').toLowerCase();
  if (hasVerifiedVideoOutput(job as unknown as Record<string, unknown>)) return 'Continue Story';
  if (status === 'draft') return 'Continue in Create';
  if (status === 'rate_limited') return 'Resume render';
  if (status === 'queued' || status === 'rendering' || status === 'processing') return 'Continue checking';
  if (status === 'paused' || status === 'failed') return creatorRenderStateCopy('paused').primaryActionLabel ?? 'Try this take';
  return 'Edit scene';
}

function statusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
  if (job.exactLikenessRoute === 'kling_reference' || job.generationMode === 'kling-exact-likeness-reference') {
    return 'Kling exact likeness';
  }

  if (job.displayEngine?.toLowerCase().includes('kling exact likeness')) {
    return 'Kling exact likeness';
  }

  // Always prioritize isDefaultSelfCharacter flag
  if (Boolean(job.isDefaultSelfCharacter)) {
    return 'Soft self guidance';
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

function verifiedJobVideoUrl(job: GenerationJob | null) {
  return getVerifiedVideoOutputUrl(job as unknown as Record<string, unknown> | null);
}

function friendlyPublishError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('status') ||
    lower.includes('published_at') ||
    lower.includes('thumbnail_url') ||
    lower.includes('poster_url') ||
    lower.includes('character_id') ||
    lower.includes('visibility')
  ) {
    return 'Lumora needs the latest publishing update before this scene can go live.';
  }

  return error instanceof Error ? `Lumora could not post this scene yet: ${error.message}` : 'Lumora could not post this scene yet.';
}

export default function StudioList({ jobs, onPublished }: Props) {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const [selectedJob, setSelectedJob] = useState<GenerationJob | null>(null);
  const [postedProjectIds, setPostedProjectIds] = useState<string[]>([]);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishPrivacy, setPublishPrivacy] = useState<PrivacySetting>('public');
  const [captionDraft, setCaptionDraft] = useState('');
  const [hiddenJobIds, setHiddenJobIds] = useState<Set<string>>(new Set());
  const visibleJobs = jobs.filter((job) => !hiddenJobIds.has(job.id));

  useEffect(() => {
    let active = true;

    async function loadPostedState() {
      if (configured && loading && !authUser) {
        return;
      }

      try {
        const postedIds = authUser
          ? (await loadSupabaseProfilePosts(authUser.id))
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
  }, [authUser, configured, loading]);

  function isPosted(projectId: string) {
    return postedProjectIds.includes(projectId);
  }

  function openJob(job: GenerationJob) {
    setPublishMessage(null);
    setPublishError(null);
    setPublishPrivacy('public');
    setCaptionDraft(job.caption || job.prompt || '');
    setSelectedJob(job);
  }

  useEffect(() => {
    const projectId = localStorage.getItem('lumora_open_studio_project_id');
    if (!projectId) return;

    const project = jobs.find((job) => job.id === projectId || job.projectId === projectId);
    if (!project) return;

    localStorage.removeItem('lumora_open_studio_project_id');
    openJob(project);
  }, [jobs]);

  async function postToFeed(job: GenerationJob, captionText: string) {
    setPublishMessage(null);
    setPublishError(null);
    const verifiedVideoUrl = verifiedJobVideoUrl(job);

    if (!verifiedVideoUrl) {
      setPublishError('A video has to finish before this scene can be published.');
      return;
    }

    if (configured && loading && !authUser) {
      setPublishError('Checking your account session. Try posting again in a moment.');
      return;
    }

    let profile;
    let storedCharacters;

    try {
      profile = authUser
        ? await loadSupabaseProfile(authUser.id)
        : loadLumoraProfile();
      storedCharacters = authUser
        ? await loadSupabaseCharacters(authUser.id)
        : getStoredCharacters();
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? `Unable to load your account profile before posting: ${error.message}`
          : 'Unable to load your account profile before posting.'
      );
      return;
    }
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
      currentCharacter?.referenceImageUrls.frontFaceUrl ||
      currentCharacter?.referenceImageUrls.frontFace ||
      (isDefaultSelfCharacter ? profile.defaultSelfCharacterAvatar : null);
    const generatedMedia = resolveGeneratedVideoMedia({
      ...job,
      videoUrl: verifiedVideoUrl,
      outputUrl: verifiedVideoUrl,
      characterAvatar,
    });
    const thumbnailUrl = generatedMedia.thumbnailUrl;
    const posterUrl = generatedMedia.posterUrl;
    const publishedAt = new Date().toISOString();

    const post: LumoraPost = {
      id: createLocalPostId(),
      sourceGenerationId: job.id,
      title: job.title || 'AI cast video',
      caption: captionText,
      prompt: job.prompt || '',
      videoUrl: verifiedVideoUrl,
      sourceGenerationJobId: job.id,
      sourceProjectId: job.projectId ?? job.id,
      sourceType: 'lumora_generated',
      isAiGenerated: true,
      mediaOrigin: 'generated',
      characterId: isDefaultSelfCharacter ? CREATOR_SELF_CHARACTER_ID : job.characterId || null,
      characterName,
      characterAvatar,
      provider: job.provider || 'mock',
      privacy: publishPrivacy,
      createdAt: job.createdAt || new Date().toISOString(),
      creatorName: profile.displayName,
      creatorUsername: profile.username,
      creatorAvatar: profile.avatar || null,
      displayName: profile.displayName || 'Lumora Creator',
      username: profile.username || 'lumora.creator',
      avatar: profile.avatar || null,
      isDefaultSelfCharacter,
      thumbnailUrl,
      posterUrl,
      thumbnailSource: generatedMedia.thumbnailSource,
      status: 'published',
      visibility: publishPrivacy,
      publishedAt,
      updatedAt: publishedAt,
    };

    const aiPost = withLumoraGeneratedPostFields(post);

    if (!aiPost.id || !aiPost.videoUrl || !aiPost.sourceGenerationId) {
      setPublishError('Only verified Lumora-generated AI cast videos can be published.');
      return;
    }

    if (isPosted(job.id)) {
      setPublishMessage('This AI cast video is already live on your Lumora profile.');
      return;
    }

    setHiddenJobIds((current) => new Set(current).add(job.id));
    setSelectedJob(null);

    try {
      if (authUser) {
        await publishDraft({
          userId: authUser.id,
          projectId: job.projectId ?? job.id,
          post: aiPost,
          privacy: publishPrivacy,
        });
      } else {
        savePostedItem(aiPost);
        markStudioProjectPublished(job.id, publishPrivacy);
      }

      setPostedProjectIds((current) =>
        current.includes(job.id) ? current : [job.id, ...current]
      );
      void trackCreatorEvent('draft_published', { source: 'drafts', draftId: job.id, privacy: publishPrivacy }, authUser?.id ?? null);
      setPublishMessage('Your AI cast video is live on your Lumora profile.');
      onPublished?.(job.id);
    } catch (error) {
      setHiddenJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
      setPublishError(friendlyPublishError(error));
    }
  }

  async function shareAsset(job: GenerationJob) {
    const verifiedVideoUrl = verifiedJobVideoUrl(job);
    if (!verifiedVideoUrl) return;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: job.title || 'Lumora concept',
          text: job.prompt || undefined,
          url: verifiedVideoUrl,
        });
        return;
      } catch {
        // Fall back to copying when native share is unavailable or dismissed.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(verifiedVideoUrl);
      alert('Asset URL copied to clipboard.');
      return;
    }

    alert(verifiedVideoUrl);
  }

  function remixJob(job: GenerationJob, mode: 'edit' | 'safe_take' = 'edit') {
    const sourcePrompt = job.prompt || job.title || '';
    const nextPrompt = mode === 'safe_take'
      ? buildSafeTakePrompt(sourcePrompt, { displayName: job.characterName })
      : sourcePrompt;
    localStorage.setItem('remixPrompt', nextPrompt);
    localStorage.setItem('remixTitle', mode === 'safe_take'
      ? `Next take of ${job.title || 'Untitled concept'}`
      : `Remix of ${job.title || 'Untitled concept'}`);
    if (mode === 'safe_take') {
      localStorage.setItem('lumora_remix_render_preference', 'success_first');
    }
    localStorage.setItem(
      'lumora_remix_project',
      JSON.stringify({
        projectId: job.projectId || job.id,
        prompt: nextPrompt,
        title: job.title || 'Untitled concept',
        characterId: job.characterId,
        characterName: job.characterName ?? null,
        characterAvatar: job.characterAvatar ?? null,
        isDefaultSelfCharacter: Boolean(job.isDefaultSelfCharacter),
        referenceImageUrl: job.referenceImageUrl ?? job.characterAvatar ?? null,
        referenceImageUrls: job.referenceImageUrls ?? null,
        additionalReferenceImageUrls: job.additionalReferenceImageUrls ?? [],
        generationMode: job.generationMode ?? null,
        provider: job.provider ?? null,
        displayEngine: job.displayEngine ?? null,
        exactLikenessRoute: job.exactLikenessRoute ?? null,
        exactLikenessProvider: job.exactLikenessProvider ?? null,
        exactLikenessCanaryStatus: job.exactLikenessCanaryStatus ?? null,
        referenceStrategy: job.referenceStrategy ?? null,
        referenceRolesUsed: job.referenceRolesUsed ?? null,
        referenceCount: job.referenceCount ?? null,
        sceneAnchorStrategy: job.sceneAnchorStrategy ?? null,
        sceneAnchorGenerated: job.sceneAnchorGenerated ?? null,
        sceneAnchorProvider: job.sceneAnchorProvider ?? null,
        sceneAnchorReason: job.sceneAnchorReason ?? null,
        sceneAnchorFailureCategory: job.sceneAnchorFailureCategory ?? null,
        sceneAnchorHttpStatus: job.sceneAnchorHttpStatus ?? null,
        sceneAnchorErrorType: job.sceneAnchorErrorType ?? null,
        sceneAnchorErrorMessage: job.sceneAnchorErrorMessage ?? null,
        sceneAnchorPayloadFieldNames: job.sceneAnchorPayloadFieldNames ?? null,
        sceneAnchorReferenceCount: job.sceneAnchorReferenceCount ?? null,
        sceneAnchorSubmittedReferenceCount: job.sceneAnchorSubmittedReferenceCount ?? null,
        sceneAnchorReferenceRolesUsed: job.sceneAnchorReferenceRolesUsed ?? null,
        sceneAnchorDroppedReferenceRoles: job.sceneAnchorDroppedReferenceRoles ?? null,
        sceneAnchorProviderReferenceLimit: job.sceneAnchorProviderReferenceLimit ?? null,
        sceneAnchorOutputParsed: job.sceneAnchorOutputParsed ?? null,
        sceneAnchorValidation: job.sceneAnchorValidation ?? null,
        primaryInputType: job.primaryInputType ?? null,
        primaryVideoInputType: job.primaryVideoInputType ?? null,
        primaryVideoInputSource: job.primaryVideoInputSource ?? null,
        identityReferencesPassedToVideoStage: job.identityReferencesPassedToVideoStage ?? null,
        identityReferenceCount: job.identityReferenceCount ?? null,
        identityReferenceMode: job.identityReferenceMode ?? null,
        startFrameSource: job.startFrameSource ?? null,
        posterFrameSource: job.posterFrameSource ?? null,
        firstFrameSource: job.firstFrameSource ?? null,
        stage2ProviderModel: job.stage2ProviderModel ?? null,
        stage2ProviderRouteType: job.stage2ProviderRouteType ?? null,
        rawReferenceVisualInputsSentToStage2: job.rawReferenceVisualInputsSentToStage2 ?? null,
        sceneIntent: job.sceneIntent ?? null,
        framingIntent: job.framingIntent ?? null,
        primaryReferenceRole: job.primaryReferenceRole ?? null,
        supportingReferenceRoles: job.supportingReferenceRoles ?? null,
        userSpecifiedOutfit: job.userSpecifiedOutfit ?? null,
        outfitTermsDetected: job.outfitTermsDetected ?? null,
        environmentTermsDetected: job.environmentTermsDetected ?? null,
        referenceOutfitCarryoverSuppressed: job.referenceOutfitCarryoverSuppressed ?? null,
        compositionCarryoverSuppressed: job.compositionCarryoverSuppressed ?? null,
        frontOnlyFallback: job.frontOnlyFallback ?? null,
        renderProvider: job.renderProvider ?? null,
        klingReferenceDiagnostics: job.klingReferenceDiagnostics ?? null,
        audioConfigured: job.audioConfigured ?? null,
        viralPresetUsed: job.viralPresetUsed ?? null,
        promptPolished: job.promptPolished ?? null,
      }),
    );
    if (job.exactLikenessRoute === 'kling_reference' || job.generationMode === 'kling-exact-likeness-reference') {
      localStorage.setItem('lumora_remix_render_engine', 'replicate');
    }
    window.location.href = '/create';
  }

  function continueStory(job: GenerationJob) {
    void trackCreatorEvent('continue_story_clicked', { source: 'drafts', draftId: job.id }, authUser?.id ?? null);
    openContinueStory(job, 'drafts');
  }

  const publishToast = publishMessage || publishError ? (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '88px',
        zIndex: 10000,
        transform: 'translateX(-50%)',
        width: 'min(360px, calc(100% - 36px))',
        padding: '12px 14px',
        borderRadius: '18px',
        border: publishError ? '1px solid var(--warning-border)' : '1px solid var(--surface-border)',
        background: publishError ? 'var(--warning-background)' : 'var(--surface-strong)',
        color: publishError ? 'var(--warning-text)' : 'var(--text-primary)',
        boxShadow: 'var(--modal-shadow)',
        textAlign: 'center',
        fontWeight: 700,
      }}
    >
      {publishError || publishMessage}
    </div>
  ) : null;
  const selectedVideoUrl = verifiedJobVideoUrl(selectedJob);
  const selectedCaptionSuggestions = selectedJob
    ? buildViralCaptionSuggestions(selectedJob.prompt || selectedJob.caption || '', selectedJob.characterName)
    : null;

  if (!jobs.length || !visibleJobs.length) {
    return (
      <>
        {publishToast}
        <section className="list-stack">
          <article className="list-card lumora-card lumora-empty-state luxury-empty-state">
            <div className="row-between">
              <h3>{jobs.length ? 'Publishing your AI cast video...' : 'Your AI scenes in progress will appear here.'}</h3>
              <span className="tiny-pill status-drafting">Ready</span>
            </div>
            <p>
              {jobs.length
                ? 'The scene will leave Drafts once it joins your profile.'
                : 'Create your first scene and Lumora will autosave the draft before you decide to post.'}
            </p>
            {!jobs.length ? (
              <Link className="primary-btn" to="/create" style={{ display: 'inline-flex', width: 'fit-content', flex: 'unset' }}>
                Create first scene
              </Link>
            ) : null}
          </article>
        </section>
      </>
    );
  }

  return (
    <>
      {publishToast}

      <section className="list-stack">
        {visibleJobs.map((job) => {
          const verifiedVideoUrl = verifiedJobVideoUrl(job);
          const effectiveStatus = job.status === 'completed' && !verifiedVideoUrl ? 'verifying_output' : job.status;
          const statusValue = (job.status || '').toLowerCase();
          const isTextOnlyDraft = statusValue === 'draft' && !verifiedVideoUrl;
          const statusLabel = isTextOnlyDraft ? 'Scene draft' : formatStatus(effectiveStatus);
          const mediaStatusLabel = isTextOnlyDraft ? 'No video yet' : statusLabel;
          const showProviderDetail = false;
          const previewItem = verifiedVideoUrl ? { ...job, videoUrl: verifiedVideoUrl, outputUrl: verifiedVideoUrl } : job;
          const draftLabels = buildDraftAiCastLabels(job);

          return (
            <article
              className={`list-card lumora-card cinematic-draft-card status-${statusClass(statusLabel)}`}
              key={job.id}
              role="button"
              tabIndex={0}
              aria-label={`Open draft ${job.title}`}
              onClick={() => openJob(job)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openJob(job);
                }
              }}
              style={{
                width: '100%',
                borderRadius: '28px',
                boxShadow: 'var(--modal-shadow)',
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              <button
                type="button"
                className="draft-card-media"
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
                <GeneratedVideoPreview
                  item={previewItem}
                  title={job.title}
                  controls={Boolean(verifiedVideoUrl)}
                  placeholderLabel={mediaStatusLabel}
                  style={{
                    width: '100%',
                    height: '260px',
                    borderRadius: '16px',
                  }}
                />
                <span className="draft-media-overlay">
                  <span>{mediaStatusLabel}</span>
                </span>
              </button>

              <div className="draft-card-copy">
                <div>
                  <h3>{job.title}</h3>
                  <p className="draft-summary-clamp">
                    {job.prompt}
                  </p>
                </div>
                {showProviderDetail ? (
                  <span className="tiny-pill">{(job.displayEngine || job.provider).toUpperCase()}</span>
                ) : null}
              </div>

              <div className="draft-continuity-note">
                <span className="tiny-dot" />
                <p>
                  {job.characterName
                    ? `${getJobCharacterLabel(job)} can carry into the next scene.`
                    : 'Story Memory can carry this mood forward.'}
                </p>
              </div>
              {lighterCastGuidanceMessage(job as unknown as Record<string, unknown>) ? (
                <p className="muted">{lighterCastGuidanceMessage(job as unknown as Record<string, unknown>)}</p>
              ) : null}

              <div className="draft-ai-cast-labels" aria-label="AI cast render metadata">
                {draftLabels.map((label) => (
                  <span key={label} className="tiny-pill">{label}</span>
                ))}
              </div>

              <div className="draft-card-footer">
                <div className="draft-action-row focused-draft-actions">
                  {verifiedVideoUrl ? (
                    <>
                      <button
                        type="button"
                        className="primary-btn continue-story-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          continueStory(job);
                        }}
                      >
                        Continue Story
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          openJob(job);
                        }}
                      >
                        View scene
                      </button>
                      <button
                        type="button"
                        className="quiet-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          void postToFeed(job, job.caption || job.prompt || '');
                        }}
                        disabled={isPosted(job.id)}
                      >
                        {isPosted(job.id) ? 'Posted' : 'Publish'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          remixJob(job, statusValue === 'paused' || statusValue === 'failed' ? 'safe_take' : 'edit');
                        }}
                      >
                        {primaryDraftAction(job)}
                      </button>
                      <button
                        type="button"
                        className="quiet-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          openJob(job);
                        }}
                      >
                        Details
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {selectedJob ? (
        <div
          className="luxury-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedJob(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'var(--modal-backdrop)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
          }}
        >
          <div
            className="luxury-preview-modal"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(920px, 100%)',
              maxHeight: '92vh',
              overflow: 'auto',
              borderRadius: '24px',
              background: 'var(--modal-surface)',
              boxShadow: 'var(--modal-shadow)',
              padding: '18px',
              color: 'var(--text-primary)',
            }}
          >
            <div className="row-between" style={{ marginBottom: '14px' }}>
              <div>
                <span className="eyebrow">draft preview</span>
                <h2 style={{ margin: '4px 0 0' }}>{selectedJob.title}</h2>
              </div>

              <button type="button" className="text-btn" onClick={() => setSelectedJob(null)}>
                Close
              </button>
            </div>

            {selectedVideoUrl ? (
              <GeneratedVideoPreview
                item={{ ...selectedJob, videoUrl: selectedVideoUrl, outputUrl: selectedVideoUrl }}
                title={selectedJob.title}
                controls
                autoPlay
                forceVideo
                fit="contain"
                style={{
                  width: '100%',
                  aspectRatio: '9 / 16',
                  maxHeight: '62vh',
                  borderRadius: '18px',
                  background: 'var(--media-background)',
                }}
              />
            ) : (
              <div className="draft-render-placeholder cinematic-shimmer" style={{
                minHeight: '220px',
                borderRadius: '18px',
                display: 'grid',
                placeItems: 'center',
                padding: '18px',
                textAlign: 'center',
              }}>
                <div>
                  <strong>{formatStatus(selectedJob.status === 'completed' ? 'verifying_output' : selectedJob.status)}</strong>
                  <p className="muted" style={{ margin: '10px 0 0' }}>{draftStateCopy(selectedJob)}</p>
                </div>
              </div>
            )}

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

            {selectedCaptionSuggestions ? (
              <details className="compact-reference-details caption-helper-details" style={{ marginTop: '10px' }}>
                <summary>Viral caption helper</summary>
                <div className="caption-helper-grid">
                  {Object.entries(selectedCaptionSuggestions).map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      className="caption-suggestion-btn"
                      onClick={() => setCaptionDraft(value)}
                    >
                      <strong>{key.replace(/([A-Z])/g, ' $1')}</strong>
                      <span>{value}</span>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}

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

              {selectedVideoUrl ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    void postToFeed(selectedJob, captionDraft);
                  }}
                  disabled={isPosted(selectedJob.id)}
                >
                  {isPosted(selectedJob.id) ? 'Posted' : 'Publish'}
                </button>
              ) : null}

              <button type="button" className="ghost-btn" onClick={() => remixJob(selectedJob)}>
                Edit scene
              </button>

              {selectedVideoUrl ? (
                <button type="button" className="ghost-btn" onClick={() => continueStory(selectedJob)}>
                  Continue Story
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => remixJob(selectedJob, (selectedJob.status || '').toLowerCase() === 'paused' || (selectedJob.status || '').toLowerCase() === 'failed' ? 'safe_take' : 'edit')}
                >
                  {primaryDraftAction(selectedJob)}
                </button>
              )}

              {selectedVideoUrl ? (
                <a href={selectedVideoUrl} download className="ghost-btn">
                  Download
                </a>
              ) : (
                <button type="button" className="ghost-btn" disabled>
                  Download when ready
                </button>
              )}

              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  void shareAsset(selectedJob);
                }}
                disabled={!selectedVideoUrl}
              >
                {selectedVideoUrl ? 'Share' : 'Share when ready'}
              </button>
            </div>

            {publishMessage ? (
              <p style={{ color: 'var(--success-text)', marginTop: '14px' }}>{publishMessage}</p>
            ) : null}
            {publishError ? (
              <p style={{ color: 'var(--error-text)', marginTop: '14px' }}>{publishError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
