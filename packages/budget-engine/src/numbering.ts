import { EditError } from './edit';
import type { Account, Budget, Category, CoaSettings } from './model';

/**
 * Category and account numbers, and the pattern they follow. A pattern is free text: `#` is a
 * digit and anything else is typed as shown, so "####" is 1102, "##-##" is 11-02 and "## ##" is
 * 11 02. Category and account numbers each have their own pattern; none allows any number.
 *
 * Numbers are told apart by their digits wherever that's unambiguous, so "1102" still finds
 * 11-02 (an AI, or someone used to the old numbers, can name it either way).
 */

/** The digits in a number: "11-02" → "1102". */
export function digitsOf(number: string): string {
  return number.replace(/\D/g, '');
}

/** A number's shape as a pattern: "11-02" → "##-##". */
export function patternOf(number: string): string {
  return number.replace(/\d/g, '#');
}

/** Digits a pattern holds: "##-##" → 4. */
export function patternDigits(pattern: string): number {
  return (pattern.match(/#/g) ?? []).length;
}

/** True when a number follows the pattern (or there is none). */
export function fitsPattern(number: string, pattern: string | null): boolean {
  return pattern === null || patternOf(number) === pattern;
}

/** Pours a number's digits into a pattern: "1102" into "##-##" → "11-02". Null if the count differs. */
export function applyPattern(number: string, pattern: string): string | null {
  const digits = digitsOf(number);
  if (digits.length !== patternDigits(pattern)) return null;
  let i = 0;
  return pattern.replace(/#/g, () => digits[i++]!);
}

/** A pattern as typed: trimmed, blank meaning none. Refuses one with no digits. */
export function cleanPattern(pattern: string | null): string | null {
  const p = pattern?.trim() ?? '';
  if (p === '') return null;
  if (patternDigits(p) === 0)
    throw new EditError('A number pattern needs at least one # for a digit, e.g. ##-##.');
  return p;
}

/** The account a category's fringes post to: its account ending in the suffix (e.g. 99 → 1199 or 11-99). */
export function categoryFringeAccount(category: Category, suffix: string): Account | undefined {
  const exact = category.number.slice(0, Math.max(0, category.number.length - suffix.length)) + suffix;
  const found = category.accounts.find((a) => a.number === exact);
  if (found) return found;
  // Numbers with a separator, or a category numbered differently from its accounts (11 → 11-99).
  const ending = digitsOf(suffix);
  if (!ending) return undefined;
  const matches = category.accounts.filter((a) => digitsOf(a.number).endsWith(ending));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The accounts that would move if each category's fringe account ended in `ending` instead: those
 * ending in the current one (1199 → 1198), where the category has no account at the new number.
 */
export function fringeAccountMoves(budget: Budget, ending: string): Renumbering[] {
  const was = budget.settings.fringes.categoryAccountSuffix;
  if (!ending || !was || ending === was) return [];
  const taken = new Set(budget.categories.flatMap((c) => c.accounts.map((a) => a.number)));
  const moves: Renumbering[] = [];
  for (const c of budget.categories) {
    const from = categoryFringeAccount(c, was);
    if (!from || categoryFringeAccount(c, ending) || !from.number.endsWith(was)) continue;
    const to = from.number.slice(0, from.number.length - was.length) + ending;
    if (!taken.has(to)) moves.push({ kind: 'account', number: from.number, newNumber: to });
  }
  return moves;
}

/** Each category's fringe account now ends in `ending`, renumbering the accounts that end in the old one. */
export function setFringeAccountEnding(budget: Budget, ending: string): Budget {
  const moved = renumber(budget, fringeAccountMoves(budget, ending));
  const fringes = { ...moved.settings.fringes, categoryAccountSuffix: ending };
  return { ...moved, settings: { ...moved.settings, fringes } };
}

/** Finds an account by number: exactly, or by its digits when only one account has them. */
export function findAccountByNumber(budget: Budget, number: string): Account[] {
  const all = budget.categories.flatMap((c) => c.accounts);
  const exact = all.filter((a) => a.number === number.trim());
  if (exact.length > 0 || !digitsOf(number)) return exact;
  return all.filter((a) => digitsOf(a.number) === digitsOf(number));
}

/** Finds a category by number, the same way. */
export function findCategoryByNumber(budget: Budget, number: string): Category[] {
  const exact = budget.categories.filter((c) => c.number === number.trim());
  if (exact.length > 0 || !digitsOf(number)) return exact;
  return budget.categories.filter((c) => digitsOf(c.number) === digitsOf(number));
}

export interface Renumbering {
  kind: 'category' | 'account';
  /** The current number (or its digits). */
  number: string;
  newNumber?: string | undefined;
  newDescription?: string | undefined;
}

/**
 * Renumbers and renames any number of categories and accounts in one go, so numbers can swap
 * (1101 ↔ 1102). Checks the result: every number set, none repeated, each following the
 * budget's pattern. Fringes posting to a single account follow it to its new number.
 */
export function renumber(budget: Budget, changes: readonly Renumbering[]): Budget {
  const categories = new Map<string, { number?: string; description?: string }>();
  const accounts = new Map<string, { number?: string; description?: string }>();
  for (const ch of changes) {
    const found =
      ch.kind === 'category'
        ? findCategoryByNumber(budget, ch.number)
        : findAccountByNumber(budget, ch.number);
    const noun = ch.kind === 'category' ? 'category' : 'account';
    if (found.length === 0) throw new EditError(`There's no ${noun} ${ch.number}.`);
    if (found.length > 1) throw new EditError(`More than one ${noun} is numbered ${ch.number}.`);
    const target = ch.kind === 'category' ? categories : accounts;
    target.set(found[0]!.id, {
      ...target.get(found[0]!.id),
      ...(ch.newNumber !== undefined && { number: ch.newNumber.trim() }),
      ...(ch.newDescription !== undefined && { description: ch.newDescription }),
    });
  }
  return renumberBy(
    budget,
    (c) => categories.get(c.id),
    (a) => accounts.get(a.id),
  );
}

/**
 * Sets the category and account patterns, and renumbers every number whose digits fit the new
 * pattern (1102 → 11-02 for "##-##"). Numbers with a different count of digits stay as they are,
 * and are listed in `left`, to change by hand.
 */
export function setNumberPatterns(
  budget: Budget,
  patterns: Partial<Pick<CoaSettings, 'categoryPattern' | 'accountPattern'>>,
): { budget: Budget; left: string[] } {
  const coa = budget.settings.coa;
  const categoryPattern =
    patterns.categoryPattern === undefined ? coa.categoryPattern : cleanPattern(patterns.categoryPattern);
  const accountPattern =
    patterns.accountPattern === undefined ? coa.accountPattern : cleanPattern(patterns.accountPattern);
  const left: string[] = [];
  const reshape = (number: string, pattern: string | null) => {
    if (pattern === null || fitsPattern(number, pattern)) return undefined;
    const next = applyPattern(number, pattern);
    if (next === null) left.push(number);
    return next ?? undefined;
  };
  const withPatterns: Budget = {
    ...budget,
    settings: { ...budget.settings, coa: { ...coa, categoryPattern, accountPattern } },
  };
  const next = renumberBy(
    withPatterns,
    (c) => {
      const number = reshape(c.number, categoryPattern);
      return number === undefined ? undefined : { number };
    },
    (a) => {
      const number = reshape(a.number, accountPattern);
      return number === undefined ? undefined : { number };
    },
    false,
  );
  return { budget: next, left };
}

type Patch = { number?: string; description?: string } | undefined;

function renumberBy(
  budget: Budget,
  category: (c: Category) => Patch,
  account: (a: Account) => Patch,
  checkPatterns = true,
): Budget {
  const moved = new Map<string, string>();
  const categories = budget.categories.map((c) => {
    const cp = category(c);
    const accounts = c.accounts.map((a) => {
      const ap = account(a);
      if (!ap) return a;
      if (ap.number !== undefined && ap.number !== a.number) moved.set(a.number, ap.number);
      return { ...a, ...ap };
    });
    const changed = accounts.some((a, i) => a !== c.accounts[i]);
    return cp || changed ? { ...c, ...cp, accounts } : c;
  });
  if (categories.every((c, i) => c === budget.categories[i])) return budget;

  const { categoryPattern, accountPattern } = budget.settings.coa;
  check(
    categories.map((c) => c.number),
    'Category',
    checkPatterns ? categoryPattern : null,
  );
  check(
    categories.flatMap((c) => c.accounts.map((a) => a.number)),
    'Account',
    checkPatterns ? accountPattern : null,
  );

  const fringes = budget.settings.fringes;
  const budgetAccount = moved.get(fringes.budgetAccount);
  return {
    ...budget,
    categories,
    ...(budgetAccount !== undefined && {
      settings: { ...budget.settings, fringes: { ...fringes, budgetAccount } },
    }),
  };
}

function check(numbers: readonly string[], label: string, pattern: string | null): void {
  const seen = new Set<string>();
  for (const n of numbers) {
    if (n === '') throw new EditError(`${label} number can't be empty.`);
    if (seen.has(n)) throw new EditError(`${label} ${n} would be used twice.`);
    seen.add(n);
    if (!fitsPattern(n, pattern)) {
      throw new EditError(
        `${label} numbers look like ${pattern} in this budget (Budget Settings → Chart of Accounts), so ${n} doesn't fit.`,
      );
    }
  }
}
