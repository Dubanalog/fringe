import { setLineNumber } from './calc';
import { type DetailTextField, EditError, applyTextEdit, insertDetail } from './edit';
import type { Budget, NumericDetailField } from './model';

/**
 * Copy and paste between the grid and spreadsheets. Spreadsheets put copied cells on the clipboard
 * as text: a row per line, cells split by tabs, and a cell holding a tab, line break or quote
 * wrapped in quotes ("" for a quote inside).
 */

/** Cells as clipboard text, the way spreadsheets write it. */
export function toClipboardTable(rows: readonly (readonly string[])[]): string {
  const cell = (v: string) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join('\t')).join('\r\n');
}

/** Clipboard text as rows of cells; the line break a spreadsheet leaves at the end is dropped. */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' && cell === '') {
      // A quoted cell runs to the next lone quote.
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) {
          cell += text.slice(j);
          j = text.length;
          break;
        }
        cell += text.slice(j, q);
        if (text[q + 1] === '"') {
          cell += '"';
          j = q + 2;
        } else {
          j = q + 1;
          break;
        }
      }
      i = j;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * A number as spreadsheets show it, as a plain number: `$1,234.50` → 1234.50, `(500)` → -500.
 * Anything else (a global, a formula, text) comes back as it was.
 */
export function pastedNumber(text: string): string {
  const t = text.trim();
  const m = /^(\()?\s*(-)?\s*[$€£¥]?\s*(-)?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\s*(\))?$/.exec(t);
  if (!m || (!m[4] && !m[6]) || Boolean(m[1]) !== Boolean(m[7])) return t;
  const negative = Boolean(m[1]) || Boolean(m[2]) || Boolean(m[3]);
  return `${negative ? '-' : ''}${(m[4] ?? '0').replace(/,/g, '')}${m[6] ?? ''}`;
}

/** Where a pasted column goes on a line: a number field, a text field, or nowhere (e.g. Subtotal). */
export type PasteColumn =
  | { label: string; numeric: NumericDetailField }
  | { label: string; field: DetailTextField }
  | { label: string };

/**
 * Pastes cells onto an account's lines, starting at `fromLineId` (or a new line at the end when
 * none), each row of cells onto the next line and each cell into the next column. Rows past the
 * last line become new lines. Cells under columns that can't be typed into are skipped, and a cell
 * that won't go in (e.g. a word in Rate) is left as it was and listed in `refused`.
 */
export function pasteLines(
  budget: Budget,
  accountId: string,
  fromLineId: string | undefined,
  columns: readonly PasteColumn[],
  rows: readonly (readonly string[])[],
): { budget: Budget; lineIds: string[]; refused: string[] } {
  const account = budget.categories.flatMap((c) => c.accounts).find((a) => a.id === accountId);
  if (!account) throw new EditError('That account is gone.');
  let next = budget;
  const lineIds: string[] = [];
  const refused: string[] = [];
  let start = fromLineId === undefined ? -1 : account.details.findIndex((d) => d.id === fromLineId);
  if (start < 0) start = account.details.length;
  let last: string | undefined = account.details[start - 1]?.id;
  rows.forEach((cells, r) => {
    let id = account.details[start + r]?.id;
    if (id === undefined) {
      const added = insertDetail(next, accountId, { siblingId: last, position: 'after' });
      next = added.budget;
      id = added.id;
    }
    last = id;
    lineIds.push(id);
    cells.forEach((value, c) => {
      const col = columns[c];
      if (!col) return;
      try {
        if ('numeric' in col) next = setLineNumber(next, id, col.numeric, pastedNumber(value));
        else if ('field' in col)
          next = applyTextEdit(next, { kind: 'detail', id, field: col.field, value: value.trim() });
      } catch (e) {
        if (!(e instanceof EditError)) throw e;
        refused.push(`${col.label} "${value.trim()}" on line ${start + r + 1}`);
      }
    });
  });
  return { budget: next, lineIds, refused };
}
