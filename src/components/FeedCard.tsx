import { motion } from 'framer-motion';
import type { Post } from '../data/mockData';

type Props = {
  post: Post;
};

export default function FeedCard({ post }: Props) {
  return (
    <motion.article
      className="feed-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.25 }}
    >
      <div className="card-media">
        <div className="gradient-orb orb-a" />
        <div className="gradient-orb orb-b" />
        <div className="card-badge">{post.stylePreset}</div>
        <div className="card-user">{post.userHandle}</div>
      </div>
      <div className="card-body">
        <p className="card-caption">{post.caption}</p>
        <div className="tag-row">
          {post.tags.map((tag) => (
            <span className="tag" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
        <p className="prompt-copy">{post.prompt}</p>
        <div className="stats-row">
          <span>♥ {post.stats.likes}</span>
          <span>↺ {post.stats.remix}</span>
          <span>★ {post.stats.saves}</span>
        </div>
      </div>
    </motion.article>
  );
}
