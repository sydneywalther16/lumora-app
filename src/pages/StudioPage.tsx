import StudioList from '../components/StudioList';

export default function StudioPage() {
  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">projects</span>
          <h2>Your content factory</h2>
        </div>
        <p>Everything in one place: drafts, renders, queued exports, and published concepts.</p>
      </section>
      <StudioList />
    </div>
  );
}
