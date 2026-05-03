import type { VideoEngine } from './api';

export type StudioProject = {
  id: string;
  title?: string | null;
  caption?: string | null;
  prompt: string;
  videoUrl: string;
  status: string;
  provider: VideoEngine;
  characterId: string | null;
  characterName: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  createdAt: string;
};

const STORAGE_KEY = 'lumora_projects';

function cleanMediaUrl(value: string): string {
  return value.startsWith('data:') || value.startsWith('blob:') ? '' : value;
}

function cleanOptionalMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  return value.startsWith('data:') || value.startsWith('blob:') ? null : value;
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
      .map((project) => ({
        ...project,
        title: typeof project.title === 'string' ? project.title : null,
        caption: typeof project.caption === 'string' ? project.caption : null,
        characterId: typeof project.characterId === 'string' ? project.characterId : null,
        characterAvatar: typeof project.characterAvatar === 'string' ? project.characterAvatar : null,
        isDefaultSelfCharacter:
          typeof project.isDefaultSelfCharacter === 'boolean' ? project.isDefaultSelfCharacter : false,
        creatorName: typeof project.creatorName === 'string' ? project.creatorName : null,
        creatorUsername: typeof project.creatorUsername === 'string' ? project.creatorUsername : null,
        creatorAvatar: typeof project.creatorAvatar === 'string' ? project.creatorAvatar : null,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function saveStudioProject(project: StudioProject) {
  if (typeof window === 'undefined') return;

  const existing = loadStudioProjects().filter((item) => item.id !== project.id);
  const nextProjects = [
    {
      ...project,
      videoUrl: cleanMediaUrl(project.videoUrl),
      characterAvatar: cleanOptionalMediaUrl(project.characterAvatar),
      creatorAvatar: cleanOptionalMediaUrl(project.creatorAvatar),
    },
    ...existing,
  ];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
  } catch {
    // ignore storage failures for now
  }
}
