import { useEffect, useState } from 'react';
import BottomSheet from '../components/BottomSheet';
import FeedVideoCard from '../components/FeedVideoCard';
import GeneratedVideoPreview from '../components/GeneratedVideoPreview';
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
    'flashbulb',
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
    'creator',
    'cast',
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
    'cinematic creator',
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
};

function HomeFeedCard({ post, fallbackAuthorAvatar, onSelect }: HomeFeedCardProps) {
  const stats = getPostStats(post.id);

  const title = post.title || post.caption || 'Untitled Lumora post';
  const bodyText = post.caption || post.prompt || 'Posted from Drafts';
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAuthorAvatar;
  const featuring = !post.isDefaultSelfCharacter && post.characterName ? `Featuring ${post.characterName}` : undefined;
  const defaultSelfLabel = post.isDefaultSelfCharacter ? 'Cinematic self' : undefined;

  return (
    <FeedVideoCard
      item={post}
      title={title}
      caption={bodyText}
      creatorName={authorName}
      creatorUsername={authorUsername}
      creatorAvatar={authorAvatar}
      statsText={`${stats.likes} likes`}
      badges={[defaultSelfLabel, featuring, formatPostedDate(post.createdAt)].filter((badge): badge is string => Boolean(badge))}
      variant="hero"
      autoPlayMuted={Boolean(post.videoUrl)}
      onOpen={() => onSelect(post)}
    />
  );
}

function HomePostModal({
  post,
  fallbackAuthorAvatar,
  onClose,
}: {
  post: LumoraPost;
  fallbackAuthorAvatar?: string | null;
  onClose: () => void;
}) {
  const title = post.title || post.caption || 'Lumora video';
  const bodyText = post.caption || post.prompt || '';
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar || fallbackAuthorAvatar;

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
          {bodyText ? <p className="muted" style={{ margin: 0 }}>{bodyText}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { configured } = useSession();
  const [activeCategory, setActiveCategory] = useState<TopChip>('For You');
  const [localPosts, setLocalPosts] = useState<LumoraPost[]>([]);
  const [fallbackAuthorAvatar, setFallbackAuthorAvatar] = useState<string | null>(null);
  const [feedMessage, setFeedMessage] = useState('');
  const [selectedPost, setSelectedPost] = useState<LumoraPost | null>(null);

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
        setFeedMessage(savedPosts.length ? '' : 'Post a public concept from Drafts to add it to Home.');
      } catch {
        const savedPosts = loadPostedPublications();
        if (!active) return;
        setLocalPosts(savedPosts);
        setFeedMessage(savedPosts.length ? '' : 'Post a concept from Drafts to add it to Home.');
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
    <div className="page lumora-page cinematic-feed-page">
      <TopChips
        items={topChips}
        activeItem={activeCategory}
        onSelect={(item) => setActiveCategory(item as TopChip)}
      />

      {!localPosts.length ? (
        <div className="hero-stat-row">
          <div className="hero-stat-card">
            <span>Creator score</span>
            <strong>96</strong>
          </div>
          <div className="hero-stat-card">
            <span>Trending rate</span>
            <strong>+38%</strong>
          </div>
        </div>
      ) : null}

      {feedMessage ? <p className="muted">{feedMessage}</p> : null}

      {filteredLocalPosts.length ? (
        <section className="list-stack">
          {filteredLocalPosts.map((post) => (
            <HomeFeedCard
              key={`local-${post.id}`}
              post={post}
              fallbackAuthorAvatar={fallbackAuthorAvatar}
              onSelect={setSelectedPost}
            />
          ))}
        </section>
      ) : null}

      {localPosts.length && !filteredLocalPosts.length ? (
        <section className="list-stack">
          <article className="list-card lumora-card lumora-empty-state">
            <div className="row-between">
              <h3>No {emptyCategoryLabel} posts yet</h3>
              <span className="tiny-pill" style={{ background: 'var(--pill-background)' }}>
                Local
              </span>
            </div>
            <p>Try another category, or post a concept from Drafts that matches this lane.</p>
          </article>
        </section>
      ) : !localPosts.length && filteredDemoPosts.length ? (
        <SwipeFeed posts={filteredDemoPosts} />
      ) : !localPosts.length ? (
        <section className="list-stack">
          <article className="list-card lumora-card lumora-empty-state">
            <div className="row-between">
              <h3>No {emptyCategoryLabel} demos yet</h3>
              <span className="tiny-pill status-drafting">Ready</span>
            </div>
            <p>The demo feed does not have a match for this category yet.</p>
          </article>
        </section>
      ) : null}

      <BottomSheet title={localPosts.length ? 'Feed is live' : 'Quick Drafts note'}>
        <p>
          {localPosts.length
            ? 'Your posted concepts are showing in Home.'
            : 'Your best-performing concepts this week all share a stronger first-frame hook.'}
        </p>
      </BottomSheet>

      {selectedPost ? (
        <HomePostModal
          post={selectedPost}
          fallbackAuthorAvatar={fallbackAuthorAvatar}
          onClose={() => setSelectedPost(null)}
        />
      ) : null}
    </div>
  );
}
