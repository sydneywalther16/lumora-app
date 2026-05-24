import type { LumoraPost } from './api';
import { filterAiCastPublicPosts, withLumoraGeneratedPostFields } from './aiCastMedia';
import { getBestPoster, getBestThumbnail, resolveGeneratedVideoMedia } from './mediaThumbnail';

const STORAGE_KEY = 'lumora_posts';

function cleanMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  return value.startsWith('data:') || value.startsWith('blob:') ? null : value;
}

export function loadPostedPublications(): LumoraPost[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is LumoraPost => {
        return (
          item &&
          typeof item.id === 'string' &&
          typeof item.createdAt === 'string' &&
          (typeof item.caption === 'string' || typeof item.title === 'string') &&
          typeof item.videoUrl === 'string'
        );
      })
      .map((post) => {
        const generatedMedia = resolveGeneratedVideoMedia(post);
        return {
          ...post,
          status: post.status ?? 'published',
          privacy: post.privacy ?? 'public',
          publishedAt: post.publishedAt ?? post.createdAt,
          thumbnailUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(post),
          posterUrl: generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(post),
          thumbnailSource: generatedMedia.thumbnailSource,
        };
      })
      .filter((post) => filterAiCastPublicPosts([post]).length > 0)
      .sort((a, b) => new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function savePostedItem(post: LumoraPost) {
  if (typeof window === 'undefined') return;

  const generatedPost = withLumoraGeneratedPostFields(post);
  if (!generatedPost.videoUrl || !generatedPost.sourceGenerationId) return;

  const existing = loadPostedPublications();
  const next = [
    ...existing,
    {
      ...generatedPost,
      ...(() => {
        const generatedMedia = resolveGeneratedVideoMedia(generatedPost);
        return {
          thumbnailUrl: cleanMediaUrl(generatedMedia.hasVerifiedVideo ? generatedMedia.thumbnailUrl : getBestThumbnail(generatedPost)),
          posterUrl: cleanMediaUrl(generatedMedia.hasVerifiedVideo ? generatedMedia.posterUrl : getBestPoster(generatedPost)),
          thumbnailSource: generatedMedia.thumbnailSource,
        };
      })(),
      imageUrl: null,
      videoUrl: cleanMediaUrl(generatedPost.videoUrl),
      characterAvatar: cleanMediaUrl(generatedPost.characterAvatar),
      creatorAvatar: cleanMediaUrl(generatedPost.creatorAvatar),
      avatar: cleanMediaUrl(generatedPost.avatar),
      status: 'published',
      privacy: post.privacy ?? 'public',
      publishedAt: post.publishedAt ?? new Date().toISOString(),
    },
  ];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}
