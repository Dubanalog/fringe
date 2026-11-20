import { cleanAddonData } from './addons';
import { cleanAssumptions } from './assumptions';
import {
  type Branch,
  type BudgetHistory,
  type BudgetVersion,
  type HistoryEntry,
  MAIN_BRANCH,
  mainBranch,
} from './history';
import {
  type Budget,
  type BudgetSettings,
  type Category,
  type CoaSettings,
  type DetailLine,
  DEFAULT_BUDGET_SETTINGS,
  newId,
} from './model';
import { toDecimal } from './money';
import { ENGINE_VERSION } from './version';

/**
 * A budget project is a folder (see docs/project-folder.md):
 *
 *   project.json            what this folder is: format, schema version, project id, name
 *   budget.json             the budget as it is now, readable on its own
 *   history/events.jsonl    every change, undo and go-back, one JSON line each, oldest first
 *   history/objects/        the budget at each change, split into content-addressed pieces
 *   documents/, knowledge/  the production's documents and instructions
 *
 * Every history snapshot is stored as pieces named by the hash of their content: the budget's
 * outline, its settings and each account. An edit to one account stores that account and a new
 * outline; everything else is shared with the snapshots before it. This file holds the pure parts
 * (packing, unpacking, replaying); reading and writing files is the app's job.
 */

export const PROJECT_FORMAT = 'fringe-budget-project';
export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  /** Stays with the project when the folder is copied or moved; it identifies history, not a location. */
  projectId: string;
  name: string;
  createdAt: string;
  /** The app's engine when the project was created. */
  engineVersion: string;
}

export function newProjectFile(name: string, at = new Date().toISOString()): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: newId(),
    name,
    createdAt: at,
    engineVersion: ENGINE_VERSION,
  };
}

/** Checks a parsed project.json; throws with a message for the user when it isn't one we can open. */
export function readProjectFile(value: unknown): ProjectFile {
  const p = value as Partial<ProjectFile> | null;
  if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) {
    throw new Error("This folder isn't a budget project (its project.json is missing or not ours).");
  }
  if (typeof p.schemaVersion !== 'number' || p.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of the app. Update the app to open it.');
  }
  if (typeof p.projectId !== 'string' || typeof p.name !== 'string') {
    throw new Error("This project's project.json is damaged (no project id or name).");
  }
  return p as ProjectFile;
}

/** A blank budget to start a new project from. */
export function newBudget(name: string): Budget {
  return { id: newId(), name, settings: DEFAULT_BUDGET_SETTINGS, categories: [] };
}

/** A branch as the log keeps it: its end is worked out from the changes and moves. */
export type StoredBranch = Omit<Branch, 'head'>;

/** What happened to a budget's history, in the order it happened. Kept until saved. */
export type HistoryEvent =
  | { type: 'change'; entry: HistoryEntry }
  /**
   * Undo or redo: the entry now at the end of `branch`, and showing. Saves from before branches
   * leave `branch` out: it was just the entry showing.
   */
  | { type: 'move'; at: string; to: string; branch?: string }
  /** A version saved or changed; the latest for an id wins. */
  | { type: 'version'; at: string; version: BudgetVersion }
  | { type: 'version-deleted'; at: string; id: string }
  /** A branch started (and shown), renamed, or marked not picked; the latest for an id wins. */
  | { type: 'branch'; at: string; branch: StoredBranch }
  /** The end of another branch opened, to work on. */
  | { type: 'show'; at: string; branch: string };

/** One line of history/events.jsonl. A change names its snapshot by the hash of its outline. */
export type StoredEvent =
  | {
      type: 'change';
      id: string;
      at: string;
      label: string;
      engineVersion: string;
      /** The entry it was made from; older saves leave it out (it was the entry showing then). */
      parent?: string | null;
      /** The branch it was made on; saves from before branches leave it out. */
      branch?: string;
      snapshot: string;
    }
  | Exclude<HistoryEvent, { type: 'change' }>;

export type Hash = (text: string) => string;

/** The budget's outline: everything but settings and accounts, which are pieces of their own. */
interface Outline extends Omit<Budget, 'settings' | 'categories'> {
  settings: string;
  categories: (Omit<Category, 'accounts'> & { accounts: string[] })[];
}

/** Splits a budget into hashed pieces. Returns the outline's hash (the snapshot) and every piece. */
export function packBudget(budget: Budget, hash: Hash): { snapshot: string; pieces: Map<string, string> } {
  const pieces = new Map<string, string>();
  const put = (value: unknown) => {
    const text = JSON.stringify(value);
    const key = hash(text);
    pieces.set(key, text);
    return key;
  };
  const { settings, categories, ...rest } = budget;
  const outline: Outline = {
    ...rest,
    settings: put(settings),
    categories: categories.map(({ accounts, ...c }) => ({ ...c, accounts: accounts.map(put) })),
  };
  return { snapshot: put(outline), pieces };
}

const normalized = new WeakMap<object, BudgetSettings>();

/**
 * Settings as saved by any version, brought up to date: missing ones take their defaults, and
 * number digit counts from before patterns (4) become patterns ("####"). Remembered per saved
 * object, so snapshots that share settings still share them.
 */
export function normalizeSettings(saved: BudgetSettings): BudgetSettings {
  const known = normalized.get(saved);
  if (known) return known;
  const old = saved.coa as Partial<CoaSettings> & {
    categoryDigits?: number | null;
    accountDigits?: number | null;
  };
  const digits = (n: number | null | undefined) => (n ? '#'.repeat(n) : null);
  const { categoryDigits, accountDigits, ...coa } = old ?? {};
  const settings: BudgetSettings = {
    ...DEFAULT_BUDGET_SETTINGS,
    ...saved,
    fringes: { ...DEFAULT_BUDGET_SETTINGS.fringes, ...saved.fringes },
    // Assumptions can come from any file; only safe formatting is kept.
    assumptions: cleanAssumptions(saved.assumptions ?? ''),
    coa: {
      ...DEFAULT_BUDGET_SETTINGS.coa,
      ...coa,
      categoryPattern: coa.categoryPattern !== undefined ? coa.categoryPattern : digits(categoryDigits),
      accountPattern: coa.accountPattern !== undefined ? coa.accountPattern : digits(accountDigits),
    },
  };
  if (!Array.isArray(settings.currencies)) settings.currencies = [];
  if (typeof settings.currency !== 'string' || !settings.currency.trim()) settings.currency = 'USD';
  if (settings.crewFringes && !isStringList(settings.crewFringes)) delete settings.crewFringes;
  const addonData = cleanAddonData(settings.addonData);
  if (addonData) settings.addonData = addonData;
  else delete settings.addonData;
  normalized.set(saved, settings);
  return settings;
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A budget as saved by any version, brought up to date (see normalizeSettings, normalizeAccount). */
export function normalizeBudget(budget: Budget): Budget {
  const settings = normalizeSettings(budget.settings);
  let changed = settings !== budget.settings;
  const categories = budget.categories.map((c) => {
    const accounts = c.accounts.map(normalizeAccount);
    if (accounts.every((a, i) => a === c.accounts[i])) return c;
    changed = true;
    return { ...c, accounts };
  });
  return changed ? { ...budget, settings, categories } : budget;
}

type Account = Category['accounts'][number];
const normalizedAccounts = new WeakMap<Account, Account>();

/**
 * An account as saved by any version. Lines used to have a fourth multiplier and units for X,
 * Rate and the fourth; the multiplier goes into X (so the subtotal is unchanged), the extra units
 * go, as they never counted for anything.
 */
export function normalizeAccount(saved: Account): Account {
  const known = normalizedAccounts.get(saved);
  if (known) return known;
  const old = (d: DetailLine) => 'fourthMultiplier' in d || 'unit2' in d || 'unit3' in d || 'unit4' in d;
  const account = saved.details.some(old) ? { ...saved, details: saved.details.map(foldFourth) } : saved;
  normalizedAccounts.set(saved, account);
  return account;
}

function foldFourth(line: DetailLine): DetailLine {
  type Old = DetailLine & {
    fourthMultiplier?: string;
    unit2?: string;
    unit3?: string;
    unit4?: string;
    formulas: DetailLine['formulas'] & { fourthMultiplier?: string };
  };
  const { fourthMultiplier, unit2: _u2, unit3: _u3, unit4: _u4, ...d } = line as Old;
  if (!('fourthMultiplier' in line)) return d;
  const { fourthMultiplier: fourthFormula, ...formulas } = (line as Old).formulas;
  const fourth = fourthMultiplier?.trim() || '1';
  if (fourthFormula === undefined && toDecimal(fourth).equals(1)) return { ...d, formulas };
  const x = toDecimal(d.x || '1')
    .times(toDecimal(fourth))
    .toFixed();
  const xFormula = formulas.x ?? (fourthFormula !== undefined ? d.x || '1' : undefined);
  if (xFormula !== undefined) formulas.x = `(${xFormula})*(${fourthFormula ?? fourth})`;
  return { ...d, x, formulas };
}

/**
 * Rebuilds a budget from its snapshot. `read` returns a piece's parsed content; pass one that
 * caches, so pieces shared between snapshots are shared in memory too.
 */
export function unpackBudget(snapshot: string, read: (key: string) => unknown): Budget {
  const { settings, categories, ...rest } = read(snapshot) as Outline;
  return {
    ...rest,
    settings: normalizeSettings(read(settings) as BudgetSettings),
    categories: categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => normalizeAccount(read(a) as Account)),
    })),
  };
}

/** A history event as it is written to disk, with the pieces its snapshot needs. */
export function storeEvent(
  event: HistoryEvent,
  hash: Hash,
): { line: StoredEvent; pieces: Map<string, string> } {
  if (event.type !== 'change') return { line: event, pieces: new Map() };
  const { id, at, label, engineVersion, parent, branch, budget } = event.entry;
  const { snapshot, pieces } = packBudget(budget, hash);
  return { line: { type: 'change', id, at, label, engineVersion, parent, branch, snapshot }, pieces };
}

/** Whether a line was written by an app that knows about branches. */
function knowsBranches(event: StoredEvent): boolean {
  switch (event.type) {
    case 'change':
      return event.branch !== undefined;
    case 'move':
      return event.branch !== undefined;
    case 'version':
      return (event.version as Partial<BudgetVersion>).branch !== undefined;
    case 'branch':
    case 'show':
      return true;
    default:
      return false;
  }
}

/**
 * Sorts a history saved before branches into branches. The line to the entry that was showing is
 * the main line. Every other line of changes with a saved version on it becomes "Alternate 1",
 * "Alternate 2"… (oldest first), from the version to the newest change after it. Changes on no
 * such line (undone, with no version) go with the branch they came off, as undone changes do.
 * Ids come from the entries, so opening the same old history again sorts it the same way.
 */
export function sortIntoBranches(
  ids: readonly string[],
  parents: readonly (number | null)[],
  current: number,
  versionEntries: readonly number[],
  times: readonly string[],
): { branchOf: string[]; branches: { info: StoredBranch; head: number }[] } {
  const branchOf: (string | undefined)[] = ids.map(() => undefined);
  const children = ids.map((): number[] => []);
  parents.forEach((p, i) => {
    if (p !== null) children[p]!.push(i);
  });
  for (let i: number | null = current; i !== null && branchOf[i] === undefined; i = parents[i]!) {
    branchOf[i] = MAIN_BRANCH;
  }
  const found: { id: string; from: number | null; head: number; start: number }[] = [];
  for (const v of [...new Set(versionEntries)].sort((a, b) => b - a)) {
    if (branchOf[v] !== undefined) continue;
    // Its end: the newest change after it, then the newest after that, and on.
    let head = v;
    for (;;) {
      const next = children[head]!.filter((c) => branchOf[c] === undefined).pop();
      if (next === undefined) break;
      head = next;
    }
    const id = `alt-${ids[v]!}`;
    let start = head;
    let i: number | null = head;
    for (; i !== null && branchOf[i] === undefined; i = parents[i]!) {
      branchOf[i] = id;
      start = i;
    }
    found.push({ id, from: i, head, start });
  }
  // The rest go with the branch of the change they were made from, which is always earlier.
  parents.forEach((p, i) => (branchOf[i] ??= p === null ? MAIN_BRANCH : branchOf[p]));
  found.sort((a, b) => a.start - b.start);
  return {
    branchOf: branchOf as string[],
    branches: found.map((b, n) => ({
      head: b.head,
      info: {
        id: b.id,
        name: `Alternate ${n + 1}`,
        from: b.from === null ? null : ids[b.from]!,
        createdAt: times[b.start]!,
        notPicked: false,
      },
    })),
  };
}

/**
 * Replays saved events into a history, as the app recorded it: every change is kept (a change
 * after an undo replaces the undone ones; they stay), undo and redo move a branch's end, branches
 * are started, renamed and marked, and versions are saved, changed and deleted. A history saved
 * before branches is sorted into them (see sortIntoBranches). It opens at the end of the branch
 * last worked on. Lines that don't parse (a write cut short) are skipped. Null when there's
 * nothing to replay.
 */
export function replayHistory(
  lines: readonly string[],
  load: (snapshot: string) => Budget,
): BudgetHistory | null {
  const changes: Extract<StoredEvent, { type: 'change' }>[] = [];
  const parents: (number | null)[] = [];
  /** Each change's branch; blank until an old history is sorted. */
  const branchOf: string[] = [];
  const index = new Map<string, number>();
  const versions = new Map<string, BudgetVersion>();
  const infos = new Map<string, StoredBranch>();
  const heads = new Map<string, number>();
  let current = -1;
  let showing = MAIN_BRANCH;
  let old = true;

  const sortOld = () => {
    old = false;
    if (current < 0) return;
    const versionEntries = [...versions.values()]
      .map((v) => index.get(v.entryId))
      .filter((i) => i !== undefined);
    const sorted = sortIntoBranches(
      changes.map((c) => c.id),
      parents,
      current,
      versionEntries,
      changes.map((c) => c.at),
    );
    sorted.branchOf.forEach((b, i) => (branchOf[i] = b));
    heads.set(MAIN_BRANCH, current);
    for (const { info, head } of sorted.branches) {
      infos.set(info.id, info);
      heads.set(info.id, head);
    }
    for (const v of versions.values()) {
      const i = index.get(v.entryId);
      if (i !== undefined) versions.set(v.id, { ...v, branch: branchOf[i]! });
    }
  };

  for (const text of lines) {
    let event: StoredEvent;
    try {
      event = JSON.parse(text) as StoredEvent;
    } catch {
      continue;
    }
    if (old && knowsBranches(event)) sortOld();
    if (event.type === 'change') {
      // A change saved twice (a retried save) shows it again rather than adding it twice.
      const seen = index.get(event.id);
      if (seen !== undefined) {
        current = seen;
        if (!old) {
          showing = branchOf[seen]!;
          heads.set(showing, seen);
        }
        continue;
      }
      const branch = old ? '' : (event.branch ?? MAIN_BRANCH);
      const fallback = old ? current : (heads.get(branch) ?? current);
      const parent =
        event.parent === null
          ? null
          : event.parent !== undefined && index.has(event.parent)
            ? index.get(event.parent)!
            : fallback < 0
              ? null
              : fallback;
      index.set(event.id, changes.length);
      changes.push(event);
      parents.push(parent);
      branchOf.push(branch);
      current = changes.length - 1;
      if (!old) {
        heads.set(branch, current);
        showing = branch;
      }
    } else if (event.type === 'move') {
      const i = index.get(event.to);
      if (i === undefined) continue;
      current = i;
      if (!old) {
        showing = event.branch ?? branchOf[i]!;
        heads.set(showing, i);
      }
    } else if (event.type === 'version') {
      // Map order is first-saved order, which a change to a version keeps.
      versions.set(event.version.id, event.version);
    } else if (event.type === 'version-deleted') {
      versions.delete(event.id);
    } else if (event.type === 'branch') {
      const b = event.branch;
      if (!infos.has(b.id)) {
        showing = b.id;
        const from = b.from === null ? undefined : index.get(b.from);
        if (!heads.has(b.id) && from !== undefined) heads.set(b.id, from);
      }
      infos.set(b.id, b);
    } else if (event.type === 'show') {
      showing = event.branch;
    }
  }
  if (old) sortOld();
  if (current < 0) return null;

  const main = infos.get(MAIN_BRANCH) ?? mainInfo(changes[0]!.at);
  const branches: Branch[] = [];
  for (const info of [main, ...[...infos.values()].filter((b) => b.id !== MAIN_BRANCH)]) {
    const head = heads.get(info.id) ?? (info.id === MAIN_BRANCH ? 0 : undefined);
    if (head === undefined) continue;
    branches.push({ ...info, from: info.id === MAIN_BRANCH ? null : info.from, head: changes[head]!.id });
  }
  const known = new Set(branches.map((b) => b.id));
  const branch = known.has(showing) ? showing : MAIN_BRANCH;
  const entries: HistoryEntry[] = changes.map((line, i) => ({
    id: line.id,
    at: line.at,
    label: line.label,
    engineVersion: line.engineVersion,
    parent: parents[i] === null ? null : changes[parents[i]!]!.id,
    branch: known.has(branchOf[i]!) ? branchOf[i]! : MAIN_BRANCH,
    budget: load(line.snapshot),
  }));
  return {
    entries,
    current: index.get(branches.find((b) => b.id === branch)!.head)!,
    versions: [...versions.values()]
      .filter((v) => index.has(v.entryId))
      .map((v) => ({
        ...v,
        branch: known.has(v.branch) ? v.branch : entries[index.get(v.entryId)!]!.branch,
      })),
    branches,
    branch,
  };
}

function mainInfo(at: string): StoredBranch {
  const { head: _head, ...info } = mainBranch('', at);
  return info;
}

/** The history's entries, branches and versions as events, for a project's first save. */
export function historyEvents(history: BudgetHistory, at = new Date().toISOString()): HistoryEvent[] {
  const events: HistoryEvent[] = history.entries.map((entry) => ({ type: 'change', entry }));
  for (const { head: _head, ...info } of history.branches) {
    if (info.id !== MAIN_BRANCH || info.notPicked) events.push({ type: 'branch', at, branch: info });
  }
  // Each branch's end, which an undo may have moved back from its newest change.
  for (const b of history.branches) events.push({ type: 'move', at, to: b.head, branch: b.id });
  for (const version of history.versions) events.push({ type: 'version', at, version });
  events.push({ type: 'show', at, branch: history.branch });
  return events;
}

/**
 * The file each branch other than the main line is written to in the project's branches folder,
 * named after it: "25-day shoot.json". The main line is budget.json.
 */
export function branchFileNames(history: BudgetHistory): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const b of history.branches) {
    if (b.id === MAIN_BRANCH) continue;
    const base = projectFolderName(b.name) || 'Branch';
    let name = `${base}.json`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).json`;
    taken.add(name.toLowerCase());
    out.set(b.id, name);
  }
  return out;
}

/** A folder name for a project: the budget's name without characters file systems refuse. */
export function projectFolderName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  // Names Windows keeps for devices, and a leading dot, which hides a folder on macOS and Linux.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)) return `${clean} budget`;
  return clean || 'Budget';
}

/** The branch files a save writes: every file to keep in the branches folder, and the ones that changed. */
export interface BranchFiles {
  keep: string[];
  write: { file: string; budget: Budget }[];
}

/**
 * What a save writes to the branches folder, given what earlier saves wrote (`written`: a key per
 * branch, empty for the first save since opening). Returns the files and the keys to remember.
 */
export function branchFilesToSave(
  history: BudgetHistory,
  written: Readonly<Record<string, string>>,
): { files: BranchFiles; written: Record<string, string> } {
  const names = branchFileNames(history);
  const files: BranchFiles = { keep: [...names.values()], write: [] };
  const next: Record<string, string> = {};
  for (const b of history.branches) {
    const file = names.get(b.id);
    if (!file) continue;
    const key = `${file}\n${b.head}`;
    next[b.id] = key;
    if (written[b.id] === key) continue;
    const head = history.entries.find((e) => e.id === b.head);
    if (head) files.write.push({ file, budget: head.budget });
  }
  return { files, written: next };
}

/** The main line's end: what budget.json holds. */
export function mainBudget(history: BudgetHistory): Budget {
  const head = history.branches.find((b) => b.id === MAIN_BRANCH)?.head;
  return (history.entries.find((e) => e.id === head) ?? history.entries[0]!).budget;
}
