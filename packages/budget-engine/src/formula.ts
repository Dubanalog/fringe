import { EditError } from './edit';
import { type Decimal, toDecimal } from './money';
import type { GlobalDef } from './model';

/**
 * Formulas in numeric fields: numbers, global names, + - * / and brackets, e.g. "SW*5" or
 * "(DGAShootWeeks + DGADarkWeeks) / 2". Parsed by hand (no eval) and worked out in exact decimals.
 * Global names match regardless of case and are stored as the global spells them.
 */

type Token =
  | { kind: 'num'; value: Decimal }
  | { kind: 'name'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '(' | ')' };

const TOKEN = /\s*(?:(\d[\d,]*(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()]))/y;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  const end = text.trimEnd().length;
  while (TOKEN.lastIndex < end) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(text);
    if (!m) throw new EditError(`Can't read "${text.slice(at).trim()}" in ${text.trim()}.`);
    if (m[1] !== undefined) tokens.push({ kind: 'num', value: toDecimal(m[1].replaceAll(',', '')) });
    else if (m[2] !== undefined) tokens.push({ kind: 'name', name: m[2] });
    else tokens.push({ kind: 'op', op: m[3] as '+' });
  }
  return tokens;
}

/** Looks up a global's value by name (any case); undefined = no such global, null = not set yet. */
export type GlobalLookup = (name: string) => { name: string; value: Decimal | null } | undefined;

export interface Evaluated {
  value: Decimal;
  /** The formula with global names spelled as defined, e.g. "sw*5" → "SW*5". */
  formula: string;
  /** Globals it uses, as defined. */
  globals: string[];
}

/** Works out a formula. Throws EditError for bad syntax, unknown or unset globals, or dividing by zero. */
export function evaluateFormula(text: string, lookup: GlobalLookup): Evaluated {
  const tokens = tokenize(text);
  if (tokens.length === 0) throw new EditError('Enter a number or a formula.');
  const globals: string[] = [];
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (t: Token | undefined, ...ops: string[]) => t?.kind === 'op' && ops.includes(t.op);

  const expr = (): Decimal => {
    let v = term();
    while (isOp(peek(), '+', '-')) {
      const op = (tokens[i++] as { op: string }).op;
      v = op === '+' ? v.plus(term()) : v.minus(term());
    }
    return v;
  };
  const term = (): Decimal => {
    let v = factor();
    while (isOp(peek(), '*', '/')) {
      const op = (tokens[i++] as { op: string }).op;
      const r = factor();
      if (op === '/' && r.isZero()) throw new EditError(`${text.trim()} divides by zero.`);
      v = op === '*' ? v.times(r) : v.dividedBy(r);
    }
    return v;
  };
  const factor = (): Decimal => {
    const t = tokens[i++];
    if (!t) throw new EditError(`${text.trim()} ends too soon.`);
    if (t.kind === 'num') return t.value;
    if (t.kind === 'name') {
      const g = lookup(t.name);
      if (!g) throw new EditError(`There's no global called ${t.name}. Add it in Budget Settings → Globals.`);
      if (g.value === null) throw new EditError(`Global ${g.name} has no value yet.`);
      t.name = g.name;
      if (!globals.includes(g.name)) globals.push(g.name);
      return g.value;
    }
    if (t.op === '-') return factor().negated();
    if (t.op === '+') return factor();
    if (t.op === '(') {
      const v = expr();
      if (!isOp(tokens[i++], ')')) throw new EditError(`${text.trim()} is missing a ")".`);
      return v;
    }
    throw new EditError(`Unexpected "${t.op}" in ${text.trim()}.`);
  };

  const value = expr();
  if (i < tokens.length)
    throw new EditError(`Can't read ${text.trim()}: something is missing between values.`);
  const formula = tokens
    .map((t) => (t.kind === 'num' ? t.value.toFixed() : t.kind === 'name' ? t.name : t.op))
    .join('');
  return { value, formula, globals };
}

/** A plain number ("1,250.50", "-3"), or null when the text is a formula. */
export function plainNumber(text: string): Decimal | null {
  const t = text.trim().replace(/^\$/, '');
  try {
    return toDecimal(t);
  } catch {
    return null;
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks a global's name: letters, digits and _, starting with a letter. */
export function checkGlobalName(name: string, taken: readonly string[]): void {
  if (!NAME.test(name)) {
    throw new EditError(
      'A global name uses letters, digits and _, and starts with a letter, e.g. SW or ShootWeeks.',
    );
  }
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) {
    throw new EditError(`There's already a global called ${name}.`);
  }
}

/**
 * Every global's value. Globals can use other globals; one that is blank, invalid, or part of a
 * loop (A uses B uses A) has no value (null), and so does anything using it.
 */
export function resolveGlobals(defs: readonly GlobalDef[]): Map<string, Decimal | null> {
  const byKey = new Map(defs.map((g) => [g.name.toLowerCase(), g]));
  const done = new Map<string, Decimal | null>();
  const visiting = new Set<string>();
  const resolve = (key: string): Decimal | null => {
    if (done.has(key)) return done.get(key)!;
    const g = byKey.get(key);
    if (!g || visiting.has(key)) return null;
    visiting.add(key);
    let value: Decimal | null = null;
    if (g.value.trim() !== '') {
      try {
        value = evaluateFormula(g.value, (n) => {
          const other = byKey.get(n.toLowerCase());
          return other && { name: other.name, value: resolve(n.toLowerCase()) };
        }).value;
      } catch (e) {
        if (!(e instanceof EditError)) throw e;
      }
    }
    visiting.delete(key);
    done.set(key, value);
    return value;
  };
  return new Map(defs.map((g) => [g.name, resolve(g.name.toLowerCase())]));
}

/** A lookup over resolved globals. */
export function globalLookup(values: ReadonlyMap<string, Decimal | null>): GlobalLookup {
  const byKey = new Map([...values].map(([name, value]) => [name.toLowerCase(), { name, value }]));
  return (name) => byKey.get(name.toLowerCase());
}

/** Global names a formula mentions (by token), as written. */
export function formulaNames(formula: string): string[] {
  try {
    return tokenize(formula).flatMap((t) => (t.kind === 'name' ? [t.name] : []));
  } catch {
    return [];
  }
}
