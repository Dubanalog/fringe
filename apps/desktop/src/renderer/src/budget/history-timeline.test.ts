import type { BudgetVersion, HistoryEntry } from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { withVersions } from './history-timeline';

const entry = (id: string, at: string) => ({ id, at }) as HistoryEntry;
const version = (number: string, entryId: string, savedAt: string) =>
  ({ id: `v${number}`, number, entryId, savedAt }) as BudgetVersion;

// Changes a, b, c at 1, 3, 5 (newest first, as the list shows them).
const entries = [entry('c', '5'), entry('b', '3'), entry('a', '1')];
const rows = entries.map((e, n) => ({ e, i: 2 - n }));
const atOf = (id: string) => entries.find((e) => e.id === id)?.at;
const picture = (items: ReturnType<typeof withVersions>) =>
  items.map((x) => (x.kind === 'entry' ? x.e.id : `v${x.version.number}`));

describe('withVersions', () => {
  it('puts each version where it was saved, newest first', () => {
    const v10 = version('1.0', 'a', '2');
    const v11 = version('1.1', 'c', '6');
    expect(picture(withVersions(rows, [v10, v11], atOf, true))).toEqual(['v1.1', 'c', 'b', 'v1.0', 'a']);
  });

  it('keeps a version above its own change, whatever its saved time', () => {
    const v10 = version('1.0', 'b', '0');
    expect(picture(withVersions(rows, [v10], atOf, true))).toEqual(['c', 'v1.0', 'b', 'a']);
  });

  it('leaves out versions older than the changes shown, until they are all shown', () => {
    const v10 = version('1.0', 'a', '2');
    const shown = rows.slice(0, 2);
    expect(picture(withVersions(shown, [v10], atOf, false))).toEqual(['c', 'b']);
    // A version saved before any change on the branch (a branch saved as it started) comes last.
    const v0 = version('0.1', 'elsewhere', '0');
    expect(picture(withVersions(rows, [v0], atOf, true))).toEqual(['c', 'b', 'a', 'v0.1']);
  });
});
