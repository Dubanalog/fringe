import {
  type BudgetHistory,
  DEFAULT_BUDGET_SETTINGS,
  MAIN_BRANCH,
  activeBranch,
  createBranch,
  currentBudget,
  goTo,
  openBranch,
  recordChange,
  saveVersion,
  setNotPicked,
  startHistory,
} from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { branchTree, withoutNotPicked } from './branch-tree';

let clock = 0;
/** Times in order, so saves and changes sort the way they happened. */
const tick = () => new Date(Date.UTC(2026, 10, 20, 0, 0, clock++)).toISOString();
const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
const edit = (h: BudgetHistory, label: string) =>
  recordChange(h, { ...currentBudget(h), name: label }, label, tick());
const save = (h: BudgetHistory, number: string) => saveVersion(h, { ...fields, number }, tick());

/** What a row shows, left to right: "1.0", "Latest" or "·" (a start dot), with its column. */
function picture(h: BudgetHistory) {
  const t = branchTree(h, 'Pilot');
  return t.rows.map((r) => [
    r.name,
    r.depth,
    t.nodes
      .filter((n) => n.row === r.row)
      .map(
        (n) => `${n.col}:${n.kind === 'version' ? n.version!.number : n.kind === 'latest' ? 'Latest' : '·'}`,
      )
      .join(' '),
  ]);
}

/** Main: v1.0, v1.1, then a change after it. */
function pilot() {
  clock = 0;
  let h = startHistory(
    { id: 'p', name: 'Pilot', settings: DEFAULT_BUDGET_SETTINGS, categories: [] },
    'Created',
    tick(),
  );
  const v10 = save(h, '1.0');
  h = edit(v10.history, 'A');
  const v11 = save(h, '1.1');
  h = edit(v11.history, 'B');
  return { h, v10: v10.version, v11: v11.version };
}

describe('branchTree', () => {
  it('shows the main line with its versions and its Latest point', () => {
    const { h } = pilot();
    expect(picture(h)).toEqual([['Pilot', 0, '0:1.0 1:1.1 2:Latest']]);
    const t = branchTree(h, 'Pilot');
    expect(t.cols).toBe(3);
    expect(t.nodes.at(-1)).toMatchObject({ end: true, showing: true });
  });

  it('makes the latest version the end when nothing changed after it', () => {
    const { h } = pilot();
    const saved = save(h, '1.2').history;
    expect(picture(saved)).toEqual([['Pilot', 0, '0:1.0 1:1.1 2:1.2']]);
    expect(branchTree(saved, 'Pilot').nodes.at(-1)).toMatchObject({ kind: 'version', end: true });
  });

  it('puts each branch in a row under the branch it came from, in the order versions were saved', () => {
    const { h: start, v10, v11 } = pilot();
    // From v1.1: 25-day shoot, with its own v1.0.
    let made = createBranch(start, '25-day shoot', v11.entryId, tick());
    let h = edit(made.history, 'C');
    const b10 = save(h, '1.0');
    h = b10.history;
    // From v1.0 of 25-day shoot: No overtime.
    made = createBranch(h, 'No overtime', b10.version.entryId, tick());
    h = edit(made.history, 'D');
    // From v1.0 on the main line: Union crew, started after No overtime but placed above it.
    h = createBranch(h, 'Union crew', v10.entryId, tick()).history;
    // Back on the main line, v1.2.
    h = save(openBranch(h, MAIN_BRANCH), '1.2').history;

    expect(picture(h)).toEqual([
      ['Pilot', 0, '0:1.0 1:1.1 5:1.2'],
      ['25-day shoot', 1, '2:1.0'],
      ['No overtime', 2, '3:Latest'],
      ['Union crew', 1, '4:Latest'],
    ]);
    const t = branchTree(h, 'Pilot');
    const key = (row: number, col: number) => t.nodes.find((n) => n.row === row && n.col === col)!.key;
    expect(t.links).toEqual([
      { from: key(0, 1), to: key(1, 2) },
      { from: key(1, 2), to: key(2, 3) },
      { from: key(0, 0), to: key(3, 4) },
    ]);
    // The main line's end is v1.2, showing.
    expect(t.nodes.filter((n) => n.showing).map((n) => n.key)).toEqual([key(0, 5)]);
  });

  it('marks where a branch started from an end that has moved on since', () => {
    const { h: start } = pilot();
    const end = activeBranch(start).head;
    let h = createBranch(start, 'Alt', end, tick()).history;
    h = edit(openBranch(h, MAIN_BRANCH), 'After');
    expect(picture(h)).toEqual([
      ['Pilot', 0, '0:1.0 1:1.1 2:· 4:Latest'],
      ['Alt', 1, '3:Latest'],
    ]);
  });

  it('shows the point a read-only look is at', () => {
    const { h: start, v10 } = pilot();
    const t = branchTree(goTo(start, v10.entryId), 'Pilot');
    expect(t.nodes.filter((n) => n.showing).map((n) => n.version?.number)).toEqual(['1.0']);
  });

  it('can leave out branches not picked, and the ones started from them, but never the one showing', () => {
    const { h: start, v10, v11 } = pilot();
    let made = createBranch(start, 'Dropped', v11.entryId, tick());
    let h = save(edit(made.history, 'C'), '1.0');
    made = createBranch(h.history, 'Under dropped', h.version.entryId, tick());
    h = { history: made.history, version: h.version };
    let hist = createBranch(h.history, 'Kept', v10.entryId, tick()).history;
    hist = setNotPicked(hist, hist.branches.find((b) => b.name === 'Dropped')!.id, true);
    expect(picture(withoutNotPicked(hist)).map((r) => r[0])).toEqual(['Pilot', 'Kept']);
    // Showing the branch under the dropped one keeps it and the dropped one above it.
    const shown = openBranch(hist, made.branch.id);
    expect(picture(withoutNotPicked(shown)).map((r) => r[0])).toEqual([
      'Pilot',
      'Dropped',
      'Under dropped',
      'Kept',
    ]);
  });

  it('keeps a branch to the right of where it started, whatever its times', () => {
    const { h: start, v11 } = pilot();
    // A branch whose times run backwards (a clock change) still starts after its version. Rows can share a column.
    const made = createBranch(start, 'Alt', v11.entryId, '2000-01-01T00:00:00.000Z');
    const h = recordChange(
      made.history,
      { ...currentBudget(made.history), name: 'X' },
      'X',
      '2000-01-01T00:00:01.000Z',
    );
    expect(picture(h)).toEqual([
      ['Pilot', 0, '0:1.0 1:1.1 2:Latest'],
      ['Alt', 1, '2:Latest'],
    ]);
  });
});
