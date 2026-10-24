import { describe, expect, it } from 'vitest';
import { calculateTotals } from './calc';
import { fringeBreakdown, fringeSourceAccounts } from './fringe-breakdown';
import { type Account, type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';

function line(id: string, amount: string, rate: string, fringes: string[]): DetailLine {
  return {
    id,
    description: id,
    amount,
    unit: 'Weeks',
    x: '1',
    rate,
    currency: '',
    subtotal: (Number(amount) * Number(rate)).toString(),
    fringes,
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
  };
}

const account = (id: string, number: string, details: DetailLine[]): Account => ({
  id,
  number,
  description: '',
  imported: null,
  details,
  postedFringes: [],
  fringeRanges: [],
});

// Two producers on 1101 and 1102, each well over a 7,000 cutoff, posting to 1199.
const budget: Budget = {
  id: 'b',
  name: 'b',
  settings: {
    ...DEFAULT_BUDGET_SETTINGS,
    fringes: { ...DEFAULT_BUDGET_SETTINGS.fringes, posting: 'category', categoryAccountSuffix: '99' },
    fringeDefs: [
      { name: 'Payroll', kind: 'percent', rate: '9.5', unit: '', cutoff: null, cutoffInferred: false },
      { name: 'SUI', kind: 'percent', rate: '3', unit: '', cutoff: '7000', cutoffInferred: false },
      { name: 'HW', kind: 'flat', rate: '500', unit: 'Weeks', cutoff: null, cutoffInferred: false },
    ],
  },
  categories: [
    {
      id: 'c',
      number: '1100',
      description: '',
      imported: null,
      accounts: [
        account('a1', '1101', [line('l1', '8', '16000', ['Payroll', 'SUI', 'HW'])]),
        account('a2', '1102', [line('l2', '20', '6500', ['SUI', 'Payroll'])]),
        account('a9', '1199', []),
      ],
    },
  ],
};

describe('fringeBreakdown', () => {
  it('adds up what posts to a fringe account, with rate, base and cutoffs', () => {
    const totals = calculateTotals(budget);
    const sources = fringeSourceAccounts(budget, totals, 'a9');
    expect(sources.map((a) => a.number)).toEqual(['1101', '1102', '1199']);
    const rows = fringeBreakdown(budget, totals, sources);
    expect(rows).toEqual([
      {
        name: 'Payroll',
        kind: 'percent',
        rate: '9.5',
        unit: '',
        cutoff: null,
        base: '258000',
        pay: '258000',
        people: 2,
        capped: 0,
        amount: '24510',
      },
      // 3% of 14,000: two people at the 7,000 cutoff.
      {
        name: 'SUI',
        kind: 'percent',
        rate: '3',
        unit: '',
        cutoff: '7000',
        base: '14000',
        pay: '258000',
        people: 2,
        capped: 2,
        amount: '420',
      },
      {
        name: 'HW',
        kind: 'flat',
        rate: '500',
        unit: 'Weeks',
        cutoff: null,
        base: '8',
        pay: '128000',
        people: 1,
        capped: 0,
        amount: '4000',
      },
    ]);
    // It's what the account's Fringes come to.
    expect(totals.accounts.get('a9')?.fringe).toBe('28930');
  });

  it("is an account's own lines when each account keeps its fringes", () => {
    const own = {
      ...budget,
      settings: { ...budget.settings, fringes: { ...budget.settings.fringes, posting: 'account' as const } },
    };
    const totals = calculateTotals(own);
    expect(fringeSourceAccounts(own, totals, 'a9')).toEqual([own.categories[0]!.accounts[2]]);
    const rows = fringeBreakdown(own, totals, fringeSourceAccounts(own, totals, 'a2'));
    expect(rows.map((r) => [r.name, r.base, r.amount])).toEqual([
      ['Payroll', '130000', '12350'],
      ['SUI', '7000', '210'],
    ]);
  });
});
