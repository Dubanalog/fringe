import { type Budget, DEFAULT_BUDGET_SETTINGS } from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { type TabsState, initialTabs, tabsReducer } from './tabs';

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
    expect(s.tabs[0]!.unsaved.map((e) => e.type)).toEqual(['change']);
    s = tabsReducer(s, { type: 'update', id: 'p', budget: { ...budget('p'), name: 'Renamed' } });
    s = tabsReducer(s, { type: 'undo', id: 'p' });
    expect(s.tabs[0]!.unsaved.map((e) => e.type)).toEqual(['change', 'change', 'move']);
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 2 });
    expect(s.tabs[0]!.unsaved).toHaveLength(1);
    expect(s.tabs[0]!.dirty).toBe(true);
    s = tabsReducer(s, { type: 'saved', id: 'p', count: 1 });
    expect(s.tabs[0]!.dirty).toBe(false);
  });

  it('switches to the tab already showing a project', () => {
    let s = tabsReducer(initialTabs, { type: 'open', budget: budget('p'), project: 'C:/p' });
    s = tabsReducer(s, { type: 'open', budget: budget('q'), project: 'C:/p' });
    expect(s.tabs).toHaveLength(1);
  });
});
