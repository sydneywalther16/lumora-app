import BottomSheet from '../components/BottomSheet';
import TrendList from '../components/TrendList';

export default function TrendsPage() {
  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">trend radar</span>
          <h2>What is hitting right now</h2>
        </div>
        <p>Tap any trend to push its prompt into the Create screen instantly.</p>
      </section>
      <TrendList />
      <BottomSheet title="Signal readout">
        <p>Comedy confessionals and luxury lifestyle POVs are converting hardest for swipe retention.</p>
      </BottomSheet>
    </div>
  );
}
