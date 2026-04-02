import { create } from 'zustand';
import { posts, projects, trends } from '../data/mockData';

type AppState = {
  activePrompt: string;
  selectedStyle: string;
  selectedTrend: string | null;
  draftTitle: string;
  posts: typeof posts;
  trends: typeof trends;
  projects: typeof projects;
  setActivePrompt: (prompt: string) => void;
  setSelectedStyle: (style: string) => void;
  setSelectedTrend: (trendId: string | null) => void;
  setDraftTitle: (title: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  activePrompt:
    'Build a glossy AI influencer reveal with paparazzi flash frames, ultra-smooth motion, and a final hook that feels instantly repostable.',
  selectedStyle: 'Editorial Drama',
  selectedTrend: 't1',
  draftTitle: 'Untitled concept',
  posts,
  trends,
  projects,
  setActivePrompt: (prompt) => set({ activePrompt: prompt }),
  setSelectedStyle: (style) => set({ selectedStyle: style }),
  setSelectedTrend: (trendId) => set({ selectedTrend: trendId }),
  setDraftTitle: (title) => set({ draftTitle: title }),
}));
