import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const CREATOR_ONBOARDING_STORAGE_KEY = 'lumora_creator_onboarding_seen_v1';

type CreatorOnboardingProps = {
  embedded?: boolean;
};

const onboardingSteps = [
  {
    eyebrow: 'welcome',
    title: 'Make your world cinematic',
    body: 'Lumora helps turn your ideas, cast, and style into cinematic scenes that remember what came before.',
    beats: ['Your cinematic identity', 'Your cast', 'Your story memory', 'Your scene flow'],
  },
  {
    eyebrow: 'identity',
    title: 'Create your cinematic identity',
    body: 'Start with your self character so Lumora can keep your look, presence, and creator style consistent.',
    beats: ['Add reference photos', 'Choose your style', 'Save your creator look'],
  },
  {
    eyebrow: 'cast',
    title: 'Build a reusable cast',
    body: 'Bring characters back across scenes with familiar faces, wardrobe tendencies, emotional tone, and memory.',
    beats: ['Self pinned first', 'Cast members underneath', 'Up to 25 cinematic identities'],
  },
  {
    eyebrow: 'story memory',
    title: 'Let your world remember',
    body: 'Story Memory keeps track of tone, settings, props, weather, camera feel, and the last scene so each moment belongs to the same world.',
    beats: ['Continuity preserved', 'Style remembered', 'Emotional pacing carried forward'],
  },
  {
    eyebrow: 'scene flow',
    title: 'Generate your first scene',
    body: 'Lumora shapes your prompt into cinematic beats, saves each finished shot, and keeps successful scenes safe if a later shot needs another take.',
    beats: ['Storyboard', 'Scene progress', 'Draft autosave'],
  },
  {
    eyebrow: 'publish',
    title: 'Post when it feels right',
    body: 'Drafts stay private until you publish. Once posted, your cinematic moment joins your profile and discovery feed.',
    beats: ['Preview in Drafts', 'Post to profile', 'Discover on For You'],
  },
];

function markOnboardingSeen() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CREATOR_ONBOARDING_STORAGE_KEY, 'seen');
  } catch {
    // Local storage can be unavailable in private browser modes.
  }
}

export default function CreatorOnboarding({ embedded = false }: CreatorOnboardingProps) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(!embedded);
  const [stepIndex, setStepIndex] = useState(0);
  const step = onboardingSteps[stepIndex];
  const progressPercent = Math.round(((stepIndex + 1) / onboardingSteps.length) * 100);
  const isLastStep = stepIndex === onboardingSteps.length - 1;

  useEffect(() => {
    if (!embedded || typeof window === 'undefined') return;
    try {
      setVisible(localStorage.getItem(CREATOR_ONBOARDING_STORAGE_KEY) !== 'seen');
    } catch {
      setVisible(true);
    }
  }, [embedded]);

  function close(target?: string) {
    markOnboardingSeen();
    if (embedded) {
      setVisible(false);
      return;
    }
    navigate(target ?? '/create');
  }

  if (!visible) return null;

  return (
    <section className={embedded ? 'creator-onboarding-card' : 'creator-onboarding-page'} aria-label="Lumora onboarding">
      <div className="creator-onboarding-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="creator-onboarding-copy">
        <span className="eyebrow">{step.eyebrow}</span>
        <h2>{step.title}</h2>
        <p>{step.body}</p>

        <div className="creator-onboarding-beats">
          {step.beats.map((beat) => (
            <span key={beat}>{beat}</span>
          ))}
        </div>
      </div>

      <div className="creator-onboarding-progress" aria-label={`Onboarding progress ${progressPercent}%`}>
        <div style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="creator-onboarding-dots" aria-hidden="true">
        {onboardingSteps.map((item, index) => (
          <span key={item.title} className={index === stepIndex ? 'active' : ''} />
        ))}
      </div>

      <div className="button-row">
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            if (isLastStep) {
              close('/create');
              return;
            }
            setStepIndex((current) => Math.min(onboardingSteps.length - 1, current + 1));
          }}
        >
          {isLastStep ? 'Start first scene' : 'Continue'}
        </button>
        <button type="button" className="ghost-btn" onClick={() => close('/for-you')}>
          {embedded ? 'Hide for now' : 'Explore For You'}
        </button>
      </div>
    </section>
  );
}
