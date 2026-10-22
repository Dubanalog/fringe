import DecimalBase from 'decimal.js';

/**
 * Exact decimal arithmetic for all financial values.
 *
 * Budget math never uses JavaScript floating point: 0.1 + 0.2 must equal 0.3,
 * and 2.675 must round to 2.68. We use a private Decimal clone so no other
 * code can change the global precision or rounding settings.
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  // Ties round away from zero (2.675 -> 2.68, -2.675 -> -2.68).
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = string | number | Decimal;

/** How a budget rounds money. Chosen per budget. */
export type RoundingPolicy =
  /** Round each detail line and each fringe amount to cents; rollups sum the rounded values. */
  | 'per-line'
  /** Carry full precision through rollups; round only for display. */
  | 'display-only';

export const DEFAULT_ROUNDING_POLICY: RoundingPolicy = 'per-line';

export class InvalidNumberError extends Error {
  constructor(readonly input: unknown) {
    super(`Not a valid number: ${JSON.stringify(input)}`);
    this.name = 'InvalidNumberError';
  }
}

const NUMERIC_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a value into an exact Decimal. Rejects NaN, Infinity, empty strings and non-numeric text. */
export function toDecimal(input: DecimalInput): Decimal {
  if (input instanceof Decimal) return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new InvalidNumberError(input);
    // String(n) gives the shortest round-trip representation, so 0.1 stays "0.1".
    return new Decimal(String(input));
  }
  const trimmed = input.trim().replaceAll(',', '');
  if (!NUMERIC_STRING.test(trimmed)) throw new InvalidNumberError(input);
  return new Decimal(trimmed);
}

/** Round to whole cents, ties away from zero. */
export function roundCents(value: DecimalInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Apply a budget's rounding policy to a computed line or fringe amount. */
export function applyRounding(value: DecimalInput, policy: RoundingPolicy): Decimal {
  return policy === 'per-line' ? roundCents(value) : toDecimal(value);
}

/** Sum values exactly. An empty list sums to zero. */
export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(toDecimal(v));
  return total;
}

/** Canonical storage form: a plain decimal string with no exponent, e.g. "1234.5". */
export function toStorageString(value: DecimalInput): string {
  return toDecimal(value).toFixed();
}
