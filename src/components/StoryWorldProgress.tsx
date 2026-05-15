import type { StoryWorldProgressData } from '../lib/storyWorld';

type StoryWorldProgressProps = {
  progress: StoryWorldProgressData;
  compact?: boolean;
};

export default function StoryWorldProgress({ progress, compact = false }: StoryWorldProgressProps) {
  const milestones = [
    { label: 'First cast member', done: progress.firstCastMemberCreated },
    { label: 'First draft saved', done: progress.drafts > 0 },
    { label: 'First moment published', done: progress.firstPublishCompleted },
    { label: 'Story Memory started', done: progress.storyMemoryUpdates > 0 },
  ];

  return (
    <section className={`story-world-progress ${compact ? 'compact' : ''}`} aria-label="Story World progress">
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Story World</span>
          <h3>{progress.headline}</h3>
        </div>
        <span className="tiny-pill">{progress.completionPercent}%</span>
      </div>
      <div className="creator-onboarding-progress" aria-label={`Story World progress ${progress.completionPercent}%`}>
        <div style={{ width: `${progress.completionPercent}%` }} />
      </div>
      <div className="story-world-stats">
        <span><strong>{progress.publishedScenes}</strong> published</span>
        <span><strong>{progress.drafts}</strong> drafts</span>
        <span><strong>{progress.characters}</strong> cast</span>
        <span><strong>{progress.storyMemoryUpdates}</strong> memories</span>
      </div>
      {!compact ? (
        <div className="story-world-milestones">
          {milestones.map((milestone) => (
            <span key={milestone.label} className={milestone.done ? 'done' : ''}>
              {milestone.done ? 'Ready' : 'Next'}: {milestone.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
