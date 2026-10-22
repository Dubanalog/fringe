/**
 * Theme registry. Colors live in styles/themes.css as CSS variables under
 * [data-theme="<id>"]; this file only lists what exists. To add a theme,
 * add a block to themes.css and an entry here.
 */

export type ThemeId = 'light' | 'dark' | 'blue' | 'green';
export type ThemePreference = ThemeId | 'system';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  /** Base scheme, used for native UI (menus, scrollbars, title bar). */
  scheme: 'light' | 'dark';
  /** Swatches for the theme picker: [background, surface, accent]. */
  swatch: readonly [string, string, string];
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'light', label: 'Light', scheme: 'light', swatch: ['#f7f7f5', '#ffffff', '#2f5bd3'] },
  { id: 'dark', label: 'Dark', scheme: 'dark', swatch: ['#16181d', '#1e2128', '#7aa2ff'] },
  { id: 'blue', label: 'Blue', scheme: 'dark', swatch: ['#0f1a2e', '#16243d', '#5cb3ff'] },
  { id: 'green', label: 'Green', scheme: 'dark', swatch: ['#0f1f19', '#162b23', '#4fd18b'] },
];

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ThemeInfo {
  const id: ThemeId = pref === 'system' ? (systemPrefersDark ? 'dark' : 'light') : pref;
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeInfo);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || THEMES.some((t) => t.id === value);
}
