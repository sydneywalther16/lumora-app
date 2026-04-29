import { useEffect, useState } from 'react';
import TopChips from '../components/TopChips';
import { posts, topChips, type Post, type TopChip } from '../data/mockData';

type LocalLumoraPost = {
  id: string;
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  createdAt: string;

  creatorName?: string;
  creatorUsername?: string;
  creatorAvatar?: string;

  characterName?: string;
  characterAvatar?: string;
  characterId?: string;
  isDefaultSelfCharacter?: boolean;
};

const categoryKeywords: Record<Exclude<TopChip, 'For You'>, string[]> = {
  Cinematic: ['cinematic', 'dramatic', 'film', 'scene', 'editorial', 'sunset', 'movie'],
  Chaos: ['chaos', 'chaotic', 'wild', 'unhinged', 'energy', 'glitch', 'spiral'],
  Beauty: ['beauty', 'glam', 'model', 'portrait', 'makeup', 'muse', 'influencer'],
  Luxury: ['luxury', 'rich', 'expensive', 'jet', 'high-end', 'glossy', 'premium'],
  Funny: ['funny', 'comedy', 'joke', 'meme', 'sitcom', 'deadpan'],
  'NPC Core': ['npc', 'ai', 'avatar', 'virtual', 'robot', 'digital'],
};

function formatPostedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString();
}

function getPostStats(postId: string): { likes: number; comments: number } {
  let total = 0;

  for (let i = 0; i < postId.length; i += 1) {
    total += postId.charCodeAt(i);
  }

  return {
    likes: 100 + (total % 900),
    comments: 5 + (total % 120),
  };
}

function getCombinedPostText(post: LocalLumoraPost | Post): string {
  return `${post.title} ${post.prompt || ''}`;
}

function matchesCategory(category: TopChip, text: string): boolean {
  if (category === 'For You') return true;

  const keywords = categoryKeywords[category];
  const lower = text.toLowerCase();

  return keywords.some((word) => lower.includes(word));
}

function getStoredPosts(): LocalLumoraPost[] {
  try {
    const savedPosts = JSON.parse(window.localStorage.getItem('lumoraPosts') || '[]');
    return Array.isArray(savedPosts) ? savedPosts : [];
  } catch {
    return [];
  }
}

function PostCard({ post, isDemo = false }: { post: LocalLumoraPost | Post; isDemo?: boolean }) {
  const stats = getPostStats(post.id);
  const imageUrl = post.imageUrl || null;
  const localPost = post as LocalLumoraPost;

  return (
    <article className="list-card">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={post.title}
          style={{
            width: '100%',
            height: '340px',
            objectFit: 'cover',
            borderRadius: '18px',
            display: 'block',
            marginBottom: '14px',
          }}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginTop: '8px',
          marginBottom: '10px',
          opacity: 0.82,
          flexWrap: 'wrap',
        }}
      >
        <span>💖 {stats.likes}</span>
        <span>🔥 Trending</span>
        <span>💬 {stats.comments}</span>
      </div>

      <div className="row-between">
        <h3>{post.title || 'Untitled concept'}</h3>
        <span className="tiny-pill" style={{ background: isDemo ? '#2a1f3d' : '#214331' }}>
          {isDemo ? 'Demo' : 'Live'}
        </span>
      </div>

      {!isDemo && localPost.creatorUsername ? (
        <p className="muted">
          Posted by {localPost.creatorName || 'Lumora Creator'} {localPost.creatorUsername}
        </p>
      ) : null}

      {!isDemo && localPost.characterName ? (
        <p className="muted">
          {localPost.isDefaultSelfCharacter
            ? 'Created as self'
            : `Featuring ${localPost.characterName}`}
        </p>
      ) : null}

      <p style={{ opacity: 0.9, lineHeight: 1.5 }}>
        {post.prompt || 'Posted from Studio'}
      </p>

      <p className="muted">Posted {formatPostedDate(post.createdAt)}</p>
    </article>
  );
}

export default function HomePage() {
  const [activeCategory, setActiveCategory] = useState<TopChip>('For You');
  const [postedConcepts, setPostedConcepts] = useState<LocalLumoraPost[]>([]);

  useEffect(() => {
    const loadPosts = () => {
      setPostedConcepts(getStoredPosts());
    };

    loadPosts();

    window.addEventListener('storage', loadPosts);
    window.addEventListener('lumoraPostsUpdated', loadPosts);

    return () => {
      window.removeEventListener('storage', loadPosts);
      window.removeEventListener('lumoraPostsUpdated', loadPosts);
    };
  }, []);

  const filteredPostedConcepts =
    activeCategory === 'For You'
      ? postedConcepts
      : postedConcepts.filter((post) =>
          matchesCategory(activeCategory, getCombinedPostText(post)),
        );

  const filteredDemoPosts =
    activeCategory === 'For You'
      ? posts
      : posts.filter((post) =>
          matchesCategory(activeCategory, getCombinedPostText(post)),
        );

  const visiblePosts = postedConcepts.length ? filteredPostedConcepts : filteredDemoPosts;
  const showingDemos = !postedConcepts.length;

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
          <strong>{postedConcepts.length ? 98 : 96}</strong>
        </div>

        <div className="hero-stat-card">
          <span>Trending rate</span>
          <strong>{postedConcepts.length ? '+52%' : '+38%'}</strong>
        </div>
      </div>

      <div className="button-row">
        <button type="button" className="ghost-btn">
          Remix
        </button>
        <button type="button" className="ghost-btn">
          Prompt
        </button>
        <button type="button" className="ghost-btn">
          Save
        </button>
        <button type="button" className="ghost-btn">
          Share
        </button>
      </div>

      {visiblePosts.length ? (
        <section className="list-stack">
          {visiblePosts.map((post) => (
            <PostCard key={post.id} post={post} isDemo={showingDemos} />
          ))}
        </section>
      ) : (
        <section className="list-stack">
          <article className="list-card">
            <h3>No {activeCategory.toLowerCase()} posts yet</h3>
            <p>Try another category, or post a concept from Studio that matches this lane.</p>
          </article>
        </section>
      )}
    </div>
  );
}