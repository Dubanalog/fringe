import {
  type Budget,
  type Totals,
  ZERO_TOTALS,
  addTotals,
  applyTextEdit,
  calculateTotals,
  deleteRow,
  formatMoney,
  insertAccount,
  insertCategory,
  incentiveLabel,
  levelOf,
  percentageLabel,
  topsheet,
} from '@fringe/budget-engine';
import { type Dispatch, useState } from 'react';
import { AccountLines } from './AccountLines';
import { isBoolean, usePref } from './prefs';
import { type Cell, type FooterRow, Grid, type GridColumn, type GridRow } from './Grid';
import type { BudgetTab, TabsAction } from './tabs';
import { keys } from '../keys';

const TOTALS_COLUMNS: readonly GridColumn[] = [
  { label: 'Acct', num: true, editable: true },
  { label: 'Description', editable: true },
  { label: 'Fringes', num: true },
  { label: 'Total', num: true },
];

interface Props {
  tab: BudgetTab;
  dispatch: Dispatch<TabsAction>;
}

export function BudgetWorkspace({ tab, dispatch }: Props) {
  const { budget, nav } = tab;
  const category = budget.categories.find((c) => c.id === nav.categoryId) ?? null;
  const account = (category && category.accounts.find((a) => a.id === nav.accountId)) ?? null;
  const level = account?.id ?? category?.id ?? 'top';
  const totals = calculateTotals(budget);

  /** Double-click on Acct / Description: edit it (default) or open the row. */
  const [doubleClickOpens, setDoubleClickOpens] = usePref('doubleClickOpens', false, isBoolean);
  const precision = budget.settings.displayPrecision;
  const money = (v: string | null) => (v === null ? '' : formatMoney(v, precision));
  const totalsCells = (t: Totals) => [money(t.fringe), money(t.total)];

  const update = (next: Budget, label?: string) =>
    dispatch({ type: 'update', id: tab.id, budget: next, ...(label ? { label } : {}) });
  const select = (lvl: string) => (cell: Cell) =>
    dispatch({ type: 'select', id: tab.id, level: lvl, row: cell.row, col: cell.col });
  const go = (categoryId: string | null, accountId: string | null) =>
    dispatch({ type: 'navigate', id: tab.id, nav: { categoryId, accountId } });

  /**
   * Like a web browser: Back (Alt+←, the mouse's back button) goes up a level, keeping the row you
   * came from selected; Forward (Alt+→) goes back into it. Opening somewhere new clears Forward.
   */
  const [forward, setForward] = useState<{ tab: string; from: string; to: BudgetTab['nav'] } | null>(null);
  const canForward = forward !== null && forward.tab === tab.id && forward.from === level;
  const open = (categoryId: string | null, accountId: string | null) => {
    setForward(null);
    go(categoryId, accountId);
  };
  const back = () => {
    const col = tab.selections[level]?.col ?? 0;
    if (account && category) {
      select(category.id)({ row: account.id, col: Math.min(col, 1) });
      setForward({ tab: tab.id, from: category.id, to: nav });
      go(category.id, null);
    } else if (category) {
      select('top')({ row: category.id, col: Math.min(col, 1) });
      setForward({ tab: tab.id, from: 'top', to: nav });
      go(null, null);
    }
  };
  const goForward = () => {
    if (!canForward) return;
    setForward(null);
    go(forward.to.categoryId, forward.to.accountId);
  };
  /**
   * The category or account before and after this one, like the next sheet in a spreadsheet
   * (Ctrl+PageUp / Ctrl+PageDown). Accounts carry on into the next category.
   */
  const siblings: { id: string; categoryId: string; accountId: string | null; label: string }[] = account
    ? budget.categories.flatMap((c) =>
        c.accounts.map((a) => ({
          id: a.id,
          categoryId: c.id,
          accountId: a.id,
          label: `${a.number} ${a.description}`,
        })),
      )
    : category
      ? budget.categories.map((c) => ({
          id: c.id,
          categoryId: c.id,
          accountId: null,
          label: `${c.number} ${c.description}`,
        }))
      : [];
  const here = siblings.findIndex((s) => s.id === (account?.id ?? category?.id));
  const previous = here > 0 ? siblings[here - 1] : undefined;
  const next = here >= 0 ? siblings[here + 1] : undefined;
  const noun = account ? 'account' : 'category';
  const step = (to: (typeof siblings)[number] | undefined) => {
    if (to) open(to.categoryId, to.accountId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      if (e.key === 'PageUp') step(previous);
      else if (e.key === 'PageDown') step(next);
      else return;
      e.preventDefault();
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft') back();
    else if (e.key === 'ArrowRight') goForward();
    else return;
    e.preventDefault();
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button === 3) back();
    else if (e.button === 4) goForward();
  };

  const lineCount = budget.categories.reduce(
    (n, c) => n + c.accounts.reduce((m, a) => m + a.details.length, 0),
    0,
  );

  let grid;
  if (account) {
    grid = null;
  } else if (category) {
    const accountTotals = category.accounts.map((a) => totals.accounts.get(a.id) ?? ZERO_TOTALS);
    const rows: GridRow[] = category.accounts.map((a, i) => {
      const t = accountTotals[i]!;
      // An account whose fringes post elsewhere (e.g. to the category's fringe account) shows them
      // greyed, with where they went; they're not in its total.
      const source = totals.fringeSources.get(a.id);
      if (!source || source.postedTo === a.id || source.fringe.isZero()) {
        return { id: a.id, cells: [a.number, a.description, ...totalsCells(t)], drillable: true };
      }
      const to = budget.categories.flatMap((c) => c.accounts).find((x) => x.id === source.postedTo);
      const where = to ? `${to.number} ${to.description}`.trim() : 'the topsheet';
      return {
        id: a.id,
        cells: [
          a.number,
          a.description,
          `${money(source.fringe.toFixed())} → ${to?.number ?? 'topsheet'}`,
          money(t.total),
        ],
        cellClass: [undefined, undefined, 'cell-elsewhere', undefined],
        cellTitle: [
          undefined,
          undefined,
          `This account's fringes, posted to ${where}. Not in this account's total.`,
          undefined,
        ],
        drillable: true,
      };
    });
    grid = (
      <Grid
        key={level}
        label={`Accounts in category ${category.number}`}
        rowNoun="Account"
        columns={TOTALS_COLUMNS}
        rows={rows}
        footer={[['', 'Total', ...totalsCells(addTotals(accountTotals))]]}
        emptyText="No accounts yet. Click here (or press Ins) to add one."
        selection={tab.selections[level]}
        onSelect={select(level)}
        onCommit={(row, col, value) =>
          update(
            applyTextEdit(budget, {
              kind: 'account',
              id: row,
              field: col === 0 ? 'number' : 'description',
              value,
            }),
          )
        }
        doubleClickOpens={doubleClickOpens}
        onDrillIn={(row) => open(category.id, row)}
        onInsert={(sibling, position) => {
          const r = insertAccount(budget, category.id, { siblingId: sibling, position });
          update(r.budget);
          return r.id;
        }}
        deletePrompt={(row) => {
          const a = category.accounts.find((x) => x.id === row);
          const lines = a?.details.length ?? 0;
          return `Delete account ${a?.number} ${a?.description}${lines ? ` and its ${lines} line${lines === 1 ? '' : 's'}` : ''}?`;
        }}
        onDelete={(row) => update(deleteRow(budget, 'account', row))}
      />
    );
  } else {
    const sheet = topsheet(budget, totals);
    const { posting } = budget.settings.fringes;
    // Fringes posted to a level's or the budget's fringe row: each category shows its own greyed,
    // with where they went, as accounts do; they're not in its total.
    const postedRow = (c: Budget['categories'][number]): string | null => {
      if (posting !== 'production-level' && posting !== 'budget') return null;
      const level = posting === 'production-level' ? levelOf(c.number, budget.settings.coa.levels) : null;
      return level ? `${level.name} Fringes` : 'Total Fringes';
    };
    const rows: GridRow[] = sheet.rows.map((r) => {
      if (r.kind !== 'category') return otherRow(r);
      const own = totals.categoryFringes.get(r.category.id);
      const where = postedRow(r.category);
      if (!where || !own || own.isZero()) {
        return {
          id: r.category.id,
          cells: [r.category.number, r.category.description, ...totalsCells(r.totals)],
          drillable: true,
        };
      }
      return {
        id: r.category.id,
        cells: [
          r.category.number,
          r.category.description,
          `${money(own.toFixed())} → ${where}`,
          money(r.totals.total),
        ],
        cellClass: [undefined, undefined, 'cell-elsewhere', undefined],
        cellTitle: [
          undefined,
          undefined,
          `This category's fringes, posted to ${where}. Not in this category's total.`,
          undefined,
        ],
        drillable: true,
      };
    });
    function otherRow(r: Exclude<(typeof sheet.rows)[number], { kind: 'category' }>): GridRow {
      return r.kind === 'fringes'
        ? {
            id: `fringes:${r.level?.id ?? 'budget'}`,
            cells: [
              r.number,
              r.level ? `${r.level.name} Fringes` : 'Total Fringes',
              ...totalsCells(r.totals),
            ],
            total: true,
          }
        : {
            id: `level:${r.level.id}`,
            cells: ['', `Total ${r.level.name}`, ...totalsCells(r.totals)],
            total: true,
          };
    }
    if (sheet.percentages.length > 0) {
      rows.push(
        {
          id: 'percentages:subtotal',
          cells: ['', 'Total before percentages', '', money(sheet.categoriesTotal.total)],
          total: true,
        },
        ...sheet.percentages.map((p) => ({
          id: `percentage:${p.percentage.id}`,
          cells: [p.percentage.account ?? '', percentageLabel(p.percentage), '', money(p.amount)],
          total: true,
          cellClass: [undefined, undefined, undefined, p.amount.startsWith('-') ? 'neg' : undefined],
        })),
      );
    }
    const incentiveCells = sheet.incentives.map((p) => [
      p.incentive.account ?? '',
      incentiveLabel(p.incentive),
      '',
      money(p.amount),
    ]);
    // From the percentages down it's totals only; the fringes are on the subtotals above.
    const grandRow =
      sheet.percentages.length > 0
        ? ['', 'Grand Total', '', money(sheet.grandTotal.total)]
        : ['', 'Grand Total', ...totalsCells(sheet.grandTotal)];
    let footer: (string[] | FooterRow)[] = [grandRow];
    if (budget.settings.incentivePlacement === 'grand-total') {
      // Taken off before the grand total: they sit with the percentages.
      rows.push(
        ...sheet.incentives.map((p, i) => ({
          id: `incentive:${p.incentive.id}`,
          cells: incentiveCells[i]!,
          total: true,
          cellClass: [undefined, undefined, undefined, p.amount.startsWith('-') ? 'neg' : undefined],
        })),
      );
    } else if (incentiveCells.length > 0) {
      footer = [
        grandRow,
        ...incentiveCells.map((cells) => ({ cells, line: true })),
        ['', 'Net Cost', '', money(sheet.net)],
      ];
    }
    grid = (
      <Grid
        key={level}
        label="Topsheet"
        rowNoun="Category"
        columns={TOTALS_COLUMNS}
        rows={rows}
        footer={footer}
        emptyText="No categories yet. Click here (or press Ins) to add one."
        selection={tab.selections[level]}
        onSelect={select(level)}
        onCommit={(row, col, value) =>
          update(
            applyTextEdit(budget, {
              kind: 'category',
              id: row,
              field: col === 0 ? 'number' : 'description',
              value,
            }),
          )
        }
        doubleClickOpens={doubleClickOpens}
        onDrillIn={(row) => open(row, null)}
        onInsert={(sibling, position) => {
          const r = insertCategory(budget, { siblingId: sibling, position });
          update(r.budget);
          return r.id;
        }}
        deletePrompt={(row) => {
          const c = budget.categories.find((x) => x.id === row);
          const n = c?.accounts.length ?? 0;
          return `Delete category ${c?.number} ${c?.description}${n ? ` and its ${n} account${n === 1 ? '' : 's'}` : ''}?`;
        }}
        onDelete={(row) => update(deleteRow(budget, 'category', row))}
      />
    );
  }

  return (
    <section className="view workspace-view" onKeyDown={onKeyDown} onMouseUp={onMouseUp}>
      <header className="browser-head">
        <div className="nav-buttons">
          <button
            type="button"
            className="nav-button"
            disabled={!category}
            onClick={back}
            title={`Back (${keys('Alt+←')})`}
          >
            ‹ Back
          </button>
          <button
            type="button"
            className="nav-button"
            disabled={!canForward}
            onClick={goForward}
            title={`Forward (${keys('Alt+→')})`}
          >
            Forward ›
          </button>
        </div>
        <nav className="crumbs" aria-label="Location in budget">
          <button type="button" className="crumb" onClick={() => open(null, null)}>
            Topsheet
          </button>
          {category && (
            <>
              <span aria-hidden="true">›</span>
              <button type="button" className="crumb" onClick={() => open(category.id, null)}>
                {category.number} {category.description}
              </button>
            </>
          )}
          {account && (
            <>
              <span aria-hidden="true">›</span>
              <span className="crumb-current">
                {account.number} {account.description}
              </span>
            </>
          )}
        </nav>
        {category && (
          <div className="nav-buttons sibling-nav">
            <button
              type="button"
              className="nav-button"
              disabled={!previous}
              onClick={() => step(previous)}
              title={`Previous ${noun} (${keys('Ctrl+PageUp')})`}
            >
              ‹ {previous?.label ?? `Previous ${noun}`}
            </button>
            <button
              type="button"
              className="nav-button"
              disabled={!next}
              onClick={() => step(next)}
              title={`Next ${noun} (${keys('Ctrl+PageDown')})`}
            >
              {next?.label ?? `Next ${noun}`} ›
            </button>
          </div>
        )}
        <span className="muted">{lineCount.toLocaleString()} lines</span>
      </header>

      {account ? (
        <AccountLines
          key={account.id}
          budget={budget}
          account={account}
          totals={totals.accounts.get(account.id) ?? ZERO_TOTALS}
          money={money}
          selection={tab.selections[level]}
          onSelect={select(level)}
          update={update}
        />
      ) : (
        <>
          <div className="grid-toolbar">
            <span className="muted">Double-click Acct / Description to</span>
            <div className="segmented" role="radiogroup" aria-label="Double-click action">
              <button
                type="button"
                role="radio"
                aria-checked={!doubleClickOpens}
                onClick={() => setDoubleClickOpens(false)}
              >
                Edit
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={doubleClickOpens}
                onClick={() => setDoubleClickOpens(true)}
              >
                Open
              </button>
            </div>
            <span className="muted">· click › to open a row</span>
            {totals.unpostedCategories.length > 0 && (
              <span className="warning">
                Fringes in {totals.unpostedCategories.join(', ')} stay on each account: no account ends in{' '}
                {budget.settings.fringes.categoryAccountSuffix} there (Budget Settings › Fringes).
              </span>
            )}
          </div>
          <div className="workspace-body">{grid}</div>
        </>
      )}

      <footer className="key-hints muted">
        <span>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> open
        </span>
        <span>
          <kbd>Alt</kbd>+<kbd>←</kbd> back
        </span>
        {category && (
          <span>
            <kbd>Ctrl</kbd>+<kbd>PgUp</kbd>/<kbd>PgDn</kbd> previous/next {account ? 'account' : 'category'}
          </span>
        )}
        <span>
          <kbd>F2</kbd> or type to edit
        </span>
        <span>
          <kbd>Ins</kbd> add row
        </span>
        {account && (
          <span>
            <kbd>Shift</kbd>/<kbd>Ctrl</kbd>+click select several
          </span>
        )}
        <span>
          <kbd>Ctrl</kbd>+<kbd>Del</kbd> delete
        </span>
        <span>Right-click for more</span>
        <span className="status-spacer" />
        <span>Changes save as you go.</span>
      </footer>
    </section>
  );
}
