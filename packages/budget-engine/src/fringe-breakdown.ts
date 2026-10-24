import type { BudgetTotals } from './calc';
import { accountFringes, fringePools } from './fringes';
import { formatRate } from './format';
import { type Decimal, applyRounding, sum, toDecimal } from './money';
import type { Account, Budget } from './model';

/**
 * How an account's fringes add up, one row per fringe, over every line whose fringes post to it:
 * its own lines, or under 'category' posting the whole category's (on 1199 "Total Fringes").
 * Each fringe shows its rate and what it applies to, so "9.5% of 258,000.00" can be checked by
 * hand; where a cutoff stopped it, how many people reached the cutoff.
 */
export interface FringeBreakdownRow {
  name: string;
  /** null when the budget has no fringe of that name. */
  kind: 'percent' | 'flat' | null;
  rate: string;
  unit: string;
  cutoff: string | null;
  /** Percent: the pay it applied to, after cutoffs. Flat: how many of its unit. */
  base: string;
  /** Percent: all the pay on its lines, before cutoffs. */
  pay: string;
  /** People carrying it: a fringe range counts as one, any other line as one. */
  people: number;
  /** People whose pay passed the cutoff. */
  capped: number;
  amount: string;
}

/** The accounts whose lines' fringes post to `accountId` ('' for the topsheet's fringe rows). */
export function fringeSourceAccounts(budget: Budget, totals: BudgetTotals, accountId: string): Account[] {
  return budget.categories
    .flatMap((c) => c.accounts)
    .filter((a) => totals.fringeSources.get(a.id)?.postedTo === accountId);
}

export function fringeBreakdown(
  budget: Budget,
  totals: BudgetTotals,
  accounts: readonly Account[],
): FringeBreakdownRow[] {
  const defs = new Map(budget.settings.fringeDefs.map((f) => [f.name, f]));
  const rounding = budget.settings.rounding;
  const rows = new Map<
    string,
    { base: Decimal; pay: Decimal; people: number; capped: number; amount: Decimal }
  >();
  for (const a of accounts) {
    const amounts = accountFringes(a, budget.settings);
    for (const pool of fringePools(a)) {
      const inPool = new Map<string, { base: Decimal; pay: Decimal; amount: Decimal }>();
      for (const d of pool) {
        const pay = totals.lines.get(d.id)?.subtotal ?? toDecimal(0);
        for (const [name, v] of amounts.get(d.id) ?? []) {
          if (v === null) continue;
          const def = defs.get(name);
          const rate = toDecimal(def?.rate ?? '0');
          // What the amount was worked out on: rate × base, before rounding.
          const base = rate.isZero()
            ? def?.kind === 'percent'
              ? pay
              : toDecimal(0)
            : def?.kind === 'percent'
              ? v.times(100).dividedBy(rate)
              : v.dividedBy(rate);
          const was = inPool.get(name) ?? { base: toDecimal(0), pay: toDecimal(0), amount: toDecimal(0) };
          inPool.set(name, {
            base: was.base.plus(base),
            pay: was.pay.plus(pay),
            amount: was.amount.plus(applyRounding(v, rounding)),
          });
        }
      }
      for (const [name, p] of inPool) {
        const was = rows.get(name) ?? {
          base: toDecimal(0),
          pay: toDecimal(0),
          people: 0,
          capped: 0,
          amount: toDecimal(0),
        };
        const capped = defs.get(name)?.kind === 'percent' && p.base.lessThan(p.pay);
        rows.set(name, {
          base: was.base.plus(p.base),
          pay: was.pay.plus(p.pay),
          people: was.people + 1,
          capped: was.capped + (capped ? 1 : 0),
          amount: was.amount.plus(p.amount),
        });
      }
    }
  }
  // In the order the budget lists its fringes.
  const order = budget.settings.fringeDefs.map((f) => f.name);
  return [...rows]
    .sort(([x], [y]) => rank(order, x) - rank(order, y))
    .map(([name, r]) => {
      const def = defs.get(name);
      return {
        name,
        kind: def?.kind ?? null,
        rate: def?.rate ?? '0',
        unit: def?.unit ?? '',
        cutoff: def?.cutoff ?? null,
        base: r.base.toFixed(),
        pay: r.pay.toFixed(),
        people: r.people,
        capped: r.capped,
        amount: r.amount.toFixed(),
      };
    });
}

const rank = (order: readonly string[], name: string) => {
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
};

/** The breakdown's total: what the account's Fringes add up to. */
export function breakdownTotal(rows: readonly FringeBreakdownRow[]): string {
  return sum(rows.map((r) => r.amount)).toFixed();
}

/**
 * A breakdown row in words, for the screen and the reports: its rate ("9.5%", "500.00 per
 * Weeks"), what it applies to ("258,000.00", "8 Weeks") and who reached its cutoff.
 */
export function breakdownWords(
  r: FringeBreakdownRow,
  money: (v: string) => string,
): { rate: string; appliesTo: string; cutoff: string } {
  if (r.kind !== 'percent') {
    const unit = r.unit || 'unit';
    return {
      rate: r.kind === 'flat' ? `${formatRate(r.rate)} per ${unit}` : '',
      appliesTo: r.kind === 'flat' ? `${formatRate(r.base)} ${unit}` : '',
      cutoff: '',
    };
  }
  const who =
    r.capped === r.people
      ? `${r.capped} ${r.capped === 1 ? 'person' : 'people'}`
      : `${r.capped} of ${r.people} people`;
  return {
    rate: `${r.rate}%`,
    appliesTo: money(r.base),
    cutoff: r.capped > 0 && r.cutoff !== null ? `${who} at the ${money(r.cutoff)} cutoff` : '',
  };
}
