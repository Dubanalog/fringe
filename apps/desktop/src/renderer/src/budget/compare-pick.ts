import {
  type BudgetHistory,
  type BudgetVersion,
  branchName,
  currentPath,
  findBranch,
  isEditable,
  previousVersion,
  versionsNewestFirst,
} from '@fringe/budget-engine';

/**
 * The Comparison report always compares what's showing (a branch's latest, or a version opened
 * read-only) with one version picked as From. To compare two older versions, open the later one.
 */

/** The version the point showing is, if it's one (the showing branch's own first). */
export function showingVersion(history: BudgetHistory): BudgetVersion | null {
  const id = history.entries[history.current]!.id;
  const at = history.versions.filter((v) => v.entryId === id);
  return at.find((v) => v.branch === history.branch) ?? at[0] ?? null;
}

/** The versions to compare from: every one but the one showing, those that led to it first. */
export function fromChoices(history: BudgetHistory): BudgetVersion[] {
  const showing = showingVersion(history);
  const path = currentPath(history);
  const list = versionsNewestFirst(history.versions).filter((v) => v.id !== showing?.id);
  return [...list.filter((v) => path.has(v.entryId)), ...list.filter((v) => !path.has(v.entryId))];
}

/**
 * What to compare from: the version picked, while it's there and isn't the one showing; otherwise
 * the latest version that led to what's showing (for a version, the one before it).
 */
export function compareFrom(history: BudgetHistory, picked: string | null): BudgetVersion | null {
  const choices = fromChoices(history);
  const chosen = choices.find((v) => v.id === picked);
  if (chosen) return chosen;
  const showing = showingVersion(history);
  if (showing) return previousVersion(history, showing);
  const path = currentPath(history);
  return choices.find((v) => path.has(v.entryId)) ?? null;
}

/** A version as the report heads it: "v1.1", with its branch's name when it's on another branch. */
export function sideLabel(history: BudgetHistory, v: BudgetVersion, budgetName: string): string {
  const branch = findBranch(history, v.branch);
  return v.branch === history.branch || !branch
    ? `v${v.number}`
    : `${branchName(branch, budgetName)} v${v.number}`;
}

/** What's showing, as the report heads it: its version, "Now" at a branch's latest, or "This point". */
export function showingLabel(history: BudgetHistory, budgetName: string): string {
  const v = showingVersion(history);
  if (v) return sideLabel(history, v, budgetName);
  return isEditable(history) ? 'Now' : 'This point';
}
