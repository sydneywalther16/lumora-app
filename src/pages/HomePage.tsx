import { useEffect, useState } from 'react';
import ActionRail from '../components/ActionRail';
import BottomSheet from '../components/BottomSheet';
import SwipeFeed from '../components/SwipeFeed';
import TopChips from '../components/TopChips';
import { posts, topChips } from '../data/mockData';

type LumoraPost = {
  id: string;
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  createdAt: string;
};

function formatPostedDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString();
}

function getPostStats(postId: string) {
  let total = 0;
  for (let i = 0; i < postId.length; i++) {
    total += postId.charCodeAt(i);
  }

  return {
    likes: 100 + (total % 900),
    comments: 5 + (total % 120),
  };
}

export default function HomePage() {
  const [postedConcepts, setPostedConcepts] = useState<LumoraPost[]>([]);

  useEffect(() => {
    const loadPosts = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');
        setPostedConcepts(Array.isArray(saved) ? saved : []);
      } catch {
        setPostedConcepts([]);
      }
    };

    loadPosts();
    window.addEventListener('storage', loadPosts);

    return () => window.removeEventListener('storage', loadPosts);
  }, []);

  return (
    <div className="page">
      <TopChips items={topChips} />

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

      <ActionRail />

      {postedConcepts.length ? (
        <section className="list-stack">
          {postedConcepts.map((post) => {
            const stats = getPostStats(post.id);

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
                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    style={{
                      width: '100%',
                      height: '420px',
                      objectFit: 'cover',
                      borderRadius: '22px',
                      marginBottom: '12px',
                    }}
                  />
                )}

                <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                  <span>❤️ {stats.likes}</span>
                  <span>🔥 Trending</span>
                  <span>💬 {stats.comments}</span>
                </div>

                <div className="row-between">
                  <h3>{post.title || 'Untitled Lumora post'}</h3>
                  <span className="tiny-pill" style={{ background: '#2a1f3d' }}>
                    Live
                  </span>
                </div>

                <p style={{ opacity: 0.9, lineHeight: 1.5 }}>
                  {post.prompt || 'Posted from Studio'}
                </p>

                <p className="muted">
                  Posted {formatPostedDate(post.createdAt)}
                </p>
              </article>
            );
          })}
        </section>
      ) : (
        <SwipeFeed posts={posts} />
      )}

      <BottomSheet title={postedConcepts.length ? 'Feed is live' : 'Quick studio note'}>
        <p>
          {postedConcepts.length
            ? 'Your posted concepts are now showing in Home.'
            : 'Your best-performing concepts this week all share a stronger first-frame hook.'}
        </p>
      </BottomSheet>
    </div>
  );
}
