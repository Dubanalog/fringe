import {
  type Account,
  type Budget,
  type DetailLine,
  type DetailTextField,
  type NumericDetailField,
  type Decimal,
  type Totals,
  type FringeDef,
  type LineTag,
  type PasteColumn,
  CODE_FIELDS,
  accountFringes,
  applyTextEdit,
  breakdownTotal,
  breakdownWords,
  budgetTags,
  calculateTotals,
  categoryFringeAccount,
  codeList,
  convertedSubtotal,
  createFringeRange,
  deleteRow,
  fringeTotal,
  formatRate,
  fringeBreakdown,
  fringeSourceAccounts,
  insertDetail,
  pasteLines,
  lineCurrency,
  rangeOf,
  removeFringeRanges,
  resolveGlobals,
  setLineNumber,
  setLineTag,
  sum,
  summarizeLines,
  toDecimal,
  updateSettings,
} from '@fringe/budget-engine';
import { useMemo, useState } from 'react';
import { ColorPick } from './ColorPick';
import { ContextMenu } from './ContextMenu';
import { moveColumn, orderedColumns } from './columnLayout';
import { type Cell, Grid, type GridColumn, type GridRow } from './Grid';
import { isBoolean, usePref } from './prefs';

/**
 * Detail-line columns in default order. Description and Subtotal always show; the rest can be
 * toggled. Order and visibility are saved per budget (settings.detailColumns).
 */
interface DetailColumn extends GridColumn {
  id: string;
  /** Editable text field on the line. */
  field?: DetailTextField;
  /** Numeric field that can hold a global, e.g. Amount = SD. */
  numeric?: NumericDetailField;
  fixed?: boolean;
  /**
   * `fringes` is the line's calculated fringe total; null when it has none or can't be worked out.
   * `line` has its currency ('' for the budget's own) and its subtotal in the budget's currency.
   */
  text(d: DetailLine, money: (v: string) => string, fringes: Decimal | null, line: LineMoney): string;
}

interface LineMoney {
  currency: string;
  /** Null when the line's currency has no rate. */
  converted: Decimal | null;
}

const NUMBER_HELP =
  'Type a number, a global (e.g. SW) or a formula (e.g. SW*5). Globals: Budget Settings → Globals';
const CODE_HELP = 'Set up codes in Budget Settings → Codes';

/** A line's subtotal in the budget's currency; zero when its currency has no rate. */
function budgetSubtotal(d: DetailLine, budget: Budget): string {
  return (convertedSubtotal(d, budget.settings) ?? toDecimal(0)).toFixed();
}

/** Quantities show as stored; the default multiplier of 1 and zero amounts stay blank. */
function qty(value: string, blank = '0'): string {
  return value === blank ? '' : value;
}

const COLUMNS: readonly DetailColumn[] = [
  {
    id: 'range',
    label: 'Range',
    title: 'Fringe ranges: lines joined by a bar share fringe cutoffs. Drag down this column to draw one.',
    text: () => '',
  },
  {
    id: 'description',
    label: 'Description',
    editable: true,
    field: 'description',
    fixed: true,
    text: (d) => d.description,
  },
  {
    id: 'amount',
    label: 'Amount',
    num: true,
    editable: true,
    numeric: 'amount',
    title: NUMBER_HELP,
    text: (d) => qty(d.amount),
  },
  { id: 'unit', label: 'Unit', editable: true, field: 'unit', text: (d) => d.unit },
  {
    id: 'x',
    label: 'X',
    num: true,
    editable: true,
    numeric: 'x',
    title: NUMBER_HELP,
    text: (d) => qty(d.x, '1'),
  },
  {
    id: 'rate',
    label: 'Rate',
    num: true,
    editable: true,
    numeric: 'rate',
    title: NUMBER_HELP,
    text: (d) => (d.rate === '0' ? '' : formatRate(d.rate)),
  },
  {
    id: 'currency',
    label: 'Currency',
    editable: true,
    field: 'currency',
    title: "Blank for the budget's currency. Set up others in Budget Settings → Currencies",
    text: (d) => d.currency,
  },
  {
    id: 'subtotal',
    label: 'Subtotal',
    num: true,
    fixed: true,
    title: "Amount × X × Rate, in the line's currency",
    text: (d, money, _f, line) =>
      line.currency ? `${line.currency} ${money(d.subtotal)}` : money(d.subtotal),
  },
  { id: 'set', label: 'Set', editable: true, field: 'set', text: (d) => d.set },
  { id: 'location', label: 'Location', editable: true, field: 'location', text: (d) => d.location },
  { id: 'in', label: 'In', editable: true, field: 'in', title: CODE_HELP, text: (d) => d.in },
  { id: 'ff1', label: 'FF1', editable: true, field: 'ff1', title: CODE_HELP, text: (d) => d.ff1 },
  { id: 'ff2', label: 'FF2', editable: true, field: 'ff2', title: CODE_HELP, text: (d) => d.ff2 },
  {
    id: 'fringePct',
    label: 'Fringe %',
    num: true,
    title: 'Fringes as a percentage of the subtotal',
    text: (_d, _money, f, line) => {
      const subtotal = line.converted;
      return f === null || f.isZero() || subtotal === null || subtotal.isZero()
        ? ''
        : `${f.dividedBy(subtotal).times(100).toFixed(2)}%`;
    },
  },
  {
    id: 'fringeAmount',
    label: 'Fringes',
    num: true,
    title:
      "The line's fringes, using fringe cutoffs and ranges. Blank where a flat fringe's unit has no hours set.",
    text: (_d, money, f) => (f === null || f.isZero() ? '' : money(f.toFixed(2))),
  },
  {
    id: 'groups',
    label: 'Groups',
    title: 'Change groups in the line details below',
    text: (d) => d.groups.join(', '),
  },
];

/** Shown until a budget saves its own layout. */
const DEFAULT_HIDDEN = ['currency', 'location', 'in', 'ff1', 'ff2'];

interface Props {
  budget: Budget;
  account: Account;
  /** The account's totals, with the fringes posted to it (see calculateTotals). */
  totals: Totals;
  money(v: string): string;
  selection: Cell | undefined;
  onSelect(cell: Cell): void;
  update(budget: Budget, label?: string): void;
}

export function AccountLines({ budget, account, totals, money, selection, onSelect, update }: Props) {
  const [showGlobals, setShowGlobals] = usePref('showGlobals', false, isBoolean);
  const [showPane, setShowPane] = usePref('lineDetailPane', true, isBoolean);
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number } | null>(null);
  /** Lines selected with Shift/Ctrl+click; empty means just the current line. */
  const [marked, setMarked] = useState<string[]>([]);

  const layout = orderedColumns(COLUMNS, budget.settings.detailColumns, DEFAULT_HIDDEN);
  const unitSuggestions = budget.settings.units.map((u) => ({
    value: u.name,
    ...(u.hours ? { hint: `${u.hours} hrs` } : {}),
  }));
  const currencySuggestions = budget.settings.currencies.map((c) => ({
    value: c.code,
    hint: c.rate ? `${c.rate} ${budget.settings.currency}` : 'no rate',
  }));
  const globalValues = resolveGlobals(budget.settings.globals);
  const globalSuggestions = [...globalValues].map(([value, v]) => ({
    value,
    hint: v === null ? 'no value' : v.toFixed(),
  }));
  const columns = layout.columns
    .filter((c) => c.fixed || !layout.hidden.has(c.id))
    .map((c) => (c.field === 'unit' ? { ...c, suggestions: unitSuggestions } : c))
    .map((c) => (c.field === 'currency' ? { ...c, suggestions: currencySuggestions } : c))
    .map((c) => (c.numeric ? { ...c, suggestions: globalSuggestions, suggestWord: true } : c))
    .map((c) => {
      const field = CODE_FIELDS.find((f) => f === c.field);
      return field ? { ...c, suggestions: codeList(budget, field).map((value) => ({ value })) } : c;
    })
    .map((c) =>
      c.id === 'range'
        ? {
            ...c,
            // Drawing over lines makes them a range of their own, taking them out of any other.
            onDrawRows: (ids: string[]) => {
              update(createFringeRange(budget, account.id, ids).budget);
              selectLines(ids);
            },
          }
        : c,
    );
  const groupColors = budget.settings.groupColors;
  // The Range column draws each fringe range as a bar down its lines, alternating two tones so
  // neighbouring ranges stand apart.
  const lineRange = account.details.map((d) => rangeOf(account, d.id));
  // Tones go by order down the page, so each range differs from the one before it.
  const tone = new Map<unknown, number>();
  for (const r of lineRange) if (r && !tone.has(r)) tone.set(r, tone.size % 2);
  const rangeBar = (i: number) => {
    const range = lineRange[i];
    if (!range) return undefined;
    return [
      'cell-range',
      `cell-range-${tone.get(range)}`,
      lineRange[i - 1] !== range ? 'cell-range-start' : '',
      lineRange[i + 1] !== range ? 'cell-range-end' : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const calculated = accountFringes(account, budget.settings);
  const lineMoney = (d: DetailLine): LineMoney => ({
    currency: lineCurrency(d, budget.settings),
    converted: convertedSubtotal(d, budget.settings),
  });
  const rows: GridRow[] = account.details.map((d, i) => {
    const color = d.groups.map((g) => groupColors[g]).find(Boolean);
    return {
      id: d.id,
      cells: columns.map((c) => {
        const formula = c.numeric && d.formulas[c.numeric];
        return showGlobals && formula
          ? formula
          : c.text(d, money, fringeTotal(calculated.get(d.id)), lineMoney(d));
      }),
      // Editing a number starts from its formula when it has one, so SW*5 stays SW*5.
      values: columns.map((c) => (c.numeric ? (d.formulas[c.numeric] ?? d[c.numeric]) : undefined)),
      cellClass: columns.map((c) =>
        c.id === 'range'
          ? rangeBar(i)
          : showGlobals && c.numeric && d.formulas[c.numeric]
            ? 'cell-global'
            : undefined,
      ),
      ...(color ? { color } : {}),
    };
  });
  const subtotal = sum(account.details.map((d) => budgetSubtotal(d, budget))).toFixed();
  const lineFringes = sum(
    account.details.flatMap((d) => {
      const f = fringeTotal(calculated.get(d.id));
      return f === null ? [] : [f.toFixed()];
    }),
  );
  const footer = (label: string, at: Partial<Record<string, string>>) =>
    columns.map((c, i) => (i === 0 ? label : (at[c.id] ?? '')));
  // Just the lines' total when there are no fringes to show.
  const footers =
    toDecimal(totals.fringe).isZero() && lineFringes.isZero()
      ? [footer('Total', { subtotal: money(subtotal) })]
      : [
          footer('Lines', { subtotal: money(subtotal), fringeAmount: money(lineFringes.toFixed()) }),
          footer('Total', {
            subtotal: money(totals.total),
            description: postingNote(budget, account, lineFringes, toDecimal(totals.fringe), money),
          }),
        ];
  // The pane works on the marked lines, or on the current line when none are marked.
  const live = marked.filter((id) => account.details.some((d) => d.id === id));
  const current = account.details.find((d) => d.id === selection?.row) ?? account.details[0];
  const selectedLines =
    live.length > 0 ? account.details.filter((d) => live.includes(d.id)) : current ? [current] : [];
  const selectLines = (ids: readonly string[]) => {
    setMarked(ids.length > 1 ? [...ids] : []);
    if (ids[0]) onSelect({ row: ids[0], col: selection?.col ?? 0 });
  };

  const saveLayout = (order: string[], hidden: Set<string>) =>
    update(updateSettings(budget, { ...budget.settings, detailColumns: { order, hidden: [...hidden] } }));
  const order = layout.columns.map((c) => c.id);
  const toggleColumn = (id: string) => {
    const hidden = new Set(layout.hidden);
    if (!hidden.delete(id)) hidden.add(id);
    saveLayout(order, hidden);
  };
  const onMoveColumn = (from: number, to: number) => {
    const id = columns[from]!.id;
    const next = moveColumn(order, id, columns[to]?.id ?? null);
    saveLayout(next, layout.hidden);
    // Keep the selected cell on the same column.
    const selectedId = selection && columns[selection.col]?.id;
    if (selection && selectedId) {
      const shown = next.filter((c) => columns.some((v) => v.id === c));
      onSelect({ row: selection.row, col: shown.indexOf(selectedId) });
    }
  };

  return (
    <>
      <div className="grid-toolbar">
        <button
          type="button"
          className="btn btn-small"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setColumnMenu({ x: r.left, y: r.bottom + 2 });
          }}
        >
          Columns ▾
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={showGlobals}
          title="Show the global behind a number (e.g. SD) instead of its value (176)"
          onClick={() => setShowGlobals(!showGlobals)}
        >
          {showGlobals ? 'Showing globals' : 'Showing amounts'}
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={showPane}
          onClick={() => setShowPane(!showPane)}
        >
          {showPane ? 'Hide line details' : 'Show line details'}
        </button>
      </div>

      <div className="workspace-body">
        <Grid
          key={account.id}
          label={`Detail lines of account ${account.number}`}
          rowNoun="Line"
          columns={columns}
          rows={rows}
          footer={footers}
          emptyText="No detail lines yet. Click here (or press Ins) to add one."
          selection={selection}
          onSelect={onSelect}
          marked={live}
          onMark={setMarked}
          onCommit={(row, col, value) => {
            const c = columns[col]!;
            update(
              c.numeric
                ? setLineNumber(budget, row, c.numeric, value)
                : applyTextEdit(budget, { kind: 'detail', id: row, field: c.field!, value }),
              `${c.label} on ${account.number}`,
            );
          }}
          onMoveColumn={onMoveColumn}
          onPaste={(row, col, cells) => {
            const into = columns
              .slice(col)
              .map((c): PasteColumn =>
                c.numeric
                  ? { label: c.label, numeric: c.numeric }
                  : c.field && c.editable
                    ? { label: c.label, field: c.field }
                    : { label: c.label },
              );
            const r = pasteLines(budget, account.id, row, into, cells);
            update(
              r.budget,
              `Pasted ${cells.length} line${cells.length === 1 ? '' : 's'} on ${account.number}`,
            );
            selectLines(r.lineIds);
            const n = r.refused.length;
            return n === 0
              ? null
              : `${n} cell${n === 1 ? " didn't" : "s didn't"} go in: ${r.refused.slice(0, 3).join('; ')}${n > 3 ? '…' : ''}`;
          }}
          onInsert={(sibling, position) => {
            const r = insertDetail(budget, account.id, { siblingId: sibling, position });
            update(r.budget);
            return r.id;
          }}
          deletePrompt={(row) => {
            const d = account.details.find((x) => x.id === row);
            return `Delete the line "${d?.description || '(blank)'}"?`;
          }}
          onDelete={(row) => update(deleteRow(budget, 'detail', row))}
        />
        <FringeBreakdown budget={budget} account={account} money={money} />
        {account.postedFringes.length > 0 && (
          <>
            <h3>Fringes posted here</h3>
            <table className="grid browser-grid">
              <thead>
                <tr>
                  <th>Fringe</th>
                  <th>Type</th>
                  <th className="num">Rate</th>
                  <th className="num">Base</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {account.postedFringes.map((f, i) => (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td>{f.kind === 'percent' ? 'Percent' : `Flat per ${f.unit || 'unit'}`}</td>
                    <td className="num">{f.kind === 'percent' ? `${f.rate}%` : formatRate(f.rate)}</td>
                    <td className="num">{f.kind === 'percent' ? money(f.base) : `${f.base} ${f.unit}`}</td>
                    <td className="num">{money(f.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{money(sum(account.postedFringes.map((f) => f.total)).toFixed())}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>

      {showPane && selectedLines.length > 0 && (
        <LinePane budget={budget} account={account} lines={selectedLines} money={money} update={update} />
      )}

      {columnMenu && (
        <ContextMenu
          x={columnMenu.x}
          y={columnMenu.y}
          items={layout.columns
            .filter((c) => !c.fixed)
            .map((c) => ({
              label: c.label,
              checked: !layout.hidden.has(c.id),
              onSelect: () => toggleColumn(c.id),
            }))}
          onClose={() => setColumnMenu(null)}
        />
      )}
    </>
  );
}

function rateText(f: FringeDef | undefined): string {
  if (!f) return '';
  return f.kind === 'percent'
    ? `${toDecimal(f.rate).toString()}%`
    : `${formatRate(f.rate)}/${f.unit.replace(/s$/, '') || 'unit'}`;
}

interface PaneProps {
  budget: Budget;
  account: Account;
  lines: readonly DetailLine[];
  money(v: string): string;
  update(budget: Budget): void;
}

/**
 * The pane under the grid for the selected line(s): every fringe and group in the budget with a
 * box ticked for those applied (to all selected lines, or some), and the fringe range.
 */

/**
 * How the account's Fringes add up, read-only: each fringe's rate, what it applies to and any
 * cutoff, summed over every line posting here (on a fringe account like 1199, the category's).
 */
function FringeBreakdown({
  budget,
  account,
  money,
}: {
  budget: Budget;
  account: Account;
  money(v: string): string;
}) {
  const { rows, from } = useMemo(() => {
    const totals = calculateTotals(budget);
    const sources = fringeSourceAccounts(budget, totals, account.id);
    return {
      rows: fringeBreakdown(budget, totals, sources).filter((r) => !toDecimal(r.amount).isZero()),
      from: sources.filter((a) => a.id !== account.id && a.details.length > 0).map((a) => a.number),
    };
  }, [budget, account.id]);
  if (rows.length === 0) return null;
  return (
    <>
      <h3>Fringes{from.length > 0 ? ` from ${from.join(', ')}` : ''}</h3>
      <table className="grid browser-grid fringe-breakdown" aria-label="Fringe breakdown">
        <thead>
          <tr>
            <th>Fringe</th>
            <th className="num">Rate</th>
            <th className="num">Applies to</th>
            <th>Cutoff</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = breakdownWords(r, money);
            return (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{w.rate}</td>
                <td className="num">{w.appliesTo}</td>
                <td>{w.cutoff}</td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>Total Fringes</td>
            <td className="num">{money(breakdownTotal(rows))}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

function LinePane({ budget, account, lines, money, update }: PaneProps) {
  const tags = budgetTags(budget);
  const summary = summarizeLines(lines);
  const n = lines.length;
  const one = n === 1 ? lines[0]! : null;
  const ids = lines.map((d) => d.id);
  const setTag = (tag: LineTag, name: string, on: boolean) => update(setLineTag(budget, ids, tag, name, on));
  const colors = budget.settings.groupColors;
  const setColor = (name: string, color: string | null) => {
    const groupColors = { ...colors };
    if (color) groupColors[name] = color;
    else delete groupColors[name];
    update(updateSettings(budget, { ...budget.settings, groupColors }));
  };

  // Each selected line's fringes, worked out across its fringe range.
  const calculated = accountFringes(account, budget.settings);
  const perLine = lines.map((d) => calculated.get(d.id));
  const fringeAmount = (name: string) => {
    const amounts = perLine.filter((m) => m?.has(name)).map((m) => m!.get(name) ?? null);
    return amounts.some((a) => a === null) ? null : sum(amounts.map((a) => a!.toString()));
  };
  const all = perLine.flatMap((m) => (m ? [...m.values()] : []));
  const fringes = sum(all.filter((a) => a !== null).map((a) => a!.toString()));
  const incomplete = all.includes(null);
  const defs = new Map(budget.settings.fringeDefs.map((f) => [f.name, f]));
  const groupSubtotal = (name: string) =>
    sum(lines.filter((d) => d.groups.includes(name)).map((d) => budgetSubtotal(d, budget)));

  return (
    <aside className="line-details" aria-label="Line details">
      <div className="pane-head">
        <h3>{one ? one.description || '(no description)' : `${n} lines selected`}</h3>
        <Totals
          subtotal={sum(lines.map((d) => budgetSubtotal(d, budget)))}
          fringes={fringes}
          incomplete={incomplete}
          money={money}
        />
      </div>
      <div className="line-details-body">
        <section>
          <h4>Fringes</h4>
          <Checklist
            key={`f:${ids.join()}`}
            noun="fringe"
            names={[...tags.fringes.keys()]}
            counts={summary.fringes}
            n={n}
            detail={(name) => {
              const f = defs.get(name);
              return {
                text: rateText(f),
                ...(f?.cutoff ? { title: `Stops at ${money(f.cutoff)} per person (fringe range)` } : {}),
              };
            }}
            amount={(name) => {
              const a = fringeAmount(name);
              return a === null ? null : money(a.toFixed(2));
            }}
            unknownAmount="Set the unit's hours in Budget Settings to work this out"
            total={{
              label: 'Total fringes',
              amount: `${money(fringes.toFixed(2))}${incomplete ? ' *' : ''}`,
              ...(incomplete
                ? { title: "Some flat fringes aren't counted: their unit has no hours set" }
                : {}),
            }}
            onSet={(name, on) => setTag('fringes', name, on)}
          />
        </section>
        <section>
          <h4>Groups</h4>
          <Checklist
            key={`g:${ids.join()}`}
            noun="group"
            names={tags.groups}
            counts={summary.groups}
            n={n}
            amount={(name) => money(groupSubtotal(name).toFixed(2))}
            color={(name) => colors[name]}
            onColor={setColor}
            onSet={(name, on) => setTag('groups', name, on)}
            allowNew
          />
        </section>
        <FringeRangeSection budget={budget} account={account} lines={lines} money={money} update={update} />
      </div>
    </aside>
  );
}

function Totals(props: {
  subtotal: Decimal;
  fringes: Decimal;
  incomplete: boolean;
  money(v: string): string;
}) {
  const { subtotal, fringes, money } = props;
  const pct = subtotal.isZero() ? null : fringes.dividedBy(subtotal).times(100);
  const note = props.incomplete ? "Some flat fringes aren't counted: their unit has no hours set" : undefined;
  return (
    <dl className="pane-totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{money(subtotal.toFixed(2))}</dd>
      </div>
      <div>
        <dt>Fringe %</dt>
        <dd>{pct ? `${pct.toFixed(2)}%` : '—'}</dd>
      </div>
      <div title={note}>
        <dt>Fringes</dt>
        <dd>
          {money(fringes.toFixed(2))}
          {props.incomplete && ' *'}
        </dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>{money(subtotal.plus(fringes).toFixed(2))}</dd>
      </div>
    </dl>
  );
}

/**
 * Making and removing fringe ranges: two or more lines whose fringe cutoffs are shared, e.g.
 * one person's shoot and wrap weeks. Also drawn by dragging down the Range column.
 */
function FringeRangeSection({ budget, account, lines, update }: PaneProps) {
  const ids = lines.map((d) => d.id);
  const ranges = new Set(lines.map((d) => rangeOf(account, d.id)).filter(Boolean));
  const exact =
    ranges.size === 1 &&
    [...ranges][0]!.lineIds.length === ids.length &&
    !lines.some((d) => !rangeOf(account, d.id));
  const canMake = ids.length > 1 && !exact;
  if (!canMake && ranges.size === 0) return null;
  return (
    <section>
      <h4>Fringe range</h4>
      <div className="tag-add">
        {canMake && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => update(createFringeRange(budget, account.id, ids).budget)}
          >
            Make fringe range
          </button>
        )}
        {ranges.size > 0 && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => update(removeFringeRanges(budget, account.id, ids))}
          >
            Remove fringe range{ranges.size > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </section>
  );
}

interface ChecklistProps {
  noun: string;
  /** Every name known in the budget. */
  names: readonly string[];
  /** How many of the selected lines carry each name. */
  counts: ReadonlyMap<string, number>;
  n: number;
  /** A second column, e.g. a fringe's rate. */
  detail?(name: string): { text: string; title?: string };
  /** The amount for the selected lines; null when it can't be worked out. */
  amount(name: string): string | null;
  unknownAmount?: string;
  onSet(name: string, on: boolean): void;
  /** Colour swatch per row (groups). */
  color?(name: string): string | undefined;
  onColor?(name: string, color: string | null): void;
  /** Offer a box for a name the budget doesn't use yet. */
  allowNew?: boolean;
  /** A total row under the list. */
  total?: { label: string; amount: string; title?: string };
}

/**
 * Everything the budget has, ticked where applied. Applied ones are listed first, in the order
 * they were when this selection was made, so rows don't jump while ticking.
 */
function Checklist(props: ChecklistProps) {
  const { noun, names, counts, n, onSet } = props;
  const [order] = useState(() => [
    ...names.filter((t) => counts.has(t)),
    ...names.filter((t) => !counts.has(t)),
  ]);
  const [draft, setDraft] = useState('');
  const rows = [...order.filter((t) => names.includes(t)), ...names.filter((t) => !order.includes(t))];
  const lineWord = n === 1 ? 'this line' : `all ${n} lines`;

  return (
    <div className="checklist">
      {rows.length === 0 ? (
        <p className="muted small">No {noun}s in this budget yet</p>
      ) : (
        <div className="checklist-scroll">
          <table className="pane-table checklist-table">
            <tbody>
              {rows.map((t) => {
                const c = counts.get(t) ?? 0;
                const partial = c > 0 && c < n;
                const detail = props.detail?.(t);
                const amount = c > 0 ? props.amount(t) : null;
                const colour = props.color?.(t);
                return (
                  <tr key={t} className={c > 0 ? 'checked' : undefined}>
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        checked={c === n}
                        ref={(el) => {
                          if (el) el.indeterminate = partial;
                        }}
                        aria-label={`${t} on ${lineWord}`}
                        title={partial ? `On ${c} of ${n} lines. Tick to apply to all.` : undefined}
                        onChange={() => onSet(t, c < n)}
                      />
                    </td>
                    {props.onColor && (
                      <td className="check-cell">
                        <ColorPick
                          small
                          label={`Colour for ${t} rows`}
                          value={colour ?? null}
                          onChange={(color) => props.onColor!(t, color)}
                        />
                      </td>
                    )}
                    <td>
                      {t}
                      {partial && <span className="tag-count">{` ${c}/${n}`}</span>}
                    </td>
                    {props.detail && (
                      <td className="num muted" title={detail?.title}>
                        {detail?.text}
                      </td>
                    )}
                    <td className="num" title={c > 0 && amount === null ? props.unknownAmount : undefined}>
                      {c === 0 ? '' : (amount ?? '—')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {props.total && (
              <tfoot>
                <tr>
                  <td colSpan={2 + (props.onColor ? 1 : 0) + (props.detail ? 1 : 0)}>{props.total.label}</td>
                  <td className="num" title={props.total.title}>
                    {props.total.amount}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {props.allowNew && (
        <form
          className="tag-add"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (name) onSet(name, true);
            setDraft('');
          }}
        >
          <input
            className="tag-new"
            value={draft}
            placeholder={`New ${noun}`}
            aria-label={`New ${noun} name`}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      )}
    </div>
  );
}

/** Where the account's line fringes went, when it's not into its own total. */
function postingNote(
  budget: Budget,
  account: Account,
  lineFringes: Decimal,
  posted: Decimal,
  money: (v: string) => string,
): string {
  if (posted.equals(lineFringes)) return lineFringes.isZero() ? '' : 'Includes the fringes';
  if (posted.greaterThan(lineFringes))
    return `Includes ${money(posted.toFixed())} of fringes from the category`;
  const { posting, categoryAccountSuffix } = budget.settings.fringes;
  if (posting === 'category') {
    const category = budget.categories.find((c) => c.accounts.includes(account));
    const to = category && categoryFringeAccount(category, categoryAccountSuffix);
    if (to) return `Fringes post to ${to.number}`;
  }
  if (posting === 'budget' || posting === 'production-level') return 'Fringes post to the topsheet';
  return 'Fringes post elsewhere';
}
