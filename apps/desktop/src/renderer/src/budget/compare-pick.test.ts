import type { BudgetVersion } from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { comparePick, versionBefore } from './compare-pick';

const v = (id: string, number: string): BudgetVersion => ({
  id,
  number,
  name: '',
  entryId: id,
  branch: 'main',
  savedAt: '2026-11-01T00:00:00Z',
  sentOn: '',
  sentTo: '',
  notes: '',
  changes: '',
  pdf: null,
});
// Saved out of order, to check they're sorted by number.
const versions = [v('b', '2.0'), v('a', '1.0'), v('c', '2.1')];
const ids = (p: ReturnType<typeof comparePick>) => [p.since?.id ?? null, p.until?.id ?? null];

describe('picking what the Changes report compares', () => {
  it('compares the latest version with now by default', () => {
    expect(ids(comparePick(versions, null, null))).toEqual(['c', null]);
  });

  it('compares a version with the one before it', () => {
    expect(ids(comparePick(versions, null, 'b'))).toEqual(['a', 'b']);
    expect(ids(comparePick(versions, null, 'a'))).toEqual([null, 'a']);
  });

  it('compares any two the user picks', () => {
    expect(ids(comparePick(versions, 'a', 'c'))).toEqual(['a', 'c']);
    expect(ids(comparePick(versions, 'a', null))).toEqual(['a', null]);
  });

  it('falls back when a picked version was deleted', () => {
    expect(ids(comparePick(versions, 'gone', 'gone'))).toEqual(['c', null]);
  });

  it('finds the version before', () => {
    expect(versionBefore(versions, versions[0]!)?.id).toBe('a');
    expect(versionBefore(versions, versions[1]!)).toBeNull();
  });
});
