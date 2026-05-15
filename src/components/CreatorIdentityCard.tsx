import type { CreatorIdentityCardData } from '../lib/storyWorld';

type CreatorIdentityCardProps = {
  card: CreatorIdentityCardData;
  compact?: boolean;
  onEdit?: () => void;
};

export default function CreatorIdentityCard({ card, compact = false, onEdit }: CreatorIdentityCardProps) {
  return (
    <article className={`creator-identity-card ${compact ? 'compact' : ''}`}>
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Creator Identity Card</span>
          <h3>{card.title}</h3>
        </div>
        {onEdit ? (
          <button type="button" className="text-btn" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
      <p className="muted">Lumora will use this to guide your future scenes.</p>
      <div className="creator-identity-grid">
        <span><strong>Style</strong>{card.cinematicStyle}</span>
        <span><strong>Mood</strong>{card.recurringMood}</span>
        <span><strong>Vibe</strong>{card.characterVibe}</span>
        <span><strong>Visual tone</strong>{card.visualTone}</span>
      </div>
      {!compact ? (
        <>
          <div className="story-memory-moment">
            <span className="tiny-dot" />
            <p>{card.storyMemorySeed}</p>
          </div>
          <p className="muted" style={{ margin: 0 }}>{card.firstSceneIdea}</p>
        </>
      ) : null}
    </article>
  );
}
