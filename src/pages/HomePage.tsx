import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionRail from '../components/ActionRail';
import BottomSheet from '../components/BottomSheet';
import SwipeFeed from '../components/SwipeFeed';
import TopChips from '../components/TopChips';
import { posts, topChips, type Post, type TopChip } from '../data/mockData';
import { type LumoraPost } from '../lib/api';
import { loadPostedPublications } from '../lib/postStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadLocalProfileAvatarUrl } from '../lib/localAvatarStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabasePublicPosts } from '../lib/supabaseAppData';

function formatPostedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString();
}

function getPostStats(postId: string): { likes: number; comments: number } {
  let total = 0;
  for (let i = 0; i < postId.length; i++) {
    total += postId.charCodeAt(i);
  }

  return {
    likes: 100 + (total % 900),
    comments: 5 + (total % 120),
  };
}

const categoryKeywords: Record<Exclude<TopChip, 'For You'>, string[]> = {
  Cinematic: [
    'cinematic',
    'editorial',
    'dramatic',
    'golden hour',
    'sunset',
    'museum',
    'skyline',
    'paparazzi',
    'art-gallery',
    'reveal',
  ],
  Chaos: [
    'chaos',
    'chaotic',
    'unhinged',
    'frantic',
    'spiral',
    'wild',
    'high-energy',
    'turbulence',
    'crazy',
    'suspicious',
  ],
  Beauty: [
    'beauty',
    'glam',
    'glamour',
    'makeup',
    'persona',
    'portrait',
    'muse',
    'influencer',
    'model',
    'soft-launch',
  ],
  Luxury: [
    'luxury',
    'glossy',
    'high-end',
    'premium',
    'elite',
    'private',
    'jet',
    'penthouse',
    'divine',
    'confidence',
  ],
  Funny: [
    'funny',
    'comedy',
    'comedic',
    'sitcom',
    'joke',
    'deadpan',
    'confessional',
    'parody',
    'humor',
    'laugh',
  ],
  'NPC Core': [
    'npc',
    'virtual',
    'avatar',
    'persona',
    'ai influencer',
    'bot',
    'simulation',
    'pixel',
    'digital',
    'streamer',
  ],
};

function inferCategoriesFromText(text: string): TopChip[] {
  const normalized = text.toLowerCase();
  const matches = (Object.entries(categoryKeywords) as Array<
    [Exclude<TopChip, 'For You'>, string[]]
  >)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(([category]) => category);

  return matches.length ? matches : ['For You'];
}

function getCombinedPostText(post: LumoraPost): string {
  return `${post.title ?? ''} ${post.caption ?? ''} ${post.prompt ?? ''}`;
}

function getCombinedDemoPostText(post: Post): string {
  return `${post.caption} ${post.prompt} ${post.stylePreset} ${post.tags.join(' ')}`;
}

function matchesCategory(category: TopChip, text: string): boolean {
  if (category === 'For You') return true;
  return inferCategoriesFromText(text).includes(category);
}

type HomeFeedCardProps = {
  post: LumoraPost;
  fallbackAuthorAvatar?: string | null;
};

function HomeFeedCard({ post, fallbackAuthorAvatar }: HomeFeedCardProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const stats = getPostStats(post.id);

  const videoUrl = post.videoUrl || post.imageUrl;
  const title = post.title || post.caption || 'Untitled Lumora post';
  const bodyText = post.caption || post.prompt || 'Posted from Studio';
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAuthorAvatar;
  const featuring = !post.isDefaultSelfCharacter && post.characterName ? `Featuring ${post.characterName}` : undefined;
  const defaultSelfLabel = post.isDefaultSelfCharacter ? 'Created as self' : undefined;
  const hasVideo = Boolean(post.videoUrl);
  const likeCount = stats.likes + (liked ? 1 : 0);

  function handleRemix() {
    if (typeof window === 'undefined') return;
    localStorage.setItem('remixPrompt', post.prompt || post.caption || post.title || '');
    localStorage.setItem('remixTitle', `Remix of ${post.title || post.caption || 'Lumora post'}`);
    window.location.href = '/create';
  }

  async function handleShare() {
    const shareUrl = post.videoUrl || post.imageUrl || window.location.href;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text: bodyText,
          url: shareUrl,
        });
        return;
      } catch {
        // Fall back to copying below when native sharing is cancelled or unavailable.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    }
  }

  const actionButtons = [
    {
      label: liked ? 'Liked' : 'Like',
      meta: likeCount.toLocaleString(),
      onClick: () => setLiked((current) => !current),
      active: liked,
    },
    {
      label: 'Comment',
      meta: stats.comments.toLocaleString(),
      onClick: () => undefined,
      active: false,
    },
    {
      label: 'Remix',
      meta: 'Create',
      onClick: handleRemix,
      active: false,
    },
    {
      label: saved ? 'Saved' : 'Save',
      meta: saved ? 'Kept' : 'Keep',
      onClick: () => setSaved((current) => !current),
      active: saved,
    },
    {
      label: 'Share',
      meta: 'Send',
      onClick: () => void handleShare(),
      active: false,
    },
  ];

  return (
    <article
      key={post.id}
      className="list-card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: 0,
        borderRadius: '30px',
        minHeight: '560px',
        background: '#05040b',
        boxShadow: stats.likes > 700 ? '0 0 42px rgba(255,105,212,0.18)' : '0 20px 70px rgba(0,0,0,0.42)',
      }}
    >
      {hasVideo && !videoFailed && post.videoUrl ? (
        <video
          src={post.videoUrl}
          controls
          muted
          loop
          playsInline
          onError={() => setVideoFailed(true)}
          style={{
            width: '100%',
            minHeight: '560px',
            maxHeight: '680px',
            aspectRatio: '9 / 16',
            objectFit: 'cover',
            display: 'block',
            background: '#000',
          }}
        />
      ) : videoUrl && !videoFailed ? (
        <img
          src={videoUrl}
          alt={title}
          style={{
            width: '100%',
            minHeight: '560px',
            maxHeight: '680px',
            aspectRatio: '9 / 16',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            minHeight: '560px',
            aspectRatio: '9 / 16',
            background:
              'linear-gradient(180deg, rgba(7,6,18,0.2), rgba(7,6,18,0.92)), linear-gradient(135deg, #25163f 0%, #071224 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#d3cdf3',
            padding: '16px',
            textAlign: 'center',
          }}
        >
          <div>
            <strong>Preview unavailable</strong>
            <p style={{ marginTop: '10px', opacity: 0.9 }}>
              This post video cannot be loaded right now.
            </p>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(5,4,11,0.1) 35%, rgba(5,4,11,0.86) 100%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: '14px',
          right: '76px',
          bottom: '16px',
          display: 'grid',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            {authorAvatar ? (
              <img src={authorAvatar} alt={authorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#f7f4ff', fontSize: '0.9rem' }}>U</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {authorName}
            </strong>
            <span style={{ color: '#d8d2ef', fontSize: '0.88rem' }}>@{authorUsername}</span>
          </div>
        </div>

        <p style={{ margin: 0, color: '#f8f5ff', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          {bodyText}
        </p>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {defaultSelfLabel ? (
            <span className="tiny-pill" style={{ background: 'rgba(255,105,212,0.22)' }}>
              {defaultSelfLabel}
            </span>
          ) : null}
          {featuring ? (
            <span className="tiny-pill" style={{ background: 'rgba(139,123,255,0.22)' }}>
              {featuring}
            </span>
          ) : null}
          <span className="tiny-pill" style={{ background: 'rgba(255,255,255,0.12)' }}>
            {formatPostedDate(post.createdAt)}
          </span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: '12px',
          bottom: '18px',
          display: 'grid',
          gap: '10px',
          width: '54px',
        }}
      >
        {actionButtons.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            title={action.label}
            style={{
              display: 'grid',
              gap: '4px',
              justifyItems: 'center',
              padding: '8px 4px',
              borderRadius: '18px',
              background: action.active ? 'rgba(255,105,212,0.28)' : 'rgba(10,8,22,0.58)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <strong style={{ fontSize: '0.72rem', lineHeight: 1 }}>{action.label}</strong>
            <span style={{ color: '#d8d2ef', fontSize: '0.68rem', lineHeight: 1 }}>{action.meta}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

export default function HomePage() {
  const { configured } = useSession();
  const [activeCategory, setActiveCategory] = useState<TopChip>('For You');
  const [localPosts, setLocalPosts] = useState<LumoraPost[]>([]);
  const [fallbackAuthorAvatar, setFallbackAuthorAvatar] = useState<string | null>(null);
  const [feedMessage, setFeedMessage] = useState('');

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      try {
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
        setFeedMessage(savedPosts.length ? '' : 'Post a public concept from Studio to add it to Home.');
      } catch {
        const savedPosts = loadPostedPublications();
        if (!active) return;
        setLocalPosts(savedPosts);
        setFeedMessage(savedPosts.length ? '' : 'Post a concept from Studio to add it to Home.');
      }
    }

    void loadFeed();

    return () => {
      active = false;
    };
  }, [configured]);

  const filteredLocalPosts =
    activeCategory === 'For You'
      ? localPosts
      : localPosts.filter((post) => matchesCategory(activeCategory, getCombinedPostText(post)));

  const filteredDemoPosts =
    activeCategory === 'For You'
      ? posts
      : posts.filter((post) => matchesCategory(activeCategory, getCombinedDemoPostText(post)));

  const emptyCategoryLabel = activeCategory.toLowerCase();

  return (
    <div className="page">
      <TopChips
        items={topChips}
        activeItem={activeCategory}
        onSelect={(item) => setActiveCategory(item as TopChip)}
      />

      <div className="hero-stat-row">
        <div className="hero-stat-card">
          <span>Creator score</span>
          <strong>{localPosts.length ? 98 : 96}</strong>
        </div>
        <div className="hero-stat-card">
          <span>Trending rate</span>
          <strong>{localPosts.length ? '+52%' : '+38%'}</strong>
        </div>
      </div>

      <ActionRail />

      <section className="headline-card">
        <div className="row-between">
          <div>
            <span className="eyebrow">characters</span>
            <h2>Capture your next character</h2>
          </div>
          <Link className="primary-btn" to="/capture">
            Capture a character
          </Link>
        </div>
        <p>Upload reference images and optional media, then keep your character profiles private by default.</p>
      </section>

      {feedMessage ? <p className="muted">{feedMessage}</p> : null}

      {filteredLocalPosts.length ? (
        <section className="list-stack">
          {filteredLocalPosts.map((post) => (
            <HomeFeedCard
              key={`local-${post.id}`}
              post={post}
              fallbackAuthorAvatar={fallbackAuthorAvatar}
            />
          ))}
        </section>
      ) : null}

      {localPosts.length && !filteredLocalPosts.length ? (
        <section className="list-stack">
          <article className="list-card">
            <div className="row-between">
              <h3>No {emptyCategoryLabel} posts yet</h3>
              <span className="tiny-pill" style={{ background: '#2a1f3d' }}>
                Local
              </span>
            </div>
            <p>Try another category, or post a concept from Studio that matches this lane.</p>
          </article>
        </section>
      ) : !localPosts.length && filteredDemoPosts.length ? (
        <SwipeFeed posts={filteredDemoPosts} />
      ) : !localPosts.length ? (
        <section className="list-stack">
          <article className="list-card">
            <div className="row-between">
              <h3>No {emptyCategoryLabel} demos yet</h3>
              <span className="tiny-pill status-drafting">Ready</span>
            </div>
            <p>The demo feed does not have a match for this category yet.</p>
          </article>
        </section>
      ) : null}

      <BottomSheet title={localPosts.length ? 'Feed is live' : 'Quick studio note'}>
        <p>
          {localPosts.length
            ? 'Your posted concepts are showing in Home.'
            : 'Your best-performing concepts this week all share a stronger first-frame hook.'}
        </p>
      </BottomSheet>
    </div>
  );
}
