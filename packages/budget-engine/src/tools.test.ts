import { describe, expect, it } from 'vitest';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import { newBudget } from './project';
import { BUDGET_TOOLS, ToolError, runTool } from './tools';

function line(id: string, amount: string, rate: string): DetailLine {
  return {
    id,
    description: id,
    amount,
    unit: 'Weeks',
    x: '1',
    rate,
    currency: '',
    subtotal: (Number(amount) * Number(rate)).toString(),
    fringes: ['FICA SS'],
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

const budget: Budget = {
  id: 'b',
  name: 'Test',
  settings: {
    ...DEFAULT_BUDGET_SETTINGS,
    fringeDefs: [
      { name: 'FICA SS', kind: 'percent', rate: '6.2', unit: '', cutoff: null, cutoffInferred: false },
    ],
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
          imported: { fringe: null, original: '0', total: '211408', variance: '0' },
          details: [line('l1', '10', '10000'), line('l2', '10', '10000')],
          postedFringes: [],
          fringeRanges: [],
        },
      ],
    },
  ],
};

describe('budget tools', () => {
  it('every tool has a schema and a description', () => {
    for (const t of BUDGET_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema['type']).toBe('object');
    }
  });

  it('reads an account with lines by position', () => {
    const { result, budget: changed } = runTool(budget, 'get_account', { account: '1101' });
    expect(changed).toBeUndefined();
    const r = result as { lines: { line: number; fringePercent: string }[]; total: string };
    expect(r.lines.map((l) => l.line)).toEqual([1, 2]);
    expect(r.lines[0]!.fringePercent).toBe('6.20%');
    expect(r.total).toBe('212400');
  });

  it('a cutoff and a range change the total, and are labelled for history', () => {
    const cut = runTool(budget, 'set_fringe_cutoff', { fringe: 'FICA SS', cutoff: '184,500' });
    expect(cut.label).toBe('AI: FICA SS cutoff 184500');
    expect(cut.budget!.settings.fringeDefs[0]).toMatchObject({ cutoff: '184500', cutoffInferred: true });
    // Two people under the cutoff: no change yet.
    expect((cut.result as { total: string }).total).toBe('212400');
    const ranged = runTool(cut.budget!, 'set_fringe_range', { account: '1101', lines: [2, 1] });
    expect(ranged.result).toMatchObject({ fringeRanges: [[1, 2]], total: '211439' });
  });

  it('says what is wrong in terms the AI can act on', () => {
    expect(() => runTool(budget, 'get_account', { account: '9999' })).toThrow(ToolError);
    expect(() => runTool(budget, 'set_fringe_cutoff', { fringe: 'FICA SS', cutoff: 'lots' })).toThrow(
      /number/,
    );
    expect(() => runTool(budget, 'set_fringe_range', { account: '1101', lines: [1, 7] })).toThrow(
      /no line 7/,
    );
  });

  it('adds a global, then updates it', () => {
    const added = runTool(budget, 'set_global', { name: 'SW', value: '22' }).budget!;
    const updated = runTool(added, 'set_global', { name: 'SW', value: '20' }).budget!;
    expect(updated.settings.globals).toEqual([{ name: 'SW', value: '20', description: '', inferred: false }]);
  });

  it("records a converted file's figures to check the budget against", () => {
    const r = runTool(budget, 'record_file_figures', {
      file: 'Pilot.xlsx',
      categories: [{ category: '1100', total: '211,439' }],
      accounts: [
        {
          account: '1101',
          total: '211439',
          fringes: [{ name: 'FICA SS', kind: 'percent', rate: '6.2', base: '184500', total: '11439' }],
        },
      ],
      lines: [{ account: '1101', line: 2, fringePercent: '3.91%' }],
    });
    expect(r.label).toBe('AI: figures from Pilot.xlsx');
    expect(r.result).toEqual({ fileTotal: '211439.00', total: '212400.00', accountsThatDiffer: 1 });
    const b = r.budget!;
    expect(b.source).toEqual({ fileName: 'Pilot.xlsx' });
    expect(b.categories[0]!.imported?.total).toBe('211439');
    const a = b.categories[0]!.accounts[0]!;
    expect(a.imported?.total).toBe('211439');
    expect(a.postedFringes).toEqual([
      { kind: 'percent', name: 'FICA SS', rate: '6.2', unit: '', base: '184500', total: '11439' },
    ]);
    expect(a.details.map((d) => d.importedFringePercent?.line ?? null)).toEqual([null, '3.91%']);
    expect(() =>
      runTool(budget, 'record_file_figures', {
        file: 'x',
        lines: [{ account: '1101', line: 9, fringePercent: '1' }],
      }),
    ).toThrow(/no line 9/);
  });

  it('builds a budget from blank, with fringes, globals and formulas', () => {
    let b = newBudget('Reality');
    const step = (name: string, input: unknown) => {
      const out = runTool(b, name, input);
      if (out.budget) {
        expect(out.label).toMatch(/^AI: /);
        b = out.budget;
      }
      return out.result as Record<string, unknown>;
    };
    step('set_global', { name: 'ShootDays', value: '15' });
    step('set_fringe', { name: 'Payroll', kind: 'percent', rate: '20' });
    step('add_category', {
      number: '1100',
      description: 'PRODUCERS',
      accounts: [
        {
          number: '1101',
          description: 'LINE PRODUCER',
          lines: [
            {
              description: 'Line Producer',
              amount: 'ShootDays+5',
              unit: 'Days',
              rate: 1000,
              fringes: ['Payroll'],
            },
          ],
        },
        { description: 'PAs', lines: [{ description: 'PA', amount: 15, unit: 'Days', x: 2, rate: '250' }] },
      ],
    });
    const lp = b.categories[0]!.accounts[0]!.details[0]!;
    expect(lp).toMatchObject({ amount: '20', subtotal: '20000', formulas: { amount: 'ShootDays+5' } });
    // A number left out is the next free one inside the category.
    expect(b.categories[0]!.accounts.map((a) => a.number)).toEqual(['1101', '1110']);
    // 20,000 + 20% fringe + 7,500.
    expect(step('get_budget_summary', {})).toMatchObject({ total: '31500' });

    step('update_lines', { account: '1101', lines: [{ line: 1, rate: 1200 }] });
    expect(b.categories[0]!.accounts[0]!.details[0]!.subtotal).toBe('24000');

    step('set_number_patterns', { categoryPattern: '##-##', accountPattern: '##-##' });
    expect(b.categories[0]!.number).toBe('11-00');
    step('add_lines', { account: '1101', after: 0, lines: [{ description: 'Top' }] });
    expect(b.categories[0]!.accounts[0]!.details[0]!.description).toBe('Top');
    step('move_lines', { account: '11-01', lines: [1], after: 2 });
    expect(b.categories[0]!.accounts[0]!.details.map((d) => d.description)).toEqual(['Line Producer', 'Top']);
    step('delete_lines', { account: '1101', lines: [2] });
    step('renumber_and_rename', { accounts: [{ number: '1101', newDescription: 'PRODUCERS' }] });
    expect(b.categories[0]!.accounts[0]!.description).toBe('PRODUCERS');
    expect(() => runTool(b, 'add_lines', { account: '1101', lines: [{ fringes: ['Nope'] }] })).toThrow(
      /set_fringe/,
    );
  });
});
