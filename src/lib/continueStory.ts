import type { GenerationMode, ReferenceImageUrls } from './api';
import { buildContinueStoryScaffold } from './aiCastExperience';

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
  provider?: string | null;
  displayEngine?: string | null;
  exactLikenessRoute?: string | null;
  exactLikenessProvider?: string | null;
  exactLikenessCanaryStatus?: string | null;
  referenceStrategy?: string | null;
  referenceRolesUsed?: string[] | null;
  referenceCount?: number | null;
  sceneAnchorStrategy?: string | null;
  sceneAnchorGenerated?: boolean | null;
  sceneAnchorPersisted?: boolean | null;
  sceneAnchorProvider?: string | null;
  sceneAnchorReason?: string | null;
  sceneAnchorFailureCategory?: string | null;
  sceneAnchorValidation?: Record<string, unknown> | null;
  primaryInputType?: string | null;
  primaryVideoInputType?: string | null;
  primaryVideoInputSource?: string | null;
  identityReferencesPassedToVideoStage?: boolean | null;
  identityReferenceCount?: number | null;
  identityReferenceMode?: string | null;
  startFrameSource?: string | null;
  posterFrameSource?: string | null;
  firstFrameSource?: string | null;
  sceneIntent?: string[] | null;
  framingIntent?: string | null;
  primaryReferenceRole?: string | null;
  supportingReferenceRoles?: string[] | null;
  userSpecifiedOutfit?: boolean | null;
  outfitTermsDetected?: string[] | null;
  environmentTermsDetected?: string[] | null;
  referenceOutfitCarryoverSuppressed?: boolean | null;
  compositionCarryoverSuppressed?: boolean | null;
  frontOnlyFallback?: boolean | null;
  renderProvider?: string | null;
  klingReferenceDiagnostics?: Record<string, unknown> | null;
  audioConfigured?: boolean | null;
  viralPresetUsed?: string | null;
  promptPolished?: boolean | null;
};

function exactKlingStagingHint(item: ContinueStoryItem) {
  if (item.exactLikenessRoute !== 'kling_reference' && item.generationMode !== 'kling-exact-likeness-reference') {
    return '';
  }

  const diagnostics = item.klingReferenceDiagnostics ?? {};
  const framingIntent = typeof diagnostics.framingIntent === 'string' ? diagnostics.framingIntent : item.referenceStrategy ?? '';
  const primaryRole = typeof diagnostics.primaryReferenceRole === 'string' ? diagnostics.primaryReferenceRole : '';
  const needsSceneStaging =
    framingIntent.includes('walking') ||
    framingIntent.includes('full_body') ||
    framingIntent.includes('open_space') ||
    primaryRole === 'full_body';

  if (!needsSceneStaging) {
    return ' Keep the Kling exact-likeness route and scene-anchor-first identity planning active for identity continuity.';
  }

  return ' Keep the Kling exact-likeness route active with scene-anchor-first planning, medium-full or full-body cinematic staging, a clean unobstructed silhouette, and the saved self-character references used as identity guidance rather than portrait composition.';
}

function nextScenePrompt(item: ContinueStoryItem) {
  const storyText = item.caption || item.prompt || item.title || 'this cinematic moment';
  const characterText = item.characterName ? ` Keep ${item.characterName}'s emotional continuity alive.` : '';
  const exactKlingHint = exactKlingStagingHint(item);
  const sceneAnchorScaffold = buildContinueStoryScaffold(item);
  return `Continue from this moment: ${storyText}. Create the next cinematic scene with a clear emotional turn, visual continuity, and one memorable detail.${characterText}${exactKlingHint}${sceneAnchorScaffold}`;
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
    provider: item.provider ?? null,
    displayEngine: item.displayEngine ?? null,
    exactLikenessRoute: item.exactLikenessRoute ?? null,
    exactLikenessProvider: item.exactLikenessProvider ?? null,
    exactLikenessCanaryStatus: item.exactLikenessCanaryStatus ?? null,
    referenceStrategy: item.referenceStrategy ?? null,
    referenceRolesUsed: item.referenceRolesUsed ?? null,
    referenceCount: item.referenceCount ?? null,
    sceneAnchorStrategy: item.sceneAnchorStrategy ?? null,
    sceneAnchorGenerated: item.sceneAnchorGenerated ?? null,
    sceneAnchorPersisted: item.sceneAnchorPersisted ?? null,
    sceneAnchorProvider: item.sceneAnchorProvider ?? null,
    sceneAnchorReason: item.sceneAnchorReason ?? null,
    sceneAnchorFailureCategory: item.sceneAnchorFailureCategory ?? null,
    sceneAnchorValidation: item.sceneAnchorValidation ?? null,
    primaryInputType: item.primaryInputType ?? null,
    primaryVideoInputType: item.primaryVideoInputType ?? null,
    primaryVideoInputSource: item.primaryVideoInputSource ?? null,
    identityReferencesPassedToVideoStage: item.identityReferencesPassedToVideoStage ?? null,
    identityReferenceCount: item.identityReferenceCount ?? null,
    identityReferenceMode: item.identityReferenceMode ?? null,
    startFrameSource: item.startFrameSource ?? null,
    posterFrameSource: item.posterFrameSource ?? null,
    firstFrameSource: item.firstFrameSource ?? null,
    sceneIntent: item.sceneIntent ?? null,
    framingIntent: item.framingIntent ?? null,
    primaryReferenceRole: item.primaryReferenceRole ?? null,
    supportingReferenceRoles: item.supportingReferenceRoles ?? null,
    userSpecifiedOutfit: item.userSpecifiedOutfit ?? null,
    outfitTermsDetected: item.outfitTermsDetected ?? null,
    environmentTermsDetected: item.environmentTermsDetected ?? null,
    referenceOutfitCarryoverSuppressed: item.referenceOutfitCarryoverSuppressed ?? null,
    compositionCarryoverSuppressed: item.compositionCarryoverSuppressed ?? null,
    frontOnlyFallback: item.frontOnlyFallback ?? null,
    renderProvider: item.renderProvider ?? null,
    klingReferenceDiagnostics: item.klingReferenceDiagnostics ?? null,
    audioConfigured: item.audioConfigured ?? null,
    viralPresetUsed: item.viralPresetUsed ?? null,
    promptPolished: item.promptPolished ?? null,
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
  if (item.exactLikenessRoute === 'kling_reference' || item.generationMode === 'kling-exact-likeness-reference') {
    localStorage.setItem('lumora_remix_render_engine', 'replicate');
  }
}

export function openContinueStory(item: ContinueStoryItem, source: string) {
  prepareContinueStory(item, source);
  window.location.href = '/create';
}
