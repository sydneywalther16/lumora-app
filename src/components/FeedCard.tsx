import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { Post } from '../data/mockData';
import { useAppStore } from '../store/useAppStore';

type Props = {
  post: Post;
};

export default function FeedCard({ post }: Props) {
  const navigate = useNavigate();
  const { setActivePrompt, setDraftTitle } = useAppStore();

  function openInCreate() {
    setActivePrompt(post.prompt);
    setDraftTitle(`Inspired by ${post.caption}`);
    navigate('/create');
  }

  return (
    <motion.button
      type="button"
      className="feed-card"
      aria-label={`Open ${post.caption} in Create`}
      onClick={openInCreate}
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
          <span>Likes {post.stats.likes}</span>
          <span>Remixes {post.stats.remix}</span>
          <span>Saves {post.stats.saves}</span>
        </div>
      </div>
    </motion.button>
  );
}
