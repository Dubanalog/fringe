import { calculateTotals } from './calc';
import type { Budget } from './model';
import { toDecimal } from './money';
import { incentiveLabel, percentageLabel } from './percentages';
import { topsheet } from './topsheet';

/**
 * The budget as a plain CSV, for importing into another program: every account's number,
 * description and total, under its category, then the topsheet's rows (fringes, level totals,
 * percentages, the grand total, incentives). Money has two decimals and no symbols or commas.
 *
 * Columns: Account, Description, Total, Type. Type says what the row is, so an import can keep
 * only what it needs: the Account, Fringes, Percentage and Incentive rows add up to the net cost
 * (to the grand total, without the incentives, when they come off after it); Category and Total
 * rows are sums of others.
 */

export type CsvRowType = 'Category' | 'Account' | 'Fringes' | 'Percentage' | 'Incentive' | 'Total';

export interface CsvRow {
  account: string;
  description: string;
  /** Exact decimal string. */
  total: string;
  type: CsvRowType;
}

export function budgetCsvRows(budget: Budget): CsvRow[] {
  const totals = calculateTotals(budget);
  const sheet = topsheet(budget, totals);
  const rows: CsvRow[] = [];
  const add = (account: string, description: string, total: string, type: CsvRowType) =>
    rows.push({ account: account.trim(), description: description.trim(), total, type });

  for (const r of sheet.rows) {
    if (r.kind === 'category') {
      add(r.category.number, r.category.description, r.totals.total, 'Category');
      for (const a of r.category.accounts)
        add(a.number, a.description, totals.accounts.get(a.id)?.total ?? '0', 'Account');
    } else if (r.kind === 'fringes') {
      add(r.number, r.level ? `${r.level.name} Fringes` : 'Total Fringes', r.totals.total, 'Fringes');
    } else {
      add('', `Total ${r.level.name}`, r.totals.total, 'Total');
    }
  }
  if (sheet.percentages.length > 0) {
    add('', 'Total before percentages', sheet.categoriesTotal.total, 'Total');
    for (const p of sheet.percentages)
      add(p.percentage.account ?? '', percentageLabel(p.percentage), p.amount, 'Percentage');
  }
  const incentives = () => {
    for (const p of sheet.incentives)
      add(p.incentive.account ?? '', incentiveLabel(p.incentive), p.amount, 'Incentive');
  };
  if (budget.settings.incentivePlacement === 'grand-total') {
    incentives();
    add('', 'Grand Total', sheet.grandTotal.total, 'Total');
  } else {
    add('', 'Grand Total', sheet.grandTotal.total, 'Total');
    if (sheet.incentives.length > 0) {
      incentives();
      add('', 'Net Cost', sheet.net, 'Total');
    }
  }
  return rows;
}

/** A field, quoted when it has to be. */
function field(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The CSV text: a header row, then one line per row, with Windows line endings (RFC 4180). */
export function budgetCsv(budget: Budget): string {
  const lines = [['Account', 'Description', 'Total', 'Type']];
  for (const r of budgetCsvRows(budget))
    lines.push([r.account, r.description, toDecimal(r.total).toFixed(2), r.type]);
  return lines.map((l) => l.map(field).join(',')).join('\r\n') + '\r\n';
}
