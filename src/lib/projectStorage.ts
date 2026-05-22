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
          thumbnailSource: typeof project.thumbnailSource === 'string' ? project.thumbnailSource : null,
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
