import { type BudgetTotals, calculateTotals } from './calc';
import type { Totals } from './topsheet';
import { type Budget, budgetTitle } from './model';
import { type CellKind, type ReportCell, type ReportDoc, type ReportRow } from './reports';
import { type BudgetTool, ToolError, obj, str, text } from './tool-kit';

/**
 * Add-ons are small pages the user (or the AI) adds to the app, e.g. a cash flow. They live with
 * the app, not in any budget, and work on whichever budget is showing. What an add-on keeps for a
 * budget (a cash flow's spread, say) is saved in the budget, under the add-on's id, so it goes
 * with the file, lands in the budget's history and can be undone like any other change.
 */

/** An add-on's id: lowercase letters, digits and dashes, e.g. "cash-flow". */
export const ADDON_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export const isAddonId = (id: unknown): id is string => typeof id === 'string' && ADDON_ID.test(id);

/** The most an add-on keeps in one budget, as JSON. */
export const MAX_ADDON_DATA = 2_000_000;

/** Turns a name into an add-on id: "Cash Flow" → "cash-flow". */
export function addonIdFor(name: string): string {
  const id = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return id || 'add-on';
}

/** What an add-on keeps for this budget; null when it hasn't kept anything. */
export function addonData(budget: Budget, id: string): unknown {
  return budget.settings.addonData?.[id] ?? null;
}

/** Keeps an add-on's data in the budget; null clears it. Throws if it isn't JSON or is too big. */
export function setAddonData(budget: Budget, id: string, value: unknown): Budget {
  if (!isAddonId(id)) throw new ToolError(`"${String(id)}" isn't an add-on id.`);
  const { [id]: _old, ...rest } = budget.settings.addonData ?? {};
  let addonData: Record<string, unknown> = rest;
  if (value !== null && value !== undefined) {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      json = undefined;
    }
    if (json === undefined) throw new ToolError('The data must be plain JSON.');
    if (json.length > MAX_ADDON_DATA)
      throw new ToolError(
        `That's ${Math.round(json.length / 1000)} KB; an add-on can keep 2 MB in a budget.`,
      );
    addonData = { ...rest, [id]: JSON.parse(json) as unknown };
  }
  const { addonData: _all, ...settings } = budget.settings;
  return {
    ...budget,
    settings: Object.keys(addonData).length > 0 ? { ...settings, addonData } : settings,
  };
}

/** Saved add-on data, checked: only valid ids, only JSON objects and values. */
export function cleanAddonData(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v).filter(([k, x]) => isAddonId(k) && x !== null));
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A budget's totals as plain data, for an add-on: strings for amounts, keyed by id. */
export interface PlainTotals {
  grand: Totals;
  categoriesTotal: Totals;
  net: string;
  categories: Record<string, Totals>;
  accounts: Record<string, Totals>;
  /** Each line's subtotal and its own fringes. */
  lines: Record<string, { subtotal: string; fringe: string }>;
  percentages: { name: string; percent: string; base: string; amount: string }[];
  incentives: { name: string; base: string; credit: string; amount: string }[];
}

export function plainTotals(budget: Budget, totals: BudgetTotals = calculateTotals(budget)): PlainTotals {
  return {
    grand: totals.grand,
    categoriesTotal: totals.categoriesTotal,
    net: totals.net,
    categories: Object.fromEntries(totals.categories),
    accounts: Object.fromEntries(totals.accounts),
    lines: Object.fromEntries(
      [...totals.lines].map(([id, t]) => [
        id,
        { subtotal: t.subtotal.toString(), fringe: t.fringe.toString() },
      ]),
    ),
    percentages: totals.percentages.map((p) => ({
      name: p.percentage.name,
      percent: p.percentage.percent,
      base: p.base,
      amount: p.amount,
    })),
    incentives: totals.incentives.map((i) => ({
      name: i.incentive.name,
      base: i.base,
      credit: i.credit,
      amount: i.amount,
    })),
  };
}

const ADDON = str('The add-on\'s id, as list_addons gives it, e.g. "cash-flow".');

/** Tools for what add-ons keep in a budget; building add-ons themselves is the app's (list_addons). */
export const ADDON_TOOLS: readonly BudgetTool[] = [
  {
    name: 'get_addon_data',
    description:
      "What an add-on keeps for this budget (e.g. a cash flow's weeks and how each account spreads over them), as the add-on saved it; null if nothing yet. list_addons says what each add-on keeps.",
    inputSchema: obj({ addon: ADDON }, ['addon']),
    edits: false,
    run: (budget, input) => ({
      result: { addon: text(input, 'addon'), data: addonData(budget, text(input, 'addon')) },
    }),
  },
  {
    name: 'set_addon_data',
    description:
      "Replaces what an add-on keeps for this budget, e.g. to fill in a cash flow's spread for the user. Read it with get_addon_data first and keep the add-on's shape; the add-on shows the change at once. null clears it. Up to 2 MB of JSON.",
    inputSchema: obj(
      {
        addon: ADDON,
        data: { description: 'The whole new data, any JSON, in the shape the add-on uses; null clears it.' },
        summary: str(
          'A few words on the change, for the budget\'s history, e.g. "spread camera over weeks 3-10".',
        ),
      },
      ['addon', 'data'],
    ),
    edits: true,
    run: (budget, input) => {
      const id = text(input, 'addon');
      const summary =
        typeof input['summary'] === 'string' && input['summary'].trim() ? input['summary'].trim() : 'data';
      return {
        budget: setAddonData(budget, id, input['data'] ?? null),
        label: `AI: ${id} ${summary}`.slice(0, 120),
        result: { addon: id, saved: input['data'] !== null && input['data'] !== undefined },
      };
    },
  },
];

const KINDS: readonly CellKind[] = ['text', 'money', 'number', 'percent', 'rate'];
const MAX_ROWS = 20_000;

/**
 * A report an add-on asks to save, checked and made into the app's own report, so it prints like
 * the others. `report` is `{ title, sections: [{ title, columns: [{ label, kind }], rows, totals?,
 * note? }] }`; cells are strings or numbers. Throws ToolError when it isn't one.
 */
export function addonReport(budget: Budget, report: unknown, now = new Date()): ReportDoc {
  const r = report as { title?: unknown; sections?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.sections) || r.sections.length === 0)
    throw new ToolError('A report needs sections.');
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 120) : 'Report';
  let count = 0;
  // Numbers from an add-on's maths (45.333333333333336, 1e-7) as the decimals the report shows.
  const cell = (v: unknown, kind: CellKind): ReportCell =>
    v === null || v === undefined
      ? null
      : typeof v === 'number'
        ? Number.isFinite(v)
          ? v
              .toFixed(kind === 'money' || kind === 'percent' ? 2 : 6)
              .replace(/(\.\d*?)0+$/, '$1')
              .replace(/\.$/, '')
              .replace(/^-0$/, '0')
          : null
        : String(v).slice(0, 2000);
  const sections = r.sections.map((raw, i) => {
    const s = (raw ?? {}) as {
      title?: unknown;
      columns?: unknown;
      rows?: unknown;
      totals?: unknown;
      note?: unknown;
    };
    if (!Array.isArray(s.columns) || s.columns.length === 0)
      throw new ToolError(`Section ${i + 1} needs columns.`);
    const columns = s.columns.map((c: unknown) => {
      const col = (typeof c === 'string' ? { label: c } : (c ?? {})) as { label?: unknown; kind?: unknown };
      return {
        label: String(col.label ?? '').slice(0, 80),
        kind: KINDS.includes(col.kind as CellKind) ? (col.kind as CellKind) : ('text' as CellKind),
      };
    });
    const rowsOf = (v: unknown, style: ReportRow['style']): ReportRow[] => {
      const list = Array.isArray(v) ? v : [];
      // One row on its own (['Total', 3000]) as well as a list of them.
      const rows = list.length > 0 && !list.some(Array.isArray) ? [list] : list;
      return rows.map((cells: unknown) => {
        if (++count > MAX_ROWS) throw new ToolError(`A report can have ${MAX_ROWS} rows.`);
        const row = Array.isArray(cells) ? cells : [];
        return { cells: columns.map((c, j) => cell(row[j], c.kind)), style };
      });
    };
    const rows = [...rowsOf(s.rows, 'normal'), ...rowsOf(s.totals, 'total')];
    if (typeof s.note === 'string' && s.note.trim())
      rows.push({
        cells: [s.note.trim().slice(0, 2000), ...columns.slice(1).map(() => null)],
        style: 'note',
      });
    return {
      id: 'addon' as const,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : title,
      blocks: [{ kind: 'table' as const, columns, rows }],
    };
  });
  return {
    title: budgetTitle(budget),
    budgetName: budget.name,
    created: now.toISOString(),
    precision: budget.settings.displayPrecision,
    sections,
  };
}
