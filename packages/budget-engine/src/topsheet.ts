import { type BudgetTotals, calculateTotals } from './calc';
import type { Budget, Category, ImportedTotals, ProductionLevel } from './model';
import { sum } from './money';

/**
 * Topsheet layout: categories grouped into production levels (Above-The-Line,
 * Below-The-Line, …), each followed by its total, then the grand total. With 'production-level'
 * fringe posting each level has a fringe row before its total; with 'budget' posting one fringe row
 * follows every level.
 *
 * Totals are calculated from the lines (see calc.ts); imported figures are kept for comparison.
 */

export interface Totals {
  fringe: string;
  original: string;
  total: string;
  variance: string;
}

export type TopsheetRow =
  | { kind: 'category'; category: Category; totals: Totals }
  | { kind: 'level'; level: ProductionLevel; totals: Totals }
  /** Fringes posted to the topsheet: a level's (level set) or the whole budget's. */
  | { kind: 'fringes'; number: string; level: ProductionLevel | null; totals: Totals };

export const ZERO_TOTALS: Totals = { fringe: '0', original: '0', total: '0', variance: '0' };

/** Imported figures as totals, for comparison with calculated ones. */
export function totalsOf(imported: ImportedTotals | null): Totals {
  if (!imported) return ZERO_TOTALS;
  return { ...imported, fringe: imported.fringe ?? '0' };
}

export function addTotals(rows: readonly Totals[]): Totals {
  return {
    fringe: sum(rows.map((r) => r.fringe)).toFixed(),
    original: sum(rows.map((r) => r.original)).toFixed(),
    total: sum(rows.map((r) => r.total)).toFixed(),
    variance: sum(rows.map((r) => r.variance)).toFixed(),
  };
}

/** A number's digits as a number (11-00 → 1100), to compare with where production totals start. */
function asNumber(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** Levels ordered by starting number (levels with a non-numeric start keep their place at the front). */
export function sortedLevels(levels: readonly ProductionLevel[]): ProductionLevel[] {
  return [...levels].sort((a, b) => (asNumber(a.from) ?? -1) - (asNumber(b.from) ?? -1));
}

/** The production level a category number falls in; numbers below every level, or non-numeric, go to the first. */
export function levelOf(
  categoryNumber: string,
  levels: readonly ProductionLevel[],
): ProductionLevel | undefined {
  const sorted = sortedLevels(levels);
  const n = asNumber(categoryNumber);
  if (n === null) return sorted[0];
  let found = sorted[0];
  for (const level of sorted) {
    const from = asNumber(level.from);
    if (from !== null && from <= n) found = level;
  }
  return found;
}

export function topsheet(
  budget: Budget,
  totals: BudgetTotals = calculateTotals(budget),
): {
  rows: TopsheetRow[];
  categoriesTotal: Totals;
  percentages: BudgetTotals['percentages'];
  grandTotal: Totals;
  incentives: BudgetTotals['incentives'];
  net: string;
} {
  const of = (c: Category) => totals.categories.get(c.id) ?? ZERO_TOTALS;
  const { posting, levelAccounts, budgetAccount } = budget.settings.fringes;
  const fringesOf = (cs: readonly Category[]) =>
    sum(cs.map((c) => totals.categoryFringes.get(c.id) ?? '0')).toFixed();
  const fringeRow = (number: string, level: ProductionLevel | null, cs: readonly Category[]) => {
    const fringe = fringesOf(cs);
    return {
      kind: 'fringes' as const,
      number,
      level,
      totals: { fringe, original: '0', total: fringe, variance: fringe },
    };
  };
  const levels = sortedLevels(budget.settings.coa.levels);
  const byLevel = new Map<string, Category[]>(levels.map((l) => [l.id, []]));
  const unleveled: Category[] = [];
  for (const c of budget.categories) {
    const level = levelOf(c.number, levels);
    (level ? byLevel.get(level.id)! : unleveled).push(c);
  }

  const rows: TopsheetRow[] = unleveled.map((c) => ({
    kind: 'category',
    category: c,
    totals: of(c),
  }));
  if (posting === 'production-level' && unleveled.length > 0) rows.push(fringeRow('', null, unleveled));
  for (const level of levels) {
    const categories = byLevel.get(level.id)!;
    if (categories.length === 0) continue;
    const categoryRows = categories.map((c) => ({
      kind: 'category' as const,
      category: c,
      totals: of(c),
    }));
    const inLevel: TopsheetRow[] = categoryRows;
    if (posting === 'production-level')
      inLevel.push(fringeRow(levelAccounts[level.id] ?? '', level, categories));
    rows.push(...inLevel, {
      kind: 'level',
      level,
      totals: addTotals(inLevel.map((r) => r.totals)),
    });
  }
  if (posting === 'budget' && budget.categories.length > 0)
    rows.push(fringeRow(budgetAccount, null, budget.categories));

  return {
    rows,
    categoriesTotal: totals.categoriesTotal,
    percentages: totals.percentages,
    grandTotal: totals.grand,
    incentives: totals.incentives,
    net: totals.net,
  };
}
