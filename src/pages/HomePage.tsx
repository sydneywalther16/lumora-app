import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import FeedVideoCard from '../components/FeedVideoCard';
import ContentSafetyActions from '../components/ContentSafetyActions';
import GeneratedVideoPreview from '../components/GeneratedVideoPreview';
import { type LumoraPost } from '../lib/api';
import { loadPostedPublications } from '../lib/postStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadLocalProfileAvatarUrl } from '../lib/localAvatarStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabasePublicPosts } from '../lib/supabaseAppData';
import { buildDraftPublicCaption, buildPortrayalDisclosure, isLegacyDemoMedia } from '../lib/aiCastExperience';
import { shouldShowInstallAction } from '../lib/nativeUi';

function homeMockVideoPost(): LumoraPost {
  const now = new Date().toISOString();
  return {
    id: 'home-mock-video-no-poster',
    title: 'Garden canary scene',
    caption: 'A real generated garden take',
    prompt: 'A character walks through a peaceful sunlit garden.',
    videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    posterUrl: null,
    thumbnailUrl: 'https://example.com/self-reference.jpg',
    thumbnailSource: 'video_output',
    status: 'published',
    privacy: 'public',
    visibility: 'public',
    createdAt: now,
    publishedAt: now,
    updatedAt: now,
    sourceGenerationId: 'mock-generated-ai-cast-video',
    sourceGenerationJobId: 'mock-generated-ai-cast-video',
    sourceProjectId: 'mock-generated-ai-cast-video',
    sourceType: 'lumora_generated',
    isAiGenerated: true,
    mediaOrigin: 'generated',
    creatorName: 'Lumora Creator',
    creatorUsername: 'lumora.creator',
    displayName: 'Lumora Creator',
    username: 'lumora.creator',
    likeCount: 128,
    viewCount: 1200,
    shareCount: 8,
    commentCount: 4,
  };
}

type HomeFeedCardProps = {
  post: LumoraPost;
  fallbackAuthorAvatar?: string | null;
  onSelect: (post: LumoraPost) => void;
  onBlocked: (blockedUserId: string) => void;
  currentUserId?: string | null;
};

function HomeFeedCard({ post, fallbackAuthorAvatar, onSelect, onBlocked, currentUserId }: HomeFeedCardProps) {
  const title = post.title || post.caption || 'AI cast video';
  const bodyText = buildDraftPublicCaption(post);
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAuthorAvatar;
  const portrayalLabel = buildPortrayalDisclosure(post);

  return (
    <FeedVideoCard
      item={post}
      title={title}
      caption={bodyText}
      creatorName={authorName}
      creatorUsername={authorUsername}
      creatorAvatar={authorAvatar}
      badges={['AI Cast Video', portrayalLabel]}
      variant="hero"
      autoPlayMuted={Boolean(post.videoUrl)}
      onOpen={() => onSelect(post)}
      actionSlot={(
        <ContentSafetyActions
          contentType="post"
          contentId={post.id}
          postId={post.id}
          creatorUserId={post.userId}
          creatorLabel={authorName}
          compact
          onBlocked={onBlocked}
          currentUserId={currentUserId}
        />
      )}
    />
  );
}

function HomePostModal({
  post,
  fallbackAuthorAvatar,
  onClose,
  onBlocked,
  currentUserId,
}: {
  post: LumoraPost;
  fallbackAuthorAvatar?: string | null;
  onClose: () => void;
  onBlocked: (blockedUserId: string) => void;
  currentUserId?: string | null;
}) {
  const title = post.title || post.caption || 'Lumora AI cast video';
  const bodyText = buildDraftPublicCaption(post);
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAuthorAvatar;
  const portrayalLabel = buildPortrayalDisclosure(post);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="luxury-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        padding: '18px',
        background: 'var(--modal-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="luxury-preview-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(900px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          borderRadius: '24px',
          background: 'var(--modal-surface)',
          color: 'var(--text-primary)',
          boxShadow: 'var(--modal-shadow)',
        }}
      >
        <div className="row-between" style={{ padding: '16px', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {authorAvatar ? (
              <img
                src={authorAvatar}
                alt=""
                style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{authorName}</strong>
              <span className="muted">@{authorUsername}</span>
            </div>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <GeneratedVideoPreview
          item={post}
          title={title}
          controls={Boolean(post.videoUrl)}
          autoPlay={Boolean(post.videoUrl)}
          forceVideo={Boolean(post.videoUrl)}
          fit="contain"
          showCastBadge={false}
          placeholderLabel={title}
          style={{
            width: '100%',
            minHeight: '340px',
            maxHeight: '62vh',
            aspectRatio: '9 / 16',
            background: 'var(--media-background)',
          }}
        />

        <div style={{ padding: '18px', display: 'grid', gap: '10px' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <span className="tiny-pill" style={{ width: 'fit-content' }}>{portrayalLabel}</span>
          {bodyText ? <p className="muted" style={{ margin: 0 }}>{bodyText}</p> : null}
          <ContentSafetyActions
            contentType="post"
            contentId={post.id}
            postId={post.id}
            creatorUserId={post.userId}
            creatorLabel={authorName}
            onBlocked={onBlocked}
            currentUserId={currentUserId}
          />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { configured, session, user } = useSession();
  const authUser = session?.user ?? user;
  const [localPosts, setLocalPosts] = useState<LumoraPost[]>([]);
  const [fallbackAuthorAvatar, setFallbackAuthorAvatar] = useState<string | null>(null);
  const [feedMessage, setFeedMessage] = useState('');
  const [selectedPost, setSelectedPost] = useState<LumoraPost | null>(null);
  const isNativePlatform = Capacitor.isNativePlatform();

  const creatorSafetyCard = (
    <section className={`list-stack creator-safety-section${isNativePlatform ? ' native-compact-safety' : ''}`}>
      <article className="list-card lumora-card">
        <div className="row-between" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Creator safety</h3>
          <span className="tiny-pill">Community</span>
        </div>
        <p style={{ marginTop: '8px' }}>
          Public AI Cast videos can be reported, and creators can be blocked from every feed card.
        </p>
        <div className="button-row creator-safety-links" style={{ marginTop: '8px' }}>
          {shouldShowInstallAction(isNativePlatform) ? <Link className="ghost-btn" to="/install">Install Lumora</Link> : null}
          <Link className="ghost-btn" to="/privacy">Privacy</Link>
          <Link className="ghost-btn" to="/terms">Terms</Link>
          <Link className="ghost-btn" to="/community-guidelines">Guidelines</Link>
        </div>
      </article>
    </section>
  );

  function handleBlocked(blockedUserId: string) {
    setLocalPosts((current) => current.filter((post) => post.userId !== blockedUserId));
    setSelectedPost((current) => current?.userId === blockedUserId ? null : current);
  }

  useEffect(() => {
    let active = true;
    const mockVideoNoPoster = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mockVideoNoPoster');

    async function loadFeed() {
      try {
        if (mockVideoNoPoster) {
          if (active) {
            setFallbackAuthorAvatar(null);
            setLocalPosts([homeMockVideoPost()]);
            setFeedMessage('');
          }
          return;
        }

        if (!configured) {
          const profile = loadLumoraProfile();
          const avatar = profile.avatar || await loadLocalProfileAvatarUrl(profile.avatarStorageKey);
          if (active) setFallbackAuthorAvatar(avatar);
        } else if (active) {
          setFallbackAuthorAvatar(null);
        }

        const savedPosts = configured
          ? await loadSupabasePublicPosts()
          : loadPostedPublications();
        if (!active) return;
        setLocalPosts(savedPosts);
        setFeedMessage(savedPosts.length ? '' : 'Generate and publish an AI cast video from Drafts to add it to Home.');
      } catch {
        const savedPosts = loadPostedPublications();
        if (!active) return;
        setLocalPosts(savedPosts);
        setFeedMessage(savedPosts.length ? '' : 'Generate and publish an AI cast video from Drafts to add it to Home.');
      }
    }

    void loadFeed();

    return () => {
      active = false;
    };
  }, [configured]);

  return (
    <div className="page lumora-page cinematic-feed-page">
      <header className="home-feed-header">
        <h1>Lumora</h1>
        <p>Create cinematic moments with your AI Cast.</p>
        <Link className="primary-btn native-home-create" to="/create">Create a scene</Link>
      </header>

      {feedMessage ? <p className="muted">{feedMessage}</p> : null}
      {localPosts.some(isLegacyDemoMedia) ? (
        <aside className="sample-media-banner" role="note">
          <strong>Sample gallery</strong>
          <span>Sample AI portrayals are beta examples, not verified creator work.</span>
        </aside>
      ) : null}

      {localPosts.length ? (
        <section className="list-stack">
          {localPosts.map((post) => (
            <HomeFeedCard
              key={`local-${post.id}`}
              post={post}
              fallbackAuthorAvatar={fallbackAuthorAvatar}
              onSelect={setSelectedPost}
              onBlocked={handleBlocked}
              currentUserId={authUser?.id}
            />
          ))}
        </section>
      ) : !localPosts.length ? (
        <section className="list-stack">
          <article className="list-card lumora-card lumora-empty-state">
            <h3>No scenes shared yet</h3>
            <p>Your finished scenes can appear here when you choose to share them.</p>
          </article>
        </section>
      ) : null}

      {creatorSafetyCard}

      {selectedPost ? (
        <HomePostModal
          post={selectedPost}
          fallbackAuthorAvatar={fallbackAuthorAvatar}
          onClose={() => setSelectedPost(null)}
          onBlocked={handleBlocked}
          currentUserId={authUser?.id}
        />
      ) : null}
    </div>
  );
}
