import { describe, expect, it } from 'vitest';
import {
  EditError,
  applyTextEdit,
  deleteRow,
  insertAccount,
  insertCategory,
  insertDetail,
  suggestNumber,
} from './edit';
import { topsheet } from './topsheet';
import { formatMoney } from './format';
import { DEFAULT_BUDGET_SETTINGS, type Account, type Budget, type DetailLine, newId } from './model';

function line(): DetailLine {
  return {
    id: newId(),
    description: 'WRITER',
    amount: '1',
    unit: 'Weeks',
    x: '1',
    rate: '100',
    currency: '',
    subtotal: '100',
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
  };
}

function account(number: string, description: string, details: DetailLine[] = []): Account {
  return { id: newId(), number, description, imported: null, details, postedFringes: [], fringeRanges: [] };
}

/** Writing (1102 with one line of 100, 1199) and Producers (1201, 1299). */
function pilot(): Budget {
  return {
    id: newId(),
    name: 'Pilot',
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      coa: { ...DEFAULT_BUDGET_SETTINGS.coa, categoryPattern: '####', accountPattern: '####' },
    },
    categories: [
      {
        id: newId(),
        number: '1100',
        description: 'WRITING',
        imported: null,
        accounts: [account('1102', 'WRITERS', [line()]), account('1199', 'Total Fringes')],
      },
      {
        id: newId(),
        number: '1200',
        description: 'PRODUCERS',
        imported: null,
        accounts: [account('1201', 'EP'), account('1299', 'Total Fringes')],
      },
    ],
  };
}

describe('applyTextEdit', () => {
  const budget = pilot();
  const writers = budget.categories[0]!.accounts[0]!;

  it('renames without changing the original budget', () => {
    const next = applyTextEdit(budget, {
      kind: 'account',
      id: writers.id,
      field: 'description',
      value: 'STORY',
    });
    expect(next.categories[0]!.accounts[0]!.description).toBe('STORY');
    expect(writers.description).toBe('WRITERS');
  });

  it('renumbers an account', () => {
    const next = applyTextEdit(budget, { kind: 'account', id: writers.id, field: 'number', value: ' 1103 ' });
    expect(next.categories[0]!.accounts[0]!.number).toBe('1103');
  });

  it('rejects duplicate, empty and wrongly sized numbers', () => {
    const edit = (value: string) => () =>
      applyTextEdit(budget, { kind: 'account', id: writers.id, field: 'number', value });
    expect(edit('1201')).toThrow(/already exists/);
    expect(edit('')).toThrow(EditError);
    expect(edit('110')).toThrow(/look like ####/);
  });
});

describe('formatMoney', () => {
  it('shows cents or whole dollars, rounding ties away from zero', () => {
    expect(formatMoney('1234567.125', 'cents')).toBe('1,234,567.13');
    expect(formatMoney('1234567.5', 'dollars')).toBe('1,234,568');
    expect(formatMoney('-0.4', 'dollars')).toBe('0');
    expect(formatMoney('-4532.7', 'dollars')).toBe('-4,533');
    expect(formatMoney('0', 'cents')).toBe('0.00');
  });
});

describe('inserting and deleting rows', () => {
  const budget = pilot();
  const writing = budget.categories[0]!;

  it('suggests numbers between neighbours', () => {
    expect(suggestNumber('1100', '1200', new Set(), '####')).toBe('1110');
    expect(suggestNumber('1500', '2000', new Set(), '####')).toBe('1600');
    expect(suggestNumber('1100', '1102', new Set(['1101']), '####')).toBe('');
    expect(suggestNumber(undefined, '1100', new Set(), '####')).toBe('1000');
  });

  it('inserts a category after the selected one', () => {
    const { budget: next, id } = insertCategory(budget, { siblingId: writing.id, position: 'after' });
    expect(next.categories.map((c) => c.number)).toEqual(['1100', '1110', '1200']);
    expect(next.categories[1]!.id).toBe(id);
  });

  it('keeps a new account inside its category range', () => {
    const [writers, fringes] = writing.accounts;
    const after = (id: string) =>
      insertAccount(budget, writing.id, { siblingId: id, position: 'after' }).budget.categories[0]!.accounts;
    expect(after(writers!.id)[1]!.number).toBe('1110');
    // Nothing fits between 1199 and the next category (1200): left blank for the user to fill in.
    expect(after(fringes!.id)[2]!.number).toBe('');
  });

  it('inserts blank detail lines and deletes rows', () => {
    const writers = writing.accounts[0]!;
    const { budget: next, id } = insertDetail(budget, writers.id, {
      position: 'before',
      siblingId: writers.details[0]!.id,
    });
    expect(next.categories[0]!.accounts[0]!.details[0]!.id).toBe(id);
    expect(deleteRow(next, 'detail', id).categories[0]!.accounts[0]!.details).toHaveLength(1);
    expect(deleteRow(budget, 'category', writing.id).categories).toHaveLength(1);
  });
});

describe('topsheet', () => {
  it('groups categories into production levels with totals', () => {
    const base = pilot();
    const withTotals = {
      ...base,
      categories: base.categories.map((c, i) => ({
        ...c,
        number: ['1100', '6100'][i]!,
        imported: { fringe: '1', original: '10', total: '10.5', variance: '0.5' },
      })),
    };
    const { rows, grandTotal } = topsheet(withTotals);
    expect(
      rows.map((r) =>
        r.kind === 'level' ? `Total ${r.level.name}` : r.kind === 'category' ? r.category.number : 'fringes',
      ),
    ).toEqual(['1100', 'Total Above-The-Line', '6100', 'Total Post Production']);
    // Calculated from the lines (one line of 100), not the imported 10.5 per category.
    expect(grandTotal).toMatchObject({ total: '100', original: '20', variance: '80' });
  });
});
