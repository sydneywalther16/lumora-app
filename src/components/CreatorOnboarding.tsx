import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredCharacters } from '../lib/characterStorage';
import { trackCreatorEvent } from '../lib/creatorEvents';
import { loadPostedPublications } from '../lib/postStorage';
import { loadLumoraProfile } from '../lib/profileStorage';
import { loadStudioProjects } from '../lib/projectStorage';
import { buildCreatorIdentityCard, buildStoryWorldProgress } from '../lib/storyWorld';
import CreatorIdentityCard from './CreatorIdentityCard';
import StoryWorldProgress from './StoryWorldProgress';

export const CREATOR_ONBOARDING_STORAGE_KEY = 'lumora_creator_onboarding_seen_v1';

type CreatorOnboardingProps = {
  embedded?: boolean;
};

const onboardingSteps = [
  {
    eyebrow: 'welcome',
    title: "Let's build your cinematic identity.",
    body: 'Start with one scene. Your story world can grow from there.',
    beats: ['Your cinematic identity', 'Your cast', 'Your story memory', 'Your scene flow'],
  },
  {
    eyebrow: 'identity',
    title: 'Your first cast member is you.',
    body: 'Create your self character so Lumora can keep your look, presence, and creator style consistent.',
    beats: ['Create Self Character', 'You control your cast', 'Self stays pinned first'],
  },
  {
    eyebrow: 'references',
    title: 'Add one to five reference photos.',
    body: 'A few strong references help Lumora preserve your cinematic identity without forcing every scene to look the same.',
    beats: ['Front photo', 'Angles', 'Optional full-body'],
  },
  {
    eyebrow: 'vibe',
    title: 'Choose the feeling of your world.',
    body: 'Pick a cinematic vibe now. You can refine the mood, style, and visual tone later.',
    beats: ['Mood', 'Wardrobe', 'Visual tone'],
  },
  {
    eyebrow: 'reveal',
    title: 'Lumora starts to understand your universe.',
    body: 'This Creator Identity Card is a first draft of your cinematic signal.',
    beats: ['Style seed', 'Story Memory seed', 'First scene idea'],
  },
  {
    eyebrow: 'storyboard',
    title: 'Build your first storyboard.',
    body: 'Lumora shapes your idea into cinematic beats before the scene begins rendering.',
    beats: ['Emotional pacing', 'Camera feeling', 'Scene rhythm'],
  },
  {
    eyebrow: 'scene flow',
    title: 'Render the first Scene Flow.',
    body: 'Finished shots stay safe in Drafts, and Story Memory carries the feeling forward.',
    beats: ['Saving scene references', 'Preserving Story Memory', 'Draft autosave'],
  },
  {
    eyebrow: 'publish',
    title: 'Reveal your first cinematic moment.',
    body: 'Drafts stay private until published. Once posted, your moment joins your profile and can appear in For You.',
    beats: ['Your scene is live', 'Profile reveal', 'Welcome to For You'],
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
  const identityCard = useMemo(() => buildCreatorIdentityCard({
    profile: loadLumoraProfile(),
    characters: getStoredCharacters(),
  }), []);
  const storyWorldProgress = useMemo(() => buildStoryWorldProgress({
    drafts: loadStudioProjects(),
    posts: loadPostedPublications(),
    characters: getStoredCharacters(),
  }), []);
  const step = onboardingSteps[stepIndex];
  const progressPercent = Math.round(((stepIndex + 1) / onboardingSteps.length) * 100);
  const isLastStep = stepIndex === onboardingSteps.length - 1;

  useEffect(() => {
    void trackCreatorEvent('onboarding_started', { embedded });
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

      {step.eyebrow === 'reveal' ? (
        <CreatorIdentityCard card={identityCard} compact={embedded} />
      ) : null}

      {step.eyebrow === 'publish' ? (
        <StoryWorldProgress progress={storyWorldProgress} compact={embedded} />
      ) : null}

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
        <button type="button" className="ghost-btn" onClick={() => close('/create')}>
          Skip for now
        </button>
      </div>
    </section>
  );
}
