import { convertedSubtotal, lineCurrency } from './currency';
import { type Decimal, sum, toDecimal } from './money';
import {
  type Account,
  type Budget,
  type BudgetSettings,
  type DetailLine,
  type FringeDef,
  type PostedFringe,
  type UnitDef,
} from './model';

/** Fringe amount per fringe on one line; null where it can't be worked out yet. */
export type LineFringes = Map<string, Decimal | null>;

/**
 * The account's lines as they are fringed together: each fringe range is one pool (one
 * person), and every other line is a pool of its own. Lines keep account order.
 */
export function fringePools(account: Account): DetailLine[][] {
  const byId = new Map(account.details.map((d) => [d.id, d]));
  const inRange = new Set(account.fringeRanges.flatMap((r) => r.lineIds));
  const pools = account.fringeRanges.map((r) =>
    r.lineIds.map((id) => byId.get(id)).filter((d): d is DetailLine => d !== undefined),
  );
  account.details.forEach((d) => inRange.has(d.id) || pools.push([d]));
  return pools;
}

/**
 * Each line's fringes. Percent fringes apply to the line's subtotal up to the fringe's cutoff;
 * in a fringe range the cutoff is shared, used up line by line in order, so once one person's
 * pay passes it the later lines pay none of that fringe. Flat fringes are rate × the line's
 * count of the fringe's unit (hours come from the budget's unit setup). Amounts are in the
 * budget's currency: a line in another currency is converted first (see currency.ts).
 */
export function accountFringes(account: Account, settings: BudgetSettings): Map<string, LineFringes> {
  const defs = new Map(settings.fringeDefs.map((f) => [f.name, f]));
  const converted = (d: DetailLine): DetailLine =>
    lineCurrency(d, settings) === ''
      ? d
      : { ...d, currency: '', subtotal: (convertedSubtotal(d, settings) ?? toDecimal(0)).toFixed() };
  const pools = fringePools(account).map((pool) => pool.map(converted));
  return poolFringes(pools, (name) => defs.get(name), settings.units);
}

function poolFringes(
  pools: readonly (readonly DetailLine[])[],
  def: (name: string) => FringeDef | undefined,
  units: readonly UnitDef[],
): Map<string, LineFringes> {
  const out = new Map<string, LineFringes>();
  for (const pool of pools) {
    const used = new Map<string, Decimal>();
    for (const d of pool) {
      const line: LineFringes = new Map();
      for (const name of d.fringes) {
        const f = def(name);
        if (!f) {
          line.set(name, null);
        } else if (f.kind === 'percent') {
          const taxable = cappedBase(toDecimal(d.subtotal), f.cutoff, used, name);
          line.set(name, taxable.times(toDecimal(f.rate)).dividedBy(100));
        } else {
          const count = unitCount(d, f.unit, units);
          line.set(name, count === null ? null : count.times(toDecimal(f.rate)));
        }
      }
      out.set(d.id, line);
    }
  }
  return out;
}

/** The part of a subtotal under what's left of the cutoff; records what it used. */
function cappedBase(
  subtotal: Decimal,
  cutoff: string | null,
  used: Map<string, Decimal>,
  name: string,
): Decimal {
  if (cutoff === null || subtotal.isNegative()) return subtotal;
  const before = used.get(name) ?? toDecimal(0);
  const room = toDecimal(cutoff).minus(before);
  const taxable = room.isNegative() ? toDecimal(0) : subtotal.lessThan(room) ? subtotal : room;
  used.set(name, before.plus(taxable));
  return taxable;
}

/**
 * How many of a flat fringe's unit a line works: its amount when the units match ("Week" and
 * "Weeks-45 Hours" both count weeks), or else through hours: amount × hours per line unit,
 * divided by hours per fringe unit (so 10 ten-hour days count as 2 fifty-hour weeks).
 */
export function unitCount(
  d: Pick<DetailLine, 'amount' | 'unit'>,
  fringeUnit: string,
  units: readonly UnitDef[],
): Decimal | null {
  const want = baseUnit(fringeUnit);
  if (!want) return null;
  // A line with no unit (a name or note line) works no time.
  if (!d.unit.trim()) return toDecimal(0);
  if (baseUnit(d.unit) === want) return toDecimal(d.amount);
  const hours = hoursOf(d.unit, units);
  if (hours === null) return null;
  const worked = toDecimal(d.amount).times(hours);
  if (want === 'hour') return worked;
  const per = hoursOf(fringeUnit, units);
  return per === null || per.isZero() ? null : worked.dividedBy(per);
}

/**
 * Hours one unit stands for: its own setting, or for a plain name ("Day", "Days") any plain
 * unit of the same kind that has hours. Null when not known.
 */
export function hoursOf(unit: string, units: readonly UnitDef[]): Decimal | null {
  const own = units.find((u) => u.name === unit)?.hours;
  if (own) return toDecimal(own);
  if (unit.includes('-')) return null;
  const base = baseUnit(unit);
  const same = units.find((u) => u.hours && !u.name.includes('-') && baseUnit(u.name) === base);
  return same ? toDecimal(same.hours!) : null;
}

/** "Weeks-45 Hours" → "week", "Days" → "day". */
export function baseUnit(unit: string): string {
  return unit.split('-')[0]!.trim().toLowerCase().replace(/s$/, '');
}

/** A line's fringes added up; null when it has none, or any can't be worked out. */
export function fringeTotal(line: LineFringes | undefined): Decimal | null {
  if (!line || line.size === 0) return null;
  const amounts = [...line.values()];
  return amounts.every((a) => a !== null) ? sum(amounts.map((a) => a!.toString())) : null;
}

/** An account holding fringe postings, with the accounts and lines those postings cover. */
export interface PostingScope {
  holder: Account;
  posted: readonly PostedFringe[];
  accounts: readonly Account[];
  pools: DetailLine[][];
}

/** The lines each fringe posting covers, by the budget's posting setting. */
export function postingScopes(budget: Budget): PostingScope[] {
  const every = budget.categories.flatMap((c) => c.accounts);
  const posting = budget.settings.fringes.posting;
  return budget.categories.flatMap((c) =>
    c.accounts
      .filter((a) => a.postedFringes.length > 0)
      .map((a) => {
        const accounts = posting === 'budget' ? every : posting === 'account' ? [a] : c.accounts;
        return { holder: a, posted: a.postedFringes, accounts, pools: accounts.flatMap(fringePools) };
      }),
  );
}

/** Taxable base for one fringe over some pools, at a given cutoff. */
export function poolBase(
  pools: readonly (readonly DetailLine[])[],
  name: string,
  cutoff: string | null,
): Decimal {
  const amounts: Decimal[] = [];
  for (const pool of pools) {
    const used = new Map<string, Decimal>();
    for (const d of pool) {
      if (d.fringes.includes(name)) amounts.push(cappedBase(toDecimal(d.subtotal), cutoff, used, name));
    }
  }
  return sum(amounts.map((a) => a.toString()));
}
