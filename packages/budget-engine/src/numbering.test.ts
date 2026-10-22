import { describe, expect, it } from 'vitest';
import { calculateTotals } from './calc';
import { EditError } from './edit';
import { type Account, type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import {
  applyPattern,
  findAccountByNumber,
  fringeAccountMoves,
  renumber,
  setFringeAccountEnding,
  setNumberPatterns,
} from './numbering';

const line = (id: string, rate: string): DetailLine => ({
  id,
  description: id,
  amount: '1',
  unit: '',
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

const account = (number: string, details: DetailLine[] = []): Account => ({
  id: `a${number}`,
  number,
  description: `ACCOUNT ${number}`,
  imported: null,
  details,
  postedFringes: [],
  fringeRanges: [],
});

function budget(): Budget {
  return {
    id: 'b',
    name: 'Pilot',
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      coa: { ...DEFAULT_BUDGET_SETTINGS.coa, categoryPattern: '####', accountPattern: '####' },
      fringes: { posting: 'category', categoryAccountSuffix: '99', budgetAccount: '1199', levelAccounts: {} },
    },
    categories: [
      {
        id: 'c1100',
        number: '1100',
        description: 'WRITING',
        imported: null,
        accounts: [account('1101', [line('l1', '100')]), account('1102'), account('1199')],
      },
      { id: 'c1200', number: '1200', description: 'PRODUCERS', imported: null, accounts: [account('1201')] },
    ],
  };
}

const numbers = (b: Budget) => b.categories.flatMap((c) => [c.number, ...c.accounts.map((a) => a.number)]);

describe('number patterns', () => {
  it('pours digits into a pattern', () => {
    expect(applyPattern('1102', '##-##')).toBe('11-02');
    expect(applyPattern('1102', '## ##')).toBe('11 02');
    expect(applyPattern('110', '##-##')).toBeNull();
  });

  it('reformats every number to a new pattern in one go', () => {
    const { budget: b, left } = setNumberPatterns(budget(), {
      categoryPattern: '##-##',
      accountPattern: '##-##',
    });
    expect(numbers(b)).toEqual(['11-00', '11-01', '11-02', '11-99', '12-00', '12-01']);
    expect(left).toEqual([]);
    expect(b.settings.coa).toMatchObject({ categoryPattern: '##-##', accountPattern: '##-##' });
    // The budget-wide fringe account follows its account.
    expect(b.settings.fringes.budgetAccount).toBe('11-99');
  });

  it('lists numbers that do not fit and leaves them', () => {
    const b = budget();
    const odd = { ...b, settings: { ...b.settings, coa: { ...b.settings.coa, accountPattern: null } } };
    const withOdd: Budget = {
      ...odd,
      categories: [
        { ...odd.categories[0]!, accounts: [...odd.categories[0]!.accounts, account('110')] },
        odd.categories[1]!,
      ],
    };
    const { budget: next, left } = setNumberPatterns(withOdd, { accountPattern: '##-##' });
    expect(left).toEqual(['110']);
    expect(findAccountByNumber(next, '110')).toHaveLength(1);
  });

  it('still posts fringes to the 99 account after reformatting', () => {
    const { budget: b } = setNumberPatterns(budget(), { categoryPattern: '##-##', accountPattern: '##-##' });
    const fringe = calculateTotals(b).fallbackPosting;
    expect(fringe).toBe(false);
  });

  it('finds an account by its digits', () => {
    const { budget: b } = setNumberPatterns(budget(), { accountPattern: '##-##' });
    expect(findAccountByNumber(b, '1102')[0]?.number).toBe('11-02');
  });
});

describe('renumber', () => {
  it('swaps numbers and renames', () => {
    const b = renumber(budget(), [
      { kind: 'account', number: '1101', newNumber: '1102', newDescription: 'WRITER' },
      { kind: 'account', number: '1102', newNumber: '1101' },
    ]);
    const accounts = b.categories[0]!.accounts;
    expect(accounts.map((a) => `${a.id} ${a.number} ${a.description}`)).toEqual([
      'a1101 1102 WRITER',
      'a1102 1101 ACCOUNT 1102',
      'a1199 1199 ACCOUNT 1199',
    ]);
  });

  it('refuses duplicates and numbers that break the pattern', () => {
    expect(() => renumber(budget(), [{ kind: 'account', number: '1101', newNumber: '1102' }])).toThrow(
      EditError,
    );
    expect(() => renumber(budget(), [{ kind: 'category', number: '1100', newNumber: '11-00' }])).toThrow(
      /look like ####/,
    );
  });

  it('moves the budget fringe account along', () => {
    const b = renumber(budget(), [{ kind: 'account', number: '1199', newNumber: '1198' }]);
    expect(b.settings.fringes.budgetAccount).toBe('1198');
  });

  it('moves the fringe accounts to a new ending', () => {
    expect(fringeAccountMoves(budget(), '98')).toEqual([
      { kind: 'account', number: '1199', newNumber: '1198' },
    ]);
    const b = setFringeAccountEnding(budget(), '98');
    expect(numbers(b)).toEqual(['1100', '1101', '1102', '1198', '1200', '1201']);
    expect(b.settings.fringes.categoryAccountSuffix).toBe('98');
    expect(fringeAccountMoves(budget(), '99')).toEqual([]);
  });
});
