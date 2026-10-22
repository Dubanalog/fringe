import { describe, expect, it } from 'vitest';
import { InvalidNumberError, applyRounding, roundCents, sum, toDecimal, toStorageString } from './money';

describe('toDecimal', () => {
  it('is exact where floating point is not', () => {
    expect(toDecimal('0.1').plus('0.2').equals('0.3')).toBe(true);
    expect(toDecimal(0.1).plus(0.2).toFixed()).toBe('0.3');
  });

  it('accepts thousands separators and whitespace', () => {
    expect(toDecimal(' 1,250,000.50 ').toFixed()).toBe('1250000.5');
  });

  it.each(['', 'abc', '1..2', '12abc', '$5', 'NaN'])('rejects %j', (bad) => {
    expect(() => toDecimal(bad)).toThrow(InvalidNumberError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %s', (bad) => {
    expect(() => toDecimal(bad)).toThrow(InvalidNumberError);
  });
});

describe('roundCents', () => {
  it('rounds ties away from zero', () => {
    // 2.675 is 2.67499999... as a float; exact decimals must give 2.68.
    expect(roundCents('2.675').toFixed(2)).toBe('2.68');
    expect(roundCents('-2.675').toFixed(2)).toBe('-2.68');
    expect(roundCents('2.674999').toFixed(2)).toBe('2.67');
  });
});

describe('applyRounding', () => {
  it('per-line rounds to cents; display-only keeps full precision', () => {
    expect(applyRounding('10.005', 'per-line').toFixed()).toBe('10.01');
    expect(applyRounding('10.005', 'display-only').toFixed()).toBe('10.005');
  });

  it('per-line and display-only totals can differ by pennies, as documented', () => {
    const lines = ['0.005', '0.005', '0.005'];
    const perLine = sum(lines.map((l) => applyRounding(l, 'per-line')));
    const displayOnly = roundCents(sum(lines.map((l) => applyRounding(l, 'display-only'))));
    expect(perLine.toFixed(2)).toBe('0.03');
    expect(displayOnly.toFixed(2)).toBe('0.02');
  });
});

describe('sum and storage', () => {
  it('sums an empty list to zero', () => {
    expect(sum([]).toFixed()).toBe('0');
  });

  it('stores without exponent notation', () => {
    expect(toStorageString('1e21')).toBe('1000000000000000000000');
    expect(toStorageString('0.00000001')).toBe('0.00000001');
  });
});
