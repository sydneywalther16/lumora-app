import type { LumoraPost } from './api';
import { getBestPoster, getBestThumbnail } from './mediaThumbnail';

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
          (typeof item.videoUrl === 'string' || typeof item.imageUrl === 'string')
        );
      })
      .map((post) => ({
        ...post,
        status: post.status ?? 'published',
        privacy: post.privacy ?? 'public',
        publishedAt: post.publishedAt ?? post.createdAt,
        thumbnailUrl: getBestThumbnail(post),
        posterUrl: getBestPoster(post),
      }))
      .filter((post) => post.status === 'published' && post.privacy !== 'private')
      .sort((a, b) => new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function savePostedItem(post: LumoraPost) {
  if (typeof window === 'undefined') return;

  const existing = loadPostedPublications();
  const next = [
    ...existing,
    {
      ...post,
      imageUrl: cleanMediaUrl(post.imageUrl),
      videoUrl: cleanMediaUrl(post.videoUrl),
      thumbnailUrl: cleanMediaUrl(getBestThumbnail(post)),
      posterUrl: cleanMediaUrl(getBestPoster(post)),
      characterAvatar: cleanMediaUrl(post.characterAvatar),
      creatorAvatar: cleanMediaUrl(post.creatorAvatar),
      avatar: cleanMediaUrl(post.avatar),
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
