import { useEffect, useState } from 'react';
import TopChips from '../components/TopChips';
import SwipeFeed from '../components/SwipeFeed';
import HomeFeedCard from '../components/HomeFeedCard';
import { posts, topChips, type Post, type TopChip } from '../data/mockData';
import type { LumoraPost } from '../lib/api';

function formatPostedDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString();
}

function getPostStats(postId: string): { likes: number; comments: number } {
  // fake stats for now
  const seed = postId.charCodeAt(0) || 1;
  return {
    likes: 500 + seed * 3,
    comments: 10 + seed,
  };
}

function getCombinedPostText(post: LumoraPost): string {
  return `${post.title} ${post.prompt || ''}`;
}

function getCombinedDemoPostText(post: Post): string {
  return `${post.title} ${post.prompt}`;
}

const categoryKeywords: Record<Exclude<TopChip, 'For You'>, string[]> = {
  Cinematic: ['cinematic', 'dramatic', 'film', 'scene', 'editorial'],
  Chaos: ['chaos', 'chaotic', 'wild', 'unhinged', 'energy'],
  Beauty: ['beauty', 'glam', 'model', 'portrait', 'makeup'],
  Luxury: ['luxury', 'rich', 'expensive', 'jet', 'high-end'],
  Funny: ['funny', 'comedy', 'joke', 'meme'],
  'NPC Core': ['npc', 'ai', 'avatar', 'virtual', 'robot'],
};

function matchesCategory(category: TopChip, text: string): boolean {
  if (category === 'For You') return true;

  const keywords = categoryKeywords[category];
  const lower = text.toLowerCase();

  return keywords.some((word) => lower.includes(word));
}

export default function HomePage() {
  const [activeCategory, setActiveCategory] = useState<TopChip>('For You');
  const [postedConcepts, setPostedConcepts] = useState<LumoraPost[]>([]);
  const [feedMessage, setFeedMessage] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lumoraPosts') || '[]');
      if (Array.isArray(saved)) {
        setPostedConcepts(saved);
      }
    } catch {
      setPostedConcepts([]);
    }
  }, []);

  const filteredPostedConcepts =
    activeCategory === 'For You'
      ? postedConcepts
      : postedConcepts.filter((post) =>
          matchesCategory(activeCategory, getCombinedPostText(post))
        );

  const filteredDemoPosts =
    activeCategory === 'For You'
      ? posts
      : posts.filter((post) =>
          matchesCategory(activeCategory, getCombinedDemoPostText(post))
        );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Lumora</h1>
      </header>

      <TopChips
        items={topChips}
        activeItem={activeCategory}
        onSelect={(item) => setActiveCategory(item)}
      />

      {postedConcepts.length ? (
        filteredPostedConcepts.length ? (
          <section className="list-stack">
            {filteredPostedConcepts.map((post) => (
              <HomeFeedCard key={post.id} post={post} />
            ))}
          </section>
        ) : (
          <section className="list-stack">
            <article className="list-card">
              <h3>No {activeCategory.toLowerCase()} posts yet</h3>
              <p>Try another category or post something from Studio.</p>
            </article>
          </section>
        )
      ) : filteredDemoPosts.length ? (
        <SwipeFeed posts={filteredDemoPosts} />
      ) : (
        <section className="list-stack">
          <article className="list-card">
            <h3>No {activeCategory.toLowerCase()} demos yet</h3>
            <p>The demo feed does not have a match for this category.</p>
          </article>
        </section>
      )}
    </div>
  );
}
