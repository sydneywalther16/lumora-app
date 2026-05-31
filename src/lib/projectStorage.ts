import type { GenerationMode, LumoraIdentityFeedback, ReferenceImageUrls, VideoEngine } from './api';
import { getBestPoster, getBestThumbnail, resolveGeneratedVideoMedia } from './mediaThumbnail';

export type StudioProject = {
  id: string;
  title?: string | null;
  caption?: string | null;
  prompt: string;
  finalPrompt?: string | null;
  videoUrl: string;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  thumbnailSource?: string | null;
  status: string;
  publishedAt?: string | null;
  postedAt?: string | null;
  isPosted?: boolean | null;
  privacy?: string | null;
  visibility?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  provider: VideoEngine;
  engine?: VideoEngine | null;
  displayEngine?: string | null;
  aspectRatio?: string | null;
  model?: string | null;
  generationMode?: GenerationMode | null;
  identityId?: string | null;
  identityPrompt?: string | null;
  consistencyPrompt?: string | null;
  canonicalReferenceSet?: string[] | null;
  keyframeUrl?: string | null;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[] | null;
  likenessFeedback?: LumoraIdentityFeedback | null;
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
  sceneAnchorHttpStatus?: number | null;
  sceneAnchorErrorType?: string | null;
  sceneAnchorErrorMessage?: string | null;
  sceneAnchorPayloadFieldNames?: string[] | null;
  sceneAnchorReferenceCount?: number | null;
  sceneAnchorSubmittedReferenceCount?: number | null;
  sceneAnchorReferenceRolesUsed?: string[] | null;
  sceneAnchorDroppedReferenceRoles?: string[] | null;
  sceneAnchorProviderReferenceLimit?: number | null;
  sceneAnchorOutputParsed?: boolean | null;
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
  stage2ProviderModel?: string | null;
  stage2ProviderRouteType?: string | null;
  rawReferenceVisualInputsSentToStage2?: boolean | null;
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
  characterId: string | null;
  characterName: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};

const STORAGE_KEY = 'lumora_projects';

function cleanMediaUrl(value: string): string {
  return value.startsWith('data:') || value.startsWith('blob:') ? '' : value;
}

function cleanOptionalMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  return value.startsWith('data:') || value.startsWith('blob:') ? null : value;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isUnpublishedDraftProject(project: StudioProject) {
  const status = project.status.toLowerCase();
  return !project.isPosted && !project.publishedAt && status !== 'published' && status !== 'archived';
}

export function loadStudioProjects(): StudioProject[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const projects = parsed.filter((project): project is StudioProject => {
      return (
        project &&
        typeof project.id === 'string' &&
        typeof project.prompt === 'string' &&
        typeof project.videoUrl === 'string' &&
        typeof project.status === 'string' &&
        typeof project.provider === 'string' &&
        (typeof project.characterId === 'string' || project.characterId === null || project.characterId === undefined) &&
        (typeof project.characterName === 'string' || project.characterName === null) &&
        typeof project.createdAt === 'string'
      );
    });

    return projects
      .map((project) => {
        const generatedMedia = resolveGeneratedVideoMedia(project);
        return {
          ...project,
          title: typeof project.title === 'string' ? project.title : null,
          caption: typeof project.caption === 'string' ? project.caption : null,
          finalPrompt: typeof project.finalPrompt === 'string' ? project.finalPrompt : null,
          thumbnailUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(project),
          posterUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(project),
          thumbnailSource: generatedMedia.thumbnailSource,
          publishedAt: typeof project.publishedAt === 'string' ? project.publishedAt : null,
          postedAt: typeof project.postedAt === 'string' ? project.postedAt : null,
          isPosted: typeof project.isPosted === 'boolean' ? project.isPosted : false,
          privacy: typeof project.privacy === 'string' ? project.privacy : null,
          visibility: typeof project.visibility === 'string' ? project.visibility : null,
          viewCount: numberValue(project.viewCount),
          likeCount: numberValue(project.likeCount),
          commentCount: numberValue(project.commentCount),
          shareCount: numberValue(project.shareCount),
          engine: typeof project.engine === 'string' ? project.engine as VideoEngine : null,
          displayEngine: typeof project.displayEngine === 'string' ? project.displayEngine : null,
          aspectRatio: typeof project.aspectRatio === 'string' ? project.aspectRatio : null,
          model: typeof project.model === 'string' ? project.model : null,
          generationMode: typeof project.generationMode === 'string' ? project.generationMode as GenerationMode : null,
          identityId: typeof project.identityId === 'string' ? project.identityId : null,
          identityPrompt: typeof project.identityPrompt === 'string' ? project.identityPrompt : null,
          consistencyPrompt: typeof project.consistencyPrompt === 'string' ? project.consistencyPrompt : null,
          canonicalReferenceSet: Array.isArray(project.canonicalReferenceSet)
            ? project.canonicalReferenceSet.filter((item): item is string => typeof item === 'string')
            : null,
          keyframeUrl: typeof project.keyframeUrl === 'string' ? project.keyframeUrl : null,
          referenceImageUrl: typeof project.referenceImageUrl === 'string' ? project.referenceImageUrl : null,
          referenceImageUrls:
            project.referenceImageUrls && typeof project.referenceImageUrls === 'object'
              ? project.referenceImageUrls as Partial<ReferenceImageUrls>
              : null,
          additionalReferenceImageUrls: Array.isArray(project.additionalReferenceImageUrls)
            ? project.additionalReferenceImageUrls.filter((item): item is string => typeof item === 'string')
            : null,
          likenessFeedback:
            project.likenessFeedback && typeof project.likenessFeedback === 'object'
              ? project.likenessFeedback as LumoraIdentityFeedback
              : null,
          exactLikenessRoute: typeof project.exactLikenessRoute === 'string' ? project.exactLikenessRoute : null,
          exactLikenessProvider: typeof project.exactLikenessProvider === 'string' ? project.exactLikenessProvider : null,
          exactLikenessCanaryStatus: typeof project.exactLikenessCanaryStatus === 'string' ? project.exactLikenessCanaryStatus : null,
          referenceStrategy: typeof project.referenceStrategy === 'string' ? project.referenceStrategy : null,
          referenceRolesUsed: Array.isArray(project.referenceRolesUsed)
            ? project.referenceRolesUsed.filter((item): item is string => typeof item === 'string')
            : null,
          referenceCount: numberValue(project.referenceCount),
          sceneAnchorStrategy: typeof project.sceneAnchorStrategy === 'string' ? project.sceneAnchorStrategy : null,
          sceneAnchorGenerated: typeof project.sceneAnchorGenerated === 'boolean' ? project.sceneAnchorGenerated : null,
          sceneAnchorPersisted: typeof project.sceneAnchorPersisted === 'boolean' ? project.sceneAnchorPersisted : null,
          sceneAnchorProvider: typeof project.sceneAnchorProvider === 'string' ? project.sceneAnchorProvider : null,
          sceneAnchorReason: typeof project.sceneAnchorReason === 'string' ? project.sceneAnchorReason : null,
          sceneAnchorFailureCategory: typeof project.sceneAnchorFailureCategory === 'string' ? project.sceneAnchorFailureCategory : null,
          sceneAnchorHttpStatus: typeof project.sceneAnchorHttpStatus === 'number' ? project.sceneAnchorHttpStatus : null,
          sceneAnchorErrorType: typeof project.sceneAnchorErrorType === 'string' ? project.sceneAnchorErrorType : null,
          sceneAnchorErrorMessage: typeof project.sceneAnchorErrorMessage === 'string' ? project.sceneAnchorErrorMessage : null,
          sceneAnchorPayloadFieldNames: Array.isArray(project.sceneAnchorPayloadFieldNames)
            ? project.sceneAnchorPayloadFieldNames.filter((item): item is string => typeof item === 'string')
            : null,
          sceneAnchorReferenceCount: typeof project.sceneAnchorReferenceCount === 'number' ? project.sceneAnchorReferenceCount : null,
          sceneAnchorSubmittedReferenceCount: typeof project.sceneAnchorSubmittedReferenceCount === 'number' ? project.sceneAnchorSubmittedReferenceCount : null,
          sceneAnchorReferenceRolesUsed: Array.isArray(project.sceneAnchorReferenceRolesUsed)
            ? project.sceneAnchorReferenceRolesUsed.filter((item): item is string => typeof item === 'string')
            : null,
          sceneAnchorDroppedReferenceRoles: Array.isArray(project.sceneAnchorDroppedReferenceRoles)
            ? project.sceneAnchorDroppedReferenceRoles.filter((item): item is string => typeof item === 'string')
            : null,
          sceneAnchorProviderReferenceLimit: typeof project.sceneAnchorProviderReferenceLimit === 'number' ? project.sceneAnchorProviderReferenceLimit : null,
          sceneAnchorOutputParsed: typeof project.sceneAnchorOutputParsed === 'boolean' ? project.sceneAnchorOutputParsed : null,
          sceneAnchorValidation:
            project.sceneAnchorValidation && typeof project.sceneAnchorValidation === 'object'
              ? project.sceneAnchorValidation as Record<string, unknown>
              : null,
          primaryInputType: typeof project.primaryInputType === 'string' ? project.primaryInputType : null,
          primaryVideoInputType: typeof project.primaryVideoInputType === 'string' ? project.primaryVideoInputType : null,
          primaryVideoInputSource: typeof project.primaryVideoInputSource === 'string' ? project.primaryVideoInputSource : null,
          identityReferencesPassedToVideoStage:
            typeof project.identityReferencesPassedToVideoStage === 'boolean' ? project.identityReferencesPassedToVideoStage : null,
          identityReferenceCount: numberValue(project.identityReferenceCount),
          identityReferenceMode: typeof project.identityReferenceMode === 'string' ? project.identityReferenceMode : null,
          startFrameSource: typeof project.startFrameSource === 'string' ? project.startFrameSource : null,
          posterFrameSource: typeof project.posterFrameSource === 'string' ? project.posterFrameSource : null,
          firstFrameSource: typeof project.firstFrameSource === 'string' ? project.firstFrameSource : null,
          stage2ProviderModel: typeof project.stage2ProviderModel === 'string' ? project.stage2ProviderModel : null,
          stage2ProviderRouteType: typeof project.stage2ProviderRouteType === 'string' ? project.stage2ProviderRouteType : null,
          rawReferenceVisualInputsSentToStage2:
            typeof project.rawReferenceVisualInputsSentToStage2 === 'boolean' ? project.rawReferenceVisualInputsSentToStage2 : null,
          sceneIntent: Array.isArray(project.sceneIntent)
            ? project.sceneIntent.filter((item): item is string => typeof item === 'string')
            : null,
          framingIntent: typeof project.framingIntent === 'string' ? project.framingIntent : null,
          primaryReferenceRole: typeof project.primaryReferenceRole === 'string' ? project.primaryReferenceRole : null,
          supportingReferenceRoles: Array.isArray(project.supportingReferenceRoles)
            ? project.supportingReferenceRoles.filter((item): item is string => typeof item === 'string')
            : null,
          userSpecifiedOutfit: typeof project.userSpecifiedOutfit === 'boolean' ? project.userSpecifiedOutfit : null,
          outfitTermsDetected: Array.isArray(project.outfitTermsDetected)
            ? project.outfitTermsDetected.filter((item): item is string => typeof item === 'string')
            : null,
          environmentTermsDetected: Array.isArray(project.environmentTermsDetected)
            ? project.environmentTermsDetected.filter((item): item is string => typeof item === 'string')
            : null,
          referenceOutfitCarryoverSuppressed:
            typeof project.referenceOutfitCarryoverSuppressed === 'boolean' ? project.referenceOutfitCarryoverSuppressed : null,
          compositionCarryoverSuppressed:
            typeof project.compositionCarryoverSuppressed === 'boolean' ? project.compositionCarryoverSuppressed : null,
          frontOnlyFallback: typeof project.frontOnlyFallback === 'boolean' ? project.frontOnlyFallback : null,
          renderProvider: typeof project.renderProvider === 'string' ? project.renderProvider : null,
          klingReferenceDiagnostics:
            project.klingReferenceDiagnostics && typeof project.klingReferenceDiagnostics === 'object'
              ? project.klingReferenceDiagnostics as Record<string, unknown>
              : null,
          audioConfigured: typeof project.audioConfigured === 'boolean' ? project.audioConfigured : null,
          viralPresetUsed: typeof project.viralPresetUsed === 'string' ? project.viralPresetUsed : null,
          promptPolished: typeof project.promptPolished === 'boolean' ? project.promptPolished : null,
          characterId: typeof project.characterId === 'string' ? project.characterId : null,
          characterAvatar: typeof project.characterAvatar === 'string' ? project.characterAvatar : null,
          isDefaultSelfCharacter:
            typeof project.isDefaultSelfCharacter === 'boolean' ? project.isDefaultSelfCharacter : false,
          creatorName: typeof project.creatorName === 'string' ? project.creatorName : null,
          creatorUsername: typeof project.creatorUsername === 'string' ? project.creatorUsername : null,
          creatorAvatar: typeof project.creatorAvatar === 'string' ? project.creatorAvatar : null,
          updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : project.createdAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function saveStudioProject(project: StudioProject) {
  if (typeof window === 'undefined') return;

  const existing = loadStudioProjects().filter((item) => item.id !== project.id);
  const generatedMedia = resolveGeneratedVideoMedia(project);
  const nextProjects = [
    {
      ...project,
      videoUrl: cleanMediaUrl(project.videoUrl),
      thumbnailUrl: cleanOptionalMediaUrl(generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(project)),
      posterUrl: cleanOptionalMediaUrl(generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(project)),
      thumbnailSource: generatedMedia.thumbnailSource,
      keyframeUrl: cleanOptionalMediaUrl(project.keyframeUrl),
      referenceImageUrl: cleanOptionalMediaUrl(project.referenceImageUrl),
      additionalReferenceImageUrls:
        project.additionalReferenceImageUrls?.map(cleanOptionalMediaUrl).filter((url): url is string => Boolean(url)) ?? null,
      characterAvatar: cleanOptionalMediaUrl(project.characterAvatar),
      creatorAvatar: cleanOptionalMediaUrl(project.creatorAvatar),
      updatedAt: project.updatedAt ?? new Date().toISOString(),
    },
    ...existing,
  ];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
  } catch {
    // ignore storage failures for now
  }
}

export function updateStudioProject(projectId: string, patch: Partial<StudioProject>): StudioProject | null {
  if (typeof window === 'undefined') return null;

  const projects = loadStudioProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) return null;

  const updated: StudioProject = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  const nextProjects = projects.map((project) => (project.id === projectId ? updated : project));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
  } catch {
    // ignore storage failures for now
  }

  return updated;
}

export function markStudioProjectPublished(projectId: string, privacy = 'public') {
  const now = new Date().toISOString();
  return updateStudioProject(projectId, {
    status: 'published',
    isPosted: true,
    publishedAt: now,
    postedAt: now,
    privacy,
    visibility: privacy,
  });
}
