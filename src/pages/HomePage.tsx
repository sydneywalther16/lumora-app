import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionRail from '../components/ActionRail';
import BottomSheet from '../components/BottomSheet';
import SwipeFeed from '../components/SwipeFeed';
import TopChips from '../components/TopChips';
import { posts, topChips, type Post, type TopChip } from '../data/mockData';
import { type LumoraPost } from '../lib/api';
import { loadPostedPublications } from '../lib/postStorage';
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
};

function HomeFeedCard({ post }: HomeFeedCardProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const stats = getPostStats(post.id);

  const videoUrl = post.videoUrl || post.imageUrl;
  const title = post.title || post.caption || 'Untitled Lumora post';
  const bodyText = post.caption || post.prompt || 'Posted from Studio';
  const authorName = post.creatorName || post.displayName || 'Lumora Creator';
  const authorUsername = post.creatorUsername || post.username || 'lumora.creator';
  const authorAvatar = post.creatorAvatar || post.avatar;
  const featuring = !post.isDefaultSelfCharacter && post.characterName ? `Featuring ${post.characterName}` : undefined;
  const defaultSelfLabel = post.isDefaultSelfCharacter ? 'Created as self' : undefined;
  const hasVideo = Boolean(post.videoUrl);

  return (
    <article
      key={post.id}
      className="list-card"
      style={{
        boxShadow:
          stats.likes > 700
            ? '0 0 40px rgba(168,85,247,0.25)'
            : '0 12px 40px rgba(0,0,0,0.25)',
      }}
    >
      <div className="row-between" style={{ marginBottom: '14px', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {authorAvatar ? (
              <img src={authorAvatar} alt={authorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#d3cdf3', fontSize: '0.9rem' }}>U</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block' }}>{authorName}</strong>
            <span className="muted">@{authorUsername}</span>
            {featuring ? (
              <div className="muted" style={{ marginTop: '4px', fontSize: '0.95rem' }}>
                {featuring}
              </div>
            ) : null}
            {defaultSelfLabel ? (
              <span className="tiny-pill" style={{ marginTop: '8px', display: 'inline-block', background: '#3f2f5f' }}>
                {defaultSelfLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>

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
            height: '420px',
            objectFit: 'cover',
            borderRadius: '22px',
            marginBottom: '12px',
            background: '#000',
          }}
        />
      ) : videoUrl && !videoFailed ? (
        <img
          src={videoUrl}
          alt={title}
          style={{
            width: '100%',
            height: '420px',
            objectFit: 'cover',
            borderRadius: '22px',
            marginBottom: '12px',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '420px',
            borderRadius: '22px',
            marginBottom: '12px',
            background: 'linear-gradient(180deg, #0f0c18 0%, #1c1730 100%)',
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

      <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
        <span>Likes {stats.likes}</span>
        <span>Trending</span>
        <span>Comments {stats.comments}</span>
      </div>

      <div className="row-between">
        <h3>{title}</h3>
        <span className="tiny-pill" style={{ background: '#2a1f3d' }}>
          Live
        </span>
      </div>

      <p style={{ opacity: 0.9, lineHeight: 1.5 }}>
        {bodyText}
      </p>

      <p className="muted">
        Posted {formatPostedDate(post.createdAt)}
      </p>
    </article>
  );
}

export default function HomePage() {
  const { configured } = useSession();
  const [activeCategory, setActiveCategory] = useState<TopChip>('For You');
  const [localPosts, setLocalPosts] = useState<LumoraPost[]>([]);
  const [feedMessage, setFeedMessage] = useState('');

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      try {
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
            <HomeFeedCard key={`local-${post.id}`} post={post} />
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
