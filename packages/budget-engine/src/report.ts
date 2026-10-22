import { calculateTotals } from './calc';
import { accountFringes, baseUnit, hoursOf, poolBase, postingScopes, unitCount } from './fringes';
import { type Decimal, sum, toDecimal } from './money';
import type { Account, Budget, Category, FringeDef, PostedFringe } from './model';

/**
 * What an import worked out that the file doesn't say (global values, cutoffs, hours per unit,
 * fringe ranges) and where the budget still doesn't come to the file's totals, with the likely
 * reason. Worked out from the budget as it is now, so it updates as things are fixed.
 */
export interface ImportReport {
  importedTotal: string;
  calculatedTotal: string;
  globals: { name: string; value: string }[];
  /** Globals the file names whose values couldn't be worked out. */
  globalsMissing: string[];
  /** Lines with a global placed in a field. */
  linesWithGlobals: number;
  cutoffs: { name: string; cutoff: string }[];
  unitHours: { name: string; hours: string }[];
  ranges: number;
  accounts: number;
  /** Accounts off by less than a dollar: rounding. */
  rounding: number;
  mismatches: ReportMismatch[];
  /** Lines with a fringe that can't be worked out, counted as zero. */
  unknownFringes: ReportLine[];
}

export interface ReportMismatch {
  categoryId: string;
  accountId: string;
  number: string;
  description: string;
  imported: string;
  calculated: string;
  difference: string;
  reasons: string[];
}

export interface ReportLine {
  categoryId: string;
  accountId: string;
  number: string;
  line: string;
  fringe: string;
  reason: string;
}

const money = (d: Decimal) => d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function importReport(budget: Budget): ImportReport {
  const totals = calculateTotals(budget);
  const defs = new Map(budget.settings.fringeDefs.map((f) => [f.name, f]));
  const units = budget.settings.units;
  const where = new Map<string, Category>();
  budget.categories.forEach((c) => c.accounts.forEach((a) => where.set(a.id, c)));
  const fringes = new Map(
    budget.categories.flatMap((c) => c.accounts.map((a) => [a.id, accountFringes(a, budget.settings)])),
  );

  /** This budget's amount of one fringe over some accounts. */
  const fringeAmount = (accounts: readonly Account[], name: string) =>
    sum(
      accounts.flatMap((a) =>
        [...fringes.get(a.id)!.values()].flatMap((line) => {
          const v = line.get(name);
          return v ? [v.toString()] : [];
        }),
      ),
    );

  const reasonsFor = new Map<string, string[]>();
  for (const scope of postingScopes(budget)) {
    const reasons: string[] = [];
    for (const p of scope.posted) {
      if (fringeAmount(scope.accounts, p.name).minus(toDecimal(p.total)).abs().lessThan(1)) continue;
      reasons.push(fringeReason(p, defs.get(p.name), scope.accounts, scope.pools, units, fringeAmount));
    }
    reasonsFor.set(scope.holder.id, reasons);
  }

  const mismatches: ReportMismatch[] = [];
  let rounding = 0;
  let accounts = 0;
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      accounts++;
      const imported = toDecimal(a.imported?.total ?? '0');
      const calculated = toDecimal(totals.accounts.get(a.id)!.total);
      const difference = calculated.minus(imported);
      if (difference.abs().lessThan(0.01)) continue;
      if (difference.abs().lessThan(1)) {
        rounding++;
        continue;
      }
      const reasons = [...(reasonsFor.get(a.id) ?? [])];
      const lines = sum(a.details.map((d) => totals.lines.get(d.id)?.subtotal ?? toDecimal(0)));
      const fileLines = imported.minus(sum(a.postedFringes.map((p) => p.total)));
      if (lines.minus(fileLines).abs().greaterThanOrEqualTo(1)) {
        reasons.unshift(`The lines add up to ${money(lines)}; in the file they come to ${money(fileLines)}.`);
      }
      if (!reasons.length)
        reasons.push('No fringe or line differs on its own; check the fringes posted here.');
      mismatches.push({
        categoryId: c.id,
        accountId: a.id,
        number: a.number,
        description: a.description,
        imported: imported.toFixed(2),
        calculated: calculated.toFixed(2),
        difference: difference.toFixed(2),
        reasons,
      });
    }
  }

  const unknownFringes: ReportLine[] = [];
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      for (const d of a.details) {
        for (const [name, v] of fringes.get(a.id)!.get(d.id) ?? []) {
          if (v !== null) continue;
          const f = defs.get(name);
          unknownFringes.push({
            categoryId: c.id,
            accountId: a.id,
            number: a.number,
            line: d.description || '(no description)',
            fringe: name,
            reason: f
              ? `${name} is per ${f.unit}, and ${d.unit || 'this line’s unit'} has no hours to convert from.`
              : `There's no fringe called ${name}.`,
          });
        }
      }
    }
  }

  const values = new Map(budget.settings.globals.map((g) => [g.name, g.value]));
  return {
    importedTotal: sum(budget.categories.map((c) => c.imported?.total ?? '0')).toFixed(2),
    calculatedTotal: toDecimal(totals.categoriesTotal.total).toFixed(2),
    globals: budget.settings.globals.filter((g) => g.inferred).map((g) => ({ name: g.name, value: g.value })),
    globalsMissing: [...values].filter(([, v]) => v.trim() === '').map(([n]) => n),
    linesWithGlobals: budget.categories
      .flatMap((c) => c.accounts.flatMap((a) => a.details))
      .filter((d) => d.formulasInferred && Object.keys(d.formulas).length > 0).length,
    cutoffs: budget.settings.fringeDefs
      .filter((f) => f.cutoffInferred && f.cutoff)
      .map((f) => ({ name: f.name, cutoff: f.cutoff! })),
    unitHours: units
      .filter((u) => u.hoursInferred && u.hours)
      .map((u) => ({ name: u.name, hours: u.hours! })),
    ranges: budget.categories.flatMap((c) => c.accounts.flatMap((a) => a.fringeRanges)).length,
    accounts,
    rounding,
    mismatches,
    unknownFringes,
  };
}

/** Why one posted fringe doesn't come to the file's amount, as far as the numbers show. */
function fringeReason(
  p: PostedFringe,
  f: FringeDef | undefined,
  accounts: readonly Account[],
  pools: Parameters<typeof poolBase>[0],
  units: Budget['settings']['units'],
  fringeAmount: (accounts: readonly Account[], name: string) => Decimal,
): string {
  const ours = fringeAmount(accounts, p.name);
  const fallback = `${p.name} comes to ${money(ours)}; the file has ${money(toDecimal(p.total))}.`;
  if (!f) return `There's no fringe called ${p.name}; add it in Budget Settings → Fringes.`;
  if (f.kind !== p.kind || !toDecimal(f.rate).equals(toDecimal(p.rate))) {
    return `${p.name}'s rate here is ${f.rate}; the file uses ${p.rate} for these lines.`;
  }
  const fileBase = toDecimal(p.base);
  if (f.kind === 'flat') {
    const lines = accounts.flatMap((a) => a.details).filter((d) => d.fringes.includes(p.name));
    const noHours = [
      ...new Set(lines.filter((d) => unitCount(d, f.unit, units) === null).map((d) => d.unit || '(none)')),
    ];
    if (noHours.length) {
      const needs = baseUnit(f.unit) !== 'hour' && hoursOf(f.unit, units) === null ? [f.unit] : [];
      return `${p.name} is per ${f.unit}, but ${[...noHours, ...needs].join(', ')} ${noHours.length + needs.length > 1 ? 'have' : 'has'} no hours set, so those lines can't be counted. Set the hours in Budget Settings → Units.`;
    }
    const count = sum(lines.map((d) => unitCount(d, f.unit, units)!.toString()));
    if (count.minus(fileBase).abs().greaterThanOrEqualTo(0.01)) {
      return `${p.name} counts ${count.toDecimalPlaces(2).toFixed()} ${f.unit} here; the file counts ${fileBase.toFixed()}. Check the units and hours on these lines.`;
    }
    return fallback;
  }
  const base = poolBase(pools, p.name, f.cutoff);
  const over = base.minus(fileBase);
  if (over.abs().lessThan(0.01)) return fallback;
  if (f.cutoff === null) {
    return over.isPositive()
      ? `${p.name} has no cutoff: its base here is ${money(base)}, the file's is ${money(fileBase)}, and no round cutoff gives that. Set the cutoff, or check the fringe ranges.`
      : `${p.name}'s base here is ${money(base)}, below the file's ${money(fileBase)}. A line may be missing this fringe.`;
  }
  const people = over.dividedBy(toDecimal(f.cutoff));
  if (people.isInteger() || people.minus(people.round()).abs().lessThan(0.0001)) {
    const n = people.abs().round().toNumber();
    return over.isPositive()
      ? `${p.name}'s base is ${n} × its ${money(toDecimal(f.cutoff))} cutoff above the file's: ${n === 1 ? 'one person’s lines look' : `${n} people’s lines look`} split across ranges. Put each person's lines in one fringe range.`
      : `${p.name}'s base is ${n} × its ${money(toDecimal(f.cutoff))} cutoff below the file's: ${n === 1 ? 'a fringe range looks' : `${n} fringe ranges look`} to hold two people. Split them.`;
  }
  return `${p.name}'s base here is ${money(base)}; the file's is ${money(fileBase)}. Check the fringe ranges and cutoff (${money(toDecimal(f.cutoff))}).`;
}
