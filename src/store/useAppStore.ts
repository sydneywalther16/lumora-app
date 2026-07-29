import { create } from 'zustand';
import { posts, projects, trends } from '../data/mockData';
import { toggleStylePreset } from '../lib/stylePresets';

type AppState = {
  activePrompt: string;
  activeDraftId: string | null;
  selectedStyles: string[];
  selectedTrend: string | null;
  draftTitle: string;
  posts: typeof posts;
  projects: typeof projects;
  trends: typeof trends;
  setActivePrompt: (prompt: string) => void;
  setActiveDraftId: (draftId: string | null) => void;
  setSelectedStyles: (styles: string[]) => void;
  toggleSelectedStyle: (style: string) => void;
  setSelectedTrend: (trendId: string | null) => void;
  setDraftTitle: (title: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  activePrompt: '',
  activeDraftId: null,
  selectedStyles: [],
  selectedTrend: null,
  draftTitle: 'Untitled concept',
  posts,
  projects,
  trends,
  setActivePrompt: (prompt) => set({ activePrompt: prompt }),
  setActiveDraftId: (draftId) => set({ activeDraftId: draftId }),
  setSelectedStyles: (styles) => set({ selectedStyles: styles }),
  toggleSelectedStyle: (style) => set((state) => ({ selectedStyles: toggleStylePreset(state.selectedStyles, style) })),
  setSelectedTrend: (trendId) => set({ selectedTrend: trendId }),
  setDraftTitle: (title) => set({ draftTitle: title }),
}));
