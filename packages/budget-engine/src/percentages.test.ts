import { describe, expect, it } from 'vitest';
import { calculateTotals, groupTotals } from './calc';
import { EditError } from './edit';
import { deleteLineTag, renameLineTag } from './lines';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import {
  deletePercentage,
  movePercentage,
  percentageLabel,
  setIncentive,
  setPercentage,
} from './percentages';
import { topsheet } from './topsheet';

const line = (id: string, rate: string, groups: string[]): DetailLine => ({
  id,
  description: id,
  amount: '1',
  unit: 'Weeks',
  x: '1',
  rate,
  currency: '',
  subtotal: rate,
  fringes: [],
  groups,
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

/** $1,000 of lines: 600 SHOOT, 300 POST, 100 in both. */
function budget(): Budget {
  return {
    id: 'b',
    name: 'Pilot',
    settings: { ...DEFAULT_BUDGET_SETTINGS, groups: ['SHOOT', 'POST'] },
    categories: [
      {
        id: 'c',
        number: '1100',
        description: 'CREW',
        imported: null,
        accounts: [
          {
            id: 'a',
            number: '1102',
            description: 'CREW',
            imported: null,
            details: [
              line('l1', '600', ['SHOOT']),
              line('l2', '300', ['POST']),
              line('l3', '100', ['SHOOT', 'POST']),
            ],
            postedFringes: [],
            fringeRanges: [],
          },
        ],
      },
    ],
  };
}

const amounts = (b: Budget) =>
  calculateTotals(b).percentages.map((p) => [p.percentage.name, p.base, p.amount]);

describe('percentages', () => {
  it('works each out from the categories total and adds it to the grand total', () => {
    const b = setPercentage(budget(), { name: 'Contingency', percent: '10%', excludeGroups: [] });
    const totals = calculateTotals(b);
    expect(amounts(b)).toEqual([['Contingency', '1000', '100']]);
    expect(totals.categoriesTotal.total).toBe('1000');
    expect(totals.grand.total).toBe('1100');
  });

  it('leaves out lines in an excluded group, counting a line in two groups once', () => {
    const b = setPercentage(budget(), { name: 'Contingency', percent: '10', excludeGroups: ['POST'] });
    expect(amounts(b)).toEqual([['Contingency', '600', '60']]);
    const both = setPercentage(b, { ...b.settings.percentages[0]!, excludeGroups: ['POST', 'SHOOT'] });
    expect(amounts(both)).toEqual([['Contingency', '0', '0']]);
  });

  it('takes a credit off with a negative percent, and does not compound', () => {
    let b = setPercentage(budget(), { name: 'Contingency', percent: '10', excludeGroups: [] });
    b = setPercentage(b, { name: 'Tax credit', percent: '-25', excludeGroups: [] });
    expect(amounts(b)).toEqual([
      ['Contingency', '1000', '100'],
      ['Tax credit', '1000', '-250'],
    ]);
    expect(calculateTotals(b).grand.total).toBe('850');
    const sheet = topsheet(b);
    expect(sheet.grandTotal.total).toBe('850');
    expect(sheet.categoriesTotal.total).toBe('1000');
  });

  it('can leave out a group that so far is only on lines, adding it to the groups', () => {
    const b0 = budget();
    const b1 = { ...b0, settings: { ...b0.settings, groups: ['SHOOT'] } };
    const b = setPercentage(b1, { name: 'Contingency', percent: '10', excludeGroups: ['POST'] });
    expect(b.settings.groups).toEqual(['SHOOT', 'POST']);
    expect(amounts(b)).toEqual([['Contingency', '600', '60']]);
  });

  it('checks names, percents and groups', () => {
    const b = setPercentage(budget(), { name: 'Contingency', percent: '10', excludeGroups: [] });
    expect(() => setPercentage(b, { name: ' ', percent: '10', excludeGroups: [] })).toThrow(EditError);
    expect(() => setPercentage(b, { name: 'Fee', percent: 'ten', excludeGroups: [] })).toThrow(EditError);
    expect(() => setPercentage(b, { name: 'contingency', percent: '5', excludeGroups: [] })).toThrow(
      /already/,
    );
    expect(() => setPercentage(b, { name: 'Fee', percent: '5', excludeGroups: ['DARK'] })).toThrow(/DARK/);
  });

  it('numbers them like categories, once each on the topsheet', () => {
    const b0 = budget();
    const b1 = { ...b0, settings: { ...b0.settings, coa: { ...b0.settings.coa, categoryPattern: '####' } } };
    const fee = (account: string, b = b1) =>
      setPercentage(b, { name: 'Fee', percent: '5', excludeGroups: [], account });
    expect(fee('9000').settings.percentages[0]!.account).toBe('9000');
    expect(() => fee('free')).toThrow(/Category numbers look like ####/);
    expect(() => fee('900')).toThrow(/####/);
    expect(() => fee('1100')).toThrow(/already used/);
    const b2 = fee('9000');
    expect(() =>
      setPercentage(b2, { name: 'Contingency', percent: '10', excludeGroups: [], account: '9000' }),
    ).toThrow(/already used/);
    const p = b2.settings.percentages[0]!;
    expect(setPercentage(b2, { ...p, percent: '6' }).settings.percentages[0]!.account).toBe('9000');
  });

  it('follows a group renamed or deleted', () => {
    let b = setPercentage(budget(), { name: 'Contingency', percent: '10', excludeGroups: ['POST'] });
    b = renameLineTag(b, 'groups', 'POST', 'EDIT');
    expect(b.settings.percentages[0]!.excludeGroups).toEqual(['EDIT']);
    expect(percentageLabel(b.settings.percentages[0]!)).toBe('Contingency 10% (less EDIT)');
    b = deleteLineTag(b, 'groups', 'EDIT');
    expect(b.settings.percentages[0]!.excludeGroups).toEqual([]);
  });

  it('moves and deletes', () => {
    let b = setPercentage(budget(), { name: 'A', percent: '1', excludeGroups: [] });
    b = setPercentage(b, { name: 'B', percent: '2', excludeGroups: [] });
    const [a] = b.settings.percentages;
    b = movePercentage(b, a!.id, 1);
    expect(b.settings.percentages.map((p) => p.name)).toEqual(['B', 'A']);
    b = deletePercentage(b, a!.id);
    expect(b.settings.percentages.map((p) => p.name)).toEqual(['B']);
  });
});

describe('groupTotals', () => {
  it('totals each group, a line counting in each of its groups', () => {
    const t = groupTotals(budget()).map((g) => [g.group, g.lines, g.total]);
    expect(t).toEqual([
      ['SHOOT', 2, '700'],
      ['POST', 2, '400'],
    ]);
  });
});

describe('tax incentives', () => {
  /** The pilot with FICA 10% and WC 5% on every line: $1,000 of lines, $150 of fringes. */
  function fringed(): Budget {
    const b = budget();
    const fringeDefs = [
      { name: 'FICA', kind: 'percent' as const, rate: '10', unit: '', cutoff: null, cutoffInferred: false },
      { name: 'WC', kind: 'percent' as const, rate: '5', unit: '', cutoff: null, cutoffInferred: false },
    ];
    const categories = b.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => ({ ...d, fringes: ['FICA', 'WC'] })),
      })),
    }));
    return { ...b, settings: { ...b.settings, fringeDefs }, categories };
  }
  const credit = (b: Budget) => {
    const t = calculateTotals(b).incentives[0]!;
    return [t.base, t.credit, t.amount];
  };
  const add = (b: Budget, more: object = {}) =>
    setIncentive(b, { name: 'Credit', rate: '30', groups: ['SHOOT'], realized: '100', ...more });

  it('counts the qualifying lines with their fringes by default', () => {
    // SHOOT is 700 of lines, 105 of fringes.
    expect(credit(add(fringed()))).toEqual(['805', '241.5', '-241.5']);
  });

  it('can leave fringes out, or only some of them', () => {
    expect(credit(add(fringed(), { includeFringes: false }))).toEqual(['700', '210', '-210']);
    expect(credit(add(fringed(), { excludeFringes: ['WC'] }))).toEqual(['770', '231', '-231']);
    // Left-out fringes don't matter when no fringes count.
    expect(credit(add(fringed(), { includeFringes: false, excludeFringes: ['WC'] }))[0]).toBe('700');
    expect(() => add(fringed(), { excludeFringes: ['DGA'] })).toThrow(/no fringe DGA/);
  });

  it('follows a fringe renamed or deleted', () => {
    let b = add(fringed(), { excludeFringes: ['WC'] });
    b = renameLineTag(b, 'fringes', 'WC', 'Workers Comp');
    expect(b.settings.incentives[0]!.excludeFringes).toEqual(['Workers Comp']);
    b = deleteLineTag(b, 'fringes', 'Workers Comp');
    expect(b.settings.incentives[0]!.excludeFringes).toBeUndefined();
  });
});
