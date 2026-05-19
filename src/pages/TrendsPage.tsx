import { useEffect, useMemo, useState } from 'react';
import { posts as demoPosts, type Post } from '../data/mockData';
import type { LumoraPost } from '../lib/api';
import { getBestPoster, getBestThumbnail } from '../lib/mediaThumbnail';
import { loadPostedPublications } from '../lib/postStorage';
import { listForYouFeed } from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';
import { openContinueStory } from '../lib/continueStory';
import { trackCreatorEvent } from '../lib/creatorEvents';

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

function recommendationReason(post: FeedPost, index: number) {
  if (post.characterName) return `Recurring cast: ${post.characterName}`;
  if ((post.likeCount ?? 0) + (post.shareCount ?? 0) > 50) return 'Trending cinematic story';
  if (index < 3) return 'Because you watched cinematic worlds';
  return 'Fresh creator scene';
}

function whyThisPost(post: FeedPost, index = 0) {
  if ((post.likeCount ?? 0) > 100) return 'Popular this week';
  if (post.characterName) return 'Popular cast moment';
  if (index < 3) return 'Similar cinematic mood';
  return 'New story world';
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
    return 'Feed and Drafts need the latest Lumora update.';
  }
  return 'Unable to load recommendations right now. Showing local discovery picks.';
}

function ForYouSkeletonGrid() {
  return (
    <div
      aria-label="Loading recommendations"
      className="for-you-skeleton-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
        gap: '10px',
      }}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="cinematic-skeleton"
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

function ForYouCard({
  post,
  preview,
  onSelect,
}: {
  post: FeedPost;
  preview?: boolean;
  onSelect: (post: FeedPost) => void;
}) {
  const thumbnailUrl = getBestThumbnail(post);
  const posterUrl = getBestPoster(post);
  const title = post.title || post.caption || 'Lumora video';
  const caption = post.caption || post.prompt || 'Cinematic Lumora post';
  const creatorName = post.creatorName || post.displayName || post.username || 'Lumora Creator';
  const creatorAvatar = post.creatorAvatar || post.avatar || post.characterAvatar || null;
  const statsText = `${formatCompactCount(post.likeCount)} likes`;

  return (
    <button
      type="button"
      className="for-you-card lumora-card"
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
      {preview && post.videoUrl ? (
        <video
          src={post.videoUrl}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          poster={posterUrl ?? thumbnailUrl ?? undefined}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : thumbnailUrl ? (
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

function ForYouPreviewModal({
  post,
  onClose,
  onContinueStory,
  onSocialAction,
  socialState,
}: {
  post: FeedPost;
  onClose: () => void;
  onContinueStory: (post: FeedPost) => void;
  onSocialAction: (action: 'like' | 'save' | 'follow', post: FeedPost) => void;
  socialState: Record<string, boolean>;
}) {
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
        onClick={(event) => event.stopPropagation()}
        className="luxury-preview-modal"
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
          <span className="tiny-pill" style={{ width: 'fit-content' }}>Why this? {whyThisPost(post)}</span>
          <p className="muted" style={{ margin: 0 }}>{bodyText}</p>
          <div className="stats-row" style={{ gap: '12px' }}>
            <span>{formatCompactCount(post.viewCount)} views</span>
            <span>{formatCompactCount(post.likeCount)} likes</span>
            <span>{formatCompactCount(post.shareCount)} shares</span>
          </div>
          <div className="social-action-row" aria-label="Social actions">
            <button type="button" className="ghost-btn social-tap" onClick={() => onSocialAction('like', post)}>
              {socialState[`like:${post.id}`] ? 'Reacted' : 'React'}
            </button>
            <button type="button" className="ghost-btn social-tap" onClick={() => onSocialAction('save', post)}>
              {socialState[`save:${post.id}`] ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="ghost-btn social-tap" onClick={() => onSocialAction('follow', post)}>
              {socialState[`follow:${post.creatorUsername || post.username || post.creatorName}`] ? 'Following' : 'Follow creator'}
            </button>
            <button type="button" className="primary-btn" onClick={() => onContinueStory(post)}>Continue Story</button>
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
  const [socialState, setSocialState] = useState<Record<string, boolean>>({});

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
  const discoveryHighlights = useMemo(() => feed.slice(0, 3), [feed]);
  const trendingStories = useMemo(
    () =>
      [...feed]
        .sort(
          (left, right) =>
            ((right.likeCount ?? 0) + (right.shareCount ?? 0) + (right.viewCount ?? 0) / 10) -
            ((left.likeCount ?? 0) + (left.shareCount ?? 0) + (left.viewCount ?? 0) / 10),
        )
        .slice(0, 6),
    [feed],
  );
  const popularCast = useMemo(() => {
    const counts = new Map<string, number>();
    feed.forEach((post) => {
      const name = post.characterName?.trim();
      if (!name) return;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5);
  }, [feed]);

  function openPost(post: FeedPost) {
    void trackCreatorEvent('for_you_item_opened', { postId: post.id, characterName: post.characterName ?? null }, authUser?.id ?? null);
    setSelectedPost(post);
  }

  function handleContinueStory(post: FeedPost) {
    void trackCreatorEvent('continue_story_clicked', { source: 'for-you', postId: post.id }, authUser?.id ?? null);
    openContinueStory(post, 'for-you');
  }

  function handleSocialAction(action: 'like' | 'save' | 'follow', post: FeedPost) {
    const key = action === 'follow'
      ? `follow:${post.creatorUsername || post.username || post.creatorName}`
      : `${action}:${post.id}`;
    setSocialState((current) => ({ ...current, [key]: true }));
    const eventName = action === 'like' ? 'like_clicked' : action === 'save' ? 'save_clicked' : 'follow_clicked';
    void trackCreatorEvent(eventName, { source: 'for-you', postId: post.id }, authUser?.id ?? null);
  }

  return (
    <div className="page lumora-page">
      <section
        className="for-you-topbar lumora-card-hero luxury-page-hero"
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
          <h2 style={{ margin: '6px 0 0' }}>Discover cinematic worlds</h2>
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
        <article className="list-card lumora-card-soft" style={{ borderRadius: '18px', padding: '12px' }}>
          <p style={{ margin: 0 }}>{errorMessage}</p>
        </article>
      ) : null}

      {!loading && !debouncedQuery && feed.length ? (
        <section className="discovery-magic-stack" aria-label="Recommendation highlights">
          <div className="discovery-reason-rail">
            {discoveryHighlights.map((post, index) => (
              <button key={post.id} type="button" className="discovery-reason-chip" onClick={() => openPost(post)}>
                <strong>{recommendationReason(post, index)}</strong>
                <span>{post.caption || post.title || 'Cinematic scene'}</span>
              </button>
            ))}
          </div>
          {popularCast.length ? (
            <div className="chip-row wrap" aria-label="Popular cast members">
              <span className="tiny-pill">Popular cast members</span>
              {popularCast.map(([name, count]) => (
                <span key={name} className="chip">{name} - {count}</span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <ForYouSkeletonGrid />
      ) : feed.length ? (
        <>
          {!debouncedQuery && trendingStories.length ? (
            <div className="row-between" style={{ marginTop: '2px' }}>
              <span className="eyebrow">Trending story worlds</span>
              <span className="tiny-pill">Live</span>
            </div>
          ) : null}
          {!debouncedQuery ? (
            <div className="chip-row wrap" aria-label="For You story sections">
              <span className="tiny-pill">Because you follow creators like this</span>
              <span className="tiny-pill">Recently published</span>
              <span className="tiny-pill">Popular cast moments</span>
              <span className="tiny-pill">Continue watching</span>
            </div>
          ) : null}
          <section
            aria-label="For You recommendations"
            className="for-you-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
              gap: '10px',
              alignItems: 'start',
            }}
          >
            {feed.map((post, index) => (
              <ForYouCard key={post.id} post={post} preview={index < 4} onSelect={openPost} />
            ))}
          </section>
        </>
      ) : (
        <article className="list-card lumora-card lumora-empty-state luxury-empty-state" style={{ borderRadius: '24px' }}>
          <div className="row-between">
            <h3>{debouncedQuery ? 'No matches yet' : 'No public videos yet'}</h3>
            <span className="tiny-pill status-drafting">Explore</span>
          </div>
          <p>
            {debouncedQuery
              ? 'Try a creator, character, title, prompt, or tag.'
              : 'Discover cinematic creators and evolving story worlds as soon as public scenes arrive.'}
          </p>
          {!debouncedQuery ? (
            <button type="button" className="primary-btn" onClick={() => setQuery('cinematic')} style={{ width: 'fit-content', flex: 'unset' }}>
              Explore trending stories
            </button>
          ) : null}
        </article>
      )}

      {selectedPost ? (
        <ForYouPreviewModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onContinueStory={handleContinueStory}
          onSocialAction={handleSocialAction}
          socialState={socialState}
        />
      ) : null}
    </div>
  );
}
