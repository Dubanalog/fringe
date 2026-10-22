import {
  type Account,
  type Budget,
  type BudgetSettings,
  type Category,
  type DetailLine,
  newId,
} from './model';
import { applyPattern, digitsOf, fitsPattern, patternDigits, patternOf } from './numbering';

/**
 * Pure edit operations. Each returns a new Budget and leaves the input untouched,
 * or throws EditError with a message suitable for showing to the user.
 */

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

export type CategoryField = 'number' | 'description';
export type AccountField = 'number' | 'description';
export type DetailTextField = 'description' | 'unit' | 'currency' | 'location' | 'set' | 'in' | 'ff1' | 'ff2';

export type TextEdit =
  | { kind: 'category'; id: string; field: CategoryField; value: string }
  | { kind: 'account'; id: string; field: AccountField; value: string }
  | { kind: 'detail'; id: string; field: DetailTextField; value: string };

export function applyTextEdit(budget: Budget, edit: TextEdit): Budget {
  const value = edit.field === 'number' ? edit.value.trim() : edit.value;

  if (edit.kind === 'category') {
    if (edit.field === 'number') checkNumber(budget, value, 'category', edit.id);
    return mapCategories(budget, (c) => (c.id === edit.id ? { ...c, [edit.field]: value } : c));
  }
  if (edit.kind === 'account') {
    if (edit.field === 'number') checkNumber(budget, value, 'account', edit.id);
    return mapAccounts(budget, (a) => (a.id === edit.id ? { ...a, [edit.field]: value } : a));
  }
  return mapDetails(budget, (d) => (d.id === edit.id ? { ...d, [edit.field]: value } : d));
}

export function updateSettings(budget: Budget, settings: BudgetSettings): Budget {
  return { ...budget, settings };
}

/** Where a new row goes: after (or before) an existing sibling, or at the end when none is given. */
export interface InsertAt {
  /** Sibling row to insert next to. */
  siblingId?: string | undefined;
  position: 'before' | 'after';
}

function insertIndex(ids: readonly string[], at: InsertAt): number {
  const i = at.siblingId === undefined ? -1 : ids.indexOf(at.siblingId);
  if (i < 0) return ids.length;
  return at.position === 'before' ? i : i + 1;
}

/**
 * Suggests an unused number between two neighbours, preferring round steps:
 * after 1100 → 1200, after 1102 → 1103. Numbers follow the pattern, or else look like their
 * neighbours (after 11-02 → 11-03). Returns '' when no number fits.
 */
export function suggestNumber(
  prev: string | undefined,
  next: string | undefined,
  taken: ReadonlySet<string>,
  pattern: string | null,
): string {
  const value = (s: string | undefined) => (s !== undefined && digitsOf(s) ? Number(digitsOf(s)) : null);
  const p = value(prev);
  const n = value(next);
  const shape = pattern ?? patternOf(prev || next || '####');
  const width = patternDigits(shape) || 4;
  const show = (v: number) => applyPattern(String(v).padStart(width, '0'), shape) ?? '';
  const fits = (v: number) =>
    v > 0 &&
    String(v).length <= width &&
    !taken.has(show(v)) &&
    (n === null || v < n) &&
    (p === null || v > p);
  const steps = [1000, 100, 10, 1].filter((s) => s < 10 ** width);
  const base = p ?? 0;
  for (const step of steps) {
    const v = (Math.floor(base / step) + 1) * step;
    if (fits(v)) return show(v);
  }
  return '';
}

export function insertCategory(budget: Budget, at: InsertAt): { budget: Budget; id: string } {
  const ids = budget.categories.map((c) => c.id);
  const i = insertIndex(ids, at);
  const taken = new Set(budget.categories.map((c) => c.number));
  const number = suggestNumber(
    budget.categories[i - 1]?.number,
    budget.categories[i]?.number,
    taken,
    budget.settings.coa.categoryPattern,
  );
  const category: Category = {
    id: newId(),
    number,
    description: 'NEW CATEGORY',
    imported: null,
    accounts: [],
  };
  const categories = [...budget.categories];
  categories.splice(i, 0, category);
  return { budget: { ...budget, categories }, id: category.id };
}

export function insertAccount(
  budget: Budget,
  categoryId: string,
  at: InsertAt,
): { budget: Budget; id: string } {
  const category = budget.categories.find((c) => c.id === categoryId);
  if (!category) throw new EditError('That category no longer exists.');
  const i = insertIndex(
    category.accounts.map((a) => a.id),
    at,
  );
  const taken = new Set(budget.categories.flatMap((c) => c.accounts.map((a) => a.number)));
  // Stay inside the category's number range: after the category number, before the next category's.
  const nextCategory = budget.categories[budget.categories.indexOf(category) + 1];
  const number = suggestNumber(
    category.accounts[i - 1]?.number ?? category.number,
    category.accounts[i]?.number ?? nextCategory?.number ?? categoryEnd(category.number),
    taken,
    budget.settings.coa.accountPattern,
  );
  const account: Account = {
    id: newId(),
    number,
    description: 'NEW ACCOUNT',
    imported: null,
    details: [],
    postedFringes: [],
    fringeRanges: [],
  };
  const accounts = [...category.accounts];
  accounts.splice(i, 0, account);
  return {
    budget: mapCategories(budget, (c) => (c.id === categoryId ? { ...c, accounts } : c)),
    id: account.id,
  };
}

export function insertDetail(
  budget: Budget,
  accountId: string,
  at: InsertAt,
): { budget: Budget; id: string } {
  const detail: DetailLine = {
    id: newId(),
    description: '',
    amount: '0',
    unit: '',
    x: '1',
    rate: '0',
    currency: '',
    subtotal: '0',
    fringes: [],
    groups: [],
    globalsUsed: [],
    location: '',
    set: '',
    in: '',
    ff1: '',
    ff2: '',
    formulas: {},
    formulasInferred: false,
    importedFringePercent: null,
  };
  let found = false;
  const next = mapAccounts(budget, (a) => {
    if (a.id !== accountId) return a;
    found = true;
    const details = [...a.details];
    details.splice(
      insertIndex(
        details.map((d) => d.id),
        at,
      ),
      0,
      detail,
    );
    return { ...a, details };
  });
  if (!found) throw new EditError('That account no longer exists.');
  return { budget: next, id: detail.id };
}

export function deleteRow(budget: Budget, kind: 'category' | 'account' | 'detail', id: string): Budget {
  if (kind === 'category') return { ...budget, categories: budget.categories.filter((c) => c.id !== id) };
  if (kind === 'account') {
    return mapCategories(budget, (c) => ({ ...c, accounts: c.accounts.filter((a) => a.id !== id) }));
  }
  return mapAccounts(budget, (a) => ({
    ...a,
    details: a.details.filter((d) => d.id !== id),
    fringeRanges: a.fringeRanges
      .map((r) => ({ ...r, lineIds: r.lineIds.filter((l) => l !== id) }))
      .filter((r) => r.lineIds.length > 0),
  }));
}

/** Where a last category's numbers end: 1100 → 1200, 11-00 → 1200. Undefined when it can't tell. */
function categoryEnd(number: string): string | undefined {
  const digits = digitsOf(number);
  const zeros = /0*$/.exec(digits)![0].length;
  if (!digits || zeros === 0 || zeros === digits.length) return undefined;
  const step = 10 ** zeros;
  return String((Number(digits) / step + 1) * step);
}

function checkNumber(budget: Budget, value: string, kind: 'category' | 'account', id: string): void {
  const label = kind === 'category' ? 'Category' : 'Account';
  if (value === '') throw new EditError(`${label} number can't be empty.`);

  const pattern =
    kind === 'category' ? budget.settings.coa.categoryPattern : budget.settings.coa.accountPattern;
  if (!fitsPattern(value, pattern)) {
    throw new EditError(
      `${label} numbers look like ${pattern} in this budget, # for each digit (Budget Settings → Chart of Accounts).`,
    );
  }

  const taken =
    kind === 'category'
      ? budget.categories.some((c) => c.id !== id && c.number === value)
      : budget.categories.some((c) => c.accounts.some((a) => a.id !== id && a.number === value));
  if (taken) throw new EditError(`${label} ${value} already exists.`);
}

function mapCategories(budget: Budget, fn: (c: Category) => Category): Budget {
  return { ...budget, categories: budget.categories.map(fn) };
}

function mapAccounts(budget: Budget, fn: (a: Account) => Account): Budget {
  return mapCategories(budget, (c) => ({ ...c, accounts: c.accounts.map(fn) }));
}

function mapDetails(budget: Budget, fn: (d: DetailLine) => DetailLine): Budget {
  return mapAccounts(budget, (a) => ({ ...a, details: a.details.map(fn) }));
}
