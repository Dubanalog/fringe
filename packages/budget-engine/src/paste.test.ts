import { describe, expect, it } from 'vitest';
import { type Budget, DEFAULT_BUDGET_SETTINGS } from './model';
import { insertDetail } from './edit';
import { type PasteColumn, parseClipboardTable, pasteLines, pastedNumber, toClipboardTable } from './paste';

const empty: Budget = {
  id: 'b',
  name: 'b',
  settings: {
    ...DEFAULT_BUDGET_SETTINGS,
    globals: [{ name: 'SW', value: '10', description: '', inferred: false }],
  },
  categories: [
    {
      id: 'c',
      number: '1100',
      description: '',
      imported: null,
      accounts: [
        {
          id: 'a',
          number: '1101',
          description: '',
          imported: null,
          details: [],
          postedFringes: [],
          fringeRanges: [],
        },
      ],
    },
  ],
};

const lines = (b: Budget) => b.categories[0]!.accounts[0]!.details;

const COLUMNS: PasteColumn[] = [
  { label: 'Description', field: 'description' },
  { label: 'Amount', numeric: 'amount' },
  { label: 'Unit', field: 'unit' },
  { label: 'X', numeric: 'x' },
  { label: 'Rate', numeric: 'rate' },
  { label: 'Subtotal' },
];

describe('clipboard tables', () => {
  it('reads what a spreadsheet copies', () => {
    expect(parseClipboardTable('Gaffer\t176\tDays\r\nBest boy\t44\t"Weeks\t40"\r\n')).toEqual([
      ['Gaffer', '176', 'Days'],
      ['Best boy', '44', 'Weeks\t40'],
    ]);
    expect(parseClipboardTable('"Say ""hi""\nthere"\t1')).toEqual([['Say "hi"\nthere', '1']]);
    expect(parseClipboardTable('a\t\tb')).toEqual([['a', '', 'b']]);
  });

  it('writes cells back the same way', () => {
    const rows = [
      ['Gaffer', '1,000.00', ''],
      ['Say "hi"', 'two\nlines', 'tab\there'],
    ];
    expect(parseClipboardTable(toClipboardTable(rows))).toEqual(rows);
  });

  it('cleans up numbers as spreadsheets show them', () => {
    expect(pastedNumber('$1,234.50')).toBe('1234.50');
    expect(pastedNumber('(500)')).toBe('-500');
    expect(pastedNumber(' -$75 ')).toBe('-75');
    expect(pastedNumber('.5')).toBe('0.5');
    expect(pastedNumber('SW*5')).toBe('SW*5');
    expect(pastedNumber('1,23')).toBe('1,23');
    expect(pastedNumber('')).toBe('');
  });
});

describe('pasting lines', () => {
  it('adds lines past the end and works out their subtotals', () => {
    const rows = parseClipboardTable('Gaffer\t176\tDays\t11\t$80.00\t999\r\nBest boy\t44\tWeeks\t\tSW*5\r\n');
    const r = pasteLines(empty, 'a', undefined, COLUMNS, rows);
    expect(r.refused).toEqual([]);
    const [a, b] = lines(r.budget);
    expect([a!.description, a!.amount, a!.unit, a!.x, a!.rate, a!.subtotal]).toEqual([
      'Gaffer',
      '176',
      'Days',
      '11',
      '80',
      '154880',
    ]);
    expect([b!.x, b!.rate, b!.subtotal, b!.formulas.rate]).toEqual(['1', '50', '2200', 'SW*5']);
    expect(r.lineIds).toEqual([a!.id, b!.id]);
  });

  it('fills existing lines from the one given, then adds the rest', () => {
    const one = insertDetail(empty, 'a', { position: 'after' });
    const two = insertDetail(one.budget, 'a', { siblingId: one.id, position: 'after' });
    // Pasting two cells starting at Amount of the second line.
    const r = pasteLines(two.budget, 'a', two.id, COLUMNS.slice(1), [['3'], ['4', 'Days']]);
    expect(lines(r.budget).map((d) => [d.amount, d.unit])).toEqual([
      ['0', ''],
      ['3', ''],
      ['4', 'Days'],
    ]);
  });

  it('leaves out cells that won’t go in and says which', () => {
    const r = pasteLines(empty, 'a', undefined, COLUMNS, [['Grip', '2', '', '', 'lots']]);
    expect(r.refused).toEqual(['Rate "lots" on line 1']);
    expect(lines(r.budget)[0]!.amount).toBe('2');
  });
});
