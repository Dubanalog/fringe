import type { Budget } from './model';
import { budgetTitle, newId } from './model';
import { ENGINE_VERSION } from './version';

/**
 * Change history, branches, versions and copies to new budgets. Every edit is recorded as a labelled snapshot
 * (budgets are immutable and share unchanged parts, so snapshots are cheap), and nothing is ever
 * dropped: a change made after an undo replaces the undone ones, which stay in the history to look
 * at. Undo goes to the entry a change was made from; redo to the newest change made from the entry
 * showing.
 *
 * A version is a named point in the history: the budget as it was sent out, e.g. v1.0 on 3 March
 * to the studio, with its notes and the PDF that went with it.
 *
 * A branch is a named line of work, e.g. "25-day shoot", started from a version or from the end of
 * another branch. Each numbers its own versions from v1.0. The main line has the budget's name.
 * Only the end of a branch (its "Latest") can be changed; any other point is read-only, and
 * changing it means starting a new branch from it. There's no merging: a branch the studio turned
 * down is marked "not picked" and stays, greyed out.
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
  /** The branch the change was made on. */
  branch: string;
  budget: Budget;
}

/** The main line's id. Its name is the budget's name. */
export const MAIN_BRANCH = 'main';

export interface Branch {
  id: string;
  /** e.g. "25-day shoot"; blank for the main line, which shows the budget's name. */
  name: string;
  /** The entry it was started from; null for the main line. */
  from: string | null;
  /** Its end ("Latest"): the only entry on it that can be changed. */
  head: string;
  /** When it was started, ISO. */
  createdAt: string;
  /** Turned down: greyed out, never deleted. */
  notPicked: boolean;
}

export interface BudgetVersion {
  id: string;
  /** e.g. "1.0", "1.1", "2.0". */
  number: string;
  /** e.g. "Studio draft"; may be blank. */
  name: string;
  /** The history entry it is. */
  entryId: string;
  /** The branch it's numbered on. */
  branch: string;
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
  /** The main line first, then the others in the order they were started. */
  branches: Branch[];
  /** The branch showing. The entry showing is its end, or a read-only point on it. */
  branch: string;
}

export function startHistory(budget: Budget, label = 'Opened', at = new Date().toISOString()): BudgetHistory {
  const first = entry(budget, label, at, null, MAIN_BRANCH);
  return {
    entries: [first],
    current: 0,
    versions: [],
    branches: [mainBranch(first.id, at)],
    branch: MAIN_BRANCH,
  };
}

export function mainBranch(head: string, at: string): Branch {
  return { id: MAIN_BRANCH, name: '', from: null, head, createdAt: at, notPicked: false };
}

/** Thrown when a change is made to a read-only point. */
export class ReadOnlyError extends Error {
  constructor() {
    super('This is an earlier point in the budget. Start a branch from it to make changes.');
    this.name = 'ReadOnlyError';
  }
}

export function findBranch(history: BudgetHistory, id: string): Branch | null {
  return history.branches.find((b) => b.id === id) ?? null;
}

/** The branch showing. */
export function activeBranch(history: BudgetHistory): Branch {
  return findBranch(history, history.branch) ?? history.branches[0]!;
}

/** A branch's name: its own, or the budget's for the main line. */
export function branchName(branch: Branch, budgetName: string): string {
  return branch.id === MAIN_BRANCH ? budgetName : branch.name;
}

/** Whether the entry showing can be changed: it's the end of the branch showing. */
export function isEditable(history: BudgetHistory): boolean {
  return history.entries[history.current]?.id === activeBranch(history).head;
}

/** The branch showing with a new end, and that end showing. */
function moveHead(history: BudgetHistory, current: number): BudgetHistory {
  const head = history.entries[current]!.id;
  const branches = history.branches.map((b) => (b.id === history.branch ? { ...b, head } : b));
  return { ...history, branches, current };
}

/**
 * Records a change, made at the end of the branch showing. Unchanged budgets aren't recorded.
 * Throws ReadOnlyError at any other point: check isEditable first.
 */
export function recordChange(
  history: BudgetHistory,
  budget: Budget,
  label: string,
  at = new Date().toISOString(),
): BudgetHistory {
  const from = history.entries[history.current];
  if (from?.budget === budget) return history;
  if (!isEditable(history)) throw new ReadOnlyError();
  const entries = [...history.entries, entry(budget, label, at, from?.id ?? null, history.branch)];
  return moveHead({ ...history, entries }, entries.length - 1);
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

/**
 * The entry undo goes to; -1 when there's none. Undo works at the end of a branch, back as far as
 * its latest version (or where it started): a saved version stays as it was sent.
 */
function undoIndex(history: BudgetHistory): number {
  if (!isEditable(history)) return -1;
  const at = history.entries[history.current]!;
  const branch = activeBranch(history);
  if (at.id === branch.from) return -1;
  if (history.versions.some((v) => v.entryId === at.id && v.branch === branch.id)) return -1;
  return indexOf(history, at.parent);
}

/** The newest change on the branch made from the entry showing, which redo goes to; -1 when there's none. */
function redoIndex(history: BudgetHistory): number {
  if (!isEditable(history)) return -1;
  const id = history.entries[history.current]?.id;
  for (let i = history.entries.length - 1; i > history.current; i--) {
    const e = history.entries[i]!;
    if (e.parent === id && e.branch === history.branch) return i;
  }
  return -1;
}

export function canUndo(history: BudgetHistory): boolean {
  return undoIndex(history) >= 0;
}

export function canRedo(history: BudgetHistory): boolean {
  return redoIndex(history) >= 0;
}

export function undo(history: BudgetHistory): BudgetHistory {
  const i = undoIndex(history);
  return i < 0 ? history : moveHead(history, i);
}

export function redo(history: BudgetHistory): BudgetHistory {
  const i = redoIndex(history);
  return i < 0 ? history : moveHead(history, i);
}

/**
 * Shows the budget as it was at an entry, on the branch it was made on. It can be changed only
 * when it's that branch's end; otherwise it's read-only. Nothing is lost: every entry stays.
 */
export function goTo(history: BudgetHistory, entryId: string): BudgetHistory {
  const current = indexOf(history, entryId);
  if (current < 0) return history;
  const branch = history.entries[current]!.branch;
  return current === history.current && branch === history.branch ? history : { ...history, current, branch };
}

/** Shows the end of a branch, to work on. */
export function openBranch(history: BudgetHistory, branchId: string): BudgetHistory {
  const branch = findBranch(history, branchId);
  const current = branch ? indexOf(history, branch.head) : -1;
  if (current < 0) throw new BranchError('That branch is not in this budget.');
  return current === history.current && branchId === history.branch
    ? history
    : { ...history, current, branch: branchId };
}

// ---- Branches

export class BranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchError';
  }
}

/** A branch name tidied up, or a BranchError saying why it can't be used. `except` is the branch being renamed. */
export function cleanBranchName(history: BudgetHistory, name: string, except?: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new BranchError('Give the branch a name, e.g. "25-day shoot".');
  const lower = clean.toLowerCase();
  if (
    history.branches.some((b) => b.id !== except && b.id !== MAIN_BRANCH && b.name.toLowerCase() === lower)
  ) {
    throw new BranchError(`There's already a branch called "${clean}".`);
  }
  return clean;
}

/** Whether a branch can start at this entry: a saved version, or the end of a branch. */
export function canBranchFrom(history: BudgetHistory, entryId: string): boolean {
  return (
    history.versions.some((v) => v.entryId === entryId) || history.branches.some((b) => b.head === entryId)
  );
}

/**
 * Starts a named branch from a saved version or the end of a branch, and shows it, ready to work
 * on. It numbers its own versions from v1.0.
 */
export function createBranch(
  history: BudgetHistory,
  name: string,
  fromEntryId: string,
  at = new Date().toISOString(),
): { history: BudgetHistory; branch: Branch } {
  const clean = cleanBranchName(history, name);
  const current = indexOf(history, fromEntryId);
  if (current < 0) throw new BranchError('That point is not in the history.');
  if (!canBranchFrom(history, fromEntryId)) {
    throw new BranchError('Start a branch from a saved version or from the end of a branch.');
  }
  const branch: Branch = {
    id: newId(),
    name: clean,
    from: fromEntryId,
    head: fromEntryId,
    createdAt: at,
    notPicked: false,
  };
  return {
    history: { ...history, branches: [...history.branches, branch], branch: branch.id, current },
    branch,
  };
}

export function renameBranch(history: BudgetHistory, branchId: string, name: string): BudgetHistory {
  if (branchId === MAIN_BRANCH) {
    throw new BranchError("The main line has the budget's name. Rename the budget instead.");
  }
  if (!findBranch(history, branchId)) throw new BranchError('That branch is not in this budget.');
  const clean = cleanBranchName(history, name, branchId);
  return {
    ...history,
    branches: history.branches.map((b) => (b.id === branchId ? { ...b, name: clean } : b)),
  };
}

/** Marks a branch as turned down (greyed out, kept), or picks it back up. */
export function setNotPicked(history: BudgetHistory, branchId: string, notPicked: boolean): BudgetHistory {
  if (!findBranch(history, branchId)) throw new BranchError('That branch is not in this budget.');
  return {
    ...history,
    branches: history.branches.map((b) => (b.id === branchId ? { ...b, notPicked } : b)),
  };
}

/** The changes on a branch's line, oldest first: after where it started, up to its end. */
export function branchLine(history: BudgetHistory, branchId: string): HistoryEntry[] {
  const branch = findBranch(history, branchId);
  if (!branch) return [];
  const byId = new Map(history.entries.map((e) => [e.id, e]));
  const out: HistoryEntry[] = [];
  for (const e of lineage(byId, branch.head)) {
    if (e.id === branch.from || e.branch !== branchId) break;
    out.push(e);
  }
  return out.reverse();
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
 * from. The copy starts its own history.
 */
export function forkBudget(
  history: BudgetHistory,
  name: string,
  entryId: string | null = null,
  at = new Date().toISOString(),
): Budget {
  const from = entryId === null ? history.entries[history.current] : findEntry(history, entryId);
  if (!from) throw new Error(`No history entry ${entryId}`);
  // A copy is its own budget, not the imported file, so it drops `source`.
  const { source: _source, ...rest } = from.budget;
  return {
    ...rest,
    id: newId(),
    name,
    forkedFrom: { budgetId: from.budget.id, budgetName: from.budget.name, entryId: from.id, at },
  };
}

/**
 * A copy's name: "Pilot (copy)", "Pilot v1.2 (copy)" from a version, or "Pilot 25-day shoot v1.2
 * (copy)" from a branch's version; numbered when one of `taken` has it ("Pilot (copy 2)"). A copy
 * of a copy doesn't pile up: "Pilot (copy)" gives "Pilot (copy 2)", not "Pilot (copy) (copy)".
 * Older copies were called forks, so "(fork)" goes too.
 */
export function copyName(name: string, taken: readonly string[], version?: string, branch?: string): string {
  let base = name.replace(/(\s*\((?:fork|copy)(?: \d+)?\))+$/i, '').trim();
  if (branch) base = `${base} ${branch}`;
  if (version !== undefined) base = `${base.replace(/\s+v\d+(?:\.\d+)*$/i, '')} v${version}`;
  base = base.trim() || 'Budget';
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  let out = `${base} (copy)`;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} (copy ${n})`;
  return out;
}

/**
 * A version's file name, without the extension: "Pilot v1.0" on the main line, and
 * "Pilot - 25-day shoot v1.0" on a branch, so versions on different branches never share a file.
 */
export function versionFileName(budget: Budget, branch: Branch | null, number: string): string {
  const v = `v${number.trim().replace(/^v/i, '')}`;
  const title = budgetTitle(budget);
  return branch && branch.id !== MAIN_BRANCH ? `${title} - ${branch.name} ${v}` : `${title} ${v}`;
}

function entry(
  budget: Budget,
  label: string,
  at: string,
  parent: string | null,
  branch: string,
): HistoryEntry {
  return { id: newId(), at, label, engineVersion: ENGINE_VERSION, parent, branch, budget };
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

/** A branch's versions (the branch showing when left out). */
export function versionsOn(history: BudgetHistory, branchId = history.branch): BudgetVersion[] {
  return history.versions.filter((v) => v.branch === branchId);
}

/** The next number: 1.0 for the first, then 1.1 (or 2.0 for a `major` one). Give one branch's versions. */
export function nextVersionNumber(versions: readonly BudgetVersion[], major = false): string {
  const last = versionsNewestFirst(versions)[0];
  if (!last) return '1.0';
  const [m, n] = versionParts(last.number);
  return major ? `${m + 1}.0` : `${m}.${n + 1}`;
}

export type VersionInput = Omit<BudgetVersion, 'id' | 'savedAt' | 'entryId' | 'branch'> & {
  id?: string;
  /** The entry it is; the one showing when left out. */
  entryId?: string;
};

/**
 * Saves a version of the end of the branch showing, numbered on that branch, or changes the one
 * with this id.
 */
export function saveVersion(
  history: BudgetHistory,
  input: VersionInput,
  at = new Date().toISOString(),
): { history: BudgetHistory; version: BudgetVersion } {
  const number = cleanVersionNumber(input.number);
  if (!number) throw new VersionError('Type the version as a number, e.g. 1.0 or 2.1.');
  const was = input.id ? history.versions.find((v) => v.id === input.id) : undefined;
  const branch = was?.branch ?? history.branch;
  if (history.versions.some((v) => v.id !== input.id && v.branch === branch && v.number === number)) {
    throw new VersionError(`There's already a v${number}.`);
  }
  if (!was && input.entryId === undefined && !isEditable(history)) {
    throw new VersionError('This is an earlier point. Open the end of a branch to save a version.');
  }
  const entryId = input.entryId ?? was?.entryId ?? history.entries[history.current]!.id;
  if (!findEntry(history, entryId)) throw new VersionError('That point is not in the history.');
  const version: BudgetVersion = {
    id: was?.id ?? newId(),
    number,
    name: input.name.trim(),
    entryId,
    branch,
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

/** A version by its id, or its number ("1.0", "v1") on a branch (the branch showing when left out). */
export function findVersion(
  history: BudgetHistory,
  numberOrId: string,
  branchId = history.branch,
): BudgetVersion | null {
  const number = cleanVersionNumber(numberOrId);
  return (
    history.versions.find((v) => v.id === numberOrId) ??
    history.versions.find((v) => v.branch === branchId && number !== null && v.number === number) ??
    null
  );
}

/** The budget as it was at a version. */
export function versionBudget(history: BudgetHistory, version: BudgetVersion): Budget | null {
  return findEntry(history, version.entryId)?.budget ?? null;
}

/**
 * The version before this one, to compare with: the one before it on its branch, or for a
 * branch's first, the version the branch was started from.
 */
export function previousVersion(history: BudgetHistory, version: BudgetVersion): BudgetVersion | null {
  const sorted = versionsNewestFirst(versionsOn(history, version.branch));
  const before = sorted[sorted.findIndex((v) => v.id === version.id) + 1];
  if (before) return before;
  const from = findBranch(history, version.branch)?.from;
  if (!from) return null;
  const at = history.versions.filter((v) => v.entryId === from && v.id !== version.id);
  const fromBranch = findEntry(history, from)?.branch;
  return at.find((v) => v.branch === fromBranch) ?? at[0] ?? null;
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
 * Which version each change went into: the first version on its branch made from it (it, or a
 * change after it). Changes in no version yet, or undone before one was made, aren't in the map.
 */
export function versionOfEntries(history: BudgetHistory): Map<string, BudgetVersion> {
  const byId = new Map(history.entries.map((e) => [e.id, e]));
  const out = new Map<string, BudgetVersion>();
  for (const branch of history.branches) {
    for (const v of versionsNewestFirst(versionsOn(history, branch.id)).reverse()) {
      // Everything before an entry already placed is placed too, so the walk stops there, and at
      // the branch's start: the changes before it went into the branch it came from.
      for (const e of lineage(byId, v.entryId, new Set(out.keys()))) {
        if (e.branch !== branch.id) break;
        out.set(e.id, v);
      }
    }
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
