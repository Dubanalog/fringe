import { useMemo, useRef, useState } from 'react';
import {
  type BudgetHistory,
  type BudgetVersion,
  BranchError,
  MAIN_BRANCH,
  branchLine,
  canBranchFrom,
  cleanBranchName,
  findEntry,
  formatMoney,
  grandTotal,
  previousVersion,
} from '@fringe/budget-engine';
import { type TreeLayout, type TreeNode, branchTree, dayMarks, withoutNotPicked } from './branch-tree';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { versionLabel } from './report-options';
import type { BudgetTab } from './tabs';

interface Props {
  tab: BudgetTab;
  /** Shows a point: a branch's end to work on, or an earlier point to look at. */
  open(node: { branchId: string; entryId: string; end: boolean }): void;
  /** Starts a branch from a saved version. The name is already checked. */
  startBranch(name: string, fromEntryId: string): void;
  /** Opens a branch's latest and the "Save version" form, then asks for a branch's name. */
  saveThenBranch(branchId: string): void;
  renameBranch(branchId: string, name: string): void;
  setNotPicked(branchId: string, notPicked: boolean): void;
  /** Opens the Comparison report: what's showing against this version. */
  showComparison(from: string): void;
  editVersion(versionId: string): void;
  deleteVersion(version: BudgetVersion): void;
  /** Opens a copy of the budget at this point as a budget of its own. */
  copyToNew(entryId: string, version?: string, branchId?: string): void;
}

/** Height of a branch's row, and the space between points on it. */
const ROW = 64;
const COL = 60;
const PAD = 28;
/** Height of the date row across the top. */
const AXIS = 22;
/** Lane colours; the main line is first. */
const LANES = 4;

export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString([], { dateStyle: 'medium' }) : ymd;
};

const x = (n: TreeNode) => PAD + n.col * COL;
const y = (n: TreeNode) => AXIS + ROW / 2 + n.row * ROW;

/**
 * The budget's branches as rows of points, left to right in the order they happened: each saved
 * version, and the Latest point where work goes on. Hover a point for its details; click it for
 * what you can do there. Click a branch's name to rename it or mark it not picked.
 */
export function BranchTreeView(props: Props) {
  const { tab } = props;
  const { history } = tab;
  const [showNotPicked, setShowNotPicked] = useState(false);
  const anyNotPicked = history.branches.some((b) => b.notPicked);
  const shown = showNotPicked ? history : withoutNotPicked(history);
  const tree = useMemo(() => branchTree(shown, tab.budget.name), [shown, tab.budget.name]);
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ node: TreeNode; left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    header: React.ReactNode;
    items: MenuEntry[];
  } | null>(null);
  /** Asking for a new branch's name: where it starts, and what that is called. */
  const [naming, setNaming] = useState<{ from: string; label: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const byKey = new Map(tree.nodes.map((n) => [n.key, n]));
  const lane = (row: number) => {
    const b = tree.rows[row]!.branch;
    return b.id === MAIN_BRANCH ? 0 : 1 + ((row - 1) % (LANES - 1));
  };

  const place = (el: Element) => {
    const box = wrap.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.right - box.left + 8, top: r.top - box.top - 6 };
  };

  const nodeMenu = (n: TreeNode, el: Element) => {
    setTip(null);
    const r = el.getBoundingClientRect();
    const v = n.version;
    const editable = n.end;
    const items: MenuEntry[] = [
      {
        label: n.showing ? 'Showing now' : editable ? 'Open and work here' : 'Open (read-only)',
        disabled: n.showing,
        onSelect: () => props.open({ branchId: n.branchId, entryId: n.entryId, end: n.end }),
      },
    ];
    if (canBranchFrom(history, n.entryId)) {
      items.push({
        label: 'Start a branch from here…',
        onSelect: () => setNaming({ from: n.entryId, label: pointLabel(tree, n) }),
      });
    } else if (n.kind === 'latest') {
      // A branch starts only from a version: save one here first.
      items.push({
        label: 'Save a version, then start a branch…',
        onSelect: () => props.saveThenBranch(n.branchId),
      });
    }
    if (v) {
      const before = previousVersion(history, v);
      items.push('separator');
      if (before) {
        // Opens this version, then compares it with the one before.
        items.push({
          label: n.showing ? `Compare with v${before.number}` : `Open and compare with v${before.number}`,
          onSelect: () => {
            if (!n.showing) props.open({ branchId: n.branchId, entryId: n.entryId, end: n.end });
            props.showComparison(before.id);
          },
        });
      }
      if (!n.showing) {
        items.push({
          label: `Compare what’s showing with v${v.number}`,
          onSelect: () => props.showComparison(v.id),
        });
      }
      if (v.pdf && tab.project) {
        items.push({
          label: 'Show PDF',
          onSelect: () => void window.fringe.revealVersionPdf(tab.project!, v.pdf!),
        });
      }
      items.push('separator', { label: 'Edit details…', onSelect: () => props.editVersion(v.id) });
    } else if (n.kind !== 'start') {
      items.push('separator');
    }
    if (n.kind !== 'start') {
      items.push({
        label: 'Copy to new budget…',
        onSelect: () => props.copyToNew(n.entryId, v?.number, n.branchId),
      });
    }
    if (v) items.push({ label: 'Delete version…', danger: true, onSelect: () => props.deleteVersion(v) });
    setMenu({ x: r.right + 4, y: r.top, header: <TipText tab={tab} tree={tree} node={n} />, items });
  };

  const laneMenu = (row: number, el: Element) => {
    const { branch } = tree.rows[row]!;
    const r = el.getBoundingClientRect();
    const main = branch.id === MAIN_BRANCH;
    const items: MenuEntry[] = [
      {
        label: history.branch === branch.id && isEnd(history) ? 'Showing now' : 'Open its latest',
        disabled: history.branch === branch.id && isEnd(history),
        onSelect: () => props.open({ branchId: branch.id, entryId: branch.head, end: true }),
      },
    ];
    if (!main) {
      items.push(
        { label: 'Rename…', onSelect: () => setRenaming(branch.id) },
        branch.notPicked
          ? { label: 'Pick it back up', onSelect: () => props.setNotPicked(branch.id, false) }
          : { label: 'Mark as not picked', onSelect: () => props.setNotPicked(branch.id, true) },
      );
    }
    setMenu({
      x: r.left,
      y: r.bottom + 2,
      header: main ? "The main line has the budget's name." : null,
      items,
    });
  };

  // Press and drag to move around the tree: sideways in its box, up and down with the page.
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    page: HTMLElement | null;
    moved: boolean;
  } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      const el = e.currentTarget;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: 0,
        page: scrollParent(el),
        moved: false,
      };
      drag.current.top = drag.current.page?.scrollTop ?? 0;
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        d.moved = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setTip(null);
      }
      e.currentTarget.scrollLeft = d.left - dx;
      if (d.page) d.page.scrollTop = d.top - dy;
    },
    onPointerUp: () => {
      // A drag isn't a click: the point it ended on doesn't open its menu.
      dragged.current = !!drag.current?.moved;
      drag.current = null;
      setDragging(false);
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!dragged.current) return;
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };

  const width = PAD * 2 + Math.max(0, tree.cols - 1) * COL + 24;
  const height = AXIS + tree.rows.length * ROW;
  const days = dayMarks(tree);

  return (
    <div className="branch-tree" ref={wrap}>
      {naming && (
        <BranchNamer
          history={history}
          from={naming.label}
          close={() => setNaming(null)}
          create={(name) => {
            props.startBranch(name, naming.from);
            setNaming(null);
          }}
        />
      )}
      <div className="tree-body">
        <ul className="tree-lanes">
          <li className="tree-axis-head" style={{ height: AXIS }} aria-hidden="true">
            Earlier → Later
          </li>
          {tree.rows.map((r) => (
            <li
              key={r.branch.id}
              className={`tree-lane lane-${lane(r.row)}${r.branch.notPicked ? ' not-picked' : ''}`}
              style={{ height: ROW, paddingLeft: 8 + r.depth * 12 }}
            >
              {renaming === r.branch.id ? (
                <LaneRename
                  history={history}
                  branchId={r.branch.id}
                  name={r.name}
                  close={() => setRenaming(null)}
                  rename={(name) => {
                    props.renameBranch(r.branch.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="tree-lane-name"
                  title="Rename, open, or mark not picked"
                  onClick={(e) => laneMenu(r.row, e.currentTarget)}
                >
                  <span className="tree-lane-title">{r.name}</span>
                  <span className="tree-lane-sub">{laneSub(tree, r.row)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className={dragging ? 'tree-scroll dragging' : 'tree-scroll'} {...dragHandlers}>
          <svg
            width={width}
            height={height}
            style={{ minWidth: '100%' }}
            className="tree-svg"
            role="group"
            aria-label="Versions by branch"
          >
            <line className="tree-axis-rule" x1={0} y1={AXIS - 0.5} x2="100%" y2={AXIS - 0.5} />
            {days.map((d) => {
              // A new day starts halfway between its column and the one before.
              const at = d.col === 0 ? 0 : PAD + d.col * COL - COL / 2;
              return (
                <g key={`day:${d.day}`} className="tree-day">
                  {d.col > 0 && <line className="tree-day-line" x1={at} y1={4} x2={at} y2={height} />}
                  <text className="tree-day-label" x={at + (d.col === 0 ? 8 : 5)} y={15}>
                    {dayLabel(d.day)}
                  </text>
                </g>
              );
            })}
            {tree.rows.map((r) => {
              const mine = tree.nodes.filter((n) => n.row === r.row);
              const first = mine[0];
              const last = mine.at(-1);
              if (!first || !last || first === last) return null;
              return (
                <line
                  key={`line:${r.branch.id}`}
                  className={`tree-line lane-${lane(r.row)}${r.branch.notPicked ? ' not-picked' : ''}`}
                  x1={x(first)}
                  y1={y(first)}
                  x2={x(last)}
                  y2={y(last)}
                />
              );
            })}
            {tree.links.map((l) => {
              const a = byKey.get(l.from);
              const b = byKey.get(l.to);
              if (!a || !b) return null;
              const row = tree.rows[b.row]!;
              return (
                <path
                  key={`${l.from}>${l.to}`}
                  className={`tree-line lane-${lane(b.row)}${row.branch.notPicked ? ' not-picked' : ''}`}
                  d={`M ${x(a)} ${y(a)} C ${x(a) + 28} ${y(a)} ${x(a) + 18} ${y(b)} ${x(b)} ${y(b)}`}
                />
              );
            })}
            {tree.nodes.map((n) => {
              const notPicked = tree.rows[n.row]!.branch.notPicked;
              const label =
                n.kind === 'version'
                  ? `v${n.version!.number}`
                  : n.kind === 'latest'
                    ? latestLabel(n)
                    : shortWhen(n.at);
              return (
                <g
                  key={n.key}
                  className={`tree-node ${n.kind} lane-${lane(n.row)}${notPicked ? ' not-picked' : ''}${n.showing ? ' showing' : ''}`}
                  transform={`translate(${x(n)} ${y(n)})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${tree.rows[n.row]!.name}, ${label || 'earlier point'}${n.showing ? ', showing' : ''}`}
                  onMouseEnter={(e) =>
                    !menu && !drag.current?.moved && setTip({ node: n, ...place(e.currentTarget) })
                  }
                  onMouseLeave={() => setTip(null)}
                  onFocus={(e) => !menu && setTip({ node: n, ...place(e.currentTarget) })}
                  onBlur={() => setTip(null)}
                  onClick={(e) => nodeMenu(n, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    nodeMenu(n, e.currentTarget);
                  }}
                >
                  {n.showing && <circle className="tree-ring" r={14} />}
                  <circle className="tree-dot" r={n.kind === 'version' ? 9 : n.kind === 'latest' ? 7 : 3.5} />
                  {/* A bigger target than the dot. */}
                  <circle className="tree-hit" r={16} />
                  {label && (
                    <text
                      className={n.kind === 'start' ? 'tree-label tree-label-small' : 'tree-label'}
                      y={n.kind === 'start' ? 18 : 25}
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {anyNotPicked && (
        <label className="check tree-toggle">
          <input
            type="checkbox"
            checked={showNotPicked}
            onChange={(e) => setShowNotPicked(e.target.checked)}
          />
          <span>Show branches not picked</span>
        </label>
      )}
      {tip && (
        <div className="tree-tip" style={{ left: tip.left, top: tip.top }} role="tooltip">
          <TipText tab={tab} tree={tree} node={tip.node} />
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={menu.header}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The box that scrolls the page up and down around an element, if any. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Whether the point showing is the end of its branch. */
function isEnd(history: BudgetHistory): boolean {
  const b = history.branches.find((x) => x.id === history.branch);
  return b !== undefined && history.entries[history.current]?.id === b.head;
}

/** When a start dot's point was: the time today, or the date. */
/** A day in the date row: "Today", "Yesterday" or a short date, with the year when it isn't this one. */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(y!, m! - 1, d!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ago = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return day.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A branch's end that isn't a version: "No changes yet" until something is changed on it. */
const latestLabel = (n: TreeNode) => (n.empty ? 'No changes yet' : 'Latest');

/** "v1.1", "Latest" or "an earlier point", with the branch's name. */
function pointLabel(tree: TreeLayout, n: TreeNode): string {
  const name = tree.rows[n.row]!.name;
  if (n.version) return `${name} v${n.version.number}`;
  return n.kind === 'latest' ? `${name}, latest` : `${name} at ${shortWhen(n.at)}`;
}

/** Under a branch's name: where it came from, and whether it was picked. */
function laneSub(tree: TreeLayout, row: number): string {
  const r = tree.rows[row]!;
  if (r.branch.id === MAIN_BRANCH) return 'main line';
  const first = tree.nodes.find((n) => n.row === row);
  const link = first && tree.links.find((l) => l.to === first.key);
  const from = link && tree.nodes.find((n) => n.key === link.from);
  const where = from ? `from ${pointLabel(tree, from)}` : '';
  return [r.branch.notPicked ? 'not picked' : '', where].filter(Boolean).join(' · ');
}

/** A point's details, for its hover tip and its menu. */
function TipText({ tab, tree, node: n }: { tab: BudgetTab; tree: TreeLayout; node: TreeNode }) {
  const { history } = tab;
  const v = n.version;
  const budget = findEntry(history, n.entryId)?.budget;
  const precision = tab.budget.settings.displayPrecision;
  let when: string;
  if (v) {
    when = `Created ${fullTime(v.savedAt)}`;
  } else if (n.kind === 'latest') {
    const line = branchLine(history, n.branchId);
    const lastVersion = tree.nodes.filter((x) => x.row === n.row && x.version).at(-1)?.version;
    const after = lastVersion
      ? line.length - 1 - line.findIndex((e) => e.id === lastVersion.entryId)
      : line.length;
    const count = Math.max(0, Math.min(after, line.length));
    const since = lastVersion ? `v${lastVersion.number}` : 'it started';
    when =
      count === 0 ? `No changes since ${since}` : `${count} change${count === 1 ? '' : 's'} since ${since}`;
    if (count > 0) when += ` · last ${fullTime(n.at)}`;
  } else {
    const at = findEntry(history, n.entryId)?.at;
    when = at ? `Changed ${fullTime(at)}` : '';
  }
  return (
    <>
      <div className="tree-tip-title">
        {tree.rows[n.row]!.name} ·{' '}
        {v ? versionLabel(v) : n.kind === 'latest' ? latestLabel(n) : 'where a branch started'}
      </div>
      <div className="muted">{when}</div>
      {v?.sentOn && (
        <div className="muted">
          Sent {shortDate(v.sentOn)}
          {v.sentTo && ` to ${v.sentTo}`}
        </div>
      )}
      {v?.sentTo && !v.sentOn && <div className="muted">To {v.sentTo}</div>}
      {budget && <div className="tree-tip-total num">{formatMoney(grandTotal(budget), precision)}</div>}
      {n.end && !n.showing && <div className="muted small">Where work goes on</div>}
    </>
  );
}

/** Asks for a new branch's name, and says why one can't be used. */
export function BranchNamer({
  history,
  from,
  create,
  close,
  cancelLabel = 'Cancel',
}: {
  history: BudgetHistory;
  /** What the branch starts from, e.g. "Test Show v1.0". */
  from: string;
  create(name: string): void;
  close(): void;
  cancelLabel?: string;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="branch-namer"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          create(cleanBranchName(history, name));
        } catch (err) {
          setError(err instanceof BranchError ? err.message : 'Couldn’t start the branch.');
        }
      }}
    >
      <span>Start a branch from {from}:</span>
      <input
        className="text-input"
        value={name}
        placeholder="Name the branch, e.g. 25-day shoot"
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      <button type="submit" className="btn btn-primary">
        Start branch
      </button>
      <button type="button" className="btn" onClick={close}>
        {cancelLabel}
      </button>
      {error && (
        <p className="warning small" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Renames a branch in place: Enter keeps it, Escape leaves it as it was. */
function LaneRename({
  history,
  branchId,
  name: was,
  rename,
  close,
}: {
  history: BudgetHistory;
  branchId: string;
  name: string;
  rename(name: string): void;
  close(): void;
}) {
  const [name, setName] = useState(was);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    if (name.trim() === was) return close();
    try {
      rename(cleanBranchName(history, name, branchId));
    } catch (err) {
      setError(err instanceof BranchError ? err.message : 'Couldn’t rename it.');
    }
  };
  return (
    <div className="tree-lane-rename">
      <input
        className="text-input"
        value={name}
        autoFocus
        aria-label="Branch name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onBlur={() => (error ? close() : done())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done();
          else if (e.key === 'Escape') close();
        }}
      />
      {error && <span className="warning small">{error}</span>}
    </div>
  );
}
