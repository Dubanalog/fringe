import { useState } from 'react';

/**
 * A view preference remembered on this computer (e.g. which detail columns
 * are shown). Not part of the budget. Falls back to the default if storage
 * is unavailable or holds something unexpected.
 */
export function usePref<T>(key: string, fallback: T, valid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`fringe.${key}`);
      const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
      return valid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(`fringe.${key}`, JSON.stringify(next));
    } catch {
      // Not remembered next time; still applies now.
    }
  };
  return [value, set] as const;
}

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
export const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
