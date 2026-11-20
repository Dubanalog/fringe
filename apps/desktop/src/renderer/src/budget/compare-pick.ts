import { type BudgetVersion, versionsNewestFirst } from '@fringe/budget-engine';

/** What the Changes report compares: version ids, or null for the defaults below. */
export interface ComparePair {
  from: string | null;
  to: string | null;
}

/**
 * The two sides of the Changes report. `to` is a version's id, or null for the budget now; `from`
 * is a version's id, or null to take the one before `to` (the latest version, when `to` is now).
 * So "v2 against the version before it" is one click, and so is "what changed since the latest".
 */
export function comparePick(
  versions: readonly BudgetVersion[],
  from: string | null,
  to: string | null,
): { since: BudgetVersion | null; until: BudgetVersion | null } {
  const list = versionsNewestFirst(versions);
  const until = list.find((v) => v.id === to) ?? null;
  const picked = list.find((v) => v.id === from);
  if (picked) return { since: picked, until };
  const since = until ? (list[list.indexOf(until) + 1] ?? null) : (list[0] ?? null);
  return { since, until };
}

/** The version saved just before this one, if any. */
export function versionBefore(versions: readonly BudgetVersion[], v: BudgetVersion): BudgetVersion | null {
  const list = versionsNewestFirst(versions);
  return list[list.findIndex((x) => x.id === v.id) + 1] ?? null;
}
