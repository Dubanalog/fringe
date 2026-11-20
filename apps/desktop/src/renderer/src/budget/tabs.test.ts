import {
  type Budget,
  DEFAULT_BUDGET_SETTINGS,
  MAIN_BRANCH,
  isEditable,
  saveVersion,
} from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { type TabsState, initialTabs, tabTitle, tabsReducer } from './tabs';

function budget(id: string): Budget {
  return { id, name: id, settings: DEFAULT_BUDGET_SETTINGS, categories: [] };
}

function open(...ids: string[]): TabsState {
  return ids.reduce((s, id) => tabsReducer(s, { type: 'open', budget: budget(id) }), initialTabs);
}

describe('tabsReducer', () => {
  it('opens each budget in its own tab and focuses it', () => {
    const s = open('a', 'b');
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(s.activeId).toBe('b');
  });

  it('cycles with wrap-around and closes to a neighbour', () => {
    const s = open('a', 'b', 'c');
    expect(tabsReducer(s, { type: 'cycle', step: 1 }).activeId).toBe('a');
    expect(tabsReducer(s, { type: 'cycle', step: -1 }).activeId).toBe('b');
    const closed = tabsReducer(s, { type: 'close', id: 'c' });
    expect(closed.activeId).toBe('b');
    expect(tabsReducer(open('a'), { type: 'close', id: 'a' }).activeId).toBeNull();
  });

  it('marks a tab dirty when its budget changes', () => {
    const s = tabsReducer(open('a'), { type: 'update', id: 'a', budget: { ...budget('a'), name: 'x' } });
    expect(s.tabs[0]!.dirty).toBe(true);
  });
});

describe('undo and redo', () => {
  it('steps back and forward through edits to a budget', () => {
    const s = open('a');
    const edited = { ...s.tabs[0]!.budget, name: 'renamed' };
    const after = tabsReducer(s, { type: 'update', id: 'a', budget: edited, label: 'Rename' });
    const undone = tabsReducer(after, { type: 'undo', id: 'a' });
    expect(undone.tabs[0]!.budget.name).toBe('a');
    expect(tabsReducer(undone, { type: 'redo', id: 'a' }).tabs[0]!.budget).toBe(edited);
    expect(after.tabs[0]!.history.entries.map((e) => e.label)).toEqual(['Opened', 'Rename']);
  });

  it('queues changes to save for a project tab, and clears them once saved', () => {
    let s = tabsReducer(initialTabs, {
      type: 'open',
      budget: budget('p'),
      project: 'C:/p',
      label: 'Created',
    });
    // The first save writes the whole history: its change, the main line's end, the branch showing.
    expect(s.tabs[0]!.unsaved.map((e) => e.type)).toEqual(['change', 'move', 'show']);
    s = tabsReducer(s, { type: 'update', id: 'p', budget: { ...budget('p'), name: 'Renamed' } });
    s = tabsReducer(s, { type: 'undo', id: 'p' });
    expect(s.tabs[0]!.unsaved.map((e) => e.type)).toEqual(['change', 'move', 'show', 'change', 'move']);
    expect(s.tabs[0]!.unsaved.at(-1)).toMatchObject({ type: 'move', branch: 'main' });
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 4 });
    expect(s.tabs[0]!.unsaved).toHaveLength(1);
    expect(s.tabs[0]!.dirty).toBe(true);
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 1 });
    expect(s.tabs[0]!.dirty).toBe(false);
  });

  it('saves nothing for a look at an earlier point', () => {
    let s = tabsReducer(initialTabs, { type: 'open', budget: budget('p'), project: 'C:/p' });
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 3 });
    s = tabsReducer(s, { type: 'update', id: 'p', budget: { ...budget('p'), name: 'Renamed' } });
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 1 });
    const first = s.tabs[0]!.history.entries[0]!.id;
    s = tabsReducer(s, { type: 'goTo', id: 'p', entryId: first });
    expect(s.tabs[0]!.budget.name).toBe(budget('p').name);
    expect(s.tabs[0]!.unsaved).toEqual([]);
    expect(s.tabs[0]!.dirty).toBe(false);
  });

  it('switches to the tab already showing a project', () => {
    let s = tabsReducer(initialTabs, { type: 'open', budget: budget('p'), project: 'C:/p' });
    s = tabsReducer(s, { type: 'open', budget: budget('q'), project: 'C:/p' });
    expect(s.tabs).toHaveLength(1);
  });
});

describe('branches in a tab', () => {
  const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', number: '1.0' };
  /** A project tab: Created, v1.0, then a change on the main line. Nothing left to save. */
  function project(): TabsState {
    let s = tabsReducer(initialTabs, { type: 'open', budget: budget('p'), project: 'C:/p' });
    const { version } = saveVersion(s.tabs[0]!.history, { ...fields, pdf: null });
    s = tabsReducer(s, { type: 'saveVersion', id: 'p', version });
    s = tabsReducer(s, { type: 'update', id: 'p', budget: { ...budget('p'), name: 'Later' } });
    return tabsReducer(s, { type: 'saved', id: 'p', count: s.tabs[0]!.unsaved.length });
  }
  const tab = (s: TabsState) => s.tabs[0]!;
  const types = (s: TabsState) => tab(s).unsaved.map((e) => e.type);
  const first = (s: TabsState) => tab(s).history.entries[0]!.id;

  it('holds an edit on an earlier point until it gets a branch', () => {
    const start = project();
    let s = tabsReducer(start, { type: 'goTo', id: 'p', entryId: first(start) });
    expect(isEditable(tab(s).history)).toBe(false);
    s = tabsReducer(s, {
      type: 'update',
      id: 'p',
      budget: { ...budget('p'), name: 'Edited' },
      label: 'Name',
    });
    expect(tab(s).heldEdit).toMatchObject({ label: 'Name' });
    expect(tab(s).budget.name).toBe('p');
    expect(tab(s).unsaved).toEqual([]);
    // A blank name changes nothing.
    expect(tab(tabsReducer(s, { type: 'branchWithEdit', id: 'p', name: ' ' }))).toBe(tab(s));
    s = tabsReducer(s, { type: 'branchWithEdit', id: 'p', name: '25-day shoot' });
    expect(tab(s).heldEdit).toBeNull();
    expect(tab(s).budget.name).toBe('Edited');
    expect(isEditable(tab(s).history)).toBe(true);
    expect(types(s)).toEqual(['branch', 'change']);
    expect(tabTitle(tab(s))).toBe('Edited · 25-day shoot');
    // The main line kept its end.
    s = tabsReducer(s, { type: 'openBranch', id: 'p', branchId: MAIN_BRANCH });
    expect(tab(s).budget.name).toBe('Later');
    expect(tabTitle(tab(s))).toBe('Later');
    expect(types(s)).toEqual(['branch', 'change', 'show']);
  });

  it('drops a held edit when asked, or when another point opens', () => {
    const start = project();
    let s = tabsReducer(start, { type: 'goTo', id: 'p', entryId: first(start) });
    s = tabsReducer(s, { type: 'update', id: 'p', budget: { ...budget('p'), name: 'Edited' } });
    expect(tab(tabsReducer(s, { type: 'dropEdit', id: 'p' })).heldEdit).toBeNull();
    expect(tab(tabsReducer(s, { type: 'openBranch', id: 'p', branchId: MAIN_BRANCH })).heldEdit).toBeNull();
  });

  it('starts, renames and marks branches, saving each', () => {
    let s = project();
    s = tabsReducer(s, { type: 'createBranch', id: 'p', name: 'Alt', fromEntryId: first(s) });
    const id = tab(s).history.branch;
    expect(id).not.toBe(MAIN_BRANCH);
    expect(tab(s).budget.name).toBe('p');
    expect(tab(tabsReducer(s, { type: 'createBranch', id: 'p', name: 'alt', fromEntryId: first(s) }))).toBe(
      tab(s),
    );
    s = tabsReducer(s, { type: 'renameBranch', id: 'p', branchId: id, name: 'Union crew' });
    s = tabsReducer(s, { type: 'setNotPicked', id: 'p', branchId: id, notPicked: true });
    expect(tab(s).history.branches[1]).toMatchObject({ name: 'Union crew', notPicked: true });
    expect(types(s)).toEqual(['branch', 'branch', 'branch']);
    expect(tab(tabsReducer(s, { type: 'renameBranch', id: 'p', branchId: MAIN_BRANCH, name: 'X' }))).toBe(
      tab(s),
    );
  });
});
