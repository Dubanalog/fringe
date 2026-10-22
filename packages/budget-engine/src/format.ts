import type { DisplayPrecision } from './model';
import { Decimal, type DecimalInput, toDecimal } from './money';

/**
 * Formats money for display: rounded (ties away from zero) to whole dollars or
 * cents, with thousands separators. Exact: never passes through floating point.
 */
export function formatMoney(value: DecimalInput, precision: DisplayPrecision): string {
  const places = precision === 'dollars' ? 0 : 2;
  const rounded = toDecimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  const [whole = '0', fraction] = rounded.abs().toFixed(places).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = rounded.isNegative() && !rounded.isZero() ? '-' : '';
  return sign + grouped + (fraction === undefined ? '' : `.${fraction}`);
}

/**
 * Formats a rate in full: at least cents, and every further decimal it has (11.0475 stays
 * 11.0475), with thousands separators. Rates are never rounded for display.
 */
export function formatRate(value: DecimalInput): string {
  const d = toDecimal(value);
  return (
    formatMoney(d, 'cents').replace(/\.\d+$/, '') +
    '.' +
    d.abs().toFixed(Math.max(2, d.decimalPlaces())).split('.')[1]
  );
}
