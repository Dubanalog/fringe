import { describe, expect, it } from 'vitest';
import {
  type BudgetHistory,
  MAIN_BRANCH,
  ReadOnlyError,
  activeBranch,
  branchLine,
  branchName,
  canRedo,
  canUndo,
  createBranch,
  currentBudget,
  findVersion,
  goTo,
  isEditable,
  nextVersionNumber,
  openBranch,
  previousVersion,
  recordChange,
  redo,
  renameBranch,
  saveVersion,
  setNotPicked,
  startHistory,
  undo,
  versionOfEntries,
  versionsOn,
} from './history';
import { newBudget } from './project';

const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
const base = newBudget('Pilot');
/** A different budget each time, as an edit makes. */
const edit = (h: BudgetHistory, label: string) =>
  recordChange(h, { ...currentBudget(h), name: `Pilot ${label}` }, label, `t-${label}`);
const save = (h: BudgetHistory, number: string) => saveVersion(h, { ...fields, number }, `s-${number}`);

/** Main: v1.0, v1.1, then a change; returns the history and the versions. */
function mainLine() {
  let h = startHistory(base, 'Created', 't0');
  const v10 = save(h, '1.0');
  h = edit(v10.history, 'A');
  const v11 = save(h, '1.1');
  h = edit(v11.history, 'B');
  return { h, v10: v10.version, v11: v11.version };
}

describe('branches', () => {
  it('starts with the main line, named after the budget, at its end', () => {
    const h = startHistory(base, 'Created', 't0');
    expect(h.branches).toHaveLength(1);
    expect(activeBranch(h).id).toBe(MAIN_BRANCH);
    expect(branchName(activeBranch(h), 'Pilot')).toBe('Pilot');
    expect(isEditable(h)).toBe(true);
    const h2 = edit(h, 'A');
    expect(activeBranch(h2).head).toBe(h2.entries[1]!.id);
    expect(h2.entries[1]!.branch).toBe(MAIN_BRANCH);
  });

  it('numbers each branch from v1.0 while the main line keeps its own numbers', () => {
    const { h: main, v11 } = mainLine();
    const made = createBranch(main, '25-day shoot', v11.entryId, 'b1');
    const branch = made.branch;
    let h = made.history;
    expect(h.branch).toBe(branch.id);
    expect(currentBudget(h)).toBe(currentBudget(goTo(main, v11.entryId)));
    expect(isEditable(h)).toBe(true);
    expect(nextVersionNumber(versionsOn(h))).toBe('1.0');
    h = edit(h, 'C');
    const b10 = save(h, '1.0');
    h = b10.history;
    expect(b10.version.branch).toBe(branch.id);
    // The main line goes on at v1.2, and "1.0" means the branch showing.
    h = openBranch(h, MAIN_BRANCH);
    expect(currentBudget(h).name).toBe('Pilot B');
    expect(nextVersionNumber(versionsOn(h))).toBe('1.2');
    expect(findVersion(h, '1.0')!.branch).toBe(MAIN_BRANCH);
    expect(findVersion(h, '1.0', branch.id)!.id).toBe(b10.version.id);
    const s12 = save(h, '1.2');
    h = s12.history;
    const m12 = s12.version;
    expect(m12.branch).toBe(MAIN_BRANCH);
    // A branch's first version compares with the version it came from.
    expect(previousVersion(h, b10.version)!.id).toBe(v11.id);
    expect(previousVersion(h, m12)!.id).toBe(v11.id);
    // Changes go into their own branch's versions.
    const of = versionOfEntries(h);
    expect(of.get(h.entries.find((e) => e.label === 'C')!.id)!.id).toBe(b10.version.id);
    expect(of.get(h.entries.find((e) => e.label === 'B')!.id)!.id).toBe(m12.id);
    expect(branchLine(h, branch.id).map((e) => e.label)).toEqual(['C']);
  });

  it('makes earlier points read-only', () => {
    const { h: main, v10 } = mainLine();
    const old = goTo(main, v10.entryId);
    expect(isEditable(old)).toBe(false);
    expect(canUndo(old)).toBe(false);
    expect(canRedo(old)).toBe(false);
    expect(() => edit(old, 'X')).toThrow(ReadOnlyError);
    expect(() => save(old, '9.0')).toThrow(/earlier point/);
    // An unchanged budget isn't a change, so it doesn't refuse.
    expect(recordChange(old, currentBudget(old), 'same')).toBe(old);
    // Opening the branch again goes back to its end.
    expect(isEditable(openBranch(old, MAIN_BRANCH))).toBe(true);
  });

  it('branches from a version on a branch, and from the end of a branch', () => {
    const { h: main, v11 } = mainLine();
    let h = createBranch(main, '25-day shoot', v11.entryId).history;
    h = edit(h, 'C');
    const b10 = save(h, '1.0');
    h = edit(edit(b10.history, 'D'), 'D2');
    const second = createBranch(h, 'No overtime', b10.version.entryId);
    expect(currentBudget(second.history).name).toBe('Pilot C');
    h = edit(second.history, 'E');
    expect(branchLine(h, second.branch.id).map((e) => e.label)).toEqual(['E']);
    // From the end of the main line, which isn't a version.
    const third = createBranch(h, 'Union crew', activeBranch(openBranch(h, MAIN_BRANCH)).head);
    expect(currentBudget(third.history).name).toBe('Pilot B');
    // Not from a point in between.
    const mid = h.entries.find((e) => e.label === 'D')!.id;
    expect(() => createBranch(h, 'Nope', mid)).toThrow(/saved version or from the end/);
  });

  it('names branches uniquely, and renames them', () => {
    const { h: main, v10 } = mainLine();
    const { history: h, branch } = createBranch(main, '  25-day   shoot ', v10.entryId);
    expect(branch.name).toBe('25-day shoot');
    expect(() => createBranch(h, '25-DAY SHOOT', v10.entryId)).toThrow(/already a branch/);
    expect(() => createBranch(h, ' ', v10.entryId)).toThrow(/name/);
    const renamed = renameBranch(h, branch.id, '30-day shoot');
    expect(renamed.branches[1]!.name).toBe('30-day shoot');
    expect(renameBranch(h, branch.id, '25-day Shoot').branches[1]!.name).toBe('25-day Shoot');
    expect(() => renameBranch(h, MAIN_BRANCH, 'X')).toThrow(/Rename the budget/);
  });

  it('undoes on a branch only back to its latest version or its start', () => {
    const { h: main, v11 } = mainLine();
    let h = undo(main);
    expect(currentBudget(h).name).toBe('Pilot A'); // v1.1
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(activeBranch(h).head).toBe(h.entries[h.current]!.id);

    h = createBranch(h, 'Alt', v11.entryId).history;
    expect(canUndo(h)).toBe(false); // nothing on it yet
    h = edit(h, 'C');
    h = undo(h);
    expect(h.entries[h.current]!.id).toBe(v11.entryId);
    expect(isEditable(h)).toBe(true);
    expect(canUndo(h)).toBe(false);
    // A change after an undo replaces the undone one, which stays in the history.
    h = edit(h, 'D');
    expect(branchLine(h, h.branch).map((e) => e.label)).toEqual(['D']);
    expect(h.entries.some((e) => e.label === 'C')).toBe(true);
    // The main line's end didn't move.
    expect(currentBudget(openBranch(h, MAIN_BRANCH)).name).toBe('Pilot B');
  });

  it('marks a branch not picked and back, keeping it', () => {
    const { h: main, v10 } = mainLine();
    const { history: h, branch } = createBranch(main, 'Alt', v10.entryId);
    const off = setNotPicked(h, branch.id, true);
    expect(off.branches).toHaveLength(2);
    expect(off.branches[1]!.notPicked).toBe(true);
    expect(setNotPicked(off, branch.id, false).branches[1]!.notPicked).toBe(false);
    expect(() => setNotPicked(h, 'nope', true)).toThrow(/not in this budget/);
  });
});
