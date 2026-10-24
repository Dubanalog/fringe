import { describe, expect, it } from 'vitest';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import { calculateTotals } from './calc';
import { buildReports, cellText, reportHtml } from './reports';

function line(id: string, amount: string, rate: string, extra: Partial<DetailLine> = {}): DetailLine {
  return {
    id,
    description: id,
    amount,
    unit: 'Weeks',
    x: '1',
    rate,
    currency: '',
    subtotal: (Number(amount) * Number(rate)).toString(),
    fringes: ['FICA'],
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
    ...extra,
  };
}

const budget: Budget = {
  id: 'b',
  name: 'night-shift',
  settings: {
    ...DEFAULT_BUDGET_SETTINGS,
    title: 'Night Shift',
    assumptions: '<p>22 weeks</p>',
    fringeDefs: [
      { name: 'FICA', kind: 'percent', rate: '10', unit: '', cutoff: '1500', cutoffInferred: false },
    ],
    codes: { ...DEFAULT_BUDGET_SETTINGS.codes, set: ['Diner'] },
  },
  categories: [
    {
      id: 'c',
      number: '1100',
      description: 'Writers',
      imported: null,
      accounts: [
        {
          id: 'a',
          number: '1101',
          description: 'Writer',
          imported: null,
          details: [line('l1', '1', '1000', { set: 'Diner' }), line('l2', '1', '1000')],
          postedFringes: [],
          fringeRanges: [{ id: 'r', lineIds: ['l1', 'l2'] }],
        },
        {
          id: 'z',
          number: '1102',
          description: 'Nobody',
          imported: null,
          details: [],
          postedFringes: [],
          fringeRanges: [],
        },
      ],
    },
  ],
};

const all = { hideZero: false, levels: [], fringeDetail: true };

describe('reports', () => {
  it('builds the topsheet with the budget title', () => {
    const doc = buildReports(budget, { ...all, reports: ['topsheet'] });
    expect(doc.title).toBe('Night Shift');
    const table = doc.sections[0]!.blocks[0]!;
    if (table.kind !== 'table') throw new Error('table');
    expect(table.rows.at(-1)).toEqual({ cells: ['', 'Grand Total', '2150'], style: 'grand' });
  });

  it('shows lines, fringes added up and totals in the detail', () => {
    const doc = buildReports(budget, { ...all, reports: ['detail'] });
    const table = doc.sections[0]!.blocks[0]!;
    if (table.kind !== 'table') throw new Error('table');
    const text = table.rows.map((r) =>
      r.cells.map((c, i) => cellText(c, table.columns[i]!, 'cents')).join('|'),
    );
    expect(text).toContain('|FICA 10% of 1,500.00 (1 person at the 1,500.00 cutoff)|||||150.00|');
    expect(text).toContain('|Total 1101||||||2,150.00');
    expect(text).toContain('1102|Nobody||||||');
    const hidden = buildReports(budget, { ...all, hideZero: true, reports: ['detail'] });
    const rows = (hidden.sections[0]!.blocks[0] as { rows: { cells: unknown[] }[] }).rows;
    expect(rows.some((r) => r.cells[0] === '1102')).toBe(false);
  });

  const textOf = (b: Budget, report: 'summary' | 'detail', fringeDetail = true) => {
    const table = buildReports(b, { ...all, fringeDetail, reports: [report] }).sections[0]!.blocks[0]!;
    if (table.kind !== 'table') throw new Error('table');
    return table.rows.map((r) => r.cells.map((c, i) => cellText(c, table.columns[i]!, 'cents')).join('|'));
  };
  const posting = (p: 'production-level' | 'budget'): Budget => ({
    ...budget,
    settings: { ...budget.settings, fringes: { ...budget.settings.fringes, posting: p } },
  });

  it('shows one Fringes line instead, without the detail', () => {
    const text = textOf(budget, 'detail', false);
    expect(text).toContain('|Fringes|||||150.00|');
    expect(text.some((r) => r.includes('FICA'))).toBe(false);
    expect(textOf(posting('production-level'), 'detail', false)).toContain(
      '|Above-The-Line Fringes||||||150.00',
    );
  });

  it('shows fringes posted to the topsheet in the summary and detail, so they add up', () => {
    for (const p of ['production-level', 'budget'] as const) {
      const name = p === 'budget' ? 'Total Fringes' : 'Above-The-Line Fringes';
      const summary = textOf(posting(p), 'summary');
      expect(summary).toContain(`|${name}|150.00|150.00`);
      expect(summary.at(-1)).toBe('|Total||2,150.00');
      const detail = textOf(posting(p), 'detail');
      expect(detail).toContain(`|${name}||||||`);
      expect(detail).toContain('|FICA 10% of 1,500.00 (1 person at the 1,500.00 cutoff)|||||150.00|');
      expect(detail).toContain(`|Total ${name.replace(/^Total /, '')}||||||150.00`);
      expect(detail.at(-1)).toBe('|Total||||||2,150.00');
    }
  });

  it('adds up fringes over the cutoff, and sets', () => {
    const doc = buildReports(budget, { ...all, reports: ['fringes', 'sets'] });
    const [fringes, sets] = doc.sections.map((s) => s.blocks[0] as { rows: { cells: unknown[] }[] });
    expect(fringes!.rows[0]!.cells).toEqual([
      'FICA',
      'Percent',
      { value: '10', kind: 'percent' },
      { value: '1500', kind: 'money' },
      { value: '1500', kind: 'money' },
      '150',
    ]);
    expect(sets!.rows.map((r) => r.cells[0])).toEqual(['Diner', 'No set']);
  });

  it('prints assumptions and leaves out empty reports', () => {
    const doc = buildReports(budget, { ...all, reports: ['globals', 'assumptions'] });
    expect(doc.sections.map((s) => s.id)).toEqual(['assumptions']);
    expect(reportHtml(doc)).toContain('<div class="assumptions"><p>22 weeks</p></div>');
  });
});

describe('tax incentives', () => {
  // Line l1 qualifies: 1,000 plus its 100 of FICA. 30% is 330; received at 80% that's 264.
  const withCredit = (placement: 'net' | 'grand-total'): Budget => ({
    ...budget,
    settings: {
      ...budget.settings,
      groups: ['GA'],
      incentives: [{ id: 'i', name: 'GA Credit', rate: '30', groups: ['GA'], realized: '80' }],
      incentivePlacement: placement,
    },
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => (d.id === 'l1' ? { ...d, groups: ['GA'] } : d)),
      })),
    })),
  });

  it('works out the credit on the qualifying groups, at the share received', () => {
    const t = calculateTotals(withCredit('net'));
    expect(t.incentives[0]).toMatchObject({ base: '1100', credit: '330', amount: '-264' });
    expect(t.grand.total).toBe('2150');
    expect(t.net).toBe('1886');
  });

  it('shows the credit under the grand total, or takes it off the grand total', () => {
    const rows = (b: Budget) => {
      const table = buildReports(b, { ...all, reports: ['topsheet'] }).sections[0]!.blocks[0]!;
      if (table.kind !== 'table') throw new Error('table');
      return table.rows.slice(-3).map((r) => r.cells.slice(1));
    };
    expect(rows(withCredit('net'))).toEqual([
      ['Grand Total', '2150'],
      ['Less: GA Credit 30% (at 80%)', '-264'],
      ['Net Cost', '1886'],
    ]);
    const inTotal = calculateTotals(withCredit('grand-total'));
    expect(inTotal.grand.total).toBe('1886');
    expect(inTotal.net).toBe('1886');
    expect(rows(withCredit('grand-total')).slice(-2)).toEqual([
      ['Less: GA Credit 30% (at 80%)', '-264'],
      ['Grand Total', '1886'],
    ]);
  });
});
