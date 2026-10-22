import { describe, expect, it } from 'vitest';
import { addGlobal, updateGlobal } from './calc';
import { describeChange, grandTotal } from './changes';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';

const line = (id: string, description: string, rate: string): DetailLine => ({
  id,
  description,
  amount: '1',
  unit: 'Weeks',
  x: '1',
  rate,
  currency: '',
  subtotal: rate,
  fringes: [],
  groups: [],
  globalsUsed: [],
  location: '',
  set: '',
  in: '',
  ff1: '',
  ff2: '',
  formulas: {},
  formulasInferred: false,
  importedFringePercent: null,
});

function budget(): Budget {
  return {
    id: 'b',
    name: 'Pilot',
    settings: DEFAULT_BUDGET_SETTINGS,
    categories: [
      {
        id: 'c',
        number: '1100',
        description: 'WRITING',
        imported: null,
        accounts: [
          {
            id: 'a',
            number: '1102',
            description: 'WRITERS',
            imported: null,
            details: [line('l1', 'Writer', '100'), line('l2', 'Editor', '50')],
            postedFringes: [],
            fringeRanges: [],
          },
        ],
      },
    ],
  };
}

/** The budget with its one account's lines replaced. */
function withLines(b: Budget, details: DetailLine[]): Budget {
  const c = b.categories[0]!;
  return { ...b, categories: [{ ...c, accounts: [{ ...c.accounts[0]!, details }] }] };
}

describe('describeChange', () => {
  it('names nothing for the first entry or an unchanged budget', () => {
    const b = budget();
    expect(describeChange(null, b)).toEqual([]);
    expect(describeChange(b, b)).toEqual([]);
  });

  it('lists each field changed on a line, with where and from → to', () => {
    const b = budget();
    const [w, e] = b.categories[0]!.accounts[0]!.details;
    const after = withLines(b, [{ ...w!, rate: '120', subtotal: '120' }, e!]);
    expect(describeChange(b, after)).toEqual([
      { where: '1102 line 1 (Writer)', what: 'Rate', from: '100', to: '120' },
      { where: '1102 line 1 (Writer)', what: 'Subtotal', from: '100', to: '120' },
    ]);
  });

  it('notices lines added, deleted and moved', () => {
    const b = budget();
    const [w, e] = b.categories[0]!.accounts[0]!.details;
    expect(describeChange(b, withLines(b, [w!, e!, line('l3', 'PA', '10')]))).toEqual([
      { where: '1102 line 3 (PA)', what: 'Line added' },
    ]);
    expect(describeChange(b, withLines(b, [w!]))).toEqual([
      { where: '1102 line 2 (Editor)', what: 'Line deleted' },
    ]);
    expect(describeChange(b, withLines(b, [e!, w!]))).toEqual([
      { where: '1102 WRITERS', what: 'Lines reordered' },
    ]);
  });

  it('describes globals added, changed and renamed', () => {
    const b = addGlobal(budget(), { name: 'SW', value: '22', description: 'Shoot weeks' });
    expect(describeChange(budget(), b)).toEqual([{ where: 'Global SW', what: 'Added' }]);
    expect(describeChange(b, updateGlobal(b, 'SW', { value: '24' }))).toEqual([
      { where: 'Global SW', what: 'Value', from: '22', to: '24' },
    ]);
    expect(describeChange(b, updateGlobal(b, 'SW', { name: 'SHOOT' }))).toEqual([
      { where: 'Global SHOOT', what: 'Renamed', from: 'SW', to: 'SHOOT' },
    ]);
  });

  it('works out the grand total', () => {
    expect(grandTotal(budget())).toBe('150');
  });
});
