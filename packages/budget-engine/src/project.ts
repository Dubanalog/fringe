import { cleanAddonData } from './addons';
import { cleanAssumptions } from './assumptions';
import type { BudgetHistory, BudgetVersion, HistoryEntry } from './history';
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

/** What happened to a budget's history, in the order it happened. Kept until saved. */
export type HistoryEvent =
  | { type: 'change'; entry: HistoryEntry }
  /** Undo, redo or going back: the entry now showing. */
  | { type: 'move'; at: string; to: string }
  /** A version saved or changed; the latest for an id wins. */
  | { type: 'version'; at: string; version: BudgetVersion }
  | { type: 'version-deleted'; at: string; id: string };

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
      snapshot: string;
    }
  | { type: 'move'; at: string; to: string }
  | { type: 'version'; at: string; version: BudgetVersion }
  | { type: 'version-deleted'; at: string; id: string };

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
  const { id, at, label, engineVersion, parent, budget } = event.entry;
  const { snapshot, pieces } = packBudget(budget, hash);
  return { line: { type: 'change', id, at, label, engineVersion, parent, snapshot }, pieces };
}

/**
 * Replays saved events into a history, as the app recorded it: every change is kept (a change
 * after going back starts a branch; the changes it replaced stay), a move shows another entry, and
 * versions are saved, changed and deleted. Lines that don't parse (a write cut short) are skipped.
 * Null when there's nothing to replay.
 */
export function replayHistory(
  lines: readonly string[],
  load: (snapshot: string) => Budget,
): BudgetHistory | null {
  const changes: Extract<StoredEvent, { type: 'change' }>[] = [];
  const parents: (string | null)[] = [];
  const index = new Map<string, number>();
  const versions = new Map<string, BudgetVersion>();
  let current = -1;
  for (const text of lines) {
    let event: StoredEvent;
    try {
      event = JSON.parse(text) as StoredEvent;
    } catch {
      continue;
    }
    if (event.type === 'change') {
      // A change saved twice (a retried save) shows it again rather than adding it twice.
      const seen = index.get(event.id);
      if (seen !== undefined) {
        current = seen;
        continue;
      }
      const parent =
        event.parent !== undefined && (event.parent === null || index.has(event.parent))
          ? event.parent
          : (changes[current]?.id ?? null);
      index.set(event.id, changes.length);
      changes.push(event);
      parents.push(parent);
      current = changes.length - 1;
    } else if (event.type === 'move') {
      const i = index.get(event.to);
      if (i !== undefined) current = i;
    } else if (event.type === 'version') {
      // Map order is first-saved order, which a change to a version keeps.
      versions.set(event.version.id, event.version);
    } else if (event.type === 'version-deleted') {
      versions.delete(event.id);
    }
  }
  if (current < 0) return null;
  return {
    current,
    entries: changes.map((line, i) => ({
      id: line.id,
      at: line.at,
      label: line.label,
      engineVersion: line.engineVersion,
      parent: parents[i]!,
      budget: load(line.snapshot),
    })),
    versions: [...versions.values()].filter((v) => index.has(v.entryId)),
  };
}

/** The history's entries and versions as events, for a project's first save. */
export function historyEvents(history: BudgetHistory, at = new Date().toISOString()): HistoryEvent[] {
  const events: HistoryEvent[] = history.entries.map((entry) => ({ type: 'change', entry }));
  if (history.current !== history.entries.length - 1) {
    events.push({ type: 'move', at, to: history.entries[history.current]!.id });
  }
  for (const version of history.versions) events.push({ type: 'version', at, version });
  return events;
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
