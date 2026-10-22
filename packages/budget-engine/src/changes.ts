import { calculateTotals } from './calc';
import type { Account, Budget, BudgetSettings, Category, CodeField, DetailLine } from './model';

/**
 * What a history entry changed, worked out by comparing the budget before and after. Every edit
 * is a new budget that shares its unchanged parts with the old one, so only what changed is
 * looked at. Used by the History page; the entry's label says why, this says exactly what.
 */
export interface ChangeDetail {
  /** Where, e.g. "1102 line 3 (Director)" or "Globals". */
  where: string;
  /** What, e.g. "Rate" or "SW added". */
  what: string;
  from?: string;
  to?: string;
}

const LINE_FIELDS: [keyof DetailLine, string][] = [
  ['description', 'Description'],
  ['amount', 'Amount'],
  ['unit', 'Unit'],
  ['x', 'X'],
  ['rate', 'Rate'],
  ['currency', 'Currency'],
  ['subtotal', 'Subtotal'],
  ['fringes', 'Fringes'],
  ['groups', 'Groups'],
  ['location', 'Location'],
  ['set', 'Set'],
  ['in', 'In'],
  ['ff1', 'FF1'],
  ['ff2', 'FF2'],
];

const FORMULA_FIELDS = { amount: 'Amount', x: 'X', rate: 'Rate' } as const;

const CODE_NAMES: Record<CodeField, string> = {
  set: 'Set',
  location: 'Location',
  in: 'In',
  ff1: 'FF1',
  ff2: 'FF2',
};

const shown = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'blank';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return String(v);
};

/** Everything that differs between two budgets, in budget order. `before` null: the first entry. */
export function describeChange(before: Budget | null, after: Budget): ChangeDetail[] {
  if (!before || before === after) return [];
  const out: ChangeDetail[] = [];
  const add = (where: string, what: string, from?: unknown, to?: unknown) => {
    if (from === undefined && to === undefined) out.push({ where, what });
    // A part rebuilt with the same contents isn't a change.
    else if (shown(from) !== shown(to)) out.push({ where, what, from: shown(from), to: shown(to) });
  };

  if (before.name !== after.name) add('Budget', 'Name', before.name, after.name);
  if (before.settings !== after.settings) settingsChanges(before.settings, after.settings, add);
  if (before.categories !== after.categories) {
    const old = new Map(before.categories.map((c) => [c.id, c]));
    const kept = new Set<string>();
    for (const c of after.categories) {
      const was = old.get(c.id);
      if (!was) {
        add(categoryName(c), 'Category added');
        continue;
      }
      kept.add(c.id);
      if (was !== c) categoryChanges(was, c, add);
    }
    for (const c of before.categories) if (!kept.has(c.id)) add(categoryName(c), 'Category deleted');
    if (sameMembersMoved(before.categories, after.categories)) add('Topsheet', 'Categories reordered');
  }
  return out;
}

type Add = (where: string, what: string, from?: unknown, to?: unknown) => void;

const categoryName = (c: Category) => `${c.number} ${c.description}`.trim();
const accountName = (a: Account) => `${a.number} ${a.description}`.trim();

function categoryChanges(was: Category, c: Category, add: Add): void {
  const where = categoryName(c);
  if (was.number !== c.number) add(where, 'Number', was.number, c.number);
  if (was.description !== c.description) add(where, 'Description', was.description, c.description);
  if (was.accounts === c.accounts) return;
  const old = new Map(was.accounts.map((a) => [a.id, a]));
  const kept = new Set<string>();
  for (const a of c.accounts) {
    const before = old.get(a.id);
    if (!before) {
      add(accountName(a), 'Account added');
      continue;
    }
    kept.add(a.id);
    if (before !== a) accountChanges(before, a, add);
  }
  for (const a of was.accounts) if (!kept.has(a.id)) add(accountName(a), 'Account deleted');
  if (sameMembersMoved(was.accounts, c.accounts)) add(where, 'Accounts reordered');
}

function accountChanges(was: Account, a: Account, add: Add): void {
  const where = accountName(a);
  if (was.number !== a.number) add(where, 'Number', was.number, a.number);
  if (was.description !== a.description) add(where, 'Description', was.description, a.description);
  if (was.fringeRanges !== a.fringeRanges) {
    const ranges = (acc: Account) =>
      acc.fringeRanges.map((r) =>
        r.lineIds
          .map((id) => acc.details.findIndex((d) => d.id === id) + 1)
          .filter((n) => n > 0)
          .join('–'),
      );
    add(where, 'Fringe ranges (lines)', ranges(was), ranges(a));
  }
  if (was.details === a.details) return;
  const old = new Map(was.details.map((d) => [d.id, d]));
  const kept = new Set<string>();
  a.details.forEach((d, i) => {
    const line = `${a.number} line ${i + 1}${d.description ? ` (${d.description})` : ''}`;
    const before = old.get(d.id);
    if (!before) {
      add(line, 'Line added');
      return;
    }
    kept.add(d.id);
    if (before === d) return;
    for (const [key, name] of LINE_FIELDS) {
      const from = before[key];
      const to = d[key];
      const differs =
        Array.isArray(from) && Array.isArray(to) ? from.join('\n') !== to.join('\n') : from !== to;
      if (differs) add(line, name, from, to);
    }
    for (const [key, name] of Object.entries(FORMULA_FIELDS) as [keyof typeof FORMULA_FIELDS, string][]) {
      if (before.formulas[key] !== d.formulas[key])
        add(line, `${name} formula`, before.formulas[key], d.formulas[key]);
    }
  });
  was.details.forEach((d, i) => {
    if (!kept.has(d.id))
      add(`${a.number} line ${i + 1}${d.description ? ` (${d.description})` : ''}`, 'Line deleted');
  });
  if (sameMembersMoved(was.details, a.details)) add(where, 'Lines reordered');
}

/** True when the same items are there in a different order (adds and deletes aside). */
function sameMembersMoved(before: readonly { id: string }[], after: readonly { id: string }[]): boolean {
  const ids = new Set(after.map((x) => x.id));
  const was = before.map((x) => x.id).filter((id) => ids.has(id));
  const kept = new Set(was);
  const now = after.map((x) => x.id).filter((id) => kept.has(id));
  return was.some((id, i) => id !== now[i]);
}

function settingsChanges(was: BudgetSettings, s: BudgetSettings, add: Add): void {
  if (was.title !== s.title) add('Budget', 'Title', was.title, s.title);
  if (was.assumptions !== s.assumptions) add('Budget', 'Assumptions changed');
  if (was.rounding !== s.rounding) add('Settings', 'Rounding', was.rounding, s.rounding);
  if (was.displayPrecision !== s.displayPrecision)
    add('Settings', 'Show money in', was.displayPrecision, s.displayPrecision);
  if (was.fringes !== s.fringes) {
    if (was.fringes.posting !== s.fringes.posting)
      add('Fringes', 'Post to', was.fringes.posting, s.fringes.posting);
    if (was.fringes.categoryAccountSuffix !== s.fringes.categoryAccountSuffix)
      add(
        'Fringes',
        'Category fringe account ending',
        was.fringes.categoryAccountSuffix,
        s.fringes.categoryAccountSuffix,
      );
    if (was.fringes.budgetAccount !== s.fringes.budgetAccount)
      add('Fringes', 'Budget fringe account', was.fringes.budgetAccount, s.fringes.budgetAccount);
    for (const level of s.coa.levels) {
      const from = was.fringes.levelAccounts[level.id] ?? '';
      const to = s.fringes.levelAccounts[level.id] ?? '';
      if (from !== to) add('Fringes', `${level.name} fringe account`, from, to);
    }
  }
  if (was.coa !== s.coa) {
    if (was.coa.categoryPattern !== s.coa.categoryPattern)
      add(
        'Chart of accounts',
        'Category numbers look like',
        was.coa.categoryPattern ?? 'any',
        s.coa.categoryPattern ?? 'any',
      );
    if (was.coa.accountPattern !== s.coa.accountPattern)
      add(
        'Chart of accounts',
        'Account numbers look like',
        was.coa.accountPattern ?? 'any',
        s.coa.accountPattern ?? 'any',
      );
    if (was.coa.levels !== s.coa.levels) {
      const levels = (l: BudgetSettings['coa']['levels']) => l.map((x) => `${x.name} from ${x.from}`);
      add('Chart of accounts', 'Production totals', levels(was.coa.levels), levels(s.coa.levels));
    }
  }
  if (JSON.stringify(was.detailColumns) !== JSON.stringify(s.detailColumns))
    add('Account detail', 'Columns shown or moved');

  byName(was.globals, s.globals, 'Global', add, (a, b, where) => {
    if (a.value !== b.value) add(where, 'Value', a.value, b.value);
    if (a.description !== b.description) add(where, 'Description', a.description, b.description);
  });
  byName(was.fringeDefs, s.fringeDefs, 'Fringe', add, (a, b, where) => {
    if (a.kind !== b.kind) add(where, 'Kind', a.kind, b.kind);
    if (a.rate !== b.rate) add(where, a.kind === 'percent' ? 'Rate %' : 'Rate', a.rate, b.rate);
    if (a.unit !== b.unit) add(where, 'Unit', a.unit, b.unit);
    if (a.cutoff !== b.cutoff) add(where, 'Cutoff', a.cutoff ?? 'none', b.cutoff ?? 'none');
  });
  byName(was.units, s.units, 'Unit', add, (a, b, where) => {
    if (a.hours !== b.hours) add(where, 'Hours', a.hours, b.hours);
  });
  byName(was.percentages, s.percentages, 'Percentage', add, (a, b, where) => {
    if (a.percent !== b.percent) add(where, 'Percent', a.percent, b.percent);
    if (a.excludeGroups.join(', ') !== b.excludeGroups.join(', '))
      add(where, 'Groups left out', a.excludeGroups, b.excludeGroups);
    if ((a.account ?? '') !== (b.account ?? '')) add(where, 'Account', a.account ?? '', b.account ?? '');
  });
  if (was.percentages !== s.percentages && sameMembersMoved(was.percentages, s.percentages))
    add('Topsheet', 'Percentages reordered');
  byName(was.incentives, s.incentives, 'Incentive', add, (a, b, where) => {
    if (a.rate !== b.rate) add(where, 'Rate %', a.rate, b.rate);
    if ((a.account ?? '') !== (b.account ?? '')) add(where, 'Account', a.account ?? '', b.account ?? '');
    if (a.realized !== b.realized) add(where, 'Received %', a.realized, b.realized);
    if (a.groups.join(', ') !== b.groups.join(', ')) add(where, 'Qualifying groups', a.groups, b.groups);
    if ((a.includeFringes !== false) !== (b.includeFringes !== false))
      add(
        where,
        'Fringes count',
        a.includeFringes !== false ? 'Yes' : 'No',
        b.includeFringes !== false ? 'Yes' : 'No',
      );
    const outA = a.excludeFringes ?? [];
    const outB = b.excludeFringes ?? [];
    if (outA.join(', ') !== outB.join(', ')) add(where, 'Fringes left out', outA, outB);
  });
  if (was.incentivePlacement !== s.incentivePlacement)
    add(
      'Topsheet',
      'Incentives',
      was.incentivePlacement === 'net' ? 'under the grand total' : 'in the grand total',
      s.incentivePlacement === 'net' ? 'under the grand total' : 'in the grand total',
    );
  if (was.groups !== s.groups) listChanges(was.groups, s.groups, 'Group', add);
  if (was.groupColors !== s.groupColors) {
    for (const name of new Set([...Object.keys(was.groupColors), ...Object.keys(s.groupColors)])) {
      if (was.groupColors[name] !== s.groupColors[name])
        add(`Group ${name}`, 'Colour', was.groupColors[name] ?? 'none', s.groupColors[name] ?? 'none');
    }
  }
  if (was.codes !== s.codes) {
    for (const field of Object.keys(CODE_NAMES) as CodeField[]) {
      if (was.codes[field] !== s.codes[field])
        listChanges(was.codes[field], s.codes[field], `${CODE_NAMES[field]} code`, add);
    }
  }
}

/** Items matched by name; one removed and one added together read as a rename. */
function byName<T extends { name: string }>(
  was: readonly T[],
  now: readonly T[],
  noun: string,
  add: Add,
  compare: (a: T, b: T, where: string) => void,
): void {
  if (was === now) return;
  const old = new Map(was.map((x) => [x.name, x]));
  const names = new Set(now.map((x) => x.name));
  const added = now.filter((x) => !old.has(x.name));
  const removed = was.filter((x) => !names.has(x.name));
  if (added.length === 1 && removed.length === 1) {
    add(`${noun} ${added[0]!.name}`, 'Renamed', removed[0]!.name, added[0]!.name);
    compare(removed[0]!, added[0]!, `${noun} ${added[0]!.name}`);
  } else {
    for (const x of added) add(`${noun} ${x.name}`, 'Added');
    for (const x of removed) add(`${noun} ${x.name}`, 'Deleted');
  }
  for (const x of now) {
    const before = old.get(x.name);
    if (before && before !== x) compare(before, x, `${noun} ${x.name}`);
  }
}

function listChanges(was: readonly string[], now: readonly string[], noun: string, add: Add): void {
  const added = now.filter((x) => !was.includes(x));
  const removed = was.filter((x) => !now.includes(x));
  if (added.length === 1 && removed.length === 1) add(noun, 'Renamed', removed[0], added[0]);
  else {
    for (const x of added) add(`${noun} ${x}`, 'Added');
    for (const x of removed) add(`${noun} ${x}`, 'Deleted');
  }
}

const grandTotals = new WeakMap<Budget, string>();

/** The budget's grand total, remembered per snapshot (history keeps many, and most repeat). */
export function grandTotal(budget: Budget): string {
  let total = grandTotals.get(budget);
  if (total === undefined) {
    total = calculateTotals(budget).grand.total;
    grandTotals.set(budget, total);
  }
  return total;
}
