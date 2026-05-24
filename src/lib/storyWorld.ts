import type { CharacterProfile, LumoraPost } from './api';
import { hasCreatorEvent } from './creatorEvents';
import type { LumoraProfile } from './profileStorage';
import type { StudioProject } from './projectStorage';

export type CreatorIdentityCardData = {
  title: string;
  cinematicStyle: string;
  recurringMood: string;
  characterVibe: string;
  visualTone: string;
  storyMemorySeed: string;
  firstSceneIdea: string;
};

export type StoryWorldProgressData = {
  publishedScenes: number;
  drafts: number;
  characters: number;
  storyMemoryUpdates: number;
  completedSceneFlows: number;
  continuityStreak: number;
  firstPublishCompleted: boolean;
  firstCastMemberCreated: boolean;
  firstForYouPostViewed: boolean;
  completionPercent: number;
  headline: string;
};

function firstText(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function compactPreference(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').slice(0, 3).join(', ');
  return '';
}

export function getSelfCharacter(characters: CharacterProfile[]) {
  return characters.find((character) => (
    character.id === 'creator-self' ||
    character.characterId === 'creator-self' ||
    character.isCreatorSelf === true
  )) ?? null;
}

export function buildCreatorIdentityCard(input: {
  profile: LumoraProfile;
  characters: CharacterProfile[];
}): CreatorIdentityCardData {
  const selfCharacter = getSelfCharacter(input.characters);
  const stylePreferences = (
    selfCharacter?.stylePreferences ?? input.profile.creatorSelfStylePreferences ?? {}
  ) as Record<string, unknown>;
  const style = firstText(
    selfCharacter?.cinematicStyle,
    compactPreference(stylePreferences['cinematicStyle']),
    compactPreference(stylePreferences['everydayStyle']),
    compactPreference(stylePreferences['glamStyle']),
    input.profile.creatorSelfStylePreferences?.everydayStyle,
    'Cinematic AI cast realism with a personal creator glow',
  );
  const mood = firstText(
    selfCharacter?.emotionalTendencies,
    compactPreference(stylePreferences['characterVibe']),
    'Intimate, expressive, and emotionally clear',
  );
  const vibe = firstText(
    selfCharacter?.appearanceSummary,
    selfCharacter?.identityProfile?.appearanceSummary,
    input.profile.bio,
    `${input.profile.displayName || 'Your creator self'} as the first recurring presence in your world`,
  );
  const wardrobe = firstText(
    selfCharacter?.wardrobeTendencies,
    compactPreference(stylePreferences['videoWardrobe']),
    input.profile.creatorSelfStylePreferences?.videoWardrobe,
    'Polished AI cast styling that can evolve scene by scene',
  );
  const seed = firstText(
    selfCharacter?.continuityState?.previousSceneSummary,
    selfCharacter?.memorySnapshots?.[0]?.summary,
    'Lumora will remember your style, story tone, and recurring details as you create.',
  );

  return {
    title: input.profile.displayName ? `${input.profile.displayName}'s AI cast identity` : 'Your AI cast identity',
    cinematicStyle: style,
    recurringMood: mood,
    characterVibe: vibe,
    visualTone: wardrobe,
    storyMemorySeed: seed,
    firstSceneIdea: `Start with one scene: ${mood.toLowerCase()} energy, ${style.toLowerCase()}, and a moment that feels unmistakably yours.`,
  };
}

export function buildStoryWorldProgress(input: {
  drafts: Array<StudioProject | { id: string }>;
  posts: LumoraPost[];
  characters: CharacterProfile[];
}): StoryWorldProgressData {
  const storyMemoryUpdates = input.characters.reduce((total, character) => {
    const continuityFields = Object.values(character.continuityState ?? {}).filter(Boolean).length;
    return total + continuityFields + (character.memorySnapshots?.length ?? 0);
  }, 0);
  const completedSceneFlows = new Set(
    input.characters.flatMap((character) =>
      (character.memorySnapshots ?? [])
        .map((snapshot) => snapshot.sceneExecutionId || snapshot.sceneId)
        .filter((value): value is string => Boolean(value)),
    ),
  ).size;
  const firstPublishCompleted = input.posts.length > 0;
  const firstCastMemberCreated = input.characters.length > 0;
  const firstForYouPostViewed = hasCreatorEvent('for_you_item_opened');
  const milestones = [
    firstCastMemberCreated,
    input.drafts.length > 0,
    firstPublishCompleted,
    storyMemoryUpdates > 0,
    completedSceneFlows > 0,
    firstForYouPostViewed,
  ];
  const completionPercent = Math.round((milestones.filter(Boolean).length / milestones.length) * 100);
  const headline = firstPublishCompleted
    ? `${input.posts.length} published AI cast video${input.posts.length === 1 ? '' : 's'} in your story world.`
    : input.drafts.length
      ? 'Your first generated scene is waiting in Drafts.'
      : 'Your story world is just beginning.';

  return {
    publishedScenes: input.posts.length,
    drafts: input.drafts.length,
    characters: input.characters.length,
    storyMemoryUpdates,
    completedSceneFlows,
    continuityStreak: Math.min(9, storyMemoryUpdates),
    firstPublishCompleted,
    firstCastMemberCreated,
    firstForYouPostViewed,
    completionPercent,
    headline,
  };
}
