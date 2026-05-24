import type { LumoraPost } from './api';
import { resolveGeneratedVideoMedia } from './mediaThumbnail';

export const LUMORA_GENERATED_SOURCE_TYPE = 'lumora_generated';
export const LUMORA_GENERATED_MEDIA_ORIGIN = 'generated';

function normalized(value?: string | null) {
  return (value ?? '').trim().toLowerCase();
}

export function hasAiCastGenerationSource(post: Pick<
  LumoraPost,
  'sourceGenerationId' | 'sourceGenerationJobId' | 'sourceProjectId' | 'sourceType' | 'isAiGenerated' | 'mediaOrigin'
>) {
  return Boolean(post.sourceGenerationId || post.sourceGenerationJobId || post.sourceProjectId);
}

function hasAiCastGeneratedMarker(post: Pick<
  LumoraPost,
  'sourceGenerationId' | 'sourceGenerationJobId' | 'sourceProjectId' | 'sourceType' | 'isAiGenerated' | 'mediaOrigin'
>) {
  return (
    post.isAiGenerated === true ||
    normalized(post.sourceType) === LUMORA_GENERATED_SOURCE_TYPE ||
    normalized(post.mediaOrigin) === LUMORA_GENERATED_MEDIA_ORIGIN ||
    hasAiCastGenerationSource(post)
  );
}

export function isAiCastGeneratedVideoPost(post: LumoraPost) {
  const generatedMedia = resolveGeneratedVideoMedia(post);
  return generatedMedia.hasVerifiedVideo && hasAiCastGeneratedMarker(post) && hasAiCastGenerationSource(post);
}

export function isPublicAiCastPost(post: LumoraPost) {
  const status = normalized(post.status) || 'published';
  const visibility = normalized(post.visibility || post.privacy) || 'public';
  return status === 'published' && visibility !== 'private' && isAiCastGeneratedVideoPost(post);
}

export function filterAiCastPublicPosts<T extends LumoraPost>(posts: T[]) {
  return posts.filter(isPublicAiCastPost);
}

export function withLumoraGeneratedPostFields<T extends LumoraPost>(post: T): T {
  return {
    ...post,
    sourceType: LUMORA_GENERATED_SOURCE_TYPE,
    isAiGenerated: true,
    sourceGenerationJobId: post.sourceGenerationJobId ?? post.sourceGenerationId ?? null,
    sourceProjectId: post.sourceProjectId ?? post.sourceGenerationId ?? null,
    mediaOrigin: LUMORA_GENERATED_MEDIA_ORIGIN,
  };
}
