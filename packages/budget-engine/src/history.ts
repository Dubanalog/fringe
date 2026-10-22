import type { Budget } from './model';
import { newId } from './model';
import { ENGINE_VERSION } from './version';

/**
 * Change history, versions and forks. Every edit is recorded as a labelled snapshot (budgets are
 * immutable and share unchanged parts, so snapshots are cheap), and nothing is ever dropped: a
 * change made after going back starts a new branch, and the changes it replaced stay in the
 * history, to look at or go back to. Undo goes to the entry a change was made from; redo to the
 * newest change made from the entry showing.
 *
 * A version is a named point in the history: the budget as it was sent out, e.g. v1.0 on 3 March
 * to the studio, with its notes and the PDF that went with it.
 */
export interface HistoryEntry {
  id: string;
  /** ISO time of the change. */
  at: string;
  /** What changed, e.g. "Rate on 1102 line 3". */
  label: string;
  /** Calculation rules in force, so a past state can be reproduced with the rules that made it. */
  engineVersion: string;
  /** The entry this change was made from; null for the first. */
  parent: string | null;
  budget: Budget;
}

export interface BudgetVersion {
  id: string;
  /** e.g. "1.0", "1.1", "2.0". */
  number: string;
  /** e.g. "Studio draft"; may be blank. */
  name: string;
  /** The history entry it is. */
  entryId: string;
  /** When it was saved, ISO. */
  savedAt: string;
  /** The date it was sent, YYYY-MM-DD; blank when it hasn't been. */
  sentOn: string;
  sentTo: string;
  notes: string;
  /** What changed since the version before, as written by the user or the AI. */
  changes: string;
  /** The PDF saved with it: a file name in the project's versions folder. */
  pdf: string | null;
}

export interface BudgetHistory {
  /** Every change, oldest first. */
  entries: HistoryEntry[];
  /** Index of the entry showing now. */
  current: number;
  /** Oldest first. */
  versions: BudgetVersion[];
}

export function startHistory(budget: Budget, label = 'Opened', at = new Date().toISOString()): BudgetHistory {
  return { entries: [entry(budget, label, at, null)], current: 0, versions: [] };
}

/** Records a change, made from the entry showing. Unchanged budgets aren't recorded. */
export function recordChange(
  history: BudgetHistory,
  budget: Budget,
  label: string,
  at = new Date().toISOString(),
): BudgetHistory {
  const from = history.entries[history.current];
  if (from?.budget === budget) return history;
  const entries = [...history.entries, entry(budget, label, at, from?.id ?? null)];
  return { ...history, entries, current: entries.length - 1 };
}

export function currentBudget(history: BudgetHistory): Budget {
  return history.entries[history.current]!.budget;
}

function indexOf(history: BudgetHistory, id: string | null): number {
  if (id === null) return -1;
  // Usually close to the end, so search from there.
  for (let i = history.entries.length - 1; i >= 0; i--) if (history.entries[i]!.id === id) return i;
  return -1;
}

/** The newest change made from the entry showing, which redo goes to; -1 when there's none. */
function redoIndex(history: BudgetHistory): number {
  const id = history.entries[history.current]?.id;
  for (let i = history.entries.length - 1; i > history.current; i--) {
    if (history.entries[i]!.parent === id) return i;
  }
  return -1;
}

export function canUndo(history: BudgetHistory): boolean {
  return indexOf(history, history.entries[history.current]?.parent ?? null) >= 0;
}

export function canRedo(history: BudgetHistory): boolean {
  return redoIndex(history) >= 0;
}

export function undo(history: BudgetHistory): BudgetHistory {
  const i = indexOf(history, history.entries[history.current]?.parent ?? null);
  return i < 0 ? history : { ...history, current: i };
}

export function redo(history: BudgetHistory): BudgetHistory {
  const i = redoIndex(history);
  return i < 0 ? history : { ...history, current: i };
}

/** Shows the budget as it was at an entry. Nothing is lost: every entry stays. */
export function goTo(history: BudgetHistory, entryId: string): BudgetHistory {
  const current = indexOf(history, entryId);
  return current < 0 || current === history.current ? history : { ...history, current };
}

/** The entries that led to the one showing (and it): the changes in the budget as it is now. */
export function currentPath(history: BudgetHistory): Set<string> {
  const byId = new Map(history.entries.map((e) => [e.id, e]));
  const path = new Set<string>();
  for (let e = history.entries[history.current]; e && !path.has(e.id); e = byId.get(e.parent ?? '')) {
    path.add(e.id);
  }
  return path;
}

/** The entry a change was made from, to compare with. */
export function parentEntry(history: BudgetHistory, entry: HistoryEntry): HistoryEntry | null {
  return history.entries[indexOf(history, entry.parent)] ?? null;
}

export function findEntry(history: BudgetHistory, id: string): HistoryEntry | null {
  return history.entries[indexOf(history, id)] ?? null;
}

/**
 * A new budget copied from a point in history (or the current state), remembering where it came
 * from. The fork starts its own history.
 */
export function forkBudget(
  history: BudgetHistory,
  name: string,
  entryId: string | null = null,
  at = new Date().toISOString(),
): Budget {
  const from = entryId === null ? history.entries[history.current] : findEntry(history, entryId);
  if (!from) throw new Error(`No history entry ${entryId}`);
  // A fork is its own budget, not the imported file, so it drops `source`.
  const { source: _source, ...rest } = from.budget;
  return {
    ...rest,
    id: newId(),
    name,
    forkedFrom: { budgetId: from.budget.id, budgetName: from.budget.name, entryId: from.id, at },
  };
}

/**
 * A fork's name: "Pilot (fork)", or "Pilot v1.2 (fork)" from a version, numbered when one of
 * `taken` has it ("Pilot (fork 2)"). A fork of a fork doesn't pile up: "Pilot (fork)" gives
 * "Pilot (fork 2)", not "Pilot (fork) (fork)".
 */
export function forkName(name: string, taken: readonly string[], version?: string): string {
  let base = name.replace(/(\s*\(fork(?: \d+)?\))+$/i, '').trim();
  if (version !== undefined) base = `${base.replace(/\s+v\d+(?:\.\d+)*$/i, '')} v${version}`;
  base = base.trim() || 'Budget';
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  let out = `${base} (fork)`;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} (fork ${n})`;
  return out;
}

function entry(budget: Budget, label: string, at: string, parent: string | null): HistoryEntry {
  return { id: newId(), at, label, engineVersion: ENGINE_VERSION, parent, budget };
}

// ---- Versions

export class VersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionError';
  }
}

const VERSION_NUMBER = /^v?(\d+)(?:\.(\d+))?$/i;

/** "v1.2", "1.2" or "1" as "1.2" / "1.0"; null when it isn't a version number. */
export function cleanVersionNumber(text: string): string | null {
  const m = VERSION_NUMBER.exec(text.trim());
  return m ? `${Number(m[1])}.${Number(m[2] ?? 0)}` : null;
}

function versionParts(number: string): [number, number] {
  const m = VERSION_NUMBER.exec(number);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
}

/** The highest version number first. */
export function versionsNewestFirst(versions: readonly BudgetVersion[]): BudgetVersion[] {
  return [...versions].sort((a, b) => {
    const [am, an] = versionParts(a.number);
    const [bm, bn] = versionParts(b.number);
    return bm - am || bn - an || b.savedAt.localeCompare(a.savedAt);
  });
}

/** The next number: 1.0 for the first, then 1.1 (or 2.0 for a `major` one). */
export function nextVersionNumber(versions: readonly BudgetVersion[], major = false): string {
  const last = versionsNewestFirst(versions)[0];
  if (!last) return '1.0';
  const [m, n] = versionParts(last.number);
  return major ? `${m + 1}.0` : `${m}.${n + 1}`;
}

export type VersionInput = Omit<BudgetVersion, 'id' | 'savedAt' | 'entryId'> & {
  id?: string;
  /** The entry it is; the one showing when left out. */
  entryId?: string;
};

/** Saves a version, or changes the one with this id. */
export function saveVersion(
  history: BudgetHistory,
  input: VersionInput,
  at = new Date().toISOString(),
): { history: BudgetHistory; version: BudgetVersion } {
  const number = cleanVersionNumber(input.number);
  if (!number) throw new VersionError('Type the version as a number, e.g. 1.0 or 2.1.');
  if (history.versions.some((v) => v.id !== input.id && v.number === number)) {
    throw new VersionError(`There's already a v${number}.`);
  }
  const was = input.id ? history.versions.find((v) => v.id === input.id) : undefined;
  const entryId = input.entryId ?? was?.entryId ?? history.entries[history.current]!.id;
  if (!findEntry(history, entryId)) throw new VersionError('That point is not in the history.');
  const version: BudgetVersion = {
    id: was?.id ?? newId(),
    number,
    name: input.name.trim(),
    entryId,
    savedAt: was?.savedAt ?? at,
    sentOn: input.sentOn.trim(),
    sentTo: input.sentTo.trim(),
    notes: input.notes,
    changes: input.changes,
    pdf: input.pdf,
  };
  const versions = was
    ? history.versions.map((v) => (v.id === version.id ? version : v))
    : [...history.versions, version];
  return { history: { ...history, versions }, version };
}

/** Deletes a version (the history entry it pointed at stays). */
export function deleteVersion(history: BudgetHistory, id: string): BudgetHistory {
  return { ...history, versions: history.versions.filter((v) => v.id !== id) };
}

/** A version by its number ("1.0", "v1", "1.0") or id. */
export function findVersion(history: BudgetHistory, numberOrId: string): BudgetVersion | null {
  const number = cleanVersionNumber(numberOrId);
  return (
    history.versions.find((v) => v.id === numberOrId || (number !== null && v.number === number)) ?? null
  );
}

/** The budget as it was at a version. */
export function versionBudget(history: BudgetHistory, version: BudgetVersion): Budget | null {
  return findEntry(history, version.entryId)?.budget ?? null;
}

/** The latest version before this one, to compare with. */
export function previousVersion(history: BudgetHistory, version: BudgetVersion): BudgetVersion | null {
  const sorted = versionsNewestFirst(history.versions);
  return sorted[sorted.findIndex((v) => v.id === version.id) + 1] ?? null;
}

/** An entry and every entry before it, back to the start. */
function lineage(byId: Map<string, HistoryEntry>, entryId: string, stop?: Set<string>): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (let e = byId.get(entryId); e && !seen.has(e.id) && !stop?.has(e.id); e = byId.get(e.parent ?? '')) {
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Which version each change went into: the first version made from it (it, or a change after it).
 * Changes in no version yet, or undone before one was made, aren't in the map.
 */
export function versionOfEntries(history: BudgetHistory): Map<string, BudgetVersion> {
  const byId = new Map(history.entries.map((e) => [e.id, e]));
  const out = new Map<string, BudgetVersion>();
  for (const v of versionsNewestFirst(history.versions).reverse()) {
    // Everything before an entry already placed is placed too, so the walk stops there.
    for (const e of lineage(byId, v.entryId, new Set(out.keys()))) out.set(e.id, v);
  }
  return out;
}

/** The changes that lead from one point to another, oldest first: the entries before `to` that `from` doesn't have. */
export function changesBetween(
  history: BudgetHistory,
  fromEntryId: string,
  toEntryId: string,
): HistoryEntry[] {
  const byId = new Map(history.entries.map((e) => [e.id, e]));
  const had = new Set(lineage(byId, fromEntryId).map((e) => e.id));
  return lineage(byId, toEntryId, had).reverse();
}
