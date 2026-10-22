import { type BudgetTotals, calculateTotals } from './calc';
import type { Account, Budget, Category, DetailLine, FringeDef, ProductionLevel } from './model';
import { type Decimal, sum } from './money';
import { levelOf, sortedLevels } from './topsheet';

/**
 * The crew list: every line that pays a person, for a one-page look at the budget's labor.
 * A line is labor when it carries one of the crew fringes, workers' comp by default: people on
 * payroll and loan-outs pay it, box and kit rentals don't (and every line pays the payroll fee,
 * so that can't tell them apart). The user can choose other fringes in the budget's settings.
 */

/** Workers' comp, however a budget names it: "WC", "W/C", "Workers Comp", "Work Comp"… */
const WORKERS_COMP = /^w\s*[/.&]?\s*c\b|work(?:er)?['’]?s?['’]?\s*comp/i;

/** The fringes that mark labor when the budget hasn't chosen: its workers' comp fringes. */
export function defaultCrewFringes(defs: readonly FringeDef[]): string[] {
  return defs.filter((f) => WORKERS_COMP.test(f.name.trim())).map((f) => f.name);
}

/** The fringes that mark a line as labor in this budget. */
export function crewFringes(budget: Budget): string[] {
  return budget.settings.crewFringes ?? defaultCrewFringes(budget.settings.fringeDefs);
}

export interface CrewLine {
  line: DetailLine;
  account: Account;
  /** What the line pays, before fringes. */
  wages: Decimal;
  fringes: Decimal;
}

export interface CrewCategory {
  category: Category;
  lines: CrewLine[];
  wages: Decimal;
  fringes: Decimal;
}

export interface CrewLevel {
  /** Null when the budget has no production levels. */
  level: ProductionLevel | null;
  categories: CrewCategory[];
  wages: Decimal;
  fringes: Decimal;
}

export interface CrewList {
  /** The fringes that marked the lines. */
  fringes: string[];
  levels: CrewLevel[];
  /** People: lines sharing a fringe range are one person's, other lines one each. */
  positions: number;
  wages: Decimal;
  fringeTotal: Decimal;
}

const add = <T extends { wages: Decimal; fringes: Decimal }>(items: readonly T[]) => ({
  wages: sum(items.map((i) => i.wages)),
  fringes: sum(items.map((i) => i.fringes)),
});

/** The budget's labor, by production level and category, in budget order. Lines that come to nothing are left out. */
export function crewList(
  budget: Budget,
  totals: BudgetTotals = calculateTotals(budget),
  fringes: readonly string[] = crewFringes(budget),
): CrewList {
  const marks = new Set(fringes);
  const levels = sortedLevels(budget.settings.coa.levels);
  const byLevel = new Map<string | null, CrewCategory[]>();
  let positions = 0;
  for (const category of budget.categories) {
    const lines: CrewLine[] = [];
    for (const account of category.accounts) {
      const people = new Set<string>();
      for (const line of account.details) {
        if (!line.fringes.some((f) => marks.has(f))) continue;
        const t = totals.lines.get(line.id);
        if (!t || (t.subtotal.isZero() && t.fringe.isZero())) continue;
        lines.push({ line, account, wages: t.subtotal, fringes: t.fringe });
        const range = account.fringeRanges.find((r) => r.lineIds.includes(line.id));
        people.add(range ? range.id : line.id);
      }
      positions += people.size;
    }
    if (lines.length === 0) continue;
    const key = levelOf(category.number, levels)?.id ?? null;
    byLevel.set(key, [...(byLevel.get(key) ?? []), { category, lines, ...add(lines) }]);
  }
  const out: CrewLevel[] = [];
  for (const level of levels.length > 0 ? levels : [null]) {
    const categories = byLevel.get(level?.id ?? null);
    if (categories) out.push({ level, categories, ...add(categories) });
  }
  const all = add(out);
  return { fringes: [...fringes], levels: out, positions, wages: all.wages, fringeTotal: all.fringes };
}
