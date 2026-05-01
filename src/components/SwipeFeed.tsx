import FeedCard from './FeedCard';
import type { Post } from '../data/mockData';

type Props = { posts: Post[] };

export default function SwipeFeed({ posts }: Props) {
  return (
    <section className="feed-stack">
      {posts.map((post) => (
        <FeedCard key={post.id} post={post} />
      ))}
    </section>
  );
}
