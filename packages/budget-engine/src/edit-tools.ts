import { ASSUMPTIONS_FORMAT, assumptionsText, cleanAssumptions } from './assumptions';
import { calculateTotals, deleteGlobal, setLineNumber, setRounding, updateGlobal } from './calc';
import { deleteCurrency, setBudgetCurrency, setCurrency } from './currency';
import {
  type InsertAt,
  applyTextEdit,
  deleteRow,
  insertAccount,
  insertCategory,
  insertDetail,
  updateSettings,
} from './edit';
import { deleteCode, deleteLineTag, renameCode, renameLineTag } from './lines';
import {
  type Account,
  type Budget,
  type Category,
  type CodeField,
  type DetailLine,
  type FringeDef,
  type NumericDetailField,
  newId,
} from './model';
import { deleteIncentive, deletePercentage, setIncentive, setPercentage } from './percentages';
import { digitsOf, findCategoryByNumber, renumber, setNumberPatterns, type Renumbering } from './numbering';
import {
  type BudgetTool,
  type ToolOutcome,
  ToolError,
  amount,
  findAccount,
  lineIds,
  lineList,
  nullableNumber,
  obj,
  str,
  text,
} from './tool-kit';

/**
 * Tools that build and change the budget: categories, accounts and lines, numbers and their
 * patterns, fringes, units, globals, groups, codes and the budget's options. With these and the
 * tools in tools.ts, an assistant can do anything the user can do in the app. Each is one step in
 * the budget's history, so building a whole category with its accounts and lines undoes at once.
 */

type Input = Record<string, unknown>;

const NUMERIC: Record<string, NumericDetailField> = {
  amount: 'amount',
  x: 'x',
  rate: 'rate',
};
const TEXT = ['description', 'unit', 'currency', 'set', 'location', 'in', 'ff1', 'ff2'] as const;
const CODE_COLUMNS: CodeField[] = ['set', 'location', 'in', 'ff1', 'ff2'];

const numberOrFormula = (description: string) => ({ type: ['string', 'number'], description });
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const LINE = obj({
  description: str('What the line is, e.g. "Story Producer".'),
  amount: numberOrFormula(
    'How many (Amount). A number, a global ("ShootDays") or a formula ("ShootDays+3").',
  ),
  unit: str('Unit for Amount, e.g. "Weeks", "Days", "Allow", "Flat".'),
  x: numberOrFormula(
    'Multiplier (X), e.g. number of people, or paid hours per unit (11 for 8 straight and 2 at time and a half). Defaults to 1. Anything else multiplying the line goes in it as a formula ("2*1.5").',
  ),
  rate: numberOrFormula("Rate per unit in the line's currency, e.g. 2500. A global or formula also works."),
  currency: str(
    "Currency code (e.g. CAD), blank for the budget's own currency. Set the currency up with set_currency first.",
  ),
  fringes: strings(
    'Fringes that apply to this line, by name, exactly as set up (see set_fringe). Replaces the list.',
  ),
  groups: strings('Groups the line is in. New group names are set up as needed. Replaces the list.'),
  set: str('Set code.'),
  location: str('Location code.'),
  in: str('"In" code.'),
  ff1: str('Free field 1.'),
  ff2: str('Free field 2.'),
});

const LINE_CHANGE = {
  ...LINE,
  properties: {
    line: { type: 'integer', minimum: 1, description: 'Line position, from 1.' },
    ...LINE.properties,
  },
  required: ['line'],
};

const ACCOUNT = obj(
  {
    number: str(
      'Account number in the budget\'s pattern, e.g. "1102" or "11-02". Omit for the next free number.',
    ),
    description: str('e.g. "STORY PRODUCERS".'),
    lines: { type: 'array', items: LINE, description: 'Detail lines, in order.' },
  },
  ['description'],
);

const optional = (input: Input, key: string): string | undefined =>
  typeof input[key] === 'string'
    ? (input[key] as string)
    : typeof input[key] === 'number'
      ? String(input[key])
      : undefined;

function findCategory(budget: Budget, number: string): Category {
  const found = findCategoryByNumber(budget, number);
  if (found.length === 0) throw new ToolError(`There's no category ${number}.`);
  if (found.length > 1) throw new ToolError(`More than one category is numbered ${number}.`);
  return found[0]!;
}

function accountById(budget: Budget, id: string): Account {
  return budget.categories.flatMap((c) => c.accounts).find((a) => a.id === id)!;
}

/** Where a new row goes among its siblings: after one, or in number order, or at the end. */
function placeAt(
  siblings: readonly { id: string; number: string }[],
  number: string | undefined,
  after: string | undefined,
): InsertAt {
  if (after !== undefined) {
    const sib = siblings.find((s) => s.number === after || digitsOf(s.number) === digitsOf(after));
    if (!sib) throw new ToolError(`There's no ${after} to put it after.`);
    return { siblingId: sib.id, position: 'after' };
  }
  if (number !== undefined && digitsOf(number)) {
    const n = Number(digitsOf(number));
    const next = siblings.find((s) => digitsOf(s.number) && Number(digitsOf(s.number)) > n);
    if (next) return { siblingId: next.id, position: 'before' };
  }
  return { position: 'after' };
}

function patchLine(budget: Budget, id: string, fn: (d: DetailLine) => DetailLine): Budget {
  return {
    ...budget,
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) =>
        a.details.some((d) => d.id === id)
          ? { ...a, details: a.details.map((d) => (d.id === id ? fn(d) : d)) }
          : a,
      ),
    })),
  };
}

/** Sets whichever line fields the input names. */
function applyLine(budget: Budget, id: string, input: Input): Budget {
  let next = budget;
  const texts: Partial<Record<(typeof TEXT)[number], string>> = {};
  for (const key of TEXT) {
    const v = optional(input, key);
    if (v !== undefined) texts[key] = v;
  }
  let fringes: string[] | undefined;
  if (Array.isArray(input['fringes'])) {
    fringes = (input['fringes'] as unknown[]).map(String);
    const known = new Set(next.settings.fringeDefs.map((f) => f.name));
    const unknown = fringes.filter((f) => !known.has(f));
    if (unknown.length)
      throw new ToolError(`There's no fringe called ${unknown.join(', ')}. Set it up first with set_fringe.`);
  }
  let groups: string[] | undefined;
  if (Array.isArray(input['groups'])) {
    groups = (input['groups'] as unknown[]).map(String).filter((g) => g.trim());
    const missing = groups.filter((g) => !next.settings.groups.includes(g));
    if (missing.length)
      next = updateSettings(next, { ...next.settings, groups: [...next.settings.groups, ...missing] });
  }
  next = patchLine(next, id, (d) => ({
    ...d,
    ...texts,
    ...(fringes && { fringes }),
    ...(groups && { groups }),
  }));
  for (const [key, field] of Object.entries(NUMERIC)) {
    const v = optional(input, key);
    if (v !== undefined) next = setLineNumber(next, id, field, v.replace(/[$,]/g, ''));
  }
  return next;
}

function addLines(budget: Budget, accountId: string, lines: unknown, after?: number): Budget {
  if (lines === undefined) return budget;
  if (!Array.isArray(lines)) throw new ToolError('lines must be a list of lines.');
  let next = budget;
  const details = accountById(next, accountId).details;
  if (after !== undefined && (after < 0 || after > details.length))
    throw new ToolError(`The account has ${details.length} lines; "after" must be 0 to ${details.length}.`);
  let at: InsertAt =
    after === undefined
      ? { position: 'after' }
      : after === 0
        ? details[0]
          ? { siblingId: details[0].id, position: 'before' }
          : { position: 'after' }
        : { siblingId: details[after - 1]!.id, position: 'after' };
  for (const line of lines as Input[]) {
    const { budget: b, id } = insertDetail(next, accountId, at);
    next = applyLine(b, id, line ?? {});
    at = { siblingId: id, position: 'after' };
  }
  return next;
}

function addAccount(
  budget: Budget,
  categoryId: string,
  spec: Input,
  after?: string,
): { budget: Budget; number: string } {
  const category = budget.categories.find((c) => c.id === categoryId)!;
  const number = optional(spec, 'number')?.trim();
  const { budget: b, id } = insertAccount(budget, categoryId, placeAt(category.accounts, number, after));
  let next = applyTextEdit(b, {
    kind: 'account',
    id,
    field: 'description',
    value: text(spec, 'description'),
  });
  if (number) next = applyTextEdit(next, { kind: 'account', id, field: 'number', value: number });
  const made = accountById(next, id);
  if (!made.number)
    throw new ToolError(`No free account number fits there; give "number" for ${made.description}.`);
  next = addLines(next, id, spec['lines']);
  return { budget: next, number: made.number };
}

function totalsOf(budget: Budget) {
  const totals = calculateTotals(budget);
  return { total: totals.grand.total };
}

function accountTotal(budget: Budget, number: string) {
  const a = findAccount(budget, number);
  const t = calculateTotals(budget);
  return {
    account: a.number,
    lines: a.details.map((d, i) => `${i + 1}. ${d.description}: ${d.subtotal}`),
    accountTotal: t.accounts.get(a.id)?.total ?? '0',
    total: t.grand.total,
  };
}

/** A whole-number position, or undefined. */
function position(input: Input, key: string): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ToolError(`${key} must be a line position.`);
  return v;
}

function sortByNumber(budget: Budget): Budget {
  const key = (n: string) => (digitsOf(n) ? Number(digitsOf(n)) : Infinity);
  const by = <T extends { number: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => key(a.number) - key(b.number));
  return {
    ...budget,
    categories: by(budget.categories).map((c) => ({ ...c, accounts: by(c.accounts) })),
  };
}

function fringeDef(budget: Budget, name: string): FringeDef {
  const def = budget.settings.fringeDefs.find((f) => f.name === name);
  if (!def) throw new ToolError(`There's no fringe called ${name}.`);
  return def;
}

function codeColumn(input: Input): CodeField {
  const column = text(input, 'column') as CodeField;
  if (!CODE_COLUMNS.includes(column)) throw new ToolError(`column is one of ${CODE_COLUMNS.join(', ')}.`);
  return column;
}

const edit = (budget: Budget, label: string, result: unknown = totalsOf(budget)): ToolOutcome => ({
  budget,
  label: `AI: ${label}`,
  result,
});

export const EDIT_TOOLS: readonly BudgetTool[] = [
  {
    name: 'add_category',
    description:
      'Adds a category, optionally with its accounts and their detail lines, all in one step. Use it to build a budget: one call per category. Goes in number order unless "after" is given. Set up fringes (set_fringe) and globals (set_global) first so lines can use them.',
    inputSchema: obj(
      {
        number: str(
          'Category number in the budget\'s pattern, e.g. "1100" or "11-00". Omit for the next free number.',
        ),
        description: str('e.g. "PRODUCTION STAFF".'),
        after: str('Put it after this category number (optional).'),
        accounts: { type: 'array', items: ACCOUNT, description: 'Accounts, in order.' },
      },
      ['description'],
    ),
    edits: true,
    run: (budget, input) => {
      const number = optional(input, 'number')?.trim();
      const { budget: b, id } = insertCategory(
        budget,
        placeAt(budget.categories, number, optional(input, 'after')),
      );
      let next = applyTextEdit(b, {
        kind: 'category',
        id,
        field: 'description',
        value: text(input, 'description'),
      });
      if (number) next = applyTextEdit(next, { kind: 'category', id, field: 'number', value: number });
      const made = next.categories.find((c) => c.id === id)!;
      if (!made.number) throw new ToolError('No free category number fits there; give "number".');
      const accounts: string[] = [];
      const specs = input['accounts'];
      if (specs !== undefined && !Array.isArray(specs)) throw new ToolError('accounts must be a list.');
      for (const spec of (specs ?? []) as Input[]) {
        const r = addAccount(next, id, spec);
        next = r.budget;
        accounts.push(r.number);
      }
      const t = calculateTotals(next);
      return edit(next, `added ${made.number} ${made.description}`, {
        category: made.number,
        accounts,
        categoryTotal: t.categories.get(id)?.total ?? '0',
        total: t.grand.total,
      });
    },
  },
  {
    name: 'add_account',
    description:
      'Adds an account to a category, optionally with its detail lines. Goes in number order unless "after" is given.',
    inputSchema: obj(
      {
        category: str('Category number, e.g. "1100".'),
        number: str('Account number, e.g. "1102" or "11-02". Omit for the next free number.'),
        description: str('e.g. "STORY PRODUCERS".'),
        after: str('Put it after this account number (optional).'),
        lines: { type: 'array', items: LINE, description: 'Detail lines, in order.' },
      },
      ['category', 'description'],
    ),
    edits: true,
    run: (budget, input) => {
      const c = findCategory(budget, text(input, 'category'));
      const { budget: next, number } = addAccount(budget, c.id, input, optional(input, 'after'));
      return edit(next, `added account ${number}`, accountTotal(next, number));
    },
  },
  {
    name: 'add_lines',
    description:
      "Adds detail lines to an account: at the end, or after a line position (0 for the top). Each line's subtotal is Amount × X × Rate, in the line's currency; numbers can be globals or formulas.",
    inputSchema: obj(
      {
        account: str('Account number.'),
        after: {
          type: 'integer',
          minimum: 0,
          description: 'Add after this line position; 0 for the top. Omit for the end.',
        },
        lines: { type: 'array', items: LINE, minItems: 1 },
      },
      ['account', 'lines'],
    ),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const next = addLines(budget, a.id, input['lines'], position(input, 'after'));
      return edit(next, `added lines to ${a.number}`, accountTotal(next, a.number));
    },
  },
  {
    name: 'update_lines',
    description:
      "Changes fields on detail lines of one account, by line position. Only the fields given change. Fringes and groups replace the line's list.",
    inputSchema: obj(
      { account: str('Account number.'), lines: { type: 'array', items: LINE_CHANGE, minItems: 1 } },
      ['account', 'lines'],
    ),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const changes = input['lines'];
      if (!Array.isArray(changes) || changes.length === 0) throw new ToolError('lines is required.');
      // Positions are read before any change, so they refer to the account as it was.
      const ids = lineIds(a, { lines: changes.map((c) => (c as Input)['line']) });
      let next = budget;
      changes.forEach((c, i) => (next = applyLine(next, ids[i]!, c as Input)));
      return edit(next, `changed lines in ${a.number}`, accountTotal(next, a.number));
    },
  },
  {
    name: 'delete_lines',
    description: 'Deletes detail lines from an account, by line position.',
    inputSchema: obj({ account: str('Account number.'), lines: lineList }, ['account', 'lines']),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const next = lineIds(a, input).reduce((b, id) => deleteRow(b, 'detail', id), budget);
      return edit(next, `deleted lines in ${a.number}`, accountTotal(next, a.number));
    },
  },
  {
    name: 'move_lines',
    description:
      'Moves detail lines within an account to after a line position (0 for the top), keeping their order.',
    inputSchema: obj(
      {
        account: str('Account number.'),
        lines: lineList,
        after: {
          type: 'integer',
          minimum: 0,
          description: 'Line position to put them after, as the account is now; 0 for the top.',
        },
      },
      ['account', 'lines', 'after'],
    ),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const moving = new Set(lineIds(a, input));
      const after = position(input, 'after') ?? 0;
      if (after > a.details.length) throw new ToolError(`The account has ${a.details.length} lines.`);
      const anchor = after === 0 ? null : a.details[after - 1]!;
      if (anchor && moving.has(anchor.id)) throw new ToolError("Lines can't move after one of themselves.");
      const moved = a.details.filter((d) => moving.has(d.id));
      const rest = a.details.filter((d) => !moving.has(d.id));
      const at = anchor ? rest.indexOf(anchor) + 1 : 0;
      const details = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
      const next: Budget = {
        ...budget,
        categories: budget.categories.map((c) => ({
          ...c,
          accounts: c.accounts.map((x) => (x.id === a.id ? { ...x, details } : x)),
        })),
      };
      return edit(next, `moved lines in ${a.number}`, accountTotal(next, a.number));
    },
  },
  {
    name: 'delete_accounts',
    description: 'Deletes accounts and all their lines.',
    inputSchema: obj({ accounts: strings('Account numbers.') }, ['accounts']),
    edits: true,
    run: (budget, input) => {
      const numbers = Array.isArray(input['accounts']) ? (input['accounts'] as unknown[]).map(String) : [];
      if (numbers.length === 0) throw new ToolError('accounts is required.');
      const ids = numbers.map((n) => findAccount(budget, n).id);
      const next = ids.reduce((b, id) => deleteRow(b, 'account', id), budget);
      return edit(next, `deleted account${numbers.length === 1 ? '' : 's'} ${numbers.join(', ')}`);
    },
  },
  {
    name: 'delete_categories',
    description: 'Deletes categories with all their accounts and lines.',
    inputSchema: obj({ categories: strings('Category numbers.') }, ['categories']),
    edits: true,
    run: (budget, input) => {
      const numbers = Array.isArray(input['categories'])
        ? (input['categories'] as unknown[]).map(String)
        : [];
      if (numbers.length === 0) throw new ToolError('categories is required.');
      const ids = numbers.map((n) => findCategory(budget, n).id);
      const next = ids.reduce((b, id) => deleteRow(b, 'category', id), budget);
      return edit(next, `deleted categor${numbers.length === 1 ? 'y' : 'ies'} ${numbers.join(', ')}`);
    },
  },
  {
    name: 'move_account',
    description:
      'Moves an account, with its lines, to another category (or elsewhere in its own): in number order, or after a given account.',
    inputSchema: obj(
      {
        account: str('Account number.'),
        category: str('Category number to move it to.'),
        after: str('Put it after this account number (optional).'),
      },
      ['account', 'category'],
    ),
    edits: true,
    run: (budget, input) => {
      const a = findAccount(budget, text(input, 'account'));
      const target = findCategory(budget, text(input, 'category'));
      const without = budget.categories.map((c) => ({
        ...c,
        accounts: c.accounts.filter((x) => x.id !== a.id),
      }));
      const to = without.find((c) => c.id === target.id)!;
      const at = placeAt(to.accounts, a.number, optional(input, 'after'));
      const i =
        at.siblingId === undefined
          ? to.accounts.length
          : to.accounts.findIndex((x) => x.id === at.siblingId) + (at.position === 'after' ? 1 : 0);
      const accounts = [...to.accounts.slice(0, i), a, ...to.accounts.slice(i)];
      const next: Budget = {
        ...budget,
        categories: without.map((c, n) =>
          c.id === target.id
            ? { ...c, accounts }
            : c.accounts.length === budget.categories[n]!.accounts.length
              ? budget.categories[n]!
              : c,
        ),
      };
      return edit(next, `moved ${a.number} to ${target.number}`);
    },
  },
  {
    name: 'renumber_and_rename',
    description:
      "Renumbers and renames any number of categories and accounts in one step (numbers can swap). Each new number must follow the budget's pattern; to change the pattern for every number at once (e.g. 1102 → 11-02), use set_number_patterns instead. sortByNumber puts categories and accounts in number order afterwards.",
    inputSchema: obj({
      categories: {
        type: 'array',
        items: obj(
          { number: str('Current number.'), newNumber: str('Optional.'), newDescription: str('Optional.') },
          ['number'],
        ),
      },
      accounts: {
        type: 'array',
        items: obj(
          { number: str('Current number.'), newNumber: str('Optional.'), newDescription: str('Optional.') },
          ['number'],
        ),
      },
      sortByNumber: { type: 'boolean', description: 'Reorder by number afterwards.' },
    }),
    edits: true,
    run: (budget, input) => {
      const list = (key: 'categories' | 'accounts', kind: Renumbering['kind']): Renumbering[] =>
        Array.isArray(input[key])
          ? (input[key] as Input[]).map((c) => ({
              kind,
              number: text(c, 'number'),
              newNumber: optional(c, 'newNumber'),
              newDescription: optional(c, 'newDescription'),
            }))
          : [];
      const changes = [...list('categories', 'category'), ...list('accounts', 'account')];
      if (changes.length === 0 && input['sortByNumber'] !== true) throw new ToolError('Nothing to change.');
      let next = renumber(budget, changes);
      if (input['sortByNumber'] === true) next = sortByNumber(next);
      return edit(next, `renumbered or renamed ${changes.length} row${changes.length === 1 ? '' : 's'}`);
    },
  },
  {
    name: 'set_number_patterns',
    description:
      'Sets what category and account numbers look like and renumbers every existing number to match, in one step: # is a digit and anything else (a dash, dot, space) appears as typed. "##-##" turns 1102 into 11-02; "####" turns it back. null allows any number. Numbers with a different count of digits are left and listed.',
    inputSchema: obj({
      categoryPattern: nullableNumber('e.g. "##-##", "####", or null for any.'),
      accountPattern: nullableNumber('e.g. "##-##", "####", or null for any.'),
    }),
    edits: true,
    run: (budget, input) => {
      const patterns: Parameters<typeof setNumberPatterns>[1] = {};
      if ('categoryPattern' in input) patterns.categoryPattern = optional(input, 'categoryPattern') ?? null;
      if ('accountPattern' in input) patterns.accountPattern = optional(input, 'accountPattern') ?? null;
      const { budget: next, left } = setNumberPatterns(budget, patterns);
      const coa = next.settings.coa;
      return edit(next, `numbers now ${coa.categoryPattern ?? 'any'} / ${coa.accountPattern ?? 'any'}`, {
        categoryPattern: coa.categoryPattern,
        accountPattern: coa.accountPattern,
        leftAsTheyWere: left,
        ...totalsOf(next),
      });
    },
  },
  {
    name: 'set_fringe',
    description:
      'Adds a fringe or changes one: its kind, rate, unit (flat fringes), cutoff (percent fringes) or name. A new fringe needs kind and rate. A rename carries through every line.',
    inputSchema: obj(
      {
        name: str('Fringe name, e.g. "FICA", "Health & Welfare".'),
        newName: str('Rename it (optional).'),
        kind: {
          type: 'string',
          enum: ['percent', 'flat'],
          description: 'percent: rate is a % of pay. flat: rate is an amount per unit.',
        },
        rate: numberOrFormula('Percent (7.65 for 7.65%) or the amount per unit.'),
        unit: str('Flat fringes: the unit the rate is per, e.g. "Hours", "Days", "Weeks".'),
        cutoff: nullableNumber('Percent fringes: pay it stops at per person, e.g. "184500", or null.'),
      },
      ['name'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const exists = budget.settings.fringeDefs.some((f) => f.name === name);
      const kind = optional(input, 'kind');
      if (kind !== undefined && kind !== 'percent' && kind !== 'flat')
        throw new ToolError('kind is percent or flat.');
      const rate = 'rate' in input ? amount(input, 'rate') : undefined;
      const cutoff = 'cutoff' in input ? amount(input, 'cutoff') : undefined;
      const unit = optional(input, 'unit');
      let next = budget;
      if (!exists) {
        if (!kind || rate === undefined || rate === null)
          throw new ToolError(`A new fringe needs kind and rate.`);
        const def: FringeDef = {
          name,
          kind,
          rate,
          unit: unit ?? '',
          cutoff: cutoff ?? null,
          cutoffInferred: false,
        };
        next = updateSettings(next, { ...next.settings, fringeDefs: [...next.settings.fringeDefs, def] });
      } else {
        const old = fringeDef(budget, name);
        const def: FringeDef = {
          ...old,
          ...(kind && { kind }),
          ...(rate !== undefined && rate !== null && { rate }),
          ...(unit !== undefined && { unit }),
          ...(cutoff !== undefined && { cutoff, cutoffInferred: false }),
        };
        next = updateSettings(next, {
          ...next.settings,
          fringeDefs: next.settings.fringeDefs.map((f) => (f === old ? def : f)),
        });
      }
      const newName = optional(input, 'newName')?.trim();
      if (newName && newName !== name) next = renameLineTag(next, 'fringes', name, newName);
      const def = fringeDef(next, newName || name);
      return edit(
        next,
        `${exists ? '' : 'added '}fringe ${def.name} ${def.rate}${def.kind === 'percent' ? '%' : ''}`,
        {
          fringe: def,
          ...totalsOf(next),
        },
      );
    },
  },
  {
    name: 'delete_fringe',
    description: 'Deletes a fringe: takes it off every line and out of the fringe list.',
    inputSchema: obj({ name: str('Fringe name.') }, ['name']),
    edits: true,
    run: (budget, input) => {
      const name = fringeDef(budget, text(input, 'name')).name;
      const next = deleteLineTag(budget, 'fringes', name);
      return edit(next, `deleted fringe ${name}`);
    },
  },
  {
    name: 'delete_unit',
    description: "Removes a unit from the budget's unit list. Lines keep the unit text they have.",
    inputSchema: obj({ unit: str('Unit name.') }, ['unit']),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'unit');
      if (!budget.settings.units.some((u) => u.name === name))
        throw new ToolError(`There's no unit ${name}.`);
      const next = updateSettings(budget, {
        ...budget.settings,
        units: budget.settings.units.filter((u) => u.name !== name),
      });
      return edit(next, `removed unit ${name}`);
    },
  },
  {
    name: 'set_currency',
    description:
      "Sets up a currency lines can be budgeted in, or changes its rate, e.g. CAD at 0.73 in a USD budget. The rate is what one unit of it is worth in the budget's own currency. Lines in it are converted at that rate for totals, fringes and reports. With budgetCurrency true, makes the code the budget's own currency instead (rates stay as they are).",
    inputSchema: obj(
      {
        code: str('Currency code, e.g. "CAD", "EUR", "GBP".'),
        rate: numberOrFormula("What one unit is worth in the budget's currency, e.g. 0.73."),
        name: str('Its name, e.g. "Canadian dollar". Optional.'),
        budgetCurrency: { type: 'boolean', description: "Make this the budget's own currency." },
      },
      ['code'],
    ),
    edits: true,
    run: (budget, input) => {
      const code = text(input, 'code').toUpperCase();
      if (input['budgetCurrency'] === true)
        return edit(setBudgetCurrency(budget, code), `budget currency now ${code}`);
      const old = budget.settings.currencies.find((c) => c.code.toUpperCase() === code);
      const rate = input['rate'] === undefined ? (old?.rate ?? '') : String(input['rate']).trim();
      const next = setCurrency(budget, { code, rate, name: optional(input, 'name') ?? old?.name ?? '' });
      return edit(next, `${old ? '' : 'added '}currency ${code}${rate ? ` at ${rate}` : ''}`, totalsOf(next));
    },
  },
  {
    name: 'delete_currency',
    description: 'Removes a currency no line uses.',
    inputSchema: obj({ code: str('Currency code.') }, ['code']),
    edits: true,
    run: (budget, input) => {
      const code = text(input, 'code').toUpperCase();
      return edit(deleteCurrency(budget, code), `removed currency ${code}`);
    },
  },
  {
    name: 'rename_global',
    description: 'Renames a global; every formula using it follows.',
    inputSchema: obj({ name: str('Current name.'), newName: str('New name.') }, ['name', 'newName']),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      if (!budget.settings.globals.some((g) => g.name === name))
        throw new ToolError(`There's no global ${name}.`);
      const to = text(input, 'newName');
      return edit(updateGlobal(budget, name, { name: to }), `renamed global ${name} to ${to}`);
    },
  },
  {
    name: 'delete_global',
    description: 'Deletes a global. Lines that used it keep their current numbers.',
    inputSchema: obj({ name: str('Global name.') }, ['name']),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      if (!budget.settings.globals.some((g) => g.name === name))
        throw new ToolError(`There's no global ${name}.`);
      return edit(deleteGlobal(budget, name), `deleted global ${name}`);
    },
  },
  {
    name: 'set_group',
    description: 'Adds a group, or renames it or sets its row colour. A rename carries through every line.',
    inputSchema: obj(
      {
        name: str('Group name.'),
        newName: str('Rename it (optional).'),
        color: nullableNumber('Row colour as #rrggbb, or null for none.'),
      },
      ['name'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      let next = budget;
      if (!next.settings.groups.includes(name))
        next = updateSettings(next, { ...next.settings, groups: [...next.settings.groups, name] });
      const newName = optional(input, 'newName')?.trim();
      const final = newName || name;
      if (newName && newName !== name) next = renameLineTag(next, 'groups', name, newName);
      if ('color' in input) {
        const color = optional(input, 'color') ?? null;
        if (color !== null && !/^#[0-9a-f]{6}$/i.test(color))
          throw new ToolError('color is #rrggbb, e.g. #ffe08a.');
        const groupColors = { ...next.settings.groupColors };
        if (color === null) delete groupColors[final];
        else groupColors[final] = color.toLowerCase();
        next = updateSettings(next, { ...next.settings, groupColors });
      }
      return edit(next, `group ${final}`);
    },
  },
  {
    name: 'delete_group',
    description: 'Deletes a group: takes it off every line.',
    inputSchema: obj({ name: str('Group name.') }, ['name']),
    edits: true,
    run: (budget, input) =>
      edit(deleteLineTag(budget, 'groups', text(input, 'name')), `deleted group ${text(input, 'name')}`),
  },
  {
    name: 'set_code',
    description:
      "Adds a code to a code column's list (Set, Location, In, FF1, FF2), or renames one everywhere.",
    inputSchema: obj(
      {
        column: { type: 'string', enum: CODE_COLUMNS },
        code: str('The code.'),
        newName: str('Rename it (optional).'),
      },
      ['column', 'code'],
    ),
    edits: true,
    run: (budget, input) => {
      const column = codeColumn(input);
      const code = text(input, 'code');
      const newName = optional(input, 'newName')?.trim();
      let next = budget;
      if (!next.settings.codes[column].includes(code))
        next = updateSettings(next, {
          ...next.settings,
          codes: { ...next.settings.codes, [column]: [...next.settings.codes[column], code] },
        });
      if (newName && newName !== code) next = renameCode(next, column, code, newName);
      return edit(next, `${column} code ${newName || code}`);
    },
  },
  {
    name: 'delete_code',
    description: "Deletes a code from its column's list and clears it from every line.",
    inputSchema: obj({ column: { type: 'string', enum: CODE_COLUMNS }, code: str('The code.') }, [
      'column',
      'code',
    ]),
    edits: true,
    run: (budget, input) => {
      const column = codeColumn(input);
      const code = text(input, 'code');
      return edit(deleteCode(budget, column, code), `deleted ${column} code ${code}`);
    },
  },
  {
    name: 'set_percentage',
    description:
      'Adds or changes a topsheet percentage: a line worked out from the budget total, e.g. Contingency 10% (a negative percent takes it off). It counts every category (lines and fringes) except lines in the groups left out, not the other percentages, and goes into the grand total. Use this for contingency, fees, overhead or insurance as a percent rather than a category line. For tax credits and rebates use set_tax_incentive.',
    inputSchema: obj(
      {
        name: str('e.g. "Contingency".'),
        newName: str('Rename it (optional).'),
        percent: { type: ['number', 'string'], description: 'Percent, e.g. 10, or -25 for a credit.' },
        excludeGroups: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Groups whose lines it leaves out (replaces the current list). Must exist; see set_group.',
        },
        account: str('The account number it shows under on the topsheet, e.g. "9800"; "" clears it.'),
      },
      ['name'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const was = budget.settings.percentages.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const percent = optional(input, 'percent') ?? was?.percent;
      if (percent === undefined) throw new ToolError('A new percentage needs percent.');
      const excludeGroups = Array.isArray(input['excludeGroups'])
        ? (input['excludeGroups'] as unknown[]).map(String)
        : (was?.excludeGroups ?? []);
      const final = optional(input, 'newName')?.trim() || name;
      const next = setPercentage(budget, {
        ...(was ? { id: was.id } : {}),
        name: final,
        percent,
        excludeGroups,
        ...accountInput(input, was?.account),
      });
      const t = calculateTotals(next);
      const mine = t.percentages.find((p) => p.percentage.name === final);
      return edit(next, `${was ? '' : 'added '}percentage ${final}`.trim(), {
        base: mine?.base,
        amount: mine?.amount,
        total: t.grand.total,
      });
    },
  },
  {
    name: 'set_tax_incentive',
    description:
      'Adds or changes a tax incentive (a film tax credit or rebate). It is worked out on the lines in the qualifying groups, with their fringes unless includeFringes is false, less any excludeFringes (a line in several groups counts once): qualifying spend × rate, then × the share received (e.g. 80 when the credit is sold at 80 cents on the dollar). Productions tag the qualifying lines with a group (set_group, then update_lines with groups) and apply the credit to those groups. Where it shows is set_budget_options incentivePlacement.',
    inputSchema: obj(
      {
        name: str('e.g. "Georgia Film Tax Credit".'),
        newName: str('Rename it (optional).'),
        rate: {
          type: ['number', 'string'],
          description: "The program's rate, percent of qualifying spend, e.g. 30.",
        },
        groups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Groups whose lines qualify (replaces the current list). Must exist.',
        },
        realized: {
          type: ['number', 'string'],
          description:
            'Percent of the credit actually received, e.g. 80 if sold at 80¢ on the dollar. Default 100.',
        },
        includeFringes: {
          type: 'boolean',
          description: "Whether the qualifying lines' fringes count. Default true.",
        },
        excludeFringes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Fringes that do not count when fringes are included, e.g. ["WC"] (replaces the current list).',
        },
        account: str('The account number it shows under on the topsheet, e.g. "9800"; "" clears it.'),
      },
      ['name'],
    ),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const was = budget.settings.incentives.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const rate = optional(input, 'rate') ?? was?.rate;
      if (rate === undefined) throw new ToolError('A new incentive needs rate.');
      const groups = Array.isArray(input['groups'])
        ? (input['groups'] as unknown[]).map(String)
        : (was?.groups ?? []);
      const final = optional(input, 'newName')?.trim() || name;
      const next = setIncentive(budget, {
        ...(was ? { id: was.id } : {}),
        name: final,
        rate,
        groups,
        realized: optional(input, 'realized') ?? was?.realized ?? '100',
        includeFringes:
          typeof input['includeFringes'] === 'boolean'
            ? input['includeFringes']
            : was?.includeFringes !== false,
        excludeFringes: Array.isArray(input['excludeFringes'])
          ? (input['excludeFringes'] as unknown[]).map(String)
          : (was?.excludeFringes ?? []),
        ...accountInput(input, was?.account),
      });
      const t = calculateTotals(next);
      const mine = t.incentives.find((p) => p.incentive.name === final);
      return edit(next, `${was ? '' : 'added '}incentive ${final}`.trim(), {
        qualifyingSpend: mine?.base,
        credit: mine?.credit,
        amount: mine?.amount,
        grandTotal: t.grand.total,
        netCost: t.net,
        ...(groups.length === 0 ? { note: 'No groups qualify yet, so it comes to nothing.' } : {}),
      });
    },
  },
  {
    name: 'delete_tax_incentive',
    description: 'Deletes a tax incentive.',
    inputSchema: obj({ name: str('e.g. "Georgia Film Tax Credit".') }, ['name']),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const was = budget.settings.incentives.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!was) throw new ToolError(`There's no incentive ${name}.`);
      return edit(deleteIncentive(budget, was.id), `deleted incentive ${was.name}`);
    },
  },
  {
    name: 'delete_percentage',
    description: 'Deletes a topsheet percentage.',
    inputSchema: obj({ name: str('e.g. "Contingency".') }, ['name']),
    edits: true,
    run: (budget, input) => {
      const name = text(input, 'name');
      const was = budget.settings.percentages.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!was) throw new ToolError(`There's no percentage ${name}.`);
      return edit(deletePercentage(budget, was.id), `deleted percentage ${was.name}`);
    },
  },
  {
    name: 'get_assumptions',
    description:
      "The budget's assumptions (Budget Settings › Assumptions): notes on what the budget assumes, printed with the reports. Returns their HTML and plain text.",
    inputSchema: obj({}),
    edits: false,
    run: (budget) => ({
      result: {
        html: budget.settings.assumptions,
        text: assumptionsText(budget.settings.assumptions),
        format: ASSUMPTIONS_FORMAT,
      },
    }),
  },
  {
    name: 'set_assumptions',
    description: `Writes the budget's assumptions, replacing what's there (read them first with get_assumptions to change part of them). ${ASSUMPTIONS_FORMAT} Plain text with no tags becomes one paragraph per line. "" clears them.`,
    inputSchema: obj({ html: str('The whole assumptions, as HTML.') }, ['html']),
    edits: true,
    run: (budget, input) => {
      const given = input['html'];
      if (typeof given !== 'string') throw new ToolError('html is required.');
      const html = cleanAssumptions(given);
      if (html === budget.settings.assumptions) throw new ToolError('The assumptions already say that.');
      const next = updateSettings(budget, { ...budget.settings, assumptions: html });
      return edit(next, html ? 'assumptions' : 'cleared the assumptions', {
        html,
        text: assumptionsText(html),
      });
    },
  },
  {
    name: 'set_budget_options',
    description:
      'The budget\'s name, title and options: the title printed at the top of reports (blank uses the name), rounding ("per-line" rounds each line and fringe to cents; "display-only" keeps full precision), how money shows ("cents" or "dollars"), the topsheet production totals (e.g. Above-The-Line from 1000), which replace the current ones, and where tax incentives go ("net": under the grand total with a Net Cost line; "grand-total": taken off the grand total).',
    inputSchema: obj({
      name: str('Budget name.'),
      title: str(
        'The title printed at the top of reports, e.g. "Night Shift — Shooting Budget". "" uses the name.',
      ),
      rounding: { type: 'string', enum: ['per-line', 'display-only'] },
      showMoneyAs: { type: 'string', enum: ['cents', 'dollars'] },
      incentivePlacement: { type: 'string', enum: ['net', 'grand-total'] },
      productionTotals: {
        type: 'array',
        items: obj(
          { name: str('e.g. "Above-The-Line".'), from: str('First category number, e.g. "1000".') },
          ['name', 'from'],
        ),
      },
    }),
    edits: true,
    run: (budget, input) => {
      let next = budget;
      const name = optional(input, 'name')?.trim();
      if (name) next = { ...next, name };
      const title = optional(input, 'title');
      if (title !== undefined) next = updateSettings(next, { ...next.settings, title: title.trim() });
      const rounding = optional(input, 'rounding');
      if (rounding === 'per-line' || rounding === 'display-only') next = setRounding(next, rounding);
      else if (rounding !== undefined) throw new ToolError('rounding is per-line or display-only.');
      const show = optional(input, 'showMoneyAs');
      if (show === 'cents' || show === 'dollars')
        next = updateSettings(next, { ...next.settings, displayPrecision: show });
      else if (show !== undefined) throw new ToolError('showMoneyAs is cents or dollars.');
      const placement = optional(input, 'incentivePlacement');
      if (placement === 'net' || placement === 'grand-total')
        next = updateSettings(next, { ...next.settings, incentivePlacement: placement });
      else if (placement !== undefined) throw new ToolError('incentivePlacement is net or grand-total.');
      if (Array.isArray(input['productionTotals'])) {
        const old = next.settings.coa.levels;
        const levels = (input['productionTotals'] as Input[]).map((l, i) => ({
          id: old[i]?.id ?? newId(),
          name: text(l, 'name'),
          from: text(l, 'from'),
        }));
        if (levels.length === 0) throw new ToolError('Keep at least one production total.');
        next = updateSettings(next, { ...next.settings, coa: { ...next.settings.coa, levels } });
      }
      if (next === budget) throw new ToolError('Nothing to change.');
      return edit(next, 'budget options');
    },
  },
];

/** The account number from a tool's input, or the one it had. */
function accountInput(input: Record<string, unknown>, was: string | undefined): { account?: string } {
  const v = input['account'];
  const account = v === undefined || v === null ? was : String(v);
  return account ? { account } : {};
}
