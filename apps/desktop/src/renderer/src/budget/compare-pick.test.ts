import {
  type BudgetHistory,
  createBranch,
  goTo,
  newBudget,
  openBranch,
  recordChange,
  saveVersion,
  startHistory,
} from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { compareFrom, fromChoices, showingLabel, showingVersion, sideLabel } from './compare-pick';

const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };

/** Pilot: v1.0, v1.1 and a change since on the main line; "Short" from v1.0 with v1.0 of its own. */
function pilot(): BudgetHistory {
  const start = newBudget('Pilot');
  let h = startHistory(start, 'Opened', 't0');
  h = saveVersion(h, { ...fields, number: '1.0' }, 't1').history;
  const v10 = h.entries[h.current]!.id;
  h = recordChange(h, { ...start, name: 'Pilot 2' }, 'Rename', 't2');
  h = saveVersion(h, { ...fields, number: '1.1' }, 't3').history;
  h = recordChange(h, { ...start, name: 'Pilot 3' }, 'Rename again', 't4');
  h = createBranch(h, 'Short', v10, 't5').history;
  h = recordChange(h, { ...start, name: 'Pilot S' }, 'Shorter', 't6');
  h = saveVersion(h, { ...fields, number: '1.0' }, 't7').history;
  return openBranch(h, 'main');
}

const version = (h: BudgetHistory, number: string, branch = 'main') =>
  h.versions.find(
    (v) => v.number === number && (branch === 'main' ? v.branch === 'main' : v.branch !== 'main'),
  )!;
const label = (h: BudgetHistory, number: string | undefined) => number && `v${number}`;

describe('picking what the Comparison report compares', () => {
  it('compares the latest with the version it came from, and labels it Now', () => {
    const h = pilot();
    expect(showingVersion(h)).toBeNull();
    expect(compareFrom(h, null)?.id).toBe(version(h, '1.1').id);
    expect(showingLabel(h, 'Pilot')).toBe('Now');
  });

  it('compares a version opened with the one before it', () => {
    let h = pilot();
    h = goTo(h, version(h, '1.1').entryId);
    expect(showingVersion(h)?.number).toBe('1.1');
    expect(label(h, compareFrom(h, null)?.number)).toBe('v1.0');
    expect(showingLabel(h, 'Pilot')).toBe('v1.1');
    // The version showing isn't offered to compare with itself.
    expect(fromChoices(h).map((v) => v.id)).not.toContain(version(h, '1.1').id);
    expect(compareFrom(h, version(h, '1.1').id)?.number).toBe('1.0');
  });

  it("starts a branch's comparison from where it came from, and names other branches", () => {
    let h = pilot();
    h = openBranch(h, h.branches.find((b) => b.name === 'Short')!.id);
    const short = version(h, '1.0', 'Short');
    expect(showingVersion(h)?.id).toBe(short.id);
    expect(compareFrom(h, null)?.id).toBe(version(h, '1.0').id);
    expect(sideLabel(h, version(h, '1.1'), 'Pilot')).toBe('Pilot v1.1');
    expect(sideLabel(h, short, 'Pilot')).toBe('v1.0');
    // Versions that led here come first.
    expect(fromChoices(h)[0]!.id).toBe(version(h, '1.0').id);
  });

  it('takes the version picked, and falls back when it was deleted', () => {
    const h = pilot();
    expect(compareFrom(h, version(h, '1.0').id)?.number).toBe('1.0');
    expect(compareFrom(h, 'gone')?.number).toBe('1.1');
  });

  it('labels an earlier point that is not a version', () => {
    let h = pilot();
    const earlier = h.entries[h.current]!.id;
    h = recordChange(h, newBudget('Pilot 4'), 'Rename once more', 't8');
    h = goTo(h, earlier);
    expect(showingLabel(h, 'Pilot')).toBe('This point');
    expect(compareFrom(h, null)?.number).toBe('1.1');
  });
});
