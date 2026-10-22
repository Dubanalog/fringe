import { EditError, parseClipboardTable, toClipboardTable } from '@fringe/budget-engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { keys } from '../keys';

/**
 * Spreadsheet-style grid used at every budget level (topsheet, category, account).
 *
 * Keyboard: arrows move, Ctrl+Enter opens the selected row (going back is the workspace's),
 * F2 / Enter / typing edits, Esc cancels, Ins adds a row below (Shift+Ins above),
 * Ctrl+Del deletes. Right-click for the same actions. Rows that open show a
 * handle on the left. With `onMark`, Shift/Ctrl+click and Shift+arrows select
 * several rows. Ctrl+C copies the selected cell, or the selected rows, as a spreadsheet
 * would; with `onPaste`, Ctrl+V pastes cells copied from one.
 */

export interface GridColumn {
  label: string;
  num?: boolean;
  editable?: boolean;
  /** Tooltip on the header, e.g. why a column is read-only. */
  title?: string;
  /** Offered in a drop-down while editing, e.g. the budget's units. */
  suggestions?: readonly Suggestion[];
  /** Suggestions complete the word being typed (e.g. a global inside "SW*5") instead of the whole cell. */
  suggestWord?: boolean;
  /** Dragging down this column across two or more rows hands over those rows, in order. */
  onDrawRows?(rowIds: string[]): void;
}

export interface Suggestion {
  value: string;
  /** Shown beside the value, e.g. "45 hrs". */
  hint?: string;
}

/** Suggestions starting with the text first, then those containing it. Null text lists them all. */
export function matchSuggestions(all: readonly Suggestion[], text: string | null, limit = 10): Suggestion[] {
  if (text === null || text.trim() === '') return all.slice(0, limit);
  const q = text.trim().toLowerCase();
  const starts = all.filter((s) => s.value.toLowerCase().startsWith(q));
  const contains = all.filter(
    (s) => !s.value.toLowerCase().startsWith(q) && s.value.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, limit);
}

/** A footer row; `line` shows it as an ordinary line between totals, e.g. an incentive. */
export interface FooterRow {
  cells: readonly string[];
  line?: boolean;
}

export interface GridRow {
  id: string;
  /** Display text per column. */
  cells: readonly string[];
  /** Raw value per column for editing; defaults to the display text. */
  values?: readonly (string | undefined)[];
  /** Total rows (e.g. "Total Above-The-Line") can't be selected or edited. */
  total?: boolean;
  /** Ctrl+Enter opens it. */
  drillable?: boolean;
  /** Extra class per cell, e.g. 'neg'. */
  cellClass?: readonly (string | undefined)[];
  /** Tooltip per cell. */
  cellTitle?: readonly (string | undefined)[];
  /** Row tint as a CSS colour, e.g. from the line's first group. */
  color?: string;
}

export interface Cell {
  row: string;
  col: number;
}

interface Props {
  label: string;
  /** Singular noun for menus: "Category", "Account", "Line". */
  rowNoun: string;
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  /** Footer rows, e.g. totals: bold, unless a row is marked as a plain line. */
  footer?: readonly (readonly string[] | FooterRow)[];
  emptyText: string;
  selection: Cell | undefined;
  onSelect(cell: Cell): void;
  /** Throws EditError to reject the value. */
  onCommit(row: string, col: number, value: string): void;
  onDrillIn?(row: string): void;
  /** Returns the new row's id; the grid then edits its first column. */
  onInsert(sibling: string | undefined, position: 'before' | 'after'): string | undefined;
  /** Text for the delete confirmation, e.g. 'Delete account 1102 WRITERS and its 4 lines?' */
  deletePrompt(row: string): string;
  onDelete(row: string): void;
  /** Drag a header to reorder columns: move column `from` so it lands before column `to` (columns.length = last). */
  onMoveColumn?(from: number, to: number): void;
  /** Double-clicking an editable cell of an openable row opens it instead of editing. */
  doubleClickOpens?: boolean;
  /** Extra rows selected along with the current one (multi-select). Empty = just the current row. */
  marked?: readonly string[];
  onMark?(rows: string[]): void;
  /**
   * Pastes cells copied from a spreadsheet (or this grid), from row `row` (undefined: after the
   * last) and column `col` on. Returns a note to show, e.g. cells that wouldn't go in.
   */
  onPaste?(row: string | undefined, col: number, cells: string[][]): string | null;
}

interface Editing extends Cell {
  /** null until the user changes it: the cell's current value (a just-inserted row isn't rendered yet). */
  value: string | null;
  /** Started by typing a character (caret after it) rather than F2 (all selected). */
  typed: boolean;
  /** Highlighted suggestion; -1 for none. */
  pick?: number;
}

const PAGE = 20;

export function Grid(props: Props) {
  const { columns, rows, selection, onSelect } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLTableCellElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A drag down a drawable column (e.g. drawing a fringe range), by row index. */
  const [draw, setDraw] = useState<{ col: number; from: number; to: number } | null>(null);
  const inDraw = (i: number) =>
    draw !== null && i >= Math.min(draw.from, draw.to) && i <= Math.max(draw.from, draw.to);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  /** Set once an edit is committed or cancelled, so the input's blur doesn't commit it twice. */
  const editDone = useRef(false);
  /** Column header being dragged: where the pointer went down, and the drop slot once it has moved. */
  const dragStart = useRef<{ x: number; from: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  /** Where a Shift+click / Shift+arrow range starts. */
  const anchor = useRef<string | null>(null);

  const selectable = rows.filter((r) => !r.total);
  const hasHandle = props.onDrillIn !== undefined;
  const current =
    selection && selectable.some((r) => r.id === selection.row)
      ? selection
      : selectable[0]
        ? { row: selectable[0].id, col: selection?.col ?? 0 }
        : undefined;

  const focusGrid = () => containerRef.current?.focus({ preventScroll: true });

  useEffect(() => {
    focusGrid();
  }, []);

  useLayoutEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current?.row, current?.col]);

  const valueOf = (row: GridRow, col: number) => row.values?.[col] ?? row.cells[col] ?? '';

  const startEdit = (cell: Cell, initial?: string) => {
    const row = rows.find((r) => r.id === cell.row);
    if (!row || row.total || !columns[cell.col]?.editable) return false;
    editDone.current = false;
    setError(null);
    setEditing({ ...cell, value: initial ?? null, typed: initial !== undefined });
    return true;
  };

  /** Returns true if the edit was accepted (or unchanged). */
  /** `value` overrides what's typed, e.g. a picked suggestion. */
  const commit = (value?: string): boolean => {
    if (!editing || editDone.current) return true;
    const row = rows.find((r) => r.id === editing.row);
    const next = value ?? editing.value;
    try {
      if (row && next !== null && next !== valueOf(row, editing.col)) {
        props.onCommit(editing.row, editing.col, next);
      }
    } catch (e) {
      if (e instanceof EditError) {
        setError(e.message);
        return false;
      }
      throw e;
    }
    editDone.current = true;
    setEditing(null);
    setError(null);
    focusGrid();
    return true;
  };

  const cancel = (keepError = false) => {
    editDone.current = true;
    setEditing(null);
    if (!keepError) setError(null);
    focusGrid();
  };

  const marked = props.marked ?? [];
  const range = (from: string, to: string) => {
    const a = selectable.findIndex((r) => r.id === from);
    const b = selectable.findIndex((r) => r.id === to);
    if (a < 0 || b < 0) return [to];
    return selectable.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id);
  };

  /** Selects a cell; 'extend' grows a range from the anchor, 'toggle' adds or removes one row. */
  const selectCell = (cell: Cell, how: 'single' | 'extend' | 'toggle' = 'single') => {
    if (props.onMark) {
      if (how === 'extend') {
        anchor.current ??= current?.row ?? cell.row;
        props.onMark(range(anchor.current, cell.row));
      } else if (how === 'toggle') {
        const base = marked.length > 0 ? marked : current ? [current.row] : [];
        props.onMark(base.includes(cell.row) ? base.filter((r) => r !== cell.row) : [...base, cell.row]);
        anchor.current = cell.row;
      } else {
        anchor.current = cell.row;
        if (marked.length > 0) props.onMark([]);
      }
    }
    onSelect(cell);
  };

  const move = (rowDelta: number, colDelta: number, extend = false) => {
    if (!current) return;
    const i = selectable.findIndex((r) => r.id === current.row);
    const next = selectable[Math.max(0, Math.min(selectable.length - 1, i + rowDelta))];
    const col = Math.max(0, Math.min(columns.length - 1, current.col + colDelta));
    if (next) selectCell({ row: next.id, col }, extend ? 'extend' : 'single');
  };

  const insert = (position: 'before' | 'after', sibling = current?.row) => {
    setError(null);
    const id = props.onInsert(sibling, position);
    if (!id) return;
    // The new row renders on the next pass; edit its first column (usually the suggested number).
    onSelect({ row: id, col: 0 });
    editDone.current = false;
    setEditing({ row: id, col: 0, value: null, typed: false });
  };

  const remove = (rowId: string | undefined = current?.row) => {
    if (!rowId || !window.confirm(props.deletePrompt(rowId))) {
      focusGrid();
      return;
    }
    // Keep the selection nearby: the next row, or the previous one at the end.
    const i = selectable.findIndex((r) => r.id === rowId);
    const neighbour = selectable[i + 1] ?? selectable[i - 1];
    props.onDelete(rowId);
    if (neighbour) onSelect({ row: neighbour.id, col: current?.col ?? 0 });
    focusGrid();
  };

  /** Copies the selected rows, or just the selected cell, as text a spreadsheet can paste. */
  const copy = (rowId = current?.row) => {
    const picked = marked.length > 0 ? selectable.filter((r) => marked.includes(r.id)) : [];
    const row = rows.find((r) => r.id === rowId);
    const cells =
      picked.length > 0 ? picked.map((r) => r.cells) : row && current ? [[row.cells[current.col] ?? '']] : [];
    if (cells.length > 0) void window.fringe.copyText(toClipboardTable(cells));
  };

  const paste = async (rowId = current?.row) => {
    if (!props.onPaste) return;
    const cells = parseClipboardTable(await window.fringe.readText());
    if (cells.length === 0) return;
    // Whole rows copied from this grid go back where they came from; anything else starts at the
    // selected cell, like a spreadsheet.
    const col = cells.every((r) => r.length === columns.length) ? 0 : (current?.col ?? 0);
    try {
      setError(props.onPaste(rowId, col, cells));
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setError(e.message);
    }
    focusGrid();
  };

  const drillIn = (rowId = current?.row) => {
    const row = rows.find((r) => r.id === rowId);
    if (row?.drillable && props.onDrillIn) props.onDrillIn(row.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || menu) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (ctrl && key === 'Enter') drillIn();
    else if (ctrl && key === 'Home') move(-Infinity, 0);
    else if (ctrl && key === 'End') move(Infinity, 0);
    else if (ctrl && key === 'Delete') remove();
    else if (ctrl && key.toLowerCase() === 'c' && !e.shiftKey) copy();
    else if (ctrl && key.toLowerCase() === 'v' && !e.shiftKey && props.onPaste) void paste();
    else if (ctrl && key.toLowerCase() === 'a' && props.onMark) props.onMark(selectable.map((r) => r.id));
    else if (key === 'ArrowDown') move(1, 0, e.shiftKey);
    else if (key === 'ArrowUp') move(-1, 0, e.shiftKey);
    else if (ctrl || e.altKey) return;
    else if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) move(0, 1);
    else if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) move(0, -1);
    else if (key === 'Home') move(0, -Infinity);
    else if (key === 'End') move(0, Infinity);
    else if (key === 'PageDown') move(PAGE, 0);
    else if (key === 'PageUp') move(-PAGE, 0);
    else if (key === 'Insert') insert(e.shiftKey ? 'before' : 'after');
    else if (key === 'F2' && current) startEdit(current);
    else if (key === 'Enter' && current) {
      if (!startEdit(current)) drillIn();
    } else if (key === 'ContextMenu' && current) {
      const rect = selectedRef.current?.getBoundingClientRect();
      setMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0, items: menuItems(current.row) });
    } else if (key.length === 1 && current) {
      // Typing replaces the cell's contents, like a spreadsheet.
      if (!startEdit(current, key)) return;
    } else return;
    e.preventDefault();
  };

  const editColumn = editing ? columns[editing.col] : undefined;
  // For word completion: the text before the word being typed, and the word itself.
  const wordAt = editColumn?.suggestWord
    ? /^(.*?)([A-Za-z_][A-Za-z0-9_]*)$/s.exec(editing?.value ?? '')
    : null;
  const editSuggestions =
    !editing || !editColumn?.suggestions
      ? []
      : !editColumn.suggestWord
        ? matchSuggestions(editColumn.suggestions, editing.value)
        : wordAt
          ? matchSuggestions(editColumn.suggestions, wordAt[2]!).sort(
              (a, b) =>
                Number(b.value.toLowerCase() === wordAt[2]!.toLowerCase()) -
                Number(a.value.toLowerCase() === wordAt[2]!.toLowerCase()),
            )
          : [];
  const complete = (value: string) => (wordAt ? wordAt[1] + value : value);
  const pick = Math.min(editing?.pick ?? -1, editSuggestions.length - 1);
  const picked = pick >= 0 && editSuggestions[pick] ? complete(editSuggestions[pick].value) : undefined;

  const onEditKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') cancel();
    else if (e.key === 'Enter') commit(picked);
    else if (e.key === 'Tab') {
      if (commit(picked)) move(0, e.shiftKey ? -1 : 1);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editing && editSuggestions.length > 0) {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setEditing({ ...editing, pick: Math.max(-1, Math.min(editSuggestions.length - 1, pick + step)) });
    } else return;
    e.preventDefault();
  };

  const menuItems = (rowId: string | undefined): MenuEntry[] => {
    const row = rows.find((r) => r.id === rowId);
    const noun = props.rowNoun;
    const items: MenuEntry[] = [];
    if (row?.drillable && props.onDrillIn) {
      items.push(
        { label: `Open ${noun}`, shortcut: keys('Ctrl+Enter'), onSelect: () => drillIn(row.id) },
        'separator',
      );
    }
    if (row) {
      items.push({ label: 'Copy', shortcut: keys('Ctrl+C'), onSelect: () => copy(row.id) });
    }
    if (props.onPaste) {
      items.push({ label: 'Paste', shortcut: keys('Ctrl+V'), onSelect: () => void paste(row?.id) });
    }
    if (row || props.onPaste) items.push('separator');
    if (row) {
      items.push(
        { label: `Insert ${noun} Above`, shortcut: 'Shift+Ins', onSelect: () => insert('before', row.id) },
        { label: `Insert ${noun} Below`, shortcut: 'Ins', onSelect: () => insert('after', row.id) },
        'separator',
        {
          label: `Delete ${noun}…`,
          shortcut: keys('Ctrl+Del'),
          danger: true,
          onSelect: () => remove(row.id),
        },
      );
    } else {
      items.push({ label: `Add ${noun}`, shortcut: 'Ins', onSelect: () => insert('after', undefined) });
    }
    return items;
  };

  return (
    <div
      ref={containerRef}
      className="grid-container"
      tabIndex={0}
      role="grid"
      aria-label={props.label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items: menuItems(undefined) });
      }}
    >
      {error && (
        <div className="grid-error" role="alert">
          {error}
        </div>
      )}
      <table className="grid edit-grid">
        <thead>
          <tr>
            {hasHandle && <th className="drill-cell" aria-label="Open" />}
            {columns.map((c, i) => {
              const move = props.onMoveColumn;
              const classes = [
                c.num ? 'num' : '',
                move ? 'th-draggable' : '',
                drag?.from === i ? 'th-dragging' : '',
                drag?.to === i ? 'drop-before' : '',
                drag?.to === columns.length && i === columns.length - 1 ? 'drop-after' : '',
              ].filter(Boolean);
              return (
                <th
                  key={i}
                  className={classes.join(' ') || undefined}
                  title={move ? `${c.title ? `${c.title}. ` : ''}Drag to move the column` : c.title}
                  onPointerDown={(e) => {
                    if (!move || e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragStart.current = { x: e.clientX, from: i };
                  }}
                  onPointerMove={(e) => {
                    const start = dragStart.current;
                    if (!start || (!drag && Math.abs(e.clientX - start.x) < 5)) return;
                    const headers = [...(e.currentTarget.parentElement?.children ?? [])].slice(
                      hasHandle ? 1 : 0,
                    );
                    let to = headers.findIndex((h) => {
                      const r = h.getBoundingClientRect();
                      return e.clientX < r.left + r.width / 2;
                    });
                    if (to < 0) to = columns.length;
                    if (drag?.to !== to) setDrag({ from: start.from, to });
                  }}
                  onPointerUp={() => {
                    if (drag && drag.to !== null && drag.to !== drag.from && drag.to !== drag.from + 1) {
                      move?.(drag.from, drag.to);
                    }
                    dragStart.current = null;
                    setDrag(null);
                  }}
                  onPointerCancel={() => {
                    dragStart.current = null;
                    setDrag(null);
                  }}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (hasHandle ? 1 : 0)} className="grid-empty">
                <button type="button" className="link-button" onClick={() => insert('after', undefined)}>
                  {props.emptyText}
                </button>
              </td>
            </tr>
          )}
          {rows.map((row, rowIndex) => {
            const isCurrentRow = current?.row === row.id && !row.total;
            const isMarked = marked.includes(row.id);
            return (
              <tr
                key={row.id}
                data-row={row.id}
                className={
                  [
                    row.total
                      ? 'row-total'
                      : isCurrentRow
                        ? 'row-selected'
                        : isMarked
                          ? 'row-marked'
                          : row.color
                            ? 'row-colored'
                            : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                style={row.color ? ({ '--row-color': row.color } as React.CSSProperties) : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!row.total && !isMarked) selectCell({ row: row.id, col: current?.col ?? 0 });
                  setMenu({ x: e.clientX, y: e.clientY, items: menuItems(row.total ? undefined : row.id) });
                }}
              >
                {hasHandle && (
                  <td className="drill-cell">
                    {row.drillable && (
                      <button
                        type="button"
                        className="drill-button"
                        tabIndex={-1}
                        title={`Open ${props.rowNoun.toLowerCase()} (${keys('Ctrl+Enter')})`}
                        aria-label={`Open ${row.cells.slice(0, 2).join(' ')}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (editing && !commit()) return;
                          drillIn(row.id);
                        }}
                      >
                        ›
                      </button>
                    )}
                  </td>
                )}
                {row.cells.map((text, col) => {
                  const isCurrent = isCurrentRow && current?.col === col;
                  const isEditing = editing?.row === row.id && editing.col === col;
                  const onDraw = columns[col]?.onDrawRows;
                  const classes = [
                    columns[col]?.num ? 'num' : '',
                    row.cellClass?.[col] ?? '',
                    isCurrent ? 'cell-selected' : '',
                    isEditing ? 'cell-editing' : '',
                    onDraw && !row.total ? 'cell-drawable' : '',
                    draw?.col === col && inDraw(rowIndex) ? 'cell-drawing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td
                      key={col}
                      ref={isCurrent ? selectedRef : undefined}
                      className={classes || undefined}
                      title={row.cellTitle?.[col]}
                      {...(onDraw && !row.total
                        ? {
                            onPointerDown: (e: React.PointerEvent<HTMLTableCellElement>) => {
                              if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setDraw({ col, from: rowIndex, to: rowIndex });
                            },
                            onPointerMove: (e: React.PointerEvent<HTMLTableCellElement>) => {
                              if (!draw) return;
                              const tr = document
                                .elementFromPoint(e.clientX, e.clientY)
                                ?.closest('tr[data-row]');
                              const to = rows.findIndex((r) => r.id === tr?.getAttribute('data-row'));
                              if (to >= 0 && to !== draw.to) setDraw({ ...draw, to });
                            },
                            onPointerUp: () => {
                              if (!draw) return;
                              const ids = rows
                                .slice(Math.min(draw.from, draw.to), Math.max(draw.from, draw.to) + 1)
                                .filter((r) => !r.total)
                                .map((r) => r.id);
                              setDraw(null);
                              if (ids.length > 1) onDraw(ids);
                            },
                            onPointerCancel: () => setDraw(null),
                          }
                        : {})}
                      onMouseDown={(e) => {
                        if (row.total || isEditing || e.button === 2) return;
                        if (editing && !commit()) return;
                        selectCell(
                          { row: row.id, col },
                          e.shiftKey ? 'extend' : e.ctrlKey || e.metaKey ? 'toggle' : 'single',
                        );
                      }}
                      onDoubleClick={(e) => {
                        if (row.total || e.shiftKey || e.ctrlKey) return;
                        if (props.doubleClickOpens && row.drillable) drillIn(row.id);
                        else if (!startEdit({ row: row.id, col })) drillIn(row.id);
                      }}
                    >
                      {isEditing ? (
                        <>
                          {/* Keeps the column at its current width; the input sits over it. */}
                          <span className="cell-sizer" aria-hidden="true">
                            {text}
                          </span>
                          <input
                            className="cell-input"
                            autoFocus
                            value={editing.value ?? valueOf(row, col)}
                            spellCheck={false}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value, pick: 0 })}
                            onKeyDown={onEditKeyDown}
                            onFocus={(e) => {
                              // Typing to start an edit keeps the typed character; F2 selects all.
                              if (editing.typed) e.target.setSelectionRange(1, 1);
                              else e.target.select();
                            }}
                            onBlur={() => {
                              // Clicking away with an invalid value drops the edit but keeps the message.
                              if (!commit()) cancel(true);
                            }}
                          />
                          {editSuggestions.length > 0 && (
                            <ul className="cell-suggest" role="listbox">
                              {editSuggestions.map((s, i) => (
                                <li
                                  key={s.value}
                                  role="option"
                                  aria-selected={i === pick}
                                  // Keep focus in the input so blur doesn't commit the typed text first.
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    commit(complete(s.value));
                                  }}
                                >
                                  <span>{s.value}</span>
                                  {s.hint && <span className="muted">{s.hint}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {props.footer && (
          <tfoot>
            {props.footer.map((row, r) => {
              const { cells, line = false } = 'cells' in row ? row : { cells: row };
              return (
                <tr key={r} className={line ? 'footer-line' : undefined}>
                  {hasHandle && <td className="drill-cell" />}
                  {cells.map((text, i) => (
                    <td
                      key={i}
                      className={
                        [columns[i]?.num && 'num', columns[i]?.num && text.startsWith('-') && 'neg']
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      {text}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tfoot>
        )}
      </table>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => {
            setMenu(null);
            focusGrid();
          }}
        />
      )}
    </div>
  );
}
