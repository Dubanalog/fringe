import { EditError } from './edit';
import type { Budget, BudgetSettings, CodeField, DetailLine, PostedFringe, UnitDef } from './model';
import { type Decimal, sum, toDecimal } from './money';

export type LineTag = 'fringes' | 'groups';

/** Adds or removes a fringe or group on each of the given detail lines. */
export function setLineTag(
  budget: Budget,
  lineIds: readonly string[],
  tag: LineTag,
  name: string,
  on: boolean,
): Budget {
  const ids = new Set(lineIds);
  return {
    ...budget,
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => {
          if (!ids.has(d.id) || d[tag].includes(name) === on) return d;
          return { ...d, [tag]: on ? [...d[tag], name] : d[tag].filter((t) => t !== name) };
        }),
      })),
    })),
  };
}

/** Puts a line's fringes or groups in the given order (e.g. after dragging); unknown names are ignored. */
export function orderLineTags(
  budget: Budget,
  lineId: string,
  tag: LineTag,
  order: readonly string[],
): Budget {
  return {
    ...budget,
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => {
          if (d.id !== lineId) return d;
          const known = order.filter((t) => d[tag].includes(t));
          return { ...d, [tag]: [...known, ...d[tag].filter((t) => !known.includes(t))] };
        }),
      })),
    })),
  };
}

/** Subtotal × the line's fringe % as reported on import; null when there's no %. */
export function estimatedFringe(d: DetailLine): Decimal | null {
  const pct = parsePercent(d.importedFringePercent?.line);
  return pct === null ? null : toDecimal(d.subtotal).times(pct).dividedBy(100);
}

/**
 * Every unit the lines use, most used first, with hours read from names like
 * "Weeks-45 Hours" or "Days-8". Plain names ("Weeks") get no hours.
 */
export function unitsFromLines(lines: Iterable<Pick<DetailLine, 'unit'>>): UnitDef[] {
  const uses = new Map<string, number>();
  for (const d of lines) {
    const name = d.unit.trim();
    if (name) uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  return [...uses]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([name]) => ({
      name,
      hours: /-\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)?\s*$/i.exec(name)?.[1] ?? null,
    }));
}

/** A fringe's rate as last reported for the budget (the first posting found). */
export type FringeRate = Pick<PostedFringe, 'kind' | 'rate' | 'unit'>;

/** Every fringe and group name in the budget (set up or used on a line), sorted, with fringe rates where known. */
export function budgetTags(budget: Budget): { fringes: Map<string, FringeRate | null>; groups: string[] } {
  const fringes = new Map<string, FringeRate | null>(
    budget.settings.fringeDefs.map((f) => [f.name, { kind: f.kind, rate: f.rate, unit: f.unit }]),
  );
  const groups = new Set<string>(budget.settings.groups);
  for (const c of budget.categories) {
    for (const a of c.accounts) {
      for (const f of a.postedFringes) {
        if (!fringes.get(f.name)) fringes.set(f.name, { kind: f.kind, rate: f.rate, unit: f.unit });
      }
      for (const d of a.details) {
        d.fringes.forEach((f) => fringes.has(f) || fringes.set(f, null));
        d.groups.forEach((g) => groups.add(g));
      }
    }
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  return {
    fringes: new Map([...fringes].sort(([a], [b]) => byName(a, b))),
    groups: [...groups].sort(byName),
  };
}

/** Totals for one or more selected detail lines. */
export interface LineSummary {
  count: number;
  subtotal: Decimal;
  /** Subtotal × each line's fringe % as reported on import. Null when no line has one. */
  fringe: Decimal | null;
  /** Lowest and highest fringe % among the lines that have one. */
  fringePercent: { min: Decimal; max: Decimal } | null;
  /** How many of the lines carry each fringe / group. */
  fringes: Map<string, number>;
  groups: Map<string, number>;
}

export function summarizeLines(lines: readonly DetailLine[]): LineSummary {
  const pcts: Decimal[] = [];
  const fringeAmounts: Decimal[] = [];
  const count = (tag: LineTag) => {
    const m = new Map<string, number>();
    lines.forEach((d) => d[tag].forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return m;
  };
  for (const d of lines) {
    const pct = parsePercent(d.importedFringePercent?.line);
    const amount = estimatedFringe(d);
    if (pct === null || amount === null) continue;
    pcts.push(pct);
    fringeAmounts.push(amount);
  }
  return {
    count: lines.length,
    subtotal: sum(lines.map((d) => d.subtotal)),
    fringe: fringeAmounts.length ? sum(fringeAmounts) : null,
    fringePercent: pcts.length
      ? {
          min: pcts.reduce((a, b) => (b.lessThan(a) ? b : a)),
          max: pcts.reduce((a, b) => (b.greaterThan(a) ? b : a)),
        }
      : null,
    fringes: count('fringes'),
    groups: count('groups'),
  };
}

function parsePercent(text: string | undefined): Decimal | null {
  const m = text?.trim().match(/^(-?\d+(?:\.\d+)?)%?$/);
  return m ? toDecimal(m[1]!) : null;
}

/** How many lines in the budget carry a fringe or group. */
export function tagUseCount(budget: Budget, tag: LineTag, name: string): number {
  return budget.categories.reduce(
    (n, c) => n + c.accounts.reduce((m, a) => m + a.details.filter((d) => d[tag].includes(name)).length, 0),
    0,
  );
}

/** Renames a fringe or group everywhere: on every line, and in its setup (rate, colour). */
export function renameLineTag(budget: Budget, tag: LineTag, from: string, to: string): Budget {
  const name = to.trim();
  if (!name) throw new EditError(`A ${tag === 'fringes' ? 'fringe' : 'group'} needs a name.`);
  if (name === from) return budget;
  const known = budgetTags(budget);
  if (tag === 'fringes' ? known.fringes.has(name) : known.groups.includes(name)) {
    throw new EditError(`There's already a ${tag === 'fringes' ? 'fringe' : 'group'} called ${name}.`);
  }
  return mapTag(
    budget,
    tag,
    from,
    (list) => list.map((t) => (t === from ? name : t)),
    (s) =>
      tag === 'fringes'
        ? {
            ...s,
            fringeDefs: s.fringeDefs.map((f) => (f.name === from ? { ...f, name } : f)),
            ...(s.crewFringes && { crewFringes: s.crewFringes.map((f) => (f === from ? name : f)) }),
            incentives: s.incentives.map((p) =>
              p.excludeFringes?.includes(from)
                ? { ...p, excludeFringes: p.excludeFringes.map((f) => (f === from ? name : f)) }
                : p,
            ),
          }
        : {
            ...s,
            groups: s.groups.map((g) => (g === from ? name : g)),
            percentages: s.percentages.map((p) =>
              p.excludeGroups.includes(from)
                ? { ...p, excludeGroups: p.excludeGroups.map((g) => (g === from ? name : g)) }
                : p,
            ),
            incentives: s.incentives.map((p) =>
              p.groups.includes(from) ? { ...p, groups: p.groups.map((g) => (g === from ? name : g)) } : p,
            ),
            groupColors: Object.fromEntries(
              Object.entries(s.groupColors).map(([g, c]) => [g === from ? name : g, c]),
            ),
          },
  );
}

/** Deletes a fringe or group: takes it off every line and out of the setup. */
export function deleteLineTag(budget: Budget, tag: LineTag, name: string): Budget {
  return mapTag(
    budget,
    tag,
    name,
    (list) => list.filter((t) => t !== name),
    (s) => {
      if (tag === 'fringes') {
        return {
          ...s,
          fringeDefs: s.fringeDefs.filter((f) => f.name !== name),
          ...(s.crewFringes && { crewFringes: s.crewFringes.filter((f) => f !== name) }),
          incentives: s.incentives.map((p) => {
            if (!p.excludeFringes?.includes(name)) return p;
            const { excludeFringes, ...rest } = p;
            const left = excludeFringes.filter((f) => f !== name);
            return left.length > 0 ? { ...rest, excludeFringes: left } : rest;
          }),
        };
      }
      const groupColors = { ...s.groupColors };
      delete groupColors[name];
      const percentages = s.percentages.map((p) =>
        p.excludeGroups.includes(name)
          ? { ...p, excludeGroups: p.excludeGroups.filter((g) => g !== name) }
          : p,
      );
      const incentives = s.incentives.map((p) =>
        p.groups.includes(name) ? { ...p, groups: p.groups.filter((g) => g !== name) } : p,
      );
      return { ...s, groups: s.groups.filter((g) => g !== name), groupColors, percentages, incentives };
    },
  );
}

function mapTag(
  budget: Budget,
  tag: LineTag,
  name: string,
  fn: (list: string[]) => string[],
  settings: (s: BudgetSettings) => BudgetSettings,
): Budget {
  return {
    ...budget,
    settings: settings(budget.settings),
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => (d[tag].includes(name) ? { ...d, [tag]: fn(d[tag]) } : d)),
      })),
    })),
  };
}

/** A code column's list: the codes set up for it, then any lines use that aren't set up, sorted. */
export function codeList(budget: Budget, field: CodeField): string[] {
  const listed = budget.settings.codes[field];
  const used = new Set(
    budget.categories.flatMap((c) => c.accounts.flatMap((a) => a.details.map((d) => d[field].trim()))),
  );
  const extra = [...used]
    .filter((v) => v && !listed.includes(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...listed, ...extra];
}

/** How many lines use a code. */
export function codeUseCount(budget: Budget, field: CodeField, code: string): number {
  return budget.categories.reduce(
    (n, c) =>
      n + c.accounts.reduce((m, a) => m + a.details.filter((d) => d[field].trim() === code).length, 0),
    0,
  );
}

/** Renames a code in its list and on every line using it. */
export function renameCode(budget: Budget, field: CodeField, from: string, to: string): Budget {
  const name = to.trim();
  if (!name) throw new EditError('A code needs a name.');
  if (name === from) return budget;
  if (codeList(budget, field).includes(name)) throw new EditError(`There's already a code ${name}.`);
  const list = codeList(budget, field).map((c) => (c === from ? name : c));
  return mapCodes(budget, field, list, (v) => (v.trim() === from ? name : v));
}

/** Deletes a code from its list and clears it from every line using it. */
export function deleteCode(budget: Budget, field: CodeField, code: string): Budget {
  const list = budget.settings.codes[field].filter((c) => c !== code);
  return mapCodes(budget, field, list, (v) => (v.trim() === code ? '' : v));
}

function mapCodes(budget: Budget, field: CodeField, list: string[], fn: (v: string) => string): Budget {
  return {
    ...budget,
    settings: { ...budget.settings, codes: { ...budget.settings.codes, [field]: list } },
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => ({
        ...a,
        details: a.details.map((d) => {
          const v = fn(d[field]);
          return v === d[field] ? d : { ...d, [field]: v };
        }),
      })),
    })),
  };
}
