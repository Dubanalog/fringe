import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { type ThemeInfo, type ThemePreference, isThemePreference, resolveTheme } from './themes';

// Per-device preference for now. Moves to the global settings folder once that
// exists, so it follows the user rather than the browser storage.
const STORAGE_KEY = 'fringe.theme';

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function useSystemPrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return dark;
}

interface ThemeContextValue {
  preference: ThemePreference;
  theme: ThemeInfo;
  setPreference(pref: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const systemDark = useSystemPrefersDark();
  const theme = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme.id;
    document.documentElement.style.colorScheme = theme.scheme;
  }, [theme]);

  useEffect(() => {
    void window.fringe.setNativeTheme(preference === 'system' ? 'system' : theme.scheme);
  }, [preference, theme.scheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference(pref) {
        setPreferenceState(pref);
        try {
          localStorage.setItem(STORAGE_KEY, pref);
        } catch {
          // Storage unavailable: the choice still applies for this session.
        }
      },
    }),
    [preference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
