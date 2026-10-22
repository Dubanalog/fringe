import { inBudgetCurrency } from './currency';
import { EditError } from './edit';
import { accountFringes } from './fringes';
import {
  checkGlobalName,
  evaluateFormula,
  formulaNames,
  globalLookup,
  plainNumber,
  resolveGlobals,
} from './formula';
import { type Decimal, applyRounding, sum, toDecimal } from './money';
import { categoryFringeAccount } from './numbering';
import type {
  Account,
  Budget,
  BudgetPercentage,
  TaxIncentive,
  BudgetSettings,
  Category,
  DetailLine,
  GlobalDef,
  NumericDetailField,
} from './model';
import type { Totals } from './topsheet';

/**
 * The calculation engine: a line's subtotal is Amount × X × Rate, in the line's currency;
 * accounts add up their lines in the budget's currency (see currency.ts), and fringes are posted
 * where the budget's settings say (see calculateTotals).
 */

const BLANK: Record<NumericDetailField, string> = { amount: '0', x: '1', rate: '0' };
const NUMERIC_FIELDS = Object.keys(BLANK) as NumericDetailField[];

/** Amount × X × Rate, rounded per the budget's policy. */
export function lineSubtotal(
  d: Pick<DetailLine, NumericDetailField>,
  policy: BudgetSettings['rounding'],
): Decimal {
  const product = NUMERIC_FIELDS.reduce((v, f) => v.times(toDecimal(d[f])), toDecimal(1));
  return applyRounding(product, policy);
}

/**
 * Sets Amount, X or Rate from what was typed: a number ("1,250"), a global ("SW") or a
 * formula ("SW*5"). A formula is kept so the line follows its globals; blank resets the field.
 */
export function setLineNumber(
  budget: Budget,
  lineId: string,
  field: NumericDetailField,
  text: string,
): Budget {
  const typed = text.trim();
  const number = typed === '' ? toDecimal(BLANK[field]) : plainNumber(typed);
  const evaluated =
    number === null ? evaluateFormula(typed, globalLookup(resolveGlobals(budget.settings.globals))) : null;
  return mapLines(budget, (d) => {
    if (d.id !== lineId) return d;
    const formulas = { ...d.formulas };
    if (evaluated) formulas[field] = evaluated.formula;
    else delete formulas[field];
    const value = (evaluated?.value ?? number!).toFixed();
    const next: DetailLine = {
      ...d,
      [field]: value,
      formulas,
      formulasInferred: d.formulasInferred && Object.keys(formulas).length > 0,
      globalsUsed: globalsAfter(d, field, evaluated?.globals ?? []),
    };
    return { ...next, subtotal: lineSubtotal(next, budget.settings.rounding).toFixed() };
  });
}

/** The line's globals once `field` uses `now`: drops ones only the old formula used. */
function globalsAfter(d: DetailLine, field: NumericDetailField, now: readonly string[]): string[] {
  const elsewhere = new Set(
    NUMERIC_FIELDS.filter((f) => f !== field).flatMap((f) => formulaNames(d.formulas[f] ?? '')),
  );
  const old = new Set(formulaNames(d.formulas[field] ?? '').map((n) => n.toLowerCase()));
  const kept = d.globalsUsed.filter((g) => !old.has(g.toLowerCase()) || elsewhere.has(g));
  return [...new Set([...kept, ...now])];
}

/**
 * Changes the budget's rounding and works line subtotals out again under it. Only lines whose
 * subtotal is Amount × X × Rate under the old rounding change; a line kept as the imported
 * file had it (one that doesn't add up) is left alone. Fringes follow on the next calculation.
 */
export function setRounding(budget: Budget, rounding: BudgetSettings['rounding']): Budget {
  const old = budget.settings.rounding;
  if (old === rounding) return budget;
  const next = { ...budget, settings: { ...budget.settings, rounding } };
  return mapLines(next, (d) => {
    if (!toDecimal(d.subtotal).equals(lineSubtotal(d, old))) return d;
    const subtotal = lineSubtotal(d, rounding);
    return subtotal.equals(toDecimal(d.subtotal)) ? d : { ...d, subtotal: subtotal.toFixed() };
  });
}

/** Works every formula out again (after a global changes) and updates the lines it moves. */
export function recalculateFormulas(budget: Budget): Budget {
  const lookup = globalLookup(resolveGlobals(budget.settings.globals));
  return mapLines(budget, (d) => {
    let next = d;
    for (const field of NUMERIC_FIELDS) {
      const formula = d.formulas[field];
      if (formula === undefined) continue;
      try {
        const value = evaluateFormula(formula, lookup).value.toFixed();
        if (value !== next[field]) next = { ...next, [field]: value };
      } catch (e) {
        // A global that's gone or blank leaves the last value in place.
        if (!(e instanceof EditError)) throw e;
      }
    }
    return next === d ? d : { ...next, subtotal: lineSubtotal(next, budget.settings.rounding).toFixed() };
  });
}

/** Adds a global. */
export function addGlobal(budget: Budget, def: Omit<GlobalDef, 'inferred'>): Budget {
  const name = def.name.trim();
  checkGlobalName(
    name,
    budget.settings.globals.map((g) => g.name),
  );
  return withGlobals(budget, [...budget.settings.globals, { ...def, name, inferred: false }]);
}

/** Changes a global's name, value or description; a rename carries through every formula. */
export function updateGlobal(
  budget: Budget,
  name: string,
  patch: Partial<Pick<GlobalDef, 'name' | 'value' | 'description'>>,
): Budget {
  const to = patch.name?.trim() ?? name;
  if (to !== name) {
    checkGlobalName(
      to,
      budget.settings.globals.filter((g) => g.name !== name).map((g) => g.name),
    );
  }
  if (patch.value !== undefined && patch.value.trim() !== '' && plainNumber(patch.value) === null) {
    // Check the formula works out from the other globals; this also refuses a loop (A uses B uses A).
    const others = budget.settings.globals.filter((g) => g.name !== name);
    evaluateFormula(patch.value, globalLookup(resolveGlobals(others)));
  }
  const globals = budget.settings.globals.map((g) =>
    g.name === name
      ? {
          ...g,
          ...patch,
          name: to,
          inferred: patch.value === undefined ? g.inferred : false,
        }
      : renameIn(g, name, to),
  );
  const renamed = to === name ? budget : renameInLines(budget, name, to);
  return withGlobals(renamed, globals);
}

/** Deletes a global. Lines that used it keep their current numbers. */
export function deleteGlobal(budget: Budget, name: string): Budget {
  const key = name.toLowerCase();
  const uses = (f: string) => formulaNames(f).some((n) => n.toLowerCase() === key);
  const unhooked = mapLines(budget, (d) => {
    const fields = NUMERIC_FIELDS.filter((f) => uses(d.formulas[f] ?? ''));
    if (fields.length === 0 && !d.globalsUsed.includes(name)) return d;
    const formulas = { ...d.formulas };
    fields.forEach((f) => delete formulas[f]);
    return { ...d, formulas, globalsUsed: d.globalsUsed.filter((g) => g !== name) };
  });
  return withGlobals(
    unhooked,
    budget.settings.globals.filter((g) => g.name !== name),
  );
}

/** How many lines use a global. */
export function globalUseCount(budget: Budget, name: string): number {
  let n = 0;
  forLines(budget, (d) => {
    if (d.globalsUsed.some((g) => g.toLowerCase() === name.toLowerCase())) n++;
  });
  return n;
}

function withGlobals(budget: Budget, globals: GlobalDef[]): Budget {
  return recalculateFormulas({ ...budget, settings: { ...budget.settings, globals } });
}

function renameFormula(formula: string, from: string, to: string): string {
  const key = from.toLowerCase();
  return formula.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => (n.toLowerCase() === key ? to : n));
}

function renameIn(g: GlobalDef, from: string, to: string): GlobalDef {
  if (from === to) return g;
  const value = renameFormula(g.value, from, to);
  return value === g.value ? g : { ...g, value };
}

function renameInLines(budget: Budget, from: string, to: string): Budget {
  return mapLines(budget, (d) => {
    if (
      !d.globalsUsed.includes(from) &&
      !Object.values(d.formulas).some((f) => formulaNames(f).includes(from))
    ) {
      return d;
    }
    const formulas = Object.fromEntries(
      Object.entries(d.formulas).map(([k, f]) => [k, renameFormula(f, from, to)]),
    ) as DetailLine['formulas'];
    return { ...d, formulas, globalsUsed: d.globalsUsed.map((g) => (g === from ? to : g)) };
  });
}

// ---------------------------------------------------------------------------------------------
// Totals

export interface BudgetTotals {
  /** Per account id. `fringe` is the account's own fringes; `total` includes fringes posted to it. */
  accounts: Map<string, Totals>;
  categories: Map<string, Totals>;
  /**
   * Per account id: its own lines' fringes and the account id they post to: its own, another (e.g.
   * the category's fringe account) or '' for the topsheet's fringe rows.
   */
  fringeSources: Map<string, { fringe: Decimal; postedTo: string }>;
  /** Per line id: its subtotal and its own fringes, in the budget's currency. */
  lines: Map<string, { subtotal: Decimal; fringe: Decimal }>;
  /**
   * Each category's own fringes, wherever they post. Under 'production-level' and 'budget' posting
   * they're in no account or category: the topsheet shows them on fringe rows (see topsheet.ts).
   */
  categoryFringes: Map<string, Decimal>;
  /** Every category added up, with the topsheet's fringe rows, before the percentages. */
  categoriesTotal: Totals;
  /** Each of the budget's percentages: what it's worked out on, and what it comes to. */
  percentages: PercentageTotal[];
  /** The whole budget: the categories and the percentages (and incentives, when they go in it). */
  grand: Totals;
  /** Each tax incentive: its qualifying spend, the credit, and what's received (a negative amount). */
  incentives: IncentiveTotal[];
  /** What the budget costs after incentives; the grand total when they're in it already. */
  net: string;
  /** Lines with a fringe that can't be worked out yet (e.g. an hourly fringe on a unit with no hours), counted as zero. */
  unknownFringeLines: number;
  /** Lines in a currency with no rate set up, counted as zero. */
  unknownCurrencyLines: number;
  /** Fringes with nowhere to post (the fringe account doesn't exist) went on each account instead. */
  fallbackPosting: boolean;
  /** Under 'category' posting, the categories with fringes but no fringe account (by number). */
  unpostedCategories: string[];
}

/**
 * Totals for every account, category and the budget, from the lines.
 * - An account's subtotal is its lines added up. Its fringe is the fringes posted to it, which are
 *   in its total: its own lines' fringes, or others' when it's a fringe account.
 * - 'account' posting: each account's total includes its own fringes.
 * - 'category': every fringe in a category is posted to its fringe account (e.g. 1199); other
 *   accounts' totals are their lines only. A category with no fringe account keeps its fringes on
 *   each account (`fallbackPosting`).
 * - 'production-level': each level's fringes are on a fringe row of the topsheet, in that level.
 * - 'budget': all fringes are on one fringe row at the bottom of the topsheet.
 *   With these two, accounts and categories are their lines only; the categories' total adds the
 *   fringes back.
 * Variance is total − original, where original is the imported baseline (zero for new rows).
 */
export interface PercentageTotal {
  percentage: BudgetPercentage;
  base: string;
  amount: string;
}

export interface IncentiveTotal {
  incentive: TaxIncentive;
  /** The qualifying lines, with the fringes that count. */
  base: string;
  /** The credit at the program's rate. */
  credit: string;
  /** What's received, as it comes off the budget: negative. */
  amount: string;
}

export function calculateTotals(budgetAsEntered: Budget): BudgetTotals {
  // Everything from here on is in the budget's currency.
  const { budget, unknownCurrencyLines } = inBudgetCurrency(budgetAsEntered);
  const { rounding, fringes: posting } = budget.settings;
  let unknownFringeLines = 0;
  const own = new Map<string, { subtotal: Decimal; fringe: Decimal }>();
  const lines = new Map<string, { subtotal: Decimal; fringe: Decimal }>();
  /** Each line's fringes by name, for incentives that leave some out. */
  const lineFringes = new Map<string, Map<string, Decimal | null>>();
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      const amounts = accountFringes(a, budget.settings);
      let fringe = toDecimal(0);
      for (const d of a.details) {
        const byName = amounts.get(d.id);
        const values = [...(byName?.values() ?? [])];
        if (values.some((v) => v === null)) unknownFringeLines++;
        const lineFringe = sum(values.flatMap((v) => (v === null ? [] : [applyRounding(v, rounding)])));
        if (byName) lineFringes.set(d.id, byName);
        lines.set(d.id, { subtotal: toDecimal(d.subtotal), fringe: lineFringe });
        fringe = fringe.plus(lineFringe);
      }
      own.set(a.id, { subtotal: sum(a.details.map((d) => d.subtotal)), fringe });
    }
  }

  // Where each account's fringes go: the account id that receives them.
  const target = new Map<string, string>();
  let fallbackPosting = false;
  const unpostedCategories: string[] = [];
  const allAccounts = budget.categories.flatMap((c) => c.accounts);
  const toTopsheet = posting.posting === 'budget' || posting.posting === 'production-level';
  if (toTopsheet) {
    // Not in any account: the topsheet's fringe rows.
    allAccounts.forEach((a) => target.set(a.id, ''));
  } else if (posting.posting === 'category') {
    for (const c of budget.categories) {
      const to = categoryFringeAccount(c, posting.categoryAccountSuffix);
      if (to) c.accounts.forEach((a) => target.set(a.id, to.id));
      else if (c.accounts.some((a) => !own.get(a.id)!.fringe.isZero())) {
        fallbackPosting = true;
        unpostedCategories.push(c.number);
      }
    }
  }

  const posted = new Map<string, Decimal>();
  const fringeSources = new Map<string, { fringe: Decimal; postedTo: string }>();
  for (const a of allAccounts) {
    const to = target.get(a.id) ?? a.id;
    fringeSources.set(a.id, { fringe: own.get(a.id)!.fringe, postedTo: to });
    posted.set(to, (posted.get(to) ?? toDecimal(0)).plus(own.get(a.id)!.fringe));
  }

  const totals = (fringe: Decimal, total: Decimal, original: string): Totals => ({
    fringe: fringe.toFixed(),
    original,
    total: total.toFixed(),
    variance: total.minus(toDecimal(original)).toFixed(),
  });
  const accounts = new Map<string, Totals>();
  const categories = new Map<string, Totals>();
  const accountTotal = (a: Account) => {
    const o = own.get(a.id)!;
    const fringe = posted.get(a.id) ?? toDecimal(0);
    const t = totals(fringe, o.subtotal.plus(fringe), a.imported?.original ?? '0');
    accounts.set(a.id, t);
    return t;
  };
  const categoryTotal = (c: Category) => {
    const rows = c.accounts.map(accountTotal);
    const t = totals(
      sum(rows.map((r) => r.fringe)),
      sum(rows.map((r) => r.total)),
      c.imported?.original ?? sum(rows.map((r) => r.original)).toFixed(),
    );
    categories.set(c.id, t);
    return t;
  };
  const rows = budget.categories.map(categoryTotal);
  const categoryFringes = new Map(
    budget.categories.map((c) => [c.id, sum(c.accounts.map((a) => own.get(a.id)!.fringe))]),
  );
  const onTopsheet = posted.get('') ?? toDecimal(0);
  const categoriesTotal = totals(
    sum(rows.map((r) => r.fringe)).plus(onTopsheet),
    sum(rows.map((r) => r.total)).plus(onTopsheet),
    sum(rows.map((r) => r.original)).toFixed(),
  );
  const percentages = budget.settings.percentages.map((p): PercentageTotal => {
    const left = new Set(p.excludeGroups);
    let base = toDecimal(categoriesTotal.total);
    if (left.size > 0) {
      forLines(budget, (d) => {
        const t = lines.get(d.id);
        if (t && d.groups.some((g) => left.has(g))) base = base.minus(t.subtotal).minus(t.fringe);
      });
    }
    const amount = isNumber(p.percent)
      ? applyRounding(base.times(p.percent).div(100), rounding)
      : toDecimal(0);
    return { percentage: p, base: base.toFixed(), amount: amount.toFixed() };
  });
  const incentives = budget.settings.incentives.map((p): IncentiveTotal => {
    const qualifying = new Set(p.groups);
    const withFringes = p.includeFringes !== false;
    const leftOut = new Set(withFringes ? (p.excludeFringes ?? []) : []);
    let base = toDecimal(0);
    forLines(budget, (d) => {
      const t = lines.get(d.id);
      if (!t || !d.groups.some((g) => qualifying.has(g))) return;
      base = base.plus(t.subtotal);
      if (!withFringes) return;
      if (leftOut.size === 0) {
        base = base.plus(t.fringe);
        return;
      }
      for (const [name, v] of lineFringes.get(d.id) ?? []) {
        if (v !== null && !leftOut.has(name)) base = base.plus(applyRounding(v, rounding));
      }
    });
    const rate = isNumber(p.rate) ? p.rate : '0';
    const realized = isNumber(p.realized) ? p.realized : '100';
    const credit = applyRounding(base.times(rate).div(100), rounding);
    const amount = applyRounding(credit.times(realized).div(100), rounding).negated();
    return { incentive: p, base: base.toFixed(), credit: credit.toFixed(), amount: amount.toFixed() };
  });
  const incentivesTotal = sum(incentives.map((p) => p.amount));
  const inGrand = budget.settings.incentivePlacement === 'grand-total';
  const grand = totals(
    toDecimal(categoriesTotal.fringe),
    toDecimal(categoriesTotal.total)
      .plus(sum(percentages.map((p) => p.amount)))
      .plus(inGrand ? incentivesTotal : 0),
    categoriesTotal.original,
  );
  const net = (inGrand ? toDecimal(grand.total) : toDecimal(grand.total).plus(incentivesTotal)).toFixed();
  return {
    accounts,
    categories,
    fringeSources,
    lines,
    categoryFringes,
    categoriesTotal,
    percentages,
    grand,
    incentives,
    net,
    unknownFringeLines,
    unknownCurrencyLines,
    fallbackPosting,
    unpostedCategories,
  };
}

const isNumber = (v: string) => /^\s*-?\d+(\.\d+)?\s*$/.test(v);

export interface GroupTotal {
  group: string;
  lines: number;
  subtotal: string;
  fringe: string;
  total: string;
}

/** Each group's lines added up, with their fringes. A line in two groups counts in both. */
export function groupTotals(budget: Budget, totals: BudgetTotals = calculateTotals(budget)): GroupTotal[] {
  const by = new Map<string, { lines: number; subtotal: Decimal; fringe: Decimal }>(
    budget.settings.groups.map((g) => [g, { lines: 0, subtotal: toDecimal(0), fringe: toDecimal(0) }]),
  );
  forLines(budget, (d) => {
    const t = totals.lines.get(d.id);
    if (!t) return;
    for (const g of new Set(d.groups)) {
      const was = by.get(g) ?? { lines: 0, subtotal: toDecimal(0), fringe: toDecimal(0) };
      by.set(g, {
        lines: was.lines + 1,
        subtotal: was.subtotal.plus(t.subtotal),
        fringe: was.fringe.plus(t.fringe),
      });
    }
  });
  return [...by].map(([group, t]) => ({
    group,
    lines: t.lines,
    subtotal: t.subtotal.toFixed(),
    fringe: t.fringe.toFixed(),
    total: t.subtotal.plus(t.fringe).toFixed(),
  }));
}

function mapLines(budget: Budget, fn: (d: DetailLine) => DetailLine): Budget {
  let changed = false;
  const categories = budget.categories.map((c) => {
    let cChanged = false;
    const accounts = c.accounts.map((a) => {
      const details = a.details.map(fn);
      if (details.every((d, i) => d === a.details[i])) return a;
      cChanged = true;
      return { ...a, details };
    });
    if (!cChanged) return c;
    changed = true;
    return { ...c, accounts };
  });
  return changed ? { ...budget, categories } : budget;
}

function forLines(budget: Budget, fn: (d: DetailLine) => void): void {
  budget.categories.forEach((c) => c.accounts.forEach((a) => a.details.forEach(fn)));
}
