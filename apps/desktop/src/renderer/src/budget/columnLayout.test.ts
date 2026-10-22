import { describe, expect, it } from 'vitest';
import { moveColumn, orderedColumns } from './columnLayout';

const all = ['desc', 'amount', 'rate', 'set'].map((id) => ({ id }));
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

describe('column layout', () => {
  it('uses the default order and hidden set when the budget has none', () => {
    const r = orderedColumns(all, null, ['set']);
    expect(ids(r.columns)).toEqual(['desc', 'amount', 'rate', 'set']);
    expect([...r.hidden]).toEqual(['set']);
  });

  it('keeps a saved order, drops unknown ids and slots in new columns', () => {
    const r = orderedColumns(all, { order: ['rate', 'gone', 'desc', 'set'], hidden: [] }, []);
    // 'amount' is new to this layout: it follows 'desc', its default predecessor.
    expect(ids(r.columns)).toEqual(['rate', 'desc', 'amount', 'set']);
  });

  it('moves a column before another, or to the end', () => {
    expect(moveColumn(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveColumn(['a', 'b', 'c', 'd'], 'a', null)).toEqual(['b', 'c', 'd', 'a']);
  });
});
