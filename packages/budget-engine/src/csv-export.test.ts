import { describe, expect, it } from 'vitest';
import { budgetCsv, budgetCsvRows } from './csv-export';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import { sum } from './money';
import { setIncentive, setPercentage } from './percentages';

const line = (id: string, rate: string, groups: string[] = []): DetailLine => ({
  id,
  description: id,
  amount: '1',
  unit: 'Weeks',
  x: '1',
  rate,
  currency: '',
  subtotal: rate,
  fringes: ['FICA'],
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

/** Two categories, one account each, with FICA 10% on every line. */
function budget(): Budget {
  const account = (id: string, number: string, description: string, details: DetailLine[]) => ({
    id,
    number,
    description,
    imported: null,
    details,
    postedFringes: [],
    fringeRanges: [],
  });
  return {
    id: 'b',
    name: 'Pilot',
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      groups: ['SHOOT'],
      fringeDefs: [
        { name: 'FICA', kind: 'percent', rate: '10', unit: '', cutoff: null, cutoffInferred: false },
      ],
    },
    categories: [
      {
        id: 'c1',
        number: '1100',
        description: 'WRITERS',
        imported: null,
        accounts: [account('a1', '1101', 'Story, "first draft"', [line('l1', '1000')])],
      },
      {
        id: 'c2',
        number: '2000',
        description: 'CAMERA',
        imported: null,
        accounts: [account('a2', '2001', 'Camera rentals', [line('l2', '500.5', ['SHOOT'])])],
      },
    ],
  };
}

describe('budget CSV', () => {
  it('lists every account with its total, then the topsheet', () => {
    let b = setPercentage(budget(), { name: 'Contingency', percent: '10', excludeGroups: [] });
    b = setIncentive(b, { name: 'Credit', rate: '20', groups: ['SHOOT'], realized: '100' });
    const rows = budgetCsvRows(b).map((r) => [r.type, r.account, r.description, r.total]);
    expect(rows).toEqual([
      ['Category', '1100', 'WRITERS', '1100'],
      ['Account', '1101', 'Story, "first draft"', '1100'],
      ['Total', '', 'Total Above-The-Line', '1100'],
      ['Category', '2000', 'CAMERA', '550.55'],
      ['Account', '2001', 'Camera rentals', '550.55'],
      ['Total', '', 'Total Below-The-Line', '550.55'],
      ['Total', '', 'Total before percentages', '1650.55'],
      ['Percentage', '', 'Contingency 10%', '165.06'],
      ['Total', '', 'Grand Total', '1815.61'],
      ['Incentive', '', 'Less: Credit 20%', '-110.11'],
      ['Total', '', 'Net Cost', '1705.5'],
    ]);
    // The rows that aren't sums of others add up to the net cost.
    const parts = budgetCsvRows(b).filter((r) => r.type !== 'Category' && r.type !== 'Total');
    expect(sum(parts.map((r) => r.total)).toFixed()).toBe('1705.5');
  });

  it('puts fringes posted to the topsheet on their own rows', () => {
    const b0 = budget();
    const b = {
      ...b0,
      settings: {
        ...b0.settings,
        fringes: { ...b0.settings.fringes, posting: 'budget' as const, budgetAccount: '9900' },
      },
    };
    const rows = budgetCsvRows(b);
    expect(rows.filter((r) => r.type === 'Account').map((r) => r.total)).toEqual(['1000', '500.5']);
    expect(rows.find((r) => r.type === 'Fringes')).toEqual({
      account: '9900',
      description: 'Total Fringes',
      total: '150.05',
      type: 'Fringes',
    });
  });

  it('writes plain figures, quoting only what needs it', () => {
    const csv = budgetCsv(budget());
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      'Account,Description,Total,Type',
      '1100,WRITERS,1100.00,Category',
      '1101,"Story, ""first draft""",1100.00,Account',
    ]);
    expect(csv.endsWith('Grand Total,1650.55,Total\r\n')).toBe(true);
  });
});
