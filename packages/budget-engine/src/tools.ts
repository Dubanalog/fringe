import { addGlobal, calculateTotals, groupTotals, updateGlobal } from './calc';
import { EditError, updateSettings } from './edit';
import { ADDON_TOOLS } from './addons';
import { EDIT_TOOLS } from './edit-tools';
import { convertedSubtotal, lineCurrency } from './currency';
import { accountFringes, fringeTotal, poolBase, postingScopes } from './fringes';
import { toDecimal } from './money';
import type { Account, Budget, FringePosting, PostedFringe } from './model';
import { createFringeRange, removeFringeRanges } from './ranges';
import { importReport } from './report';
import {
  type BudgetTool,
  type ToolOutcome,
  ToolError,
  amount,
  findAccount,
  lineIds,
  lineList,
  money2,
  nullableNumber,
  obj,
  str,
  text,
} from './tool-kit';

export { type BudgetTool, type ToolOutcome, ToolError } from './tool-kit';

/**
 * The tools an AI assistant uses on a budget. Every tool is pure: it reads the budget and its
 * input, and returns a result to show the AI and, for edits, the changed budget. The app records
 * each edit in the budget's history (so the user can undo it) and saves it like any other change.
 * The same list serves the app's MCP server and its built-in chat.
 *
 * Accounts are named by number ("1101") and lines by their position in the account, from 1,
 * counting blank lines, as the user sees them. Numbers can be given by their digits alone
 * ("1102" finds 11-02). Reading tools are here; tools that build and change the budget are in
 * edit-tools.ts.
 */

/** An account's ranges as line positions. */
function rangesOf(account: Account): number[][] {
  const at = new Map(account.details.map((d, i) => [d.id, i + 1]));
  return account.fringeRanges.map((r) => r.lineIds.map((id) => at.get(id)!));
}

function summary(budget: Budget) {
  const totals = calculateTotals(budget);
  const s = budget.settings;
  return {
    name: budget.name,
    title: s.title,
    hasAssumptions: s.assumptions !== '',
    importedFrom: budget.source?.fileName ?? null,
    total: totals.grand.total,
    categoriesTotal: totals.categoriesTotal.total,
    percentages: totals.percentages.map((p) => ({
      name: p.percentage.name,
      percent: p.percentage.percent,
      excludeGroups: p.percentage.excludeGroups,
      base: p.base,
      amount: p.amount,
    })),
    incentives: totals.incentives.map((p) => ({
      name: p.incentive.name,
      rate: p.incentive.rate,
      realized: p.incentive.realized,
      groups: p.incentive.groups,
      includeFringes: p.incentive.includeFringes !== false,
      excludeFringes: p.incentive.excludeFringes ?? [],
      qualifyingSpend: p.base,
      credit: p.credit,
      amount: p.amount,
    })),
    incentivePlacement: s.incentivePlacement,
    netCost: totals.net,
    groups: groupTotals(budget, totals).map((g) => ({ name: g.group, lines: g.lines, total: g.total })),
    importedTotal: budget.categories.some((c) => c.imported)
      ? money2(budget.categories.reduce((t, c) => t.plus(toDecimal(c.imported?.total ?? '0')), toDecimal(0)))
      : null,
    fringePosting: s.fringes,
    fringes: s.fringeDefs.map((f) => ({
      name: f.name,
      kind: f.kind,
      rate: f.rate,
      ...(f.kind === 'flat' ? { per: f.unit } : { cutoff: f.cutoff, cutoffInferred: f.cutoffInferred }),
    })),
    units: s.units.map((u) => ({ name: u.name, hours: u.hours, hoursInferred: u.hoursInferred ?? false })),
    globals: s.globals.map((g) => ({ name: g.name, value: g.value, inferred: g.inferred })),
    categories: budget.categories.map((c) => ({
      number: c.number,
      description: c.description,
      total: totals.categories.get(c.id)?.total ?? '0',
      importedTotal: c.imported?.total ?? null,
      accounts: c.accounts.map((a) => ({
        number: a.number,
        description: a.description,
        lines: a.details.length,
        total: totals.accounts.get(a.id)?.total ?? '0',
        importedTotal: a.imported?.total ?? null,
      })),
    })),
  };
}

function account(budget: Budget, number: string) {
  const a = findAccount(budget, number);
  const totals = calculateTotals(budget).accounts.get(a.id);
  const fringes = accountFringes(a, budget.settings);
  return {
    number: a.number,
    description: a.description,
    total: totals?.total ?? '0',
    importedTotal: a.imported?.total ?? null,
    lines: a.details.map((d, i) => {
      const line = fringes.get(d.id);
      const fringe = fringeTotal(line);
      const sub = convertedSubtotal(d, budget.settings) ?? toDecimal(0);
      return {
        line: i + 1,
        description: d.description,
        amount: d.amount,
        unit: d.unit,
        x: d.x,
        rate: d.rate,
        subtotal: d.subtotal,
        ...(lineCurrency(d, budget.settings)
          ? { currency: d.currency, subtotalInBudgetCurrency: money2(sub) }
          : {}),
        formulas: d.formulas,
        set: d.set,
        fringes: d.fringes,
        fringeAmounts: Object.fromEntries(
          [...(line ?? [])].map(([k, v]) => [k, v === null ? null : money2(v)]),
        ),
        fringePercent: fringe && !sub.isZero() ? `${fringe.dividedBy(sub).times(100).toFixed(2)}%` : null,
        importedFringePercent: d.importedFringePercent?.line ?? null,
      };
    }),
    fringeRanges: rangesOf(a),
    postedFringes: a.postedFringes,
  };
}

/** For each fringe posting: the file's base and total against this budget's, per posting account. */
function fringeBases(budget: Budget, name: string | null) {
  const defs = new Map(budget.settings.fringeDefs.map((f) => [f.name, f]));
  return postingScopes(budget).flatMap((scope) =>
    scope.posted
      .filter((p) => !name || p.name === name)
      .map((p) => {
        const def = defs.get(p.name);
        const base = p.kind === 'percent' ? money2(poolBase(scope.pools, p.name, def?.cutoff ?? null)) : null;
        return {
          postedTo: scope.holder.number,
          fringe: p.name,
          kind: p.kind,
          rate: p.rate,
          cutoff: def?.cutoff ?? null,
          fileBase: p.base,
          base,
          fileTotal: p.total,
        };
      }),
  );
}

export const BUDGET_TOOLS: readonly BudgetTool[] = [
  {
    name: 'get_budget_summary',
    description:
      'The open budget: its total (and the total of the file it was converted from, if any), fringes with rates and cutoffs, units with hours, globals, and every category and account with calculated and imported totals.',
    inputSchema: obj({}),
    edits: false,
    run: (budget) => ({ result: summary(budget) }),
  },
  {
    name: 'get_account',
    description:
      "One account's detail lines (position, description, amount, unit, X, rate, subtotal, currency and the subtotal converted when not the budget's, fringes ticked, Set), each line's calculated fringe amounts and %, the imported file's fringe % for comparison, its fringe ranges as line positions, and the fringes posted to it.",
    inputSchema: obj({ account: str('Account number, e.g. "1101".') }, ['account']),
    edits: false,
    run: (budget, input) => ({ result: account(budget, text(input, 'account')) }),
  },
  {
    name: 'get_import_report',
    description:
      "How the budget compares with the imported file's totals: grand totals, matching accounts, mismatches with likely reasons, lines whose fringes can't be worked out, and what was inferred.",
    inputSchema: obj({}),
    edits: false,
    run: (budget) => ({ result: importReport(budget) }),
  },
  {
    name: 'get_fringe_bases',
    description:
      "For each fringe posted in the imported file: the file's taxable base (or unit count) and total, against this budget's base with the current cutoff and ranges. Use it to check a cutoff.",
    inputSchema: obj({ fringe: str('Only this fringe (optional).') }),
    edits: false,
    run: (budget, input) => ({
      result: fringeBases(budget, typeof input['fringe'] === 'string' ? input['fringe'] : null),
    }),
  },
  {
    name: 'set_fringe_cutoff',
    description:
      'Sets the pay a percent fringe stops at, per person (fringe range). null removes the cutoff. Marked as inferred unless confirmed by the user.',
    inputSchema: obj(
      {
        fringe: str('Fringe name, exactly as listed.'),
        cutoff: nullableNumber('e.g. "184500", or null for none.'),
        confirmed: { type: 'boolean', description: 'True when the user gave or confirmed this value.' },
      },
      ['fringe', 'cutoff'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'fringe');
      const cutoff = amount(input, 'cutoff');
      const defs = budget.settings.fringeDefs;
      const def = defs.find((f) => f.name === name);
      if (!def) throw new ToolError(`There's no fringe called ${name}.`);
      if (def.kind !== 'percent')
        throw new ToolError(`${name} is a flat fringe; only percent fringes have cutoffs.`);
      const next = updateSettings(budget, {
        ...budget.settings,
        fringeDefs: defs.map((f) =>
          f === def ? { ...f, cutoff, cutoffInferred: cutoff !== null && input['confirmed'] !== true } : f,
        ),
      });
      return {
        budget: next,
        label: `AI: ${name} cutoff ${cutoff ?? 'removed'}`,
        result: {
          fringe: name,
          cutoff,
          total: calculateTotals(next).grand.total,
          bases: fringeBases(next, name),
        },
      };
    },
  },
  {
    name: 'set_unit_hours',
    description:
      'Sets how many hours one of a unit stands for (e.g. "Weeks" = 50), used by fringes paid per hour. Adds the unit if the budget has none by that name. null clears it.',
    inputSchema: obj(
      {
        unit: str('Unit name, e.g. "Days".'),
        hours: nullableNumber('e.g. "10", or null.'),
        confirmed: { type: 'boolean', description: 'True when the user gave or confirmed this value.' },
      },
      ['unit', 'hours'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'unit');
      const hours = amount(input, 'hours');
      const inferred = hours !== null && input['confirmed'] !== true;
      const units = budget.settings.units;
      const next = updateSettings(budget, {
        ...budget.settings,
        units: units.some((u) => u.name === name)
          ? units.map((u) => (u.name === name ? { ...u, hours, hoursInferred: inferred } : u))
          : [...units, { name, hours, hoursInferred: inferred }],
      });
      return {
        budget: next,
        label: `AI: ${name} = ${hours ?? 'no'} hours`,
        result: { unit: name, hours, total: calculateTotals(next).grand.total },
      };
    },
  },
  {
    name: 'set_global',
    description:
      'Sets a global\'s value (a number or a formula of other globals, e.g. "SW+2"), adding the global if it doesn\'t exist. Lines using it recalculate.',
    inputSchema: obj(
      { name: str('Global name, e.g. "SW".'), value: str('e.g. "22".'), description: str('Optional.') },
      ['name', 'value'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const value = text(input, 'value');
      const description = typeof input['description'] === 'string' ? input['description'] : undefined;
      const exists = budget.settings.globals.some((g) => g.name === name);
      const next = exists
        ? updateGlobal(budget, name, { value, ...(description !== undefined && { description }) })
        : addGlobal(budget, { name, value, description: description ?? '' });
      return {
        budget: next,
        label: `AI: ${name} = ${value}`,
        result: { name, value, total: calculateTotals(next).grand.total },
      };
    },
  },
  {
    name: 'set_fringe_range',
    description:
      "Puts two or more lines of an account in one fringe range (one person's lines, sharing cutoffs), taking them out of any range they were in.",
    inputSchema: obj({ account: str('Account number.'), lines: lineList }, ['account', 'lines']),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const { budget: next } = createFringeRange(budget, a.id, lineIds(a, input));
      return accountEdit(next, a.number, `AI: fringe range in ${a.number}`);
    },
  },
  {
    name: 'remove_fringe_ranges',
    description: 'Removes the fringe ranges the given lines are in, so each line stands alone.',
    inputSchema: obj({ account: str('Account number.'), lines: lineList }, ['account', 'lines']),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const next = removeFringeRanges(budget, a.id, lineIds(a, input));
      return accountEdit(next, a.number, `AI: removed fringe ranges in ${a.number}`);
    },
  },
  {
    name: 'set_fringe_posting',
    description:
      'Where fringes post: "account" (each account), "category" (one fringe account per category, by number ending, e.g. "99" → 1199), "production-level" (a fringe row on the topsheet in each production level, e.g. Above-The-Line) or "budget" (one fringe row at the bottom of the topsheet).',
    inputSchema: obj(
      {
        posting: { type: 'string', enum: ['account', 'category', 'production-level', 'budget'] },
        categoryAccountSuffix: str('For "category": the account number ending, e.g. "99".'),
        budgetAccount: str('For "budget": the fringe row\'s account number.'),
        levelAccounts: {
          type: 'object',
          description:
            'For "production-level": each level\'s fringe row account number, by level name, e.g. {"Above-The-Line": "1999"}.',
          additionalProperties: { type: 'string' },
        },
      },
      ['posting'],
    ),
    edits: true,
    run: (budget, input) => {
      const posting = text(input, 'posting') as FringePosting;
      if (!['account', 'category', 'production-level', 'budget'].includes(posting))
        throw new ToolError('Unknown posting.');
      const f = budget.settings.fringes;
      const levelAccounts = { ...f.levelAccounts };
      const given = input['levelAccounts'];
      if (given && typeof given === 'object') {
        for (const [name, number] of Object.entries(given)) {
          const level = budget.settings.coa.levels.find((l) => l.name === name || l.id === name);
          if (!level) throw new ToolError(`There's no production level called ${name}.`);
          levelAccounts[level.id] = String(number);
        }
      }
      const fringes = {
        levelAccounts,
        posting,
        categoryAccountSuffix:
          typeof input['categoryAccountSuffix'] === 'string'
            ? input['categoryAccountSuffix']
            : f.categoryAccountSuffix,
        budgetAccount: typeof input['budgetAccount'] === 'string' ? input['budgetAccount'] : f.budgetAccount,
      };
      const next = updateSettings(budget, { ...budget.settings, fringes });
      return {
        budget: next,
        label: `AI: fringes post to ${posting}`,
        result: { fringes, total: calculateTotals(next).grand.total },
      };
    },
  },
  {
    name: 'record_file_figures',
    description:
      "After building a budget from another program's file: records the file's own figures so every total can be checked against it (get_import_report, get_fringe_bases). Category and account totals, the fringes the file shows posted to an account (with each one's taxable base, or unit count for a flat fringe), and the fringe % it shows on a line. Can be called again; each figure replaces the one recorded before.",
    inputSchema: obj(
      {
        file: str('The file\'s name, e.g. "Pilot budget.xlsx".'),
        categories: {
          type: 'array',
          items: obj({ category: str('Category number.'), total: str("The file's total.") }, [
            'category',
            'total',
          ]),
        },
        accounts: {
          type: 'array',
          items: obj(
            {
              account: str('Account number.'),
              total: str("The file's total, fringes included."),
              fringes: {
                type: 'array',
                description: 'Fringes the file shows posted to this account.',
                items: obj(
                  {
                    name: str('Fringe name, as in the budget.'),
                    kind: { type: 'string', enum: ['percent', 'flat'] },
                    rate: str('Percent, or amount per unit.'),
                    unit: str('Flat fringes: the unit the rate is per, e.g. "Hours".'),
                    base: str('Taxable base (percent) or unit count (flat).'),
                    total: str('Amount.'),
                  },
                  ['name', 'kind', 'rate', 'base', 'total'],
                ),
              },
            },
            ['account', 'total'],
          ),
        },
        lines: {
          type: 'array',
          items: obj(
            {
              account: str('Account number.'),
              line: { type: 'integer', minimum: 1, description: 'Line position in the account, from 1.' },
              fringePercent: str(
                'The line\'s fringes as a % of its pay, as the file shows it, e.g. "38.63".',
              ),
            },
            ['account', 'line', 'fringePercent'],
          ),
        },
      },
      ['file'],
    ),
    edits: true,
    run: (budget, input) => {
      const next = recordFileFigures(budget, input);
      const report = importReport(next);
      return {
        budget: next,
        label: `AI: figures from ${next.source?.fileName ?? 'the file'}`,
        result: {
          fileTotal: report.importedTotal,
          total: report.calculatedTotal,
          accountsThatDiffer: report.mismatches.length,
        },
      };
    },
  },
  ...EDIT_TOOLS,
  ...ADDON_TOOLS,
];

function list(input: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = input[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object'))
    throw new ToolError(`${key} must be a list.`);
  return v as Record<string, unknown>[];
}

const fileTotals = (total: string) => ({ fringe: null, original: total, total, variance: '0' });

/** The file's figures, kept on the budget to check it against (see record_file_figures). */
function recordFileFigures(budget: Budget, input: Record<string, unknown>): Budget {
  const file = text(input, 'file');
  const categoryTotals = new Map<string, string>();
  for (const c of list(input, 'categories')) {
    const number = text(c, 'category');
    const found = budget.categories.filter((x) => x.number === number);
    if (found.length !== 1) throw new ToolError(`There's no category ${number}.`);
    categoryTotals.set(found[0]!.id, amount(c, 'total') ?? '0');
  }
  interface Figures {
    total: string;
    posted: PostedFringe[] | null;
    percents: Map<string, string>;
  }
  const accounts = new Map<string, Figures>();
  const figuresFor = (number: string) => {
    const a = findAccount(budget, number);
    const f = accounts.get(a.id) ?? { total: a.imported?.total ?? '0', posted: null, percents: new Map() };
    accounts.set(a.id, f);
    return { a, f };
  };
  for (const x of list(input, 'accounts')) {
    const { f } = figuresFor(text(x, 'account'));
    f.total = amount(x, 'total') ?? '0';
    if (x['fringes'] !== undefined)
      f.posted = list(x, 'fringes').map((p) => {
        const kind = text(p, 'kind');
        if (kind !== 'percent' && kind !== 'flat') throw new ToolError('A fringe is "percent" or "flat".');
        return {
          kind,
          name: text(p, 'name'),
          rate: amount(p, 'rate') ?? '0',
          unit: typeof p['unit'] === 'string' ? p['unit'] : '',
          base: amount(p, 'base') ?? '0',
          total: amount(p, 'total') ?? '0',
        };
      });
  }
  for (const x of list(input, 'lines')) {
    const { a, f } = figuresFor(text(x, 'account'));
    const n = x['line'];
    const d = typeof n === 'number' ? a.details[n - 1] : undefined;
    if (!d) throw new ToolError(`Account ${a.number} has no line ${String(n)}.`);
    f.percents.set(d.id, `${text(x, 'fringePercent').replace('%', '').trim()}%`);
  }
  return {
    ...budget,
    source: { fileName: file },
    categories: budget.categories.map((c) => ({
      ...c,
      imported: categoryTotals.has(c.id) ? fileTotals(categoryTotals.get(c.id)!) : c.imported,
      accounts: c.accounts.map((a) => {
        const f = accounts.get(a.id);
        if (!f) return a;
        return {
          ...a,
          imported: fileTotals(f.total),
          postedFringes: f.posted ?? a.postedFringes,
          details: a.details.map((d) => {
            const pct = f.percents.get(d.id);
            return pct ? { ...d, importedFringePercent: { line: pct, cumulative: '' } } : d;
          }),
        };
      }),
    })),
  };
}

function accountEdit(budget: Budget, number: string, label: string): ToolOutcome {
  const a = findAccount(budget, number);
  return {
    budget,
    label,
    result: {
      account: number,
      fringeRanges: rangesOf(a),
      total: calculateTotals(budget).accounts.get(a.id)?.total ?? '0',
      importedTotal: a.imported?.total ?? null,
    },
  };
}

/** Runs a tool by name. Errors a user or AI can act on come back as ToolError. */
export function runTool(budget: Budget, name: string, input: unknown): ToolOutcome {
  const tool = BUDGET_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`There's no tool called ${name}.`);
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  try {
    return tool.run(budget, args);
  } catch (err) {
    if (err instanceof EditError) throw new ToolError(err.message);
    throw err;
  }
}
