import { type BudgetTotals, calculateTotals, groupTotals } from './calc';
import { type BudgetComparison, type ComparedRow, compareBudgets } from './compare';
import { crewList } from './crew';
import { lineCurrency } from './currency';
import { formatMoney, formatRate } from './format';
import { resolveGlobals } from './formula';
import { breakdownTotal, breakdownWords, fringeBreakdown, fringeSourceAccounts } from './fringe-breakdown';
import { accountFringes, fringePools, poolBase, unitCount } from './fringes';
import {
  type Account,
  type Budget,
  type Category,
  type DetailLine,
  type DisplayPrecision,
  budgetTitle,
} from './model';
import { type Decimal, applyRounding, sum, toDecimal } from './money';
import { categoryFringeAccount } from './numbering';
import { incentiveLabel, percentageLabel } from './percentages';
import { levelOf, sortedLevels, topsheet } from './topsheet';

/**
 * Printed reports. Each report is built once, as plain tables (`ReportDoc`), and the app turns
 * that into a PDF (via `reportHtml`), a spreadsheet or JSON, so every format shows the same
 * figures. Money is kept as exact decimal strings; formatting happens when it's shown.
 */

export type ReportId =
  | 'topsheet'
  | 'changes'
  | 'summary'
  | 'detail'
  | 'crew'
  | 'fringes'
  | 'globals'
  | 'groups'
  | 'sets'
  | 'locations'
  | 'assumptions';

export const REPORTS: readonly { id: ReportId; name: string; description: string }[] = [
  {
    id: 'topsheet',
    name: 'Topsheet',
    description: 'Categories, production totals, percentages and the grand total.',
  },
  {
    id: 'changes',
    name: 'Changes',
    description: 'What changed since a version: the totals then and now, and each change.',
  },
  { id: 'summary', name: 'Account Summary', description: 'Every account with its total, by category.' },
  { id: 'detail', name: 'Detail', description: 'Every account with its lines, fringes and totals.' },
  {
    id: 'crew',
    name: 'Crew List',
    description: 'The budget’s labor on its own: each position’s rate, time, wages and fringes.',
  },
  {
    id: 'fringes',
    name: 'Fringes',
    description: 'Each fringe: rate, cutoff, what it applies to and what it comes to.',
  },
  { id: 'globals', name: 'Globals', description: 'Each global, its formula and what it works out to.' },
  { id: 'groups', name: 'Groups', description: 'What the lines in each group add up to.' },
  { id: 'sets', name: 'Sets', description: 'What the lines for each set add up to.' },
  { id: 'locations', name: 'Locations', description: 'What the lines for each location add up to.' },
  {
    id: 'assumptions',
    name: 'Assumptions',
    description: 'The budget’s assumptions, as written in Budget Settings.',
  },
];

export interface ReportOptions {
  reports: ReportId[];
  /** Leave out categories, accounts and lines that come to nothing. */
  hideZero: boolean;
  /** Production level ids whose categories go in the Account Summary and Detail; empty for all. */
  levels: string[];
  /**
   * Detail: each fringe with its rate and what it applies to, wherever fringes land (an account, a
   * category's fringe account, a production level or the budget); or just one Fringes line there.
   */
  fringeDetail: boolean;
  /** The order the reports print in; reports it leaves out follow in their usual order. */
  order?: ReportId[];
}

/** Every report, in the order the options print them. */
export function reportOrder(options: Pick<ReportOptions, 'order'>): (typeof REPORTS)[number][] {
  const order = options.order ?? [];
  const at = (id: ReportId) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length + REPORTS.findIndex((r) => r.id === id) : i;
  };
  return [...REPORTS].sort((a, b) => at(a.id) - at(b.id));
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  reports: ['topsheet', 'summary', 'detail'],
  hideZero: false,
  levels: [],
  fringeDetail: true,
};

/** How a cell's value reads: money and numbers are decimal strings, a percent is "7.65" for 7.65%. */
export type CellKind = 'text' | 'money' | 'number' | 'rate' | 'percent';
export type ReportCell = string | null | { value: string; kind: CellKind };

export interface ReportColumn {
  label: string;
  kind: CellKind;
}

/** heading: a category or account name over its rows; subtotal/total/grand: added-up rows. */
export type RowStyle = 'normal' | 'heading' | 'subtotal' | 'total' | 'grand' | 'note';

export interface ReportRow {
  cells: ReportCell[];
  style: RowStyle;
}

export type ReportBlock =
  | { kind: 'table'; heading?: string; columns: ReportColumn[]; rows: ReportRow[] }
  | { kind: 'html'; html: string };

export interface ReportSection {
  /** Which report; 'addon' for one an add-on made (see addons.ts). */
  id: ReportId | 'addon';
  title: string;
  blocks: ReportBlock[];
}

export interface ReportDoc {
  /** The budget's title (see budgetTitle). */
  title: string;
  budgetName: string;
  /** When the reports were made, as an ISO timestamp. */
  created: string;
  precision: DisplayPrecision;
  sections: ReportSection[];
}

const row = (cells: ReportCell[], style: RowStyle = 'normal'): ReportRow => ({ cells, style });
const isZero = (v: Decimal | string) => toDecimal(v).isZero();
const fixed = (v: Decimal) => v.toFixed();

/** What the reports are of, beyond the budget itself. */
export interface ReportExtras {
  /** The version these reports are, e.g. "1.1": the title becomes "Pilot v1.1". */
  version?: string;
  /** For the Changes report: the budget to compare with, e.g. as it was at v1.0. */
  compare?: {
    /** e.g. "v1.0". */
    label: string;
    budget: Budget;
    /** What changed, in words (a version's "What changed"); shown above the figures. */
    notes?: string;
  };
}

/** Changes listed one by one before "and N more". */
const CHANGE_DETAIL_LIMIT = 500;

/** Builds the chosen reports, in the order of REPORTS. */
export function buildReports(
  budget: Budget,
  options: ReportOptions,
  now = new Date(),
  extras: ReportExtras = {},
): ReportDoc {
  const totals = calculateTotals(budget);
  const ctx: Context = { budget, totals, options, extras };
  const sections = reportOrder(options)
    .filter((r) => options.reports.includes(r.id))
    .flatMap((r) => {
      const blocks = BUILDERS[r.id](ctx);
      return blocks.length > 0 ? [{ id: r.id, title: r.name, blocks }] : [];
    });
  return {
    title: extras.version ? `${budgetTitle(budget)} v${extras.version}` : budgetTitle(budget),
    budgetName: budget.name,
    created: now.toISOString(),
    precision: budget.settings.displayPrecision,
    sections,
  };
}

interface Context {
  budget: Budget;
  totals: BudgetTotals;
  options: ReportOptions;
  extras: ReportExtras;
}

const BUILDERS: Record<ReportId, (ctx: Context) => ReportBlock[]> = {
  topsheet: topsheetReport,
  changes: changesReport,
  summary: summaryReport,
  detail: detailReport,
  crew: crewReport,
  fringes: fringeReport,
  globals: globalsReport,
  groups: groupsReport,
  sets: (ctx) => codeReport(ctx, 'set', 'Set'),
  locations: (ctx) => codeReport(ctx, 'location', 'Location'),
  assumptions: ({ budget }) =>
    budget.settings.assumptions ? [{ kind: 'html', html: budget.settings.assumptions }] : [],
};

function topsheetReport({ budget, totals, options }: Context): ReportBlock[] {
  const sheet = topsheet(budget, totals);
  const rows: ReportRow[] = [];
  for (const r of sheet.rows) {
    if (r.kind === 'category') {
      if (options.hideZero && isZero(r.totals.total)) continue;
      rows.push(row([r.category.number, r.category.description, r.totals.total]));
    } else if (r.kind === 'fringes') {
      if (options.hideZero && isZero(r.totals.total)) continue;
      rows.push(row([r.number, r.level ? `${r.level.name} Fringes` : 'Total Fringes', r.totals.total]));
    } else {
      rows.push(row(['', `Total ${r.level.name}`, r.totals.total], 'subtotal'));
    }
  }
  const shown = <T extends { amount: Parameters<typeof isZero>[0] }>(list: readonly T[]) =>
    options.hideZero ? list.filter((p) => !isZero(p.amount)) : list;
  const percentages = shown(sheet.percentages);
  if (percentages.length > 0) {
    rows.push(row(['', 'Total before percentages', sheet.categoriesTotal.total], 'subtotal'));
    for (const p of percentages)
      rows.push(row([p.percentage.account ?? '', percentageLabel(p.percentage), p.amount]));
  }
  const incentives = shown(sheet.incentives).map((p) =>
    row([p.incentive.account ?? '', incentiveLabel(p.incentive), p.amount]),
  );
  if (budget.settings.incentivePlacement === 'grand-total') {
    rows.push(...incentives, row(['', 'Grand Total', sheet.grandTotal.total], 'grand'));
  } else {
    rows.push(row(['', 'Grand Total', sheet.grandTotal.total], 'grand'));
    if (incentives.length > 0) rows.push(...incentives, row(['', 'Net Cost', sheet.net], 'grand'));
  }
  return [
    {
      kind: 'table',
      columns: [
        { label: 'Acct', kind: 'text' },
        { label: 'Category', kind: 'text' },
        { label: 'Total', kind: 'money' },
      ],
      rows,
    },
  ];
}

function changesReport({ budget, extras }: Context): ReportBlock[] {
  const compare = extras.compare;
  if (!compare) return [];
  const c: BudgetComparison = compareBudgets(compare.budget, budget);
  const blocks: ReportBlock[] = [];
  const notes = compare.notes?.trim();
  if (notes) {
    blocks.push({
      kind: 'html',
      html: notes
        .split(/\n\s*\n/)
        .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
        .join(''),
    });
  }
  const columns: ReportColumn[] = [
    { label: 'Acct', kind: 'text' },
    { label: 'Account', kind: 'text' },
    { label: compare.label, kind: 'money' },
    { label: 'Now', kind: 'money' },
    { label: 'Difference', kind: 'money' },
  ];
  const noted = (r: ComparedRow) =>
    r.status === 'added'
      ? `${r.name} (new)`.trim()
      : r.status === 'deleted'
        ? `${r.name} (deleted)`.trim()
        : r.name;
  const cells = (r: ComparedRow, label = noted(r)): ReportCell[] => [
    r.number,
    label,
    r.before,
    r.after,
    r.difference,
  ];
  const rows: ReportRow[] = [];
  for (const cat of c.categories) {
    if (cat.accounts.length === 0) {
      rows.push(row(cells(cat), 'subtotal'));
      continue;
    }
    rows.push(row([cat.number, noted(cat), null, null, null], 'heading'));
    for (const a of cat.accounts) rows.push(row(cells(a)));
    rows.push(row(cells(cat, `Total ${cat.number} ${cat.name}`.trim()), 'subtotal'));
  }
  if (rows.length === 0) rows.push(row(['', 'No account totals changed.', null, null, null], 'note'));
  for (const t of c.totals) {
    rows.push(row(cells(t), t.name === 'Grand Total' || t.name === 'Net Cost' ? 'grand' : 'normal'));
  }
  blocks.push({ kind: 'table', heading: `Totals since ${compare.label}`, columns, rows });
  if (c.details.length > 0) {
    const shown = c.details
      .slice(0, CHANGE_DETAIL_LIMIT)
      .map((d) => row([d.where, d.what, d.from ?? '', d.to ?? '']));
    if (c.details.length > CHANGE_DETAIL_LIMIT) {
      shown.push(row(['', `and ${c.details.length - CHANGE_DETAIL_LIMIT} more changes`, '', ''], 'note'));
    }
    blocks.push({
      kind: 'table',
      heading: `Every change since ${compare.label}`,
      columns: [
        { label: 'Where', kind: 'text' },
        { label: 'What', kind: 'text' },
        { label: 'Was', kind: 'text' },
        { label: 'Now', kind: 'text' },
      ],
      rows: shown,
    });
  }
  return blocks;
}

/** The categories the options include, in order. */
function chosenCategories({ budget, options }: Context): Category[] {
  if (options.levels.length === 0) return budget.categories;
  const levels = sortedLevels(budget.settings.coa.levels);
  return budget.categories.filter((c) => {
    const level = levelOf(c.number, levels);
    return level !== undefined && options.levels.includes(level.id);
  });
}

/**
 * Fringes posted to the topsheet ('production-level' or 'budget' posting), as the topsheet shows
 * them: each fringe row with the chosen categories it covers, keyed by the last of those categories
 * so the reports can print it right after them.
 */
function topsheetFringes(ctx: Context, categories: readonly Category[]) {
  const { budget, totals } = ctx;
  const { posting, levelAccounts, budgetAccount } = budget.settings.fringes;
  const groups: { number: string; name: string; categories: Category[]; amount: Decimal }[] = [];
  if (posting === 'budget' && categories.length > 0) {
    groups.push({
      number: budgetAccount,
      name: 'Total Fringes',
      categories: [...categories],
      amount: toDecimal(0),
    });
  } else if (posting === 'production-level') {
    const levels = sortedLevels(budget.settings.coa.levels);
    const byLevel = new Map<string, Category[]>();
    for (const c of categories) {
      const id = levelOf(c.number, levels)?.id ?? '';
      byLevel.set(id, [...(byLevel.get(id) ?? []), c]);
    }
    for (const [id, cs] of byLevel) {
      const level = levels.find((l) => l.id === id);
      groups.push({
        number: level ? (levelAccounts[level.id] ?? '') : '',
        name: level ? `${level.name} Fringes` : 'Total Fringes',
        categories: cs,
        amount: toDecimal(0),
      });
    }
  }
  const after = new Map<string, typeof groups>();
  for (const g of groups) {
    g.amount = sum(g.categories.map((c) => totals.categoryFringes.get(c.id) ?? '0'));
    const last = g.categories.at(-1)!.id;
    after.set(last, [...(after.get(last) ?? []), g]);
  }
  return after;
}

function summaryReport(ctx: Context): ReportBlock[] {
  const { totals, options } = ctx;
  const rows: ReportRow[] = [];
  let shown = toDecimal(0);
  const categories = chosenCategories(ctx);
  const posted = topsheetFringes(ctx, categories);
  for (const c of categories) {
    const ct = totals.categories.get(c.id);
    if (ct && !(options.hideZero && isZero(ct.total))) {
      rows.push(row([c.number, c.description, null, null], 'heading'));
      for (const a of c.accounts) {
        const at = totals.accounts.get(a.id);
        if (!at || (options.hideZero && isZero(at.total))) continue;
        rows.push(row([a.number, a.description, at.fringe, at.total]));
      }
      rows.push(row(['', `Total ${c.number} ${c.description}`.trim(), ct.fringe, ct.total], 'subtotal'));
      shown = shown.plus(toDecimal(ct.total));
    }
    // Fringes posted to the topsheet follow their level's (or the budget's) last category.
    for (const g of posted.get(c.id) ?? []) {
      if (options.hideZero && g.amount.isZero()) continue;
      rows.push(row([g.number, g.name, fixed(g.amount), fixed(g.amount)], 'subtotal'));
      shown = shown.plus(g.amount);
    }
  }
  if (rows.length === 0) return [];
  rows.push(row(['', 'Total', null, fixed(shown)], 'total'));
  return [
    {
      kind: 'table',
      columns: [
        { label: 'Acct', kind: 'text' },
        { label: 'Account', kind: 'text' },
        { label: 'Fringes', kind: 'money' },
        { label: 'Total', kind: 'money' },
      ],
      rows,
    },
  ];
}

/** True when a line has nothing on it: no description and nothing to add up. */
const blankLine = (d: DetailLine) => !d.description.trim() && isZero(d.subtotal || '0');

function detailReport(ctx: Context): ReportBlock[] {
  const { budget, totals, options } = ctx;
  const money = (v: string) => formatMoney(v, budget.settings.displayPrecision);
  const columns: ReportColumn[] = [
    { label: 'Acct', kind: 'text' },
    { label: 'Description', kind: 'text' },
    { label: 'Amount', kind: 'number' },
    { label: 'Units', kind: 'text' },
    { label: 'X', kind: 'number' },
    { label: 'Rate', kind: 'rate' },
    { label: 'Subtotal', kind: 'money' },
    { label: 'Total', kind: 'money' },
  ];
  /** A row with the description in column 2 and figures placed by column label. */
  const at = (description: string, by: Record<string, ReportCell>, style: RowStyle, acct = ''): ReportRow => {
    const cells: ReportCell[] = columns.map((col) => by[col.label] ?? null);
    cells[0] = acct;
    cells[1] = description;
    return row(cells, style);
  };
  /** How the fringes from `sources`' lines add up: each with its rate and what it applies to. */
  const breakdownRows = (sources: readonly Account[]) => {
    const breakdown = fringeBreakdown(budget, totals, sources).filter((r) => !isZero(r.amount));
    const lines = breakdown.map((r) => {
      const w = breakdownWords(r, money);
      const of = w.appliesTo ? ` of ${w.appliesTo}` : '';
      const text = `${r.name} ${w.rate}${of}${w.cutoff ? ` (${w.cutoff})` : ''}`.replace(/\s+/g, ' ').trim();
      return at(text, { Subtotal: r.amount }, 'note');
    });
    return { lines, total: breakdown.length > 0 ? breakdownTotal(breakdown) : null };
  };
  const rows: ReportRow[] = [];
  let shown = toDecimal(0);
  const categories = chosenCategories(ctx);
  const posted = topsheetFringes(ctx, categories);
  const toTopsheet = fringeSourceAccounts(budget, totals, '');
  for (const c of categories) {
    // Fringes posted to the topsheet follow their level's (or the budget's) last category.
    const after = () => {
      for (const g of posted.get(c.id) ?? []) {
        if (options.hideZero && g.amount.isZero()) continue;
        if (!options.fringeDetail) {
          rows.push(at(g.name, { Total: fixed(g.amount) }, 'total', g.number));
        } else {
          rows.push(at(g.name, {}, 'heading', g.number));
          const inGroup = new Set(g.categories.flatMap((x) => x.accounts));
          rows.push(...breakdownRows(toTopsheet.filter((a) => inGroup.has(a))).lines);
          const label = g.name.startsWith('Total ') ? g.name : `Total ${g.name}`;
          rows.push(at(label, { Total: fixed(g.amount) }, 'total'));
        }
        shown = shown.plus(g.amount);
      }
    };
    const ct = totals.categories.get(c.id);
    if (!ct || (options.hideZero && isZero(ct.total))) {
      after();
      continue;
    }
    rows.push(at(c.description, {}, 'heading', c.number));
    for (const a of c.accounts) {
      const accountTotal = totals.accounts.get(a.id);
      if (!accountTotal || (options.hideZero && isZero(accountTotal.total) && a.details.every(blankLine)))
        continue;
      rows.push(at(a.description, {}, 'heading', a.number));
      for (const d of a.details) {
        if (options.hideZero && isZero(d.subtotal || '0')) continue;
        const line = totals.lines.get(d.id);
        // A line in another currency shows its own figures, then its subtotal converted.
        const foreign = lineCurrency(d, budget.settings);
        rows.push(
          at(
            foreign
              ? `${d.description} (${foreign} ${formatMoney(d.subtotal || '0', budget.settings.displayPrecision)})`
              : d.description,
            {
              Amount: d.amount || null,
              Units: d.unit || null,
              X: d.x && !toDecimal(d.x).equals(1) ? d.x : null,
              Rate: d.rate || null,
              Subtotal: foreign ? (line ? fixed(line.subtotal) : null) : d.subtotal || null,
            },
            'normal',
          ),
        );
      }
      const own = totals.lines;
      const lineSum = sum(a.details.map((d) => own.get(d.id)?.subtotal ?? toDecimal(0)));
      const fringeSum = sum(a.details.map((d) => own.get(d.id)?.fringe ?? toDecimal(0)));
      // The fringes that land on this account, from its own lines or (on a fringe account like
      // 1199) the whole category's: each one, or just what they come to.
      const { lines, total } = breakdownRows(fringeSourceAccounts(budget, totals, a.id));
      if (total !== null) {
        if (options.fringeDetail) rows.push(...lines);
        rows.push(at(options.fringeDetail ? 'Total Fringes' : 'Fringes', { Subtotal: total }, 'subtotal'));
      }
      const note = postingNote(budget, a, fringeSum, toDecimal(accountTotal.total).minus(lineSum));
      rows.push(at(`Total ${a.number}${note ? ` (${note})` : ''}`, { Total: accountTotal.total }, 'total'));
    }
    rows.push(at(`Total ${c.number} ${c.description}`.trim(), { Total: ct.total }, 'subtotal'));
    shown = shown.plus(toDecimal(ct.total));
    after();
  }
  if (rows.length === 0) return [];
  rows.push(at('Total', { Total: fixed(shown) }, 'grand'));
  return [{ kind: 'table', columns, rows }];
}

/** The crew list (see crew.ts): labor by production level and category. */
function crewReport(ctx: Context): ReportBlock[] {
  const { budget, totals } = ctx;
  const crew = crewList(budget, totals);
  const chosen = new Set(chosenCategories(ctx).map((c) => c.id));
  const columns: ReportColumn[] = [
    { label: 'Acct', kind: 'text' },
    { label: 'Position', kind: 'text' },
    { label: 'Amount', kind: 'number' },
    { label: 'Units', kind: 'text' },
    { label: 'X', kind: 'number' },
    { label: 'Rate', kind: 'rate' },
    { label: 'Wages', kind: 'money' },
    { label: 'Fringes', kind: 'money' },
    { label: 'Total', kind: 'money' },
  ];
  const sums = (wages: Decimal, fringes: Decimal): ReportCell[] => [
    fixed(wages),
    fixed(fringes),
    fixed(wages.plus(fringes)),
  ];
  const rows: ReportRow[] = [];
  let wages = toDecimal(0);
  let fringes = toDecimal(0);
  for (const level of crew.levels) {
    const categories = level.categories.filter((c) => chosen.has(c.category.id));
    if (categories.length === 0) continue;
    const many = crew.levels.length > 1 && level.level;
    if (many) rows.push(row(['', level.level!.name, null, null, null, null, null, null, null], 'heading'));
    for (const c of categories) {
      rows.push(
        row([c.category.number, c.category.description, null, null, null, null, null, null, null], 'heading'),
      );
      for (const { line: d, account, wages: w, fringes: f } of c.lines) {
        rows.push(
          row([
            account.number,
            d.description,
            d.amount || null,
            d.unit || null,
            d.x && !toDecimal(d.x).equals(1) ? d.x : null,
            d.rate || null,
            ...sums(w, f),
          ]),
        );
      }
      rows.push(
        row(
          ['', `Total ${c.category.description}`.trim(), null, null, null, null, ...sums(c.wages, c.fringes)],
          'subtotal',
        ),
      );
      wages = wages.plus(c.wages);
      fringes = fringes.plus(c.fringes);
    }
    if (many && categories.length === level.categories.length)
      rows.push(
        row(
          ['', `Total ${level.level!.name}`, null, null, null, null, ...sums(level.wages, level.fringes)],
          'total',
        ),
      );
  }
  if (rows.length === 0) return [];
  rows.push(row(['', 'Total Labor', null, null, null, null, ...sums(wages, fringes)], 'grand'));
  const marked = crew.fringes.length > 0 ? crew.fringes.join(', ') : 'no fringe chosen';
  rows.push(
    row(
      [
        '',
        `${crew.positions} ${crew.positions === 1 ? 'position' : 'positions'}. Lines with ${marked}.`,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      'note',
    ),
  );
  return [{ kind: 'table', columns, rows }];
}

/** Where an account's fringes went, when they aren't simply in its total. */
function postingNote(budget: Budget, account: Account, own: Decimal, posted: Decimal): string {
  if (posted.equals(own)) return '';
  if (posted.greaterThan(own)) return 'includes fringes from the category';
  const { posting, categoryAccountSuffix } = budget.settings.fringes;
  if (posting === 'category') {
    const category = budget.categories.find((c) => c.accounts.includes(account));
    const to = category && categoryFringeAccount(category, categoryAccountSuffix);
    if (to) return `fringes post to ${to.number}`;
  }
  if (posting === 'budget' || posting === 'production-level') return 'fringes post to the topsheet';
  return 'fringes post elsewhere';
}

/** Each fringe across the budget: what it applies to (taxable pay, or units) and what it comes to. */
export function fringeSummary(
  budget: Budget,
): { name: string; base: Decimal; amount: Decimal; unknown: number }[] {
  const { fringeDefs, rounding, units } = budget.settings;
  const out = new Map(
    fringeDefs.map((f) => [f.name, { base: toDecimal(0), amount: toDecimal(0), unknown: 0 }]),
  );
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      const fringes = accountFringes(a, budget.settings);
      for (const f of fringeDefs) {
        const t = out.get(f.name)!;
        if (f.kind === 'percent') t.base = t.base.plus(poolBase(fringePools(a), f.name, f.cutoff));
        for (const d of a.details) {
          if (!d.fringes.includes(f.name)) continue;
          const v = fringes.get(d.id)?.get(f.name);
          if (v === null || v === undefined) {
            t.unknown++;
            continue;
          }
          t.amount = t.amount.plus(applyRounding(v, rounding));
          if (f.kind === 'flat') t.base = t.base.plus(unitCount(d, f.unit, units) ?? toDecimal(0));
        }
      }
    }
  }
  return [...out].map(([name, t]) => ({ name, ...t }));
}

function fringeReport({ budget, options }: Context): ReportBlock[] {
  const defs = new Map(budget.settings.fringeDefs.map((f) => [f.name, f]));
  const rows: ReportRow[] = [];
  let total = toDecimal(0);
  for (const s of fringeSummary(budget)) {
    if (options.hideZero && s.amount.isZero()) continue;
    const f = defs.get(s.name)!;
    const percent = f.kind === 'percent';
    rows.push(
      row([
        f.name,
        percent ? 'Percent' : 'Flat',
        percent ? { value: f.rate, kind: 'percent' } : { value: f.rate, kind: 'rate' },
        percent ? (f.cutoff ? { value: f.cutoff, kind: 'money' } : 'None') : `per ${f.unit}`,
        percent ? { value: fixed(s.base), kind: 'money' } : { value: fixed(s.base), kind: 'number' },
        fixed(s.amount),
      ]),
    );
    total = total.plus(s.amount);
  }
  if (rows.length === 0) return [];
  rows.push(row(['Total', null, null, null, null, fixed(total)], 'total'));
  return [
    {
      kind: 'table',
      columns: [
        { label: 'Fringe', kind: 'text' },
        { label: 'Kind', kind: 'text' },
        { label: 'Rate', kind: 'text' },
        { label: 'Cutoff', kind: 'text' },
        { label: 'Applies to', kind: 'text' },
        { label: 'Amount', kind: 'money' },
      ],
      rows,
    },
  ];
}

function globalsReport({ budget }: Context): ReportBlock[] {
  const globals = budget.settings.globals;
  if (globals.length === 0) return [];
  const values = resolveGlobals(globals);
  return [
    {
      kind: 'table',
      columns: [
        { label: 'Global', kind: 'text' },
        { label: 'Value', kind: 'text' },
        { label: 'Works out to', kind: 'number' },
        { label: 'Description', kind: 'text' },
      ],
      rows: globals.map((g) => {
        const v = values.get(g.name.toLowerCase());
        return row([g.name, g.value, v ? fixed(v) : null, g.description]);
      }),
    },
  ];
}

const tallyColumns = (first: string): ReportColumn[] => [
  { label: first, kind: 'text' },
  { label: 'Lines', kind: 'number' },
  { label: 'Subtotal', kind: 'money' },
  { label: 'Fringes', kind: 'money' },
  { label: 'Total', kind: 'money' },
];

function groupsReport({ budget, totals, options }: Context): ReportBlock[] {
  const groups = groupTotals(budget, totals).filter((g) => !(options.hideZero && isZero(g.total)));
  if (groups.length === 0) return [];
  return [
    {
      kind: 'table',
      columns: tallyColumns('Group'),
      rows: groups.map((g) => row([g.group, String(g.lines), g.subtotal, g.fringe, g.total])),
    },
  ];
}

function codeReport(
  { budget, totals, options }: Context,
  field: 'set' | 'location',
  noun: string,
): ReportBlock[] {
  const by = new Map<string, { lines: number; subtotal: Decimal; fringe: Decimal }>(
    budget.settings.codes[field].map((code) => [
      code,
      { lines: 0, subtotal: toDecimal(0), fringe: toDecimal(0) },
    ]),
  );
  const none = { lines: 0, subtotal: toDecimal(0), fringe: toDecimal(0) };
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      for (const d of a.details) {
        const t = totals.lines.get(d.id);
        if (!t) continue;
        const code = d[field].trim();
        const into = code
          ? (by.get(code) ?? { lines: 0, subtotal: toDecimal(0), fringe: toDecimal(0) })
          : none;
        into.lines++;
        into.subtotal = into.subtotal.plus(t.subtotal);
        into.fringe = into.fringe.plus(t.fringe);
        if (code) by.set(code, into);
      }
    }
  }
  if (by.size === 0) return [];
  const rows: ReportRow[] = [];
  const tally = (name: string, t: typeof none, style: RowStyle = 'normal') =>
    row([name, String(t.lines), fixed(t.subtotal), fixed(t.fringe), fixed(t.subtotal.plus(t.fringe))], style);
  for (const [code, t] of by) {
    if (options.hideZero && t.subtotal.plus(t.fringe).isZero()) continue;
    rows.push(tally(code, t));
  }
  if (none.lines > 0 && !(options.hideZero && none.subtotal.plus(none.fringe).isZero()))
    rows.push(tally(`No ${noun.toLowerCase()}`, none, 'note'));
  return rows.length > 0 ? [{ kind: 'table', columns: tallyColumns(noun), rows }] : [];
}

// ---- Showing a report ----

/** A cell's value and how it reads. */
export function cellValue(cell: ReportCell, column: ReportColumn): { value: string; kind: CellKind } | null {
  if (cell === null || cell === '') return null;
  return typeof cell === 'string' ? { value: cell, kind: column.kind } : cell;
}

/** A cell as text, the way the printout shows it. */
export function cellText(cell: ReportCell, column: ReportColumn, precision: DisplayPrecision): string {
  const c = cellValue(cell, column);
  if (!c) return '';
  if (c.kind === 'text') return c.value;
  if (!/^-?\d+(\.\d+)?$/.test(c.value)) return c.value;
  if (c.kind === 'money') return formatMoney(c.value, precision);
  if (c.kind === 'rate') return formatRate(c.value);
  const [whole = '0', fraction] = toDecimal(c.value).toFixed().split('.');
  const n = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  return c.kind === 'percent' ? `${n}%` : n;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function printedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Styles for the printout and the preview. */
const REPORT_CSS = `
  @page { size: letter; margin: 0.6in 0.5in 0.6in 0.5in; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 10pt/1.35 "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; color: #111; background: #fff; }
  @media screen { body { padding: 0.6in 0.5in; } }
  .report-title { margin: 0 0 2pt; font-size: 18pt; font-weight: 600; }
  .report-meta { margin: 0 0 14pt; color: #555; font-size: 9pt; }
  section + section { break-before: page; }
  h2 { margin: 0 0 8pt; font-size: 13pt; font-weight: 600; border-bottom: 1.5pt solid #111; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
  thead { display: table-header-group; }
  th { text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.03em; color: #444; border-bottom: 1pt solid #888; padding: 3pt 5pt; }
  td { padding: 2pt 5pt; vertical-align: top; }
  tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  tr.heading td { font-weight: 600; padding-top: 7pt; }
  tr.subtotal td { font-weight: 600; border-top: 0.75pt solid #bbb; }
  tr.total td { font-weight: 600; border-top: 0.75pt solid #888; }
  tr.grand td { font-weight: 700; border-top: 1.5pt solid #111; border-bottom: 3pt double #111; padding-top: 4pt; }
  tr.note td { color: #555; font-style: italic; }
  td.neg { color: #b00020; }
  .assumptions h1 { font-size: 16pt; margin: 10pt 0 4pt; }
  .assumptions h2 { font-size: 13pt; margin: 9pt 0 4pt; border: 0; padding: 0; }
  .assumptions h3 { font-size: 11pt; margin: 8pt 0 3pt; }
  .assumptions p { margin: 0 0 5pt; }
  .assumptions ul, .assumptions ol { margin: 0 0 6pt; padding-left: 18pt; }
  .assumptions blockquote { margin: 0 0 6pt; padding-left: 9pt; border-left: 2pt solid #bbb; color: #333; }
  .empty { color: #666; }
`;

function tableHtml(block: Extract<ReportBlock, { kind: 'table' }>, precision: DisplayPrecision): string {
  const numeric = (col: ReportColumn) => col.kind !== 'text';
  const head = block.columns
    .map((col) => `<th${numeric(col) ? ' class="num"' : ''}>${escape(col.label)}</th>`)
    .join('');
  const body = block.rows
    .map((r) => {
      const cells = r.cells
        .map((cell, i) => {
          const col = block.columns[i]!;
          const v = cellValue(cell, col);
          const isNum = v !== null && v.kind !== 'text';
          const cls = [isNum || numeric(col) ? 'num' : '', isNum && v.value.startsWith('-') ? 'neg' : '']
            .filter(Boolean)
            .join(' ');
          return `<td${cls ? ` class="${cls}"` : ''}>${escape(cellText(cell, col, precision))}</td>`;
        })
        .join('');
      return `<tr${r.style === 'normal' ? '' : ` class="${r.style}"`}>${cells}</tr>`;
    })
    .join('\n');
  return `${block.heading ? `<h3>${escape(block.heading)}</h3>` : ''}<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

/**
 * The reports as a printable HTML page. Assumptions are already safe HTML (see assumptions.ts).
 * `titleBlock` puts the title and date at the top, for a preview; the PDF prints them in the page
 * header instead.
 */
export function reportHtml(doc: ReportDoc, { titleBlock = true } = {}): string {
  const sections = doc.sections
    .map((s) => {
      const blocks = s.blocks
        .map((b) =>
          b.kind === 'table' ? tableHtml(b, doc.precision) : `<div class="assumptions">${b.html}</div>`,
        )
        .join('\n');
      return `<section><h2>${escape(s.title)}</h2>\n${blocks}</section>`;
    })
    .join('\n');
  const head = titleBlock
    ? `<h1 class="report-title">${escape(doc.title)}</h1><p class="report-meta">${escape(printedDate(doc.created))}</p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(doc.title)}</title><style>${REPORT_CSS}</style></head><body>${head}${
    sections || '<p class="empty">Nothing to show. Choose a report, or turn off “Hide zero amounts”.</p>'
  }</body></html>`;
}
