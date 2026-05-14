import { useEffect, useMemo, useState } from 'react';
import { posts as demoPosts, type Post } from '../data/mockData';
import type { LumoraPost } from '../lib/api';
import { getBestPoster, getBestThumbnail } from '../lib/mediaThumbnail';
import { loadPostedPublications } from '../lib/postStorage';
import { listForYouFeed } from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';

type FeedPost = LumoraPost & {
  tags?: string[] | string | null;
  stylePreset?: string | null;
};

const searchPlaceholder = 'Search videos, creators, characters...';

function formatCompactCount(value: number | null | undefined) {
  const count = Math.max(0, Math.round(value ?? 0));
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function demoCount(value: string) {
  const normalized = value.trim().toUpperCase();
  const numeric = Number(normalized.replace(/[KM]/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  if (normalized.endsWith('M')) return Math.round(numeric * 1_000_000);
  if (normalized.endsWith('K')) return Math.round(numeric * 1_000);
  return Math.round(numeric);
}

function feedSearchText(post: FeedPost) {
  const tags = Array.isArray(post.tags) ? post.tags.join(' ') : post.tags;
  return [
    post.title,
    post.caption,
    post.prompt,
    post.creatorName,
    post.creatorUsername,
    post.displayName,
    post.username,
    post.characterName,
    post.stylePreset,
    tags,
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesSearch(post: FeedPost, query: string) {
  return !query || feedSearchText(post).includes(query.toLowerCase());
}

function demoToFeedPost(post: Post, index: number): FeedPost {
  const now = Date.now();
  return {
    id: `demo-${post.id}`,
    title: post.stylePreset,
    caption: post.caption,
    prompt: post.prompt,
    createdAt: new Date(now - (index + 1) * 3_600_000).toISOString(),
    publishedAt: new Date(now - (index + 1) * 3_600_000).toISOString(),
    updatedAt: new Date(now - (index + 1) * 3_600_000).toISOString(),
    status: 'published',
    privacy: 'public',
    visibility: 'public',
    creatorName: post.userHandle.replace(/^@/, ''),
    creatorUsername: post.userHandle.replace(/^@/, ''),
    displayName: post.userHandle.replace(/^@/, ''),
    username: post.userHandle.replace(/^@/, ''),
    provider: 'demo',
    viewCount: demoCount(post.stats.likes) * 8,
    likeCount: demoCount(post.stats.likes),
    commentCount: demoCount(post.stats.remix),
    shareCount: demoCount(post.stats.saves),
    tags: post.tags,
    stylePreset: post.stylePreset,
  };
}

function scoreFallbackPost(post: FeedPost, index: number) {
  const ageHours = Math.max(1, (Date.now() - new Date(post.publishedAt ?? post.createdAt).getTime()) / 36e5);
  const recencyScore = Math.max(0, 48 - Math.min(48, ageHours)) / 48;
  const viralScore = Math.log10(
    (post.viewCount ?? 0) +
      (post.likeCount ?? 0) * 4 +
      (post.commentCount ?? 0) * 3 +
      (post.shareCount ?? 0) * 5 +
      1,
  );
  return viralScore + recencyScore - index * 0.02;
}

function localForYouFeed(query: string) {
  const localPosts = loadPostedPublications() as FeedPost[];
  const demoFeed = demoPosts.map(demoToFeedPost);
  return [...localPosts, ...demoFeed]
    .filter((post) => {
      const status = (post.status || 'published').toLowerCase();
      const visibility = (post.visibility || post.privacy || 'public').toLowerCase();
      return status === 'published' && visibility !== 'private' && matchesSearch(post, query);
    })
    .sort((left, right) => scoreFallbackPost(right, 0) - scoreFallbackPost(left, 0));
}

function friendlyFeedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('status') ||
    lower.includes('published_at') ||
    lower.includes('thumbnail_url') ||
    lower.includes('character_id')
  ) {
    return 'Feed and Drafts need the latest database migration.';
  }
  return 'Unable to load recommendations right now. Showing local discovery picks.';
}

function ForYouSkeletonGrid() {
  return (
    <div
      aria-label="Loading recommendations"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
        gap: '10px',
      }}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          style={{
            aspectRatio: index % 3 === 0 ? '1 / 1.28' : '1 / 1',
            borderRadius: '18px',
            background: 'var(--control-background)',
            border: '1px solid var(--surface-border)',
            opacity: 0.72,
          }}
        />
      ))}
    </div>
  );
}

function ForYouCard({ post, onSelect }: { post: FeedPost; onSelect: (post: FeedPost) => void }) {
  const thumbnailUrl = getBestThumbnail(post);
  const title = post.title || post.caption || 'Lumora video';
  const caption = post.caption || post.prompt || 'Cinematic Lumora post';
  const creatorName = post.creatorName || post.displayName || post.username || 'Lumora Creator';
  const creatorAvatar = post.creatorAvatar || post.avatar || post.characterAvatar || null;
  const statsText = `${formatCompactCount(post.likeCount)} likes`;

  return (
    <button
      type="button"
      onClick={() => onSelect(post)}
      title={title}
      style={{
        position: 'relative',
        minHeight: 0,
        aspectRatio: '1 / 1.18',
        overflow: 'hidden',
        padding: 0,
        borderRadius: '18px',
        border: '1px solid var(--surface-border)',
        background: 'var(--card-media-background)',
        color: '#fff',
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: 'var(--surface-shadow)',
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          loading="lazy"
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            padding: '14px',
            textAlign: 'center',
          }}
        >
          <strong style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>{post.stylePreset || title}</strong>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(5,4,11,0.02) 36%, rgba(5,4,11,0.86) 100%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: '9px',
          right: '9px',
          bottom: '9px',
          display: 'grid',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.22)',
              flex: '0 0 auto',
              display: 'grid',
              placeItems: 'center',
              fontSize: '0.72rem',
              fontWeight: 800,
            }}
          >
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              creatorName.charAt(0).toUpperCase()
            )}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
            {creatorName}
          </span>
        </div>

        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.86rem' }}>
          {caption}
        </strong>
        <span style={{ color: '#d8d2ef', fontSize: '0.74rem' }}>{statsText}</span>
      </div>
    </button>
  );
}

function ForYouPreviewModal({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const title = post.title || post.caption || 'Lumora video';
  const bodyText = post.caption || post.prompt || '';
  const posterUrl = getBestPoster(post);
  const imageUrl = posterUrl || post.imageUrl || null;
  const creatorName = post.creatorName || post.displayName || post.username || 'Lumora Creator';
  const creatorUsername = post.creatorUsername || post.username || 'lumora.creator';

  return (
    <div
      role="dialog"
      aria-modal="true"
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
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block' }}>{creatorName}</strong>
            <span className="muted">@{creatorUsername}</span>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {post.videoUrl ? (
          <video
            src={post.videoUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            poster={posterUrl ?? undefined}
            style={{ width: '100%', maxHeight: '62vh', display: 'block', objectFit: 'contain', background: '#000' }}
          />
        ) : imageUrl ? (
          <img src={imageUrl} alt={title} style={{ width: '100%', maxHeight: '62vh', display: 'block', objectFit: 'contain' }} />
        ) : (
          <div
            style={{
              minHeight: '340px',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--card-media-background)',
              color: '#fff',
            }}
          >
            <strong>{title}</strong>
          </div>
        )}

        <div style={{ padding: '18px', display: 'grid', gap: '10px' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <p className="muted" style={{ margin: 0 }}>{bodyText}</p>
          <div className="stats-row" style={{ gap: '12px' }}>
            <span>{formatCompactCount(post.viewCount)} views</span>
            <span>{formatCompactCount(post.likeCount)} likes</span>
            <span>{formatCompactCount(post.shareCount)} shares</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrendsPage() {
  const { user, session, configured } = useSession();
  const authUser = session?.user ?? user;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedPost, setSelectedPost] = useState<FeedPost | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 260);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      setLoading(true);
      setErrorMessage('');

      try {
        const nextFeed = configured
          ? await listForYouFeed({
              currentUserId: authUser?.id ?? null,
              searchQuery: debouncedQuery,
            })
          : localForYouFeed(debouncedQuery);

        if (!active) return;
        setFeed(nextFeed as FeedPost[]);
      } catch (error) {
        if (!active) return;
        setFeed(localForYouFeed(debouncedQuery));
        setErrorMessage(friendlyFeedError(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFeed();

    return () => {
      active = false;
    };
  }, [authUser?.id, configured, debouncedQuery]);

  const resultCopy = useMemo(() => {
    if (loading) return 'Finding cinematic recommendations...';
    if (debouncedQuery) return feed.length ? `${feed.length} result${feed.length === 1 ? '' : 's'}` : 'No matching videos yet';
    return feed.length ? 'Recommended for you' : 'No public posts yet';
  }, [debouncedQuery, feed.length, loading]);

  return (
    <div className="page">
      <section
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 6,
          display: 'grid',
          gap: '12px',
          padding: '4px 0 10px',
          background: 'var(--app-background)',
        }}
      >
        <div>
          <span className="eyebrow">for you</span>
          <h2 style={{ margin: '6px 0 0' }}>Discover</h2>
        </div>
        <label className="field-block" style={{ margin: 0 }}>
          <span className="eyebrow">Search</span>
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={searchPlaceholder}
            style={{ borderRadius: '999px' }}
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>{resultCopy}</p>
      </section>

      {errorMessage ? (
        <article className="list-card" style={{ borderRadius: '18px', padding: '12px' }}>
          <p style={{ margin: 0 }}>{errorMessage}</p>
        </article>
      ) : null}

      {loading ? (
        <ForYouSkeletonGrid />
      ) : feed.length ? (
        <section
          aria-label="For You recommendations"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            gap: '10px',
            alignItems: 'start',
          }}
        >
          {feed.map((post) => (
            <ForYouCard key={post.id} post={post} onSelect={setSelectedPost} />
          ))}
        </section>
      ) : (
        <article className="list-card" style={{ borderRadius: '24px' }}>
          <div className="row-between">
            <h3>{debouncedQuery ? 'No matches yet' : 'No public videos yet'}</h3>
            <span className="tiny-pill status-drafting">Explore</span>
          </div>
          <p>
            {debouncedQuery
              ? 'Try a creator, character, title, prompt, or tag.'
              : 'Post a public draft and it will become eligible for discovery.'}
          </p>
        </article>
      )}

      {selectedPost ? (
        <ForYouPreviewModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      ) : null}
    </div>
  );
}
