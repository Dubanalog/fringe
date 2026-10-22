import { type BudgetTotals, calculateTotals } from './calc';
import { type ChangeDetail, describeChange } from './changes';
import { formatMoney } from './format';
import type { Account, Budget, Category, DisplayPrecision } from './model';
import { toDecimal } from './money';
import { incentiveLabel, percentageLabel } from './percentages';
import { topsheet } from './topsheet';

/**
 * Two states of a budget side by side, e.g. version 1.0 as it was sent and the budget now: each
 * category and account that moved, the totals before and after, and every change in between.
 * Accounts are matched by id (so a renumbered account is still the same account), then by number.
 */
export interface ComparedRow {
  number: string;
  name: string;
  /** Exact decimal strings; '0' when it isn't in that budget. */
  before: string;
  after: string;
  difference: string;
  /** In only one of the two. */
  status: 'added' | 'deleted' | null;
}

export interface ComparedCategory extends ComparedRow {
  /** The accounts whose total changed. */
  accounts: ComparedRow[];
}

export interface BudgetComparison {
  /** Categories with a changed total or a changed account, in the newer budget's order. */
  categories: ComparedCategory[];
  /** Totals at the bottom of the topsheet: production total, percentages, grand total, incentives, net. */
  totals: ComparedRow[];
  details: ChangeDetail[];
}

const name = (x: { description: string }) => x.description.trim();

function compared(
  number: string,
  label: string,
  before: string | undefined,
  after: string | undefined,
): ComparedRow {
  const b = toDecimal(before ?? '0');
  const a = toDecimal(after ?? '0');
  return {
    number,
    name: label,
    before: b.toFixed(),
    after: a.toFixed(),
    difference: a.minus(b).toFixed(),
    status: before === undefined ? 'added' : after === undefined ? 'deleted' : null,
  };
}

const changed = (r: ComparedRow) => r.status !== null || !toDecimal(r.difference).isZero();

/** Finds an item's match in the other budget: by id, then by number. */
function matcher<T extends { id: string; number: string }>(items: readonly T[]) {
  const byId = new Map(items.map((x) => [x.id, x]));
  const byNumber = new Map(items.filter((x) => x.number.trim()).map((x) => [x.number.trim(), x]));
  const used = new Set<string>();
  return {
    find(x: T): T | undefined {
      const m = byId.get(x.id) ?? (x.number.trim() ? byNumber.get(x.number.trim()) : undefined);
      if (!m || used.has(m.id)) return undefined;
      used.add(m.id);
      return m;
    },
    unused: () => items.filter((x) => !used.has(x.id)),
  };
}

export function compareBudgets(before: Budget, after: Budget): BudgetComparison {
  const bt = calculateTotals(before);
  const at = calculateTotals(after);
  const total = (t: BudgetTotals, kind: 'categories' | 'accounts', id: string) =>
    (kind === 'categories' ? t.categories : t.accounts).get(id)?.total ?? '0';

  // Categories are matched first; accounts across the whole budget, so a moved one still matches.
  const categories = matcher<Category>(before.categories);
  const wasCategory = new Map(after.categories.map((c) => [c.id, categories.find(c)]));
  const goneCategories = categories.unused();
  const accounts = matcher<Account & { category: string }>(
    before.categories.flatMap((c) => c.accounts.map((a) => ({ ...a, category: c.id }))),
  );
  const rows = new Map<string, ComparedRow[]>();
  for (const c of after.categories) {
    rows.set(
      c.id,
      c.accounts.map((a) => {
        const was = accounts.find({ ...a, category: c.id });
        return compared(
          a.number,
          name(a),
          was ? total(bt, 'accounts', was.id) : undefined,
          total(at, 'accounts', a.id),
        );
      }),
    );
  }
  // A deleted account shows under its category: the one now, or the deleted one.
  const goneRows = new Map<string, ComparedRow[]>(goneCategories.map((c) => [c.id, []]));
  for (const a of accounts.unused()) {
    const r = compared(a.number, name(a), total(bt, 'accounts', a.id), undefined);
    const now = after.categories.find((c) => wasCategory.get(c.id)?.id === a.category);
    (now ? rows.get(now.id) : goneRows.get(a.category))?.push(r);
  }

  const out: ComparedCategory[] = [];
  for (const c of after.categories) {
    const was = wasCategory.get(c.id);
    const row = compared(
      c.number,
      name(c),
      was ? total(bt, 'categories', was.id) : undefined,
      total(at, 'categories', c.id),
    );
    const changedAccounts = rows.get(c.id)!.filter(changed);
    if (changed(row) || changedAccounts.length > 0) out.push({ ...row, accounts: changedAccounts });
  }
  for (const c of goneCategories) {
    out.push({
      ...compared(c.number, name(c), total(bt, 'categories', c.id), undefined),
      accounts: goneRows.get(c.id)!,
    });
  }

  const bs = topsheet(before, bt);
  const as = topsheet(after, at);
  const totals: ComparedRow[] = [];
  const hasPercentages = bs.percentages.length > 0 || as.percentages.length > 0;
  if (hasPercentages) {
    totals.push(compared('', 'Total before percentages', bs.categoriesTotal.total, as.categoriesTotal.total));
    for (const row of pairs(bs.percentages, as.percentages, (p) => p.percentage)) {
      const label = bothLabels(row.before?.percentage, row.after?.percentage, percentageLabel);
      totals.push(compared(row.item.account ?? '', label, row.before?.amount, row.after?.amount));
    }
  }
  totals.push(compared('', 'Grand Total', bs.grandTotal.total, as.grandTotal.total));
  if (bs.incentives.length > 0 || as.incentives.length > 0) {
    for (const row of pairs(bs.incentives, as.incentives, (p) => p.incentive)) {
      const label = bothLabels(row.before?.incentive, row.after?.incentive, incentiveLabel);
      totals.push(compared(row.item.account ?? '', label, row.before?.amount, row.after?.amount));
    }
    // Taken off the grand total, the net cost is the grand total: no need to say it twice.
    if (bs.net !== bs.grandTotal.total || as.net !== as.grandTotal.total)
      totals.push(compared('', 'Net Cost', bs.net, as.net));
  }
  return { categories: out, totals, details: describeChange(before, after) };
}

/** How a percentage or incentive reads, both ways when it changed: "Contingency 10% → Contingency 0%". */
function bothLabels<T>(before: T | undefined, after: T | undefined, label: (t: T) => string): string {
  const a = before ? label(before) : null;
  const b = after ? label(after) : null;
  return a && b && a !== b ? `${a} → ${b}` : (b ?? a ?? '');
}

/** Percentages or incentives from both budgets, matched by id, in the newer budget's order. */
function pairs<T extends { amount: string }, I extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  item: (t: T) => I,
): { item: I; before?: T; after?: T }[] {
  const old = new Map(before.map((t) => [item(t).id, t]));
  const rows: { item: I; before?: T; after?: T }[] = after.map((t) => {
    const was = old.get(item(t).id);
    old.delete(item(t).id);
    return was ? { item: item(t), before: was, after: t } : { item: item(t), after: t };
  });
  for (const t of old.values()) rows.push({ item: item(t), before: t });
  return rows;
}

/**
 * A comparison in words, as a starting point for a version's "What changed": the grand total,
 * then each category and account that moved.
 */
export function describeComparison(c: BudgetComparison, precision: DisplayPrecision): string {
  const money = (v: string) => formatMoney(v, precision);
  const signed = (v: string) => {
    const d = toDecimal(v);
    return `${d.isNegative() ? '−' : '+'}${formatMoney(d.abs().toFixed(), precision)}`;
  };
  const line = (r: ComparedRow) => {
    const label = `${r.number} ${r.name}`.trim();
    if (r.status === 'added') return `${label}: new, ${money(r.after)}`;
    if (r.status === 'deleted') return `${label}: deleted (was ${money(r.before)})`;
    return `${label}: ${money(r.before)} → ${money(r.after)} (${signed(r.difference)})`;
  };
  const out: string[] = [];
  for (const t of c.totals) {
    if (t.name === 'Grand Total' || t.name === 'Net Cost' || changed(t)) out.push(line(t));
  }
  for (const cat of c.categories) {
    out.push('', line(cat));
    for (const a of cat.accounts) out.push(`  ${line(a)}`);
  }
  if (c.categories.length === 0) out.push('', 'No account totals changed.');
  return out.join('\n');
}
