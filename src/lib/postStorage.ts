import type { LumoraPost } from './api';

const STORAGE_KEY = 'lumora_posts';

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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function savePostedItem(post: LumoraPost) {
  if (typeof window === 'undefined') return;

  const existing = loadPostedPublications();
  const next = [...existing, post];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}
