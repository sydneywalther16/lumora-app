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

export default function HomePage() {
  const [postedConcepts, setPostedConcepts] = useState<LumoraPost[]>([]);

  useEffect(() => {
    const savedPosts = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');
    setPostedConcepts(savedPosts);
  }, []);

  const homePosts = postedConcepts.length
    ? postedConcepts.map((post) => ({
        id: post.id,
        title: post.title || 'Untitled Lumora post',
        subtitle: post.prompt || 'Posted from Studio',
        imageUrl: post.imageUrl || '/demo-placeholder.jpg',
        creator: '@you',
        stats: 'Posted',
      }))
    : posts;

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

      {postedConcepts.length ? (
        <section className="headline-card">
          <div>
            <span className="eyebrow">live feed</span>
            <h2>Your posted Lumora concepts</h2>
          </div>
          <p>Your Studio posts now appear here as your personal creator feed.</p>
        </section>
      ) : null}

      <ActionRail />
      <SwipeFeed posts={homePosts} />

      <BottomSheet title={postedConcepts.length ? 'Feed is live' : 'Quick studio note'}>
        <p>
          {postedConcepts.length
            ? 'Your posted concepts are now feeding into Home. Next step: make Post save to the real database so everyone can see it.'
            : 'Your best-performing concepts this week all share a stronger first-frame hook and a more direct face reveal.'}
        </p>
      </BottomSheet>
    </div>
  );
}
