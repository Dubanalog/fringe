import { describe, expect, it } from 'vitest';
import { type Account, type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import { evaluateFormula, globalLookup, resolveGlobals } from './formula';
import {
  addGlobal,
  calculateTotals,
  deleteGlobal,
  globalUseCount,
  setLineNumber,
  updateGlobal,
} from './calc';
import { deleteCurrency, missingCurrencies, setBudgetCurrency, setCurrency } from './currency';
import { EditError, deleteRow } from './edit';
import { toDecimal } from './money';
import { normalizeBudget } from './project';
import { setLineTag } from './lines';
import {
  canRedo,
  canUndo,
  currentBudget,
  currentPath,
  deleteVersion,
  forkBudget,
  forkName,
  goTo,
  nextVersionNumber,
  recordChange,
  redo,
  saveVersion,
  startHistory,
  undo,
  changesBetween,
  versionBudget,
  versionOfEntries,
} from './history';
import { runVersionTool } from './version-tools';
import { setPercentage, deletePercentage } from './percentages';
import { topsheet } from './topsheet';
import { formatRate } from './format';
import { compareBudgets, describeComparison } from './compare';
import { DEFAULT_REPORT_OPTIONS, buildReports } from './reports';

const g = (name: string, value: string) => ({ name, value, description: '', inferred: false });
const lookup = (...defs: ReturnType<typeof g>[]) => globalLookup(resolveGlobals(defs));

describe('formulas', () => {
  it('works out numbers, globals and brackets exactly, in the usual order', () => {
    const r = evaluateFormula('(sw + 2) * 0.1 - -1', lookup(g('SW', '20')));
    expect(r.value.toFixed()).toBe('3.2');
    expect(r.formula).toBe('(SW+2)*0.1--1');
    expect(r.globals).toEqual(['SW']);
    expect(evaluateFormula('1,000 / 8', lookup()).value.toFixed()).toBe('125');
  });

  it('refuses bad formulas with a reason', () => {
    for (const bad of ['2 +', '(1', 'NOPE', '1/0', '2 3', '5 $']) {
      expect(() => evaluateFormula(bad, lookup())).toThrow(EditError);
    }
    expect(() => evaluateFormula('SW', lookup(g('SW', '')))).toThrow(/no value/);
  });

  it('resolves globals that use globals, and leaves loops without a value', () => {
    const v = resolveGlobals([g('A', 'B*2'), g('B', '3'), g('C', 'D'), g('D', 'C')]);
    expect(v.get('A')?.toFixed()).toBe('6');
    expect(v.get('C')).toBeNull();
  });
});

function line(id: string, amount: string, rate: string, fringes: string[] = []): DetailLine {
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
  imported: { fringe: null, original: '1000', total: '0', variance: '0' },
  details,
  postedFringes: [],
  fringeRanges: [],
});

const budget: Budget = {
  id: 'b',
  name: 'b',
  settings: {
    ...DEFAULT_BUDGET_SETTINGS,
    fringeDefs: [
      { name: 'FICA', kind: 'percent', rate: '10', unit: '', cutoff: null, cutoffInferred: false },
      { name: 'HW', kind: 'flat', rate: '5', unit: 'Weeks', cutoff: null, cutoffInferred: false },
    ],
    globals: [g('SW', '10')],
  },
  categories: [
    {
      id: 'c',
      number: '1100',
      description: '',
      imported: null,
      accounts: [
        account('a1', '1101', [line('l1', '2', '500', ['FICA', 'HW']), line('l2', '1', '300')]),
        account('a9', '1199', []),
      ],
    },
  ],
};
const lines = (b: Budget) => b.categories[0]!.accounts[0]!.details;

describe('editing numbers', () => {
  it('takes a number, recalculating the subtotal', () => {
    const b = setLineNumber(budget, 'l1', 'rate', '1,250.50');
    expect(lines(b)[0]).toMatchObject({ rate: '1250.5', subtotal: '2501', formulas: {} });
  });

  it('takes a global or formula and keeps it, so the line follows the global', () => {
    const b = setLineNumber(budget, 'l1', 'amount', 'sw*2');
    expect(lines(b)[0]).toMatchObject({ amount: '20', subtotal: '10000', formulas: { amount: 'SW*2' } });
    expect(lines(b)[0]!.globalsUsed).toEqual(['SW']);
    expect(globalUseCount(b, 'SW')).toBe(1);

    const changed = updateGlobal(b, 'SW', { value: '3' });
    expect(lines(changed)[0]).toMatchObject({ amount: '6', subtotal: '3000' });

    const renamed = updateGlobal(changed, 'SW', { name: 'ShootWeeks' });
    expect(lines(renamed)[0]!.formulas).toEqual({ amount: 'ShootWeeks*2' });

    const gone = deleteGlobal(renamed, 'ShootWeeks');
    expect(lines(gone)[0]).toMatchObject({ amount: '6', formulas: {}, globalsUsed: [] });
  });

  it('goes back to a plain number, and blank resets the field', () => {
    const b = setLineNumber(setLineNumber(budget, 'l1', 'amount', 'SW'), 'l1', 'amount', '4');
    expect(lines(b)[0]).toMatchObject({ amount: '4', formulas: {}, globalsUsed: [] });
    expect(lines(setLineNumber(budget, 'l1', 'x', ''))[0]!.x).toBe('1');
  });

  it('refuses unknown globals and bad global names', () => {
    expect(() => setLineNumber(budget, 'l1', 'rate', 'DW')).toThrow(/no global called DW/);
    expect(() => addGlobal(budget, { name: '2X', value: '1', description: '' })).toThrow(EditError);
    expect(() => addGlobal(budget, { name: 'sw', value: '1', description: '' })).toThrow(/already/);
    expect(() => updateGlobal(addGlobal(budget, g('B', 'SW')), 'SW', { value: 'B' })).toThrow(EditError);
  });
});

describe('totals', () => {
  const t = (b: Budget) => {
    const r = calculateTotals(b);
    return {
      a1: r.accounts.get('a1'),
      a9: r.accounts.get('a9')?.total,
      grand: r.grand.total,
    };
  };

  it("adds fringes to each account's total with account posting", () => {
    // l1: 1,000 + 10% (100) + 2 weeks × 5 (10).
    expect(t(budget)).toEqual({
      a1: { fringe: '110', original: '1000', total: '1410', variance: '410' },
      a9: '0',
      grand: '1410',
    });
  });

  it("posts a category's fringes to its fringe account", () => {
    const b = {
      ...budget,
      settings: { ...budget.settings, fringes: { ...budget.settings.fringes, posting: 'category' as const } },
    };
    // The Fringes column follows the posting: a1 keeps none, a9 has them all.
    expect(t(b)).toMatchObject({ a1: { fringe: '0', total: '1300' }, a9: '110', grand: '1410' });
    expect(calculateTotals(b).accounts.get('a9')?.fringe).toBe('110');
    expect(calculateTotals(b).unpostedCategories).toEqual([]);
    // No account ends in 98: the fringes stay on each account, and the category is named.
    const none = {
      ...b,
      settings: { ...b.settings, fringes: { ...b.settings.fringes, categoryAccountSuffix: '98' } },
    };
    expect(t(none)).toMatchObject({ a1: { fringe: '110', total: '1410' }, a9: '0' });
    expect(calculateTotals(none).unpostedCategories).toHaveLength(1);
  });

  it('puts fringes on the topsheet, per production level or once for the budget', () => {
    const posting = (p: 'production-level' | 'budget') => ({
      ...budget,
      settings: {
        ...budget.settings,
        fringes: {
          ...budget.settings.fringes,
          posting: p,
          budgetAccount: '9999',
          levelAccounts: { atl: '1999' },
        },
      },
    });
    const level = topsheet(posting('production-level'));
    const rows = level.rows.map((r) => [
      r.kind,
      r.kind === 'fringes' ? r.number : '',
      r.totals.fringe,
      r.totals.total,
    ]);
    // Category 1100 is its lines only; the fringe row and the level total carry the 110.
    expect(rows).toEqual([
      ['category', '', '0', '1300'],
      ['fringes', '1999', '110', '110'],
      ['level', '', '110', '1410'],
    ]);
    expect(level.grandTotal).toMatchObject({ fringe: '110', total: '1410' });
    const whole = topsheet(posting('budget'));
    expect(whole.rows.map((r) => r.kind)).toEqual(['category', 'level', 'fringes']);
    expect(whole.rows[2]).toMatchObject({ number: '9999', totals: { total: '110' } });
    expect(whole.grandTotal.total).toBe('1410');
  });

  it('follows edits: removing a fringe or deleting a line changes the totals', () => {
    expect(t(setLineTag(budget, ['l1'], 'fringes', 'FICA', false)).grand).toBe('1310');
    expect(t(deleteRow(budget, 'detail', 'l2')).grand).toBe('1110');
    expect(topsheet(setLineNumber(budget, 'l2', 'rate', '0')).grandTotal.total).toBe('1110');
  });
});

describe('history', () => {
  it('undoes and redoes, keeping every change when a new one branches off', () => {
    const b2 = setLineNumber(budget, 'l1', 'rate', '1');
    let h = recordChange(startHistory(budget, 'Opened', 't0'), b2, 'Rate', 't1');
    expect(recordChange(h, b2, 'same')).toBe(h);
    h = undo(h);
    expect(currentBudget(h)).toBe(budget);
    expect(canUndo(h)).toBe(false);
    expect(currentBudget(redo(h))).toBe(b2);
    h = recordChange(h, deleteRow(budget, 'detail', 'l2'), 'Delete', 't2');
    expect(canRedo(h)).toBe(false);
    expect(h.entries.map((e) => e.label)).toEqual(['Opened', 'Rate', 'Delete']);
    expect([...currentPath(h)]).toEqual([h.entries[2]!.id, h.entries[0]!.id]);
    // Undo follows the branch back, and redo takes the newest branch.
    h = undo(h);
    expect(currentBudget(h)).toBe(budget);
    expect(redo(h).entries[redo(h).current]!.label).toBe('Delete');
    // The replaced change is still there to go back to.
    expect(currentBudget(goTo(h, h.entries[1]!.id))).toBe(b2);
  });

  it('keeps every change, however many', () => {
    let h = startHistory(budget, 'Opened', 't0');
    for (let i = 1; i <= 1200; i++)
      h = recordChange(h, setLineNumber(budget, 'l1', 'rate', String(i)), 'Rate');
    expect(h.entries).toHaveLength(1201);
  });

  it('saves, numbers and deletes versions', () => {
    let h = startHistory(budget, 'Opened', 't0');
    expect(nextVersionNumber(h.versions)).toBe('1.0');
    const fields = {
      name: 'Studio',
      sentOn: '2026-03-03',
      sentTo: 'Studio',
      notes: '',
      changes: '',
      pdf: null,
    };
    const v1 = saveVersion(h, { ...fields, number: 'v1' }, 't1');
    h = v1.history;
    expect(v1.version.number).toBe('1.0');
    expect(versionBudget(h, v1.version)).toBe(budget);
    expect(nextVersionNumber(h.versions)).toBe('1.1');
    expect(nextVersionNumber(h.versions, true)).toBe('2.0');
    expect(() => saveVersion(h, { ...fields, number: '1.0' })).toThrow(/already a v1.0/);
    expect(() => saveVersion(h, { ...fields, number: 'draft' })).toThrow(/number/);
    h = recordChange(h, setLineNumber(budget, 'l1', 'rate', '1'), 'Rate', 't2');
    h = saveVersion(h, { ...fields, number: '1.10' }, 't3').history;
    expect(nextVersionNumber(h.versions)).toBe('1.11');
    h = saveVersion(h, { ...fields, id: v1.version.id, number: '1.0', notes: 'Sent' }).history;
    expect(h.versions.map((v) => [v.number, v.notes, v.savedAt])).toEqual([
      ['1.0', 'Sent', 't1'],
      ['1.10', '', 't3'],
    ]);
    expect(deleteVersion(h, v1.version.id).versions).toHaveLength(1);
  });

  it('tells which version each change went into', () => {
    const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
    let h = startHistory(budget, 'Opened', 't0');
    h = recordChange(h, setLineNumber(budget, 'l1', 'rate', '1'), 'A', 't1');
    h = saveVersion(h, { ...fields, number: '1.0' }, 't2').history;
    h = recordChange(h, setLineNumber(budget, 'l1', 'rate', '2'), 'B', 't3');
    h = recordChange(h, setLineNumber(budget, 'l1', 'rate', '3'), 'C', 't4');
    h = saveVersion(h, { ...fields, number: '1.1' }, 't5').history;
    h = recordChange(h, setLineNumber(budget, 'l1', 'rate', '4'), 'D', 't6');
    const of = versionOfEntries(h);
    expect(h.entries.map((e) => of.get(e.id)?.number ?? null)).toEqual(['1.0', '1.0', '1.1', '1.1', null]);
    expect(changesBetween(h, h.entries[1]!.id, h.entries[4]!.id).map((e) => e.label)).toEqual([
      'B',
      'C',
      'D',
    ]);
  });

  it('lets the AI compare versions and write what changed into one', () => {
    const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
    const withC = setPercentage(budget, { name: 'Contingency', percent: '10', excludeGroups: [] });
    let h = startHistory(withC, 'Opened', 't0');
    h = saveVersion(h, { ...fields, number: '1.0' }, 't1').history;
    h = recordChange(
      h,
      deletePercentage(withC, withC.settings.percentages[0]!.id),
      'Delete Contingency',
      't2',
    );
    h = saveVersion(h, { ...fields, number: '1.1' }, 't3').history;

    const list = runVersionTool(h, 'list_versions', {})!.result as { versions: { version: string }[] };
    expect(list.versions.map((v) => v.version)).toEqual(['1.1', '1.0']);
    const c = runVersionTool(h, 'compare_versions', { from: '1.0', to: '1.1' })!.result as {
      draft: string;
      history: { change: string }[];
      categories: unknown[];
    };
    expect(c.history.map((x) => x.change)).toEqual(['Delete Contingency']);
    expect(c.categories).toEqual([]);
    expect(c.draft).toMatch(/Contingency 10%: deleted/);
    expect(c.draft).toMatch(/No account totals changed/);

    const u = runVersionTool(h, 'update_version', { version: '1.1', whatChanged: 'Took out contingency' })!;
    expect(u.version!.changes).toBe('Took out contingency');
    expect(u.version!.number).toBe('1.1');
    expect(u.label).toBe('AI: v1.1 details');
    expect(() => runVersionTool(h, 'update_version', { version: '2.0' })).toThrow(/no v2.0/);
    expect(runVersionTool(h, 'set_line', {})).toBeNull();

    // Before saving: compare with the latest version and fill in the form.
    const now = runVersionTool(h, 'compare_versions', {})!.result as { from: string; to: string };
    expect([now.from, now.to]).toEqual(['v1.1', 'now']);
    const f = runVersionTool(h, 'fill_version_form', { whatChanged: 'No changes', sentTo: 'Studio' })!;
    expect(f.draft).toEqual({ whatChanged: 'No changes', sentTo: 'Studio' });
    expect(f.version).toBeUndefined();
    expect((f.result as { version: string }).version).toBe('1.2');
    expect(() => runVersionTool(h, 'fill_version_form', { number: '1.1' })).toThrow(/already a v1.1/);
    expect(() => runVersionTool(h, 'fill_version_form', {})).toThrow(/at least one/);
  });

  it('forks a copy that remembers where it came from', () => {
    const h = startHistory(budget, 'Opened', 't0');
    const fork = forkBudget(h, 'Option B', null, 't1');
    expect(fork.id).not.toBe(budget.id);
    expect(fork.forkedFrom).toEqual({ budgetId: 'b', budgetName: 'b', entryId: h.entries[0]!.id, at: 't1' });
  });

  it('names forks without piling up "(fork)"', () => {
    expect(forkName('Pilot', [])).toBe('Pilot (fork)');
    expect(forkName('Pilot', ['Pilot (fork)'])).toBe('Pilot (fork 2)');
    expect(forkName('Pilot (fork)', ['Pilot', 'Pilot (fork)'])).toBe('Pilot (fork 2)');
    expect(forkName('Pilot (fork) (fork 3)', ['pilot (FORK)'])).toBe('Pilot (fork 2)');
    expect(forkName('Pilot', [], '1.2')).toBe('Pilot v1.2 (fork)');
    expect(forkName('Pilot v1.2 (fork)', [], '2')).toBe('Pilot v2 (fork)');
  });
});

describe('formatRate', () => {
  it('shows every decimal a rate has, and at least cents', () => {
    expect(formatRate('11.0475')).toBe('11.0475');
    expect(formatRate('1250')).toBe('1,250.00');
    expect(formatRate('-0.5')).toBe('-0.50');
  });
});

describe('compareBudgets', () => {
  it('lists the accounts that moved, the totals, and every change', () => {
    const after = setLineNumber(budget, 'l2', 'rate', '400');
    const c = compareBudgets(budget, after);
    expect(c.categories.map((x) => [x.number, x.difference])).toEqual([['1100', '100']]);
    expect(c.categories[0]!.accounts.map((a) => [a.number, a.before, a.after])).toEqual([
      ['1101', '1410', '1510'],
    ]);
    expect(c.totals.find((t) => t.name === 'Grand Total')).toMatchObject({ difference: '100' });
    expect(c.details.length).toBeGreaterThan(0);
    expect(describeComparison(c, 'dollars')).toContain('  1101: 1,410 → 1,510 (+100)');
  });

  it('shows deleted accounts under their category', () => {
    const cat = budget.categories[0]!;
    const extra = {
      ...budget,
      categories: [{ ...cat, accounts: [...cat.accounts, account('a2', '1102', [line('l9', '1', '50')])] }],
    };
    const c = compareBudgets(extra, budget);
    expect(c.categories[0]!.accounts.map((a) => [a.number, a.status])).toEqual([['1102', 'deleted']]);
  });

  it('makes the Changes report, and puts the version in the title', () => {
    const after = setLineNumber(budget, 'l2', 'rate', '400');
    const doc = buildReports(after, { ...DEFAULT_REPORT_OPTIONS, reports: ['changes'] }, new Date(), {
      version: '1.1',
      compare: { label: 'v1.0', budget, notes: 'Raised the rate.' },
    });
    expect(doc.title).toMatch(/ v1\.1$/);
    const blocks = doc.sections[0]!.blocks;
    expect(blocks[0]).toEqual({ kind: 'html', html: '<p>Raised the rate.</p>' });
    expect(buildReports(after, { ...DEFAULT_REPORT_OPTIONS, reports: ['changes'] }).sections).toEqual([]);
  });
});

describe('currencies', () => {
  const inCad = (rate: string): Budget => {
    const b = setCurrency(budget, { code: 'cad', name: 'Canadian dollar', rate });
    const [l1, l2] = lines(b);
    const details = [l1!, { ...l2!, currency: 'CAD', fringes: ['FICA'] }];
    const [a1, a9] = b.categories[0]!.accounts;
    return { ...b, categories: [{ ...b.categories[0]!, accounts: [{ ...a1!, details }, a9!] }] };
  };

  it("converts a line at its currency's rate for totals and fringes, keeping its own figures", () => {
    const b = inCad('0.5');
    expect(lines(b)[1]!.subtotal).toBe('300');
    const t = calculateTotals(b);
    // 1,000 + 100 FICA + 10 HW, and 300 CAD = 150 + 15 FICA.
    expect(t.lines.get('l2')).toEqual({ subtotal: toDecimal('150'), fringe: toDecimal('15') });
    expect(t.accounts.get('a1')!.total).toBe('1275');
    expect(t.unknownCurrencyLines).toBe(0);
  });

  it('counts a line with no rate as zero, and says so', () => {
    const t = calculateTotals(inCad(''));
    expect(t.accounts.get('a1')!.total).toBe('1110');
    expect(t.unknownCurrencyLines).toBe(1);
    expect(missingCurrencies(inCad(''))).toEqual(['CAD']);
  });

  it("won't remove a currency lines use, or add the budget's own", () => {
    expect(() => deleteCurrency(inCad('0.5'), 'CAD')).toThrow(/1 line is in CAD/);
    expect(() => setCurrency(budget, { code: 'USD', name: '', rate: '1' })).toThrow(EditError);
    const b = setBudgetCurrency(inCad('0.5'), 'cad');
    expect(b.settings.currency).toBe('CAD');
    expect(b.settings.currencies).toEqual([]);
    expect(calculateTotals(b).accounts.get('a1')!.total).toBe('1440');
  });
});

describe('budgets saved before', () => {
  it('folds the old fourth multiplier into X, so the subtotal stays', () => {
    const old = (fourth: string, formulas: Record<string, string>) =>
      ({
        ...line('l1', '2', '500'),
        x: '3',
        unit2: 'People',
        unit3: '',
        unit4: '',
        fourthMultiplier: fourth,
        formulas,
      }) as DetailLine;
    const migrate = (d: DetailLine) =>
      normalizeBudget({
        ...budget,
        categories: [{ ...budget.categories[0]!, accounts: [account('a', '1', [d])] }],
      }).categories[0]!.accounts[0]!.details[0]!;
    const plain = migrate(old('2', {}));
    expect(plain).toMatchObject({ x: '6', formulas: {} });
    expect('unit2' in plain || 'fourthMultiplier' in plain).toBe(false);
    expect(migrate(old('1', {})).x).toBe('3');
    expect(migrate(old('10', { fourthMultiplier: 'SW' })).formulas).toEqual({ x: '(3)*(SW)' });
  });
});
