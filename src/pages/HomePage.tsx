import ActionRail from '../components/ActionRail';
import BottomSheet from '../components/BottomSheet';
import SwipeFeed from '../components/SwipeFeed';
import TopChips from '../components/TopChips';
import { posts, topChips } from '../data/mockData';

export default function HomePage() {
  return (
    <div className="page">
      <TopChips items={topChips} />
      <div className="hero-stat-row">
        <div className="hero-stat-card">
          <span>Creator score</span>
          <strong>96</strong>
        </div>
        <div className="hero-stat-card">
          <span>Trending rate</span>
          <strong>+38%</strong>
        </div>
      </div>
      <ActionRail />
      <SwipeFeed posts={posts} />
      <BottomSheet title="Quick studio note">
        <p>
          Your best-performing concepts this week all share a stronger first-frame hook and a more direct face reveal.
        </p>
      </BottomSheet>
    </div>
  );
}
