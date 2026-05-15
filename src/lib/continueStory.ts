import type { GenerationMode, ReferenceImageUrls } from './api';

type ContinueStoryItem = {
  id: string;
  projectId?: string | null;
  prompt?: string | null;
  title?: string | null;
  caption?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
  generationMode?: GenerationMode | null;
};

function nextScenePrompt(item: ContinueStoryItem) {
  const storyText = item.caption || item.prompt || item.title || 'this cinematic moment';
  const characterText = item.characterName ? ` Keep ${item.characterName}'s emotional continuity alive.` : '';
  return `Continue from this moment: ${storyText}. Create the next cinematic scene with a clear emotional turn, visual continuity, and one memorable detail.${characterText}`;
}

export function prepareContinueStory(item: ContinueStoryItem, source: string) {
  if (typeof window === 'undefined') return;

  const prompt = nextScenePrompt(item);
  const title = `Continue: ${item.title || item.caption || 'Lumora story'}`;
  const payload = {
    projectId: item.projectId || item.id,
    prompt,
    title,
    characterId: item.characterId ?? null,
    characterName: item.characterName ?? null,
    characterAvatar: item.characterAvatar ?? null,
    isDefaultSelfCharacter: Boolean(item.isDefaultSelfCharacter),
    referenceImageUrl: item.referenceImageUrl ?? item.characterAvatar ?? null,
    referenceImageUrls: (item.referenceImageUrls ?? null) as Partial<ReferenceImageUrls> | null,
    additionalReferenceImageUrls: item.additionalReferenceImageUrls ?? [],
    generationMode: item.generationMode ?? null,
    source,
  };

  localStorage.setItem('remixPrompt', prompt);
  localStorage.setItem('remixTitle', title);
  localStorage.setItem('lumora_remix_project', JSON.stringify(payload));
  localStorage.setItem('lumora_continue_story_context', JSON.stringify({
    source,
    sourceId: item.id,
    characterName: item.characterName ?? null,
    createdAt: new Date().toISOString(),
  }));
}

export function openContinueStory(item: ContinueStoryItem, source: string) {
  prepareContinueStory(item, source);
  window.location.href = '/create';
}
