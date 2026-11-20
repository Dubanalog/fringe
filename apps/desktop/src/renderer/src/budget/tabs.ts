import {
  type Budget,
  type BudgetHistory,
  type BudgetVersion,
  type VersionDraft,
  MAIN_BRANCH,
  ReadOnlyError,
  activeBranch,
  branchName,
  createBranch,
  currentBudget,
  deleteVersion,
  goTo,
  type HistoryEvent,
  historyEvents,
  isEditable,
  openBranch,
  recordChange,
  redo,
  renameBranch,
  setNotPicked,
  startHistory,
  undo,
} from '@fringe/budget-engine';

/** Where the user is inside a budget: topsheet, a category, or an account. */
export interface BudgetNav {
  categoryId: string | null;
  accountId: string | null;
}

/** Selected cell per grid level, keyed by 'top' or the category/account id, so it survives drilling and tab switches. */
export type Selections = Record<string, { row: string; col: number }>;

export interface BudgetTab {
  id: string;
  /** The budget as it is now: always the history's current entry. */
  budget: Budget;
  /** Every change and version, for undo/redo, the Versions page and copies. */
  history: BudgetHistory;
  /** The project folder this budget saves to; null for a budget that isn't saved anywhere. */
  project: string | null;
  /** Changes not yet saved to the project folder, oldest first. Saved automatically. */
  unsaved: HistoryEvent[];
  /** Why the last save failed; cleared by the next change, which tries again. */
  saveError: string | null;
  /** Changed and not saved. */
  dirty: boolean;
  /** Each branch file last written to the project, as branchFilesToSave tracks them. */
  branchFiles: Record<string, string>;
  nav: BudgetNav;
  selections: Selections;
  /**
   * An edit made while an earlier point was showing, which is read-only. It waits here while the
   * user names a new branch for it (branchWithEdit), or drops it (dropEdit).
   */
  heldEdit?: { budget: Budget; label: string } | null;
  /** Fields the AI filled in for the "Save version" form, until the form closes; `at` tells fills apart. */
  versionDraft?: (VersionDraft & { at: number }) | null;
}

export interface TabsState {
  tabs: BudgetTab[];
  /** null shows the start page. */
  activeId: string | null;
}

export type TabsAction =
  /**
   * Opens a budget in a tab. With a history it's an existing project, already saved; without,
   * a new history starts (`label` names its first entry) and, with a project, is saved there.
   */
  | { type: 'open'; budget: Budget; project?: string; history?: BudgetHistory; label?: string }
  | { type: 'activate'; id: string | null }
  | { type: 'cycle'; step: 1 | -1 }
  | { type: 'close'; id: string }
  /** `label` names the change in history, e.g. "Rate"; defaults to "Edit". */
  | { type: 'update'; id: string; budget: Budget; label?: string }
  | { type: 'undo'; id: string }
  | { type: 'redo'; id: string }
  /** Shows an entry: a version or a branch's end. Anything but the end of a branch is read-only. */
  | { type: 'goTo'; id: string; entryId: string }
  /** Shows the end of a branch, to work on. */
  | { type: 'openBranch'; id: string; branchId: string }
  /**
   * Starts a branch from a version or a branch's end, and shows it. Check the name first with the
   * engine's cleanBranchName: a name it refuses leaves the tab as it was.
   */
  | { type: 'createBranch'; id: string; name: string; fromEntryId: string }
  /** Starts a branch from the point showing and makes the held edit on it. */
  | { type: 'branchWithEdit'; id: string; name: string }
  | { type: 'dropEdit'; id: string }
  | { type: 'renameBranch'; id: string; branchId: string; name: string }
  | { type: 'setNotPicked'; id: string; branchId: string; notPicked: boolean }
  /** A version saved or changed (see the engine's saveVersion). */
  | { type: 'saveVersion'; id: string; version: BudgetVersion }
  | { type: 'deleteVersion'; id: string; versionId: string }
  | { type: 'draftVersion'; id: string; draft: VersionDraft | null }
  | { type: 'navigate'; id: string; nav: BudgetNav }
  | { type: 'select'; id: string; level: string; row: string; col: number }
  /** The first `count` unsaved events were saved., and these branch files written. */
  | { type: 'saved'; id: string; count: number; branchFiles?: Record<string, string> }
  | { type: 'saveFailed'; id: string; error: string };

export const initialTabs: TabsState = { tabs: [], activeId: null };

function patch(state: TabsState, id: string, fn: (tab: BudgetTab) => BudgetTab): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      // Opening the same file again switches to its tab instead of duplicating it.
      const existing = state.tabs.find((t) => action.project !== undefined && t.project === action.project);
      if (existing) return { ...state, activeId: existing.id };
      const history = action.history ?? startHistory(action.budget, action.label ?? 'Opened');
      const tab: BudgetTab = {
        id: action.budget.id,
        budget: currentBudget(history),
        history,
        project: action.project ?? null,
        unsaved: action.project && !action.history ? historyEvents(history) : [],
        saveError: null,
        dirty: false,
        branchFiles: {},
        nav: { categoryId: null, accountId: null },
        selections: {},
      };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }
    case 'activate':
      return { ...state, activeId: action.id };
    case 'cycle': {
      if (state.tabs.length === 0) return state;
      const i = state.tabs.findIndex((t) => t.id === state.activeId);
      const next = (i + action.step + state.tabs.length) % state.tabs.length;
      return { ...state, activeId: state.tabs[next]!.id };
    }
    case 'close': {
      const i = state.tabs.findIndex((t) => t.id === action.id);
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const activeId =
        state.activeId === action.id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : state.activeId;
      return { tabs, activeId };
    }
    case 'update':
      return patch(state, action.id, (t) => {
        if (t.budget === action.budget) return t;
        const label = action.label ?? 'Edit';
        try {
          return change(t, recordChange(t.history, action.budget, label));
        } catch (err) {
          if (!(err instanceof ReadOnlyError)) throw err;
          return { ...t, heldEdit: { budget: action.budget, label } };
        }
      });
    case 'openBranch':
      return patch(state, action.id, (t) => {
        const history = openBranch(t.history, action.branchId);
        if (history === t.history) return t;
        return show(t, history);
      });
    case 'createBranch':
      return patch(state, action.id, (t) => {
        const made = tryBranch(t.history, action.name, action.fromEntryId);
        return made ? branched(t, made) : t;
      });
    case 'branchWithEdit':
      return patch(state, action.id, (t) => {
        const held = t.heldEdit;
        if (!held) return t;
        const made = tryBranch(t.history, action.name, t.history.entries[t.history.current]!.id);
        if (!made) return t;
        const next = branched(t, made);
        return { ...change(next, recordChange(next.history, held.budget, held.label)), heldEdit: null };
      });
    case 'dropEdit':
      return patch(state, action.id, (t) => (t.heldEdit ? { ...t, heldEdit: null } : t));
    case 'renameBranch':
    case 'setNotPicked':
      return patch(state, action.id, (t) => {
        let history: BudgetHistory;
        try {
          history =
            action.type === 'renameBranch'
              ? renameBranch(t.history, action.branchId, action.name)
              : setNotPicked(t.history, action.branchId, action.notPicked);
        } catch {
          return t;
        }
        if (history === t.history) return t;
        const branch = history.branches.find((b) => b.id === action.branchId)!;
        return { ...branchEvent(t, branch), history, dirty: true };
      });
    case 'undo':
    case 'redo':
    case 'goTo':
      return patch(state, action.id, (t) => {
        const history =
          action.type === 'undo'
            ? undo(t.history)
            : action.type === 'redo'
              ? redo(t.history)
              : goTo(t.history, action.entryId);
        if (history === t.history) return t;
        const at = new Date().toISOString();
        const to = history.entries[history.current]!.id;
        const budget = currentBudget(history);
        if (action.type !== 'goTo') {
          // Undo and redo move the end of the branch being worked on.
          const moved = unsaved(t, { type: 'move', at, to, branch: history.branch });
          return { ...moved, history, budget, dirty: true };
        }
        return show(t, history);
      });
    case 'saveVersion':
      return patch(state, action.id, (t) => {
        const { version } = action;
        const known = t.history.versions.some((v) => v.id === version.id);
        const versions = known
          ? t.history.versions.map((v) => (v.id === version.id ? version : v))
          : [...t.history.versions, version];
        const saved = unsaved(t, { type: 'version', at: new Date().toISOString(), version });
        return { ...saved, history: { ...t.history, versions }, dirty: true };
      });
    case 'deleteVersion':
      return patch(state, action.id, (t) => {
        const history = deleteVersion(t.history, action.versionId);
        if (history.versions.length === t.history.versions.length) return t;
        const saved = unsaved(t, {
          type: 'version-deleted',
          at: new Date().toISOString(),
          id: action.versionId,
        });
        return { ...saved, history, dirty: true };
      });
    case 'draftVersion':
      return patch(state, action.id, (t) => ({
        ...t,
        versionDraft: action.draft ? { ...action.draft, at: (t.versionDraft?.at ?? 0) + 1 } : null,
      }));
    case 'navigate':
      return patch(state, action.id, (t) => ({ ...t, nav: action.nav }));
    case 'select':
      return patch(state, action.id, (t) => ({
        ...t,
        selections: { ...t.selections, [action.level]: { row: action.row, col: action.col } },
      }));
    case 'saved':
      return patch(state, action.id, (t) => {
        const rest = t.unsaved.slice(action.count);
        return {
          ...t,
          unsaved: rest,
          saveError: null,
          dirty: rest.length > 0,
          branchFiles: action.branchFiles ?? t.branchFiles,
        };
      });
    case 'saveFailed':
      return patch(state, action.id, (t) => ({ ...t, saveError: action.error }));
  }
}

/** The tab's name: the budget's, and the branch's when it isn't the main line ("Pilot · 25-day shoot"). */
export function tabTitle(tab: BudgetTab): string {
  const branch = activeBranch(tab.history);
  return branch.id === MAIN_BRANCH
    ? tab.budget.name
    : `${tab.budget.name} · ${branchName(branch, tab.budget.name)}`;
}

/** A change just recorded in the history. */
function change(t: BudgetTab, history: BudgetHistory): BudgetTab {
  if (history === t.history) return t;
  const entry = history.entries[history.current]!;
  return { ...unsaved(t, { type: 'change', entry }), budget: entry.budget, history, dirty: true };
}

/**
 * Shows another point. A look at an earlier point saves nothing; opening the end of another branch
 * is remembered, so the project opens there next time. An edit held for the point before is dropped.
 */
function show(t: BudgetTab, history: BudgetHistory): BudgetTab {
  const next = { ...t, history, budget: currentBudget(history), heldEdit: null };
  if (!isEditable(history) || history.branch === t.history.branch) return next;
  return {
    ...unsaved(next, { type: 'show', at: new Date().toISOString(), branch: history.branch }),
    dirty: true,
  };
}

function tryBranch(history: BudgetHistory, name: string, from: string) {
  try {
    return createBranch(history, name, from);
  } catch {
    return null;
  }
}

/** A branch just started (and showing). */
function branched(t: BudgetTab, made: ReturnType<typeof createBranch>): BudgetTab {
  const next = branchEvent(t, made.branch);
  return { ...next, history: made.history, budget: currentBudget(made.history), dirty: true };
}

/** Saves a branch's name, start and mark; the latest line for a branch wins. */
function branchEvent(t: BudgetTab, branch: ReturnType<typeof createBranch>['branch']): BudgetTab {
  const { head: _head, ...info } = branch;
  return unsaved(t, { type: 'branch', at: new Date().toISOString(), branch: info });
}

/** Adds a change to save, for a budget saved to a project; a new change retries a failed save. */
function unsaved(t: BudgetTab, event: HistoryEvent): BudgetTab {
  return t.project ? { ...t, unsaved: [...t.unsaved, event], saveError: null } : t;
}
