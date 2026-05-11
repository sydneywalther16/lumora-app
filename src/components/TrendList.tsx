import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export default function TrendList() {
  const navigate = useNavigate();
  const { trends, selectedTrend, setSelectedTrend, setActivePrompt, setDraftTitle } = useAppStore();

  return (
    <section className="list-stack">
      {trends.map((trend) => (
        <button
          type="button"
          key={trend.id}
          className={`list-card ${selectedTrend === trend.id ? 'selected' : ''}`}
          onClick={() => {
            setSelectedTrend(trend.id);
            setActivePrompt(trend.prompt);
            setDraftTitle(trend.title);
            navigate('/create');
          }}
        >
          <div className="row-between">
            <h3>{trend.title}</h3>
            <span className="tiny-pill">{trend.category}</span>
          </div>
          <p>{trend.prompt}</p>
          <div className="row-between muted-line">
            <span>{trend.uses}</span>
            <span>Tap to create</span>
          </div>
        </button>
      ))}
    </section>
  );
}
