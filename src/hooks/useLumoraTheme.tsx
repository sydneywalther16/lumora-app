import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type LumoraTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'lumora-theme';

type LumoraThemeContextValue = {
  theme: LumoraTheme;
  setTheme: (theme: LumoraTheme) => void;
  toggleTheme: () => void;
};

const LumoraThemeContext = createContext<LumoraThemeContextValue | null>(null);

function isLumoraTheme(value: unknown): value is LumoraTheme {
  return value === 'dark' || value === 'light';
}

function readStoredTheme(): LumoraTheme {
  if (typeof window === 'undefined') return 'dark';

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isLumoraTheme(storedTheme) ? storedTheme : 'dark';
  } catch {
    return 'dark';
  }
}

function applyDocumentTheme(theme: LumoraTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function LumoraThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<LumoraTheme>(() => {
    const initialTheme = readStoredTheme();
    applyDocumentTheme(initialTheme);
    return initialTheme;
  });

  useEffect(() => {
    applyDocumentTheme(theme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence should never block rendering.
    }
  }, [theme]);

  const value = useMemo<LumoraThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggleTheme: () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [theme],
  );

  return (
    <LumoraThemeContext.Provider value={value}>
      {children}
    </LumoraThemeContext.Provider>
  );
}

export function useLumoraTheme() {
  const context = useContext(LumoraThemeContext);
  if (!context) {
    throw new Error('useLumoraTheme must be used inside LumoraThemeProvider');
  }
  return context;
}
