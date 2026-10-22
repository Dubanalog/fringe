import { type Decimal, applyRounding, toDecimal } from './money';
import { EditError } from './edit';
import type { Budget, BudgetSettings, CurrencyDef, DetailLine } from './model';

/**
 * Lines in other currencies. A line's numbers and subtotal stay in its own currency, as it was
 * budgeted; totals, fringes and reports work in the budget's currency, converting each line at its
 * currency's rate (what one unit of it is worth in the budget's currency, e.g. CAD at 0.73 in a
 * USD budget). Changing a rate moves every total that uses it, and goes into history like any edit.
 */

/** A line's currency, or '' for the budget's own. */
export function lineCurrency(d: Pick<DetailLine, 'currency'>, settings: BudgetSettings): string {
  const code = d.currency.trim().toUpperCase();
  return code === '' || code === settings.currency.trim().toUpperCase() ? '' : code;
}

/** What one unit of `code` is worth in the budget's currency: 1 for its own, null when not set up. */
export function currencyRate(settings: BudgetSettings, code: string): Decimal | null {
  const c = code.trim().toUpperCase();
  if (c === '' || c === settings.currency.trim().toUpperCase()) return toDecimal(1);
  const def = settings.currencies.find((x) => x.code.trim().toUpperCase() === c);
  if (!def || !/^\s*\d+(\.\d+)?\s*$/.test(def.rate) || toDecimal(def.rate).isZero()) return null;
  return toDecimal(def.rate);
}

/** A line's subtotal in the budget's currency, rounded; null when its currency has no rate. */
export function convertedSubtotal(
  d: Pick<DetailLine, 'currency' | 'subtotal'>,
  settings: BudgetSettings,
): Decimal | null {
  const code = lineCurrency(d, settings);
  if (code === '') return toDecimal(d.subtotal);
  const rate = currencyRate(settings, code);
  return rate === null ? null : applyRounding(toDecimal(d.subtotal).times(rate), settings.rounding);
}

/**
 * The budget with every line's subtotal in the budget's currency, for working out totals and
 * fringes. A line whose currency has no rate counts as zero (see `unknownCurrencyLines`). The same
 * budget comes back when every line is in the budget's currency.
 */
export function inBudgetCurrency(budget: Budget): { budget: Budget; unknownCurrencyLines: number } {
  const settings = budget.settings;
  let unknownCurrencyLines = 0;
  let changed = false;
  const categories = budget.categories.map((c) => {
    let cChanged = false;
    const accounts = c.accounts.map((a) => {
      if (!a.details.some((d) => lineCurrency(d, settings) !== '')) return a;
      cChanged = true;
      const details = a.details.map((d) => {
        if (lineCurrency(d, settings) === '') return d;
        const converted = convertedSubtotal(d, settings);
        if (converted === null) unknownCurrencyLines++;
        return { ...d, currency: '', subtotal: (converted ?? toDecimal(0)).toFixed() };
      });
      return { ...a, details };
    });
    if (!cChanged) return c;
    changed = true;
    return { ...c, accounts };
  });
  return { budget: changed ? { ...budget, categories } : budget, unknownCurrencyLines };
}

/** How many lines are in a currency other than the budget's. */
export function currencyUseCount(budget: Budget, code: string): number {
  const c = code.trim().toUpperCase();
  let n = 0;
  for (const cat of budget.categories)
    for (const a of cat.accounts)
      for (const d of a.details) if (c !== '' && lineCurrency(d, budget.settings) === c) n++;
  return n;
}

/** Currencies lines use that have no rate yet, by code. */
export function missingCurrencies(budget: Budget): string[] {
  const out = new Set<string>();
  for (const cat of budget.categories)
    for (const a of cat.accounts)
      for (const d of a.details) {
        const code = lineCurrency(d, budget.settings);
        if (code !== '' && currencyRate(budget.settings, code) === null) out.add(code);
      }
  return [...out];
}

/** Adds a currency or changes one, by code. */
export function setCurrency(budget: Budget, def: CurrencyDef): Budget {
  const code = def.code.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw new EditError('A currency code is 2 to 5 letters, e.g. CAD.');
  if (code === budget.settings.currency.trim().toUpperCase())
    throw new EditError(`${code} is the budget's own currency.`);
  const rate = def.rate.trim();
  if (rate !== '' && (!/^\d+(\.\d+)?$/.test(rate) || toDecimal(rate).isZero()))
    throw new EditError('A rate is a number above zero, e.g. 0.73.');
  const next = { code, name: def.name.trim(), rate };
  const list = budget.settings.currencies;
  const at = list.findIndex((c) => c.code.trim().toUpperCase() === code);
  const currencies = at < 0 ? [...list, next] : list.map((c, i) => (i === at ? next : c));
  return { ...budget, settings: { ...budget.settings, currencies } };
}

/** Removes a currency no line uses. */
export function deleteCurrency(budget: Budget, code: string): Budget {
  const c = code.trim().toUpperCase();
  const n = currencyUseCount(budget, c);
  if (n > 0)
    throw new EditError(
      `${n} line${n === 1 ? ' is' : 's are'} in ${c}; change ${n === 1 ? 'it' : 'them'} first.`,
    );
  const currencies = budget.settings.currencies.filter((x) => x.code.trim().toUpperCase() !== c);
  return { ...budget, settings: { ...budget.settings, currencies } };
}

/**
 * Sets the budget's own currency. Rates stay as they are, so check them; a currency in the list
 * with the new code comes off it, as its lines are now in the budget's own.
 */
export function setBudgetCurrency(budget: Budget, code: string): Budget {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(c)) throw new EditError('A currency code is 2 to 5 letters, e.g. USD.');
  const currencies = budget.settings.currencies.filter((x) => x.code.trim().toUpperCase() !== c);
  return { ...budget, settings: { ...budget.settings, currency: c, currencies } };
}
