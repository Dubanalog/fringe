import {
  type Budget,
  type BudgetHistory,
  type BudgetVersion,
  type VersionDraft,
  currentBudget,
  deleteVersion,
  goTo,
  type HistoryEvent,
  historyEvents,
  recordChange,
  redo,
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
  /** Every change and version, for undo/redo, the History page and forks. */
  history: BudgetHistory;
  /** The project folder this budget saves to; null for a budget that isn't saved anywhere. */
  project: string | null;
  /** Changes not yet saved to the project folder, oldest first. Saved automatically. */
  unsaved: HistoryEvent[];
  /** Why the last save failed; cleared by the next change, which tries again. */
  saveError: string | null;
  /** Changed and not saved. */
  dirty: boolean;
  nav: BudgetNav;
  selections: Selections;
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
  | { type: 'goTo'; id: string; entryId: string }
  /** A version saved or changed (see the engine's saveVersion). */
  | { type: 'saveVersion'; id: string; version: BudgetVersion }
  | { type: 'deleteVersion'; id: string; versionId: string }
  | { type: 'draftVersion'; id: string; draft: VersionDraft | null }
  | { type: 'navigate'; id: string; nav: BudgetNav }
  | { type: 'select'; id: string; level: string; row: string; col: number }
  /** The first `count` unsaved events were saved. */
  | { type: 'saved'; id: string; count: number }
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
        const history = recordChange(t.history, action.budget, action.label ?? 'Edit');
        const entry = history.entries[history.current]!;
        return { ...unsaved(t, { type: 'change', entry }), budget: action.budget, history, dirty: true };
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
        const to = history.entries[history.current]!.id;
        const moved = unsaved(t, { type: 'move', at: new Date().toISOString(), to });
        return { ...moved, history, budget: currentBudget(history), dirty: true };
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
        return { ...t, unsaved: rest, saveError: null, dirty: rest.length > 0 };
      });
    case 'saveFailed':
      return patch(state, action.id, (t) => ({ ...t, saveError: action.error }));
  }
}

/** Adds a change to save, for a budget saved to a project; a new change retries a failed save. */
function unsaved(t: BudgetTab, event: HistoryEvent): BudgetTab {
  return t.project ? { ...t, unsaved: [...t.unsaved, event], saveError: null } : t;
}
