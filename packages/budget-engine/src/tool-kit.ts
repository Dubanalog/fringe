import { type Decimal } from './money';
import type { Account, Budget } from './model';
import { findAccountByNumber } from './numbering';

export interface BudgetTool {
  name: string;
  description: string;
  /** JSON Schema for the input. */
  inputSchema: Record<string, unknown>;
  /** True when the tool can change the budget. */
  edits: boolean;
  run(budget: Budget, input: Record<string, unknown>): ToolOutcome;
}

export interface ToolOutcome {
  result: unknown;
  /** The changed budget, for an edit. */
  budget?: Budget;
  /** The history entry for the edit, e.g. "AI: FICA SS cutoff 184,500". */
  label?: string;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const str = (description: string) => ({ type: 'string', description });
export const nullableNumber = (description: string) => ({ type: ['string', 'null'], description });
export const lineList = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: 'Line positions in the account, from 1.',
};

export const money2 = (d: Decimal) => d.toFixed(2);

export function text(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${key} is required.`);
  return v.trim();
}

/** A number as a decimal string, or null for blank/null. */
export function amount(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[,$\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new ToolError(`${key} must be a number, e.g. 184500.`);
  return s;
}

/** The account with this number (or these digits: 1102 finds 11-02). */
export function findAccount(budget: Budget, number: string): Account {
  const matches = findAccountByNumber(budget, number);
  if (matches.length === 0) throw new ToolError(`There's no account ${number}.`);
  if (matches.length > 1) throw new ToolError(`More than one account is numbered ${number}.`);
  return matches[0]!;
}

export function lineIds(account: Account, input: Record<string, unknown>): string[] {
  const lines = input['lines'];
  if (!Array.isArray(lines) || lines.length === 0) throw new ToolError('lines is required.');
  return lines.map((n) => {
    const d = typeof n === 'number' ? account.details[n - 1] : undefined;
    if (!d) throw new ToolError(`Account ${account.number} has no line ${String(n)}.`);
    return d.id;
  });
}
