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

  for (let i = 0; i < postId.length; i += 1) {
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
        const savedPosts = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');
        setPostedConcepts(Array.isArray(savedPosts) ? savedPosts : []);
      } catch {
        setPostedConcepts([]);
      }
    };

    loadPosts();

    window.addEventListener('storage', loadPosts);

    return () => {
      window.removeEventListener('storage', loadPosts);
    };
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
              <article className="list-card" key={post.id}>
                {post.imageUrl ? (
                  <img
                    src={post.imageUrl}
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

                <div className="row-between">
                  <h3>{post.title || 'Untitled Lumora post'}</h3>
                  <span className="tiny-pill">Posted</span>
                </div>

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
                  <span>❤️ {stats.likes}</span>
                  <span>🔥 Trending</span>
                  <span>💬 {stats.comments}</span>
                </div>

                <p>{post.prompt || 'Posted from Studio'}</p>

                <p className="muted">Posted {formatPostedDate(post.createdAt)}</p>
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
            : 'Your best-performing concepts this week all share a stronger first-frame hook and a more direct face reveal.'}
        </p>
      </BottomSheet>
    </div>
  );
}
