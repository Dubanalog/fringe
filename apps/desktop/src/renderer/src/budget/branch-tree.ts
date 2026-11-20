import {
  type Branch,
  type BudgetHistory,
  type BudgetVersion,
  MAIN_BRANCH,
  branchName,
  versionsOn,
} from '@fringe/budget-engine';

/** One branch's row on the Versions page. */
export interface TreeRow {
  branch: Branch;
  /** The branch's name; the budget's for the main line. */
  name: string;
  /** Top to bottom. */
  row: number;
  /** 0 for the main line, 1 for a branch from it, and so on. */
  depth: number;
}

/**
 * A point on the tree:
 * - `version`: a saved version;
 * - `latest`: the end of a branch that isn't a version yet (drawn dashed);
 * - `start`: where a branch was started from a branch's end that has moved on since, so it's
 *   neither of the others (a small dot).
 */
export interface TreeNode {
  key: string;
  kind: 'version' | 'latest' | 'start';
  branchId: string;
  entryId: string;
  row: number;
  /** Left to right, in the order things happened. Rows can share a column; a row never does. */
  col: number;
  version: BudgetVersion | null;
  /** The end of its branch: where work goes on. A version can be the end too. */
  end: boolean;
  /** The point showing in the tab. */
  showing: boolean;
}

/** A line from the point a branch started at to the branch's first node. */
export interface TreeLink {
  from: string;
  to: string;
}

export interface TreeLayout {
  rows: TreeRow[];
  /** Left to right; each row's nodes in order. */
  nodes: TreeNode[];
  links: TreeLink[];
  cols: number;
}

/**
 * The history without its not-picked branches, and the branches started from them, for a tree
 * that hides them. The branch showing, and the branches it came from, always stay.
 */
export function withoutNotPicked(history: BudgetHistory): BudgetHistory {
  const entryAt = new Map(history.entries.map((e) => [e.id, e]));
  const byId = new Map(history.branches.map((b) => [b.id, b]));
  const parentOf = (b: Branch) => (b.from === null ? null : (entryAt.get(b.from)?.branch ?? null));
  const keep = new Set<string>();
  for (let id: string | null = history.branch, n = 0; id !== null && n <= byId.size; n++) {
    const b = byId.get(id);
    if (!b) break;
    keep.add(id);
    id = parentOf(b);
  }
  const hidden = (b: Branch): boolean => {
    if (keep.has(b.id)) return false;
    const seen = new Set<string>();
    for (let at: Branch | undefined = b; at && !seen.has(at.id);) {
      if (at.notPicked) return true;
      seen.add(at.id);
      const up = parentOf(at);
      at = up === null ? undefined : byId.get(up);
    }
    return false;
  };
  const gone = new Set(history.branches.filter(hidden).map((b) => b.id));
  if (gone.size === 0) return history;
  return {
    ...history,
    branches: history.branches.filter((b) => !gone.has(b.id)),
    versions: history.versions.filter((v) => !gone.has(v.branch)),
  };
}

/**
 * Lays out a budget's branches in rows: the main line on top, and each branch in its own row under
 * the branch it came from (the newest started lowest). Left to right is the order versions were
 * saved; each branch ends in its Latest point unless its end is a version. Pure, for the Versions
 * page to draw.
 */
export function branchTree(history: BudgetHistory, budgetName: string): TreeLayout {
  const entryAt = new Map(history.entries.map((e) => [e.id, e]));
  const branchOfEntry = (id: string | null) => (id === null ? null : (entryAt.get(id)?.branch ?? null));
  const known = new Set(history.branches.map((b) => b.id));

  // Rows: depth first, children in the order they were started.
  const children = new Map<string, Branch[]>();
  for (const b of history.branches) {
    if (b.id === MAIN_BRANCH) continue;
    const parent = branchOfEntry(b.from);
    const under = parent !== null && known.has(parent) && parent !== b.id ? parent : MAIN_BRANCH;
    children.set(under, [...(children.get(under) ?? []), b]);
  }
  const rows: TreeRow[] = [];
  const place = (b: Branch, depth: number) => {
    if (rows.some((r) => r.branch.id === b.id)) return;
    rows.push({ branch: b, name: branchName(b, budgetName), row: rows.length, depth });
    const kids = [...(children.get(b.id) ?? [])].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    for (const kid of kids) place(kid, depth + 1);
  };
  const main = history.branches.find((b) => b.id === MAIN_BRANCH);
  if (main) place(main, 0);
  // Anything left over (a loop in a damaged history) goes at the bottom.
  for (const b of history.branches) place(b, 1);
  const rowOf = new Map(rows.map((r) => [r.branch.id, r.row]));

  const showingEntry = history.entries[history.current]?.id;
  const nodes: (Omit<TreeNode, 'col'> & { at: string })[] = [];
  for (const { branch, row } of rows) {
    const versions = [...versionsOn(history, branch.id)].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    const showingHere = history.branch === branch.id;
    for (const v of versions) {
      nodes.push({
        key: `v:${v.id}`,
        kind: 'version',
        branchId: branch.id,
        entryId: v.entryId,
        row,
        version: v,
        end: false,
        showing: showingHere && v.entryId === showingEntry,
        at: v.savedAt,
      });
    }
    const last = versions.at(-1);
    if (last && last.entryId === branch.head) {
      // Nothing changed since its latest version: that version is the end.
      const node = nodes.at(-1)!;
      node.end = true;
    } else {
      nodes.push({
        key: `end:${branch.id}`,
        kind: 'latest',
        branchId: branch.id,
        entryId: branch.head,
        row,
        version: null,
        end: true,
        showing: showingHere && branch.head === showingEntry,
        // A branch with no changes yet ends where it was started, at the time it was started.
        at: [entryAt.get(branch.head)?.at ?? '', branch.id === MAIN_BRANCH ? '' : branch.createdAt]
          .sort()
          .at(-1)!,
      });
    }
  }

  // Where each branch starts: a node on the row it came from, or a start dot there.
  const links: TreeLink[] = [];
  for (const { branch, row } of rows) {
    if (branch.id === MAIN_BRANCH || branch.from === null) continue;
    const first = nodes.find((n) => n.row === row);
    if (!first) continue;
    const parentRow = rowOf.get(branchOfEntry(branch.from) ?? MAIN_BRANCH) ?? 0;
    let from = nodes.find((n) => n.row === parentRow && n.entryId === branch.from && n.kind !== 'start');
    from ??= nodes.find((n) => n.row === parentRow && n.entryId === branch.from);
    if (!from) {
      from = {
        key: `start:${branch.from}`,
        kind: 'start',
        branchId: rows[parentRow]!.branch.id,
        entryId: branch.from,
        row: parentRow,
        version: null,
        end: false,
        showing: false,
        at: entryAt.get(branch.from)?.at ?? branch.createdAt,
      };
      nodes.push(from);
    }
    links.push({ from: from.key, to: first.key });
  }

  // Columns: in time order, ties top to bottom; then every node right of the one before it on its
  // row, and every branch's first node right of where it started.
  const order = [...nodes].sort((a, b) => a.at.localeCompare(b.at) || a.row - b.row);
  const col = new Map(order.map((n, i) => [n.key, i]));
  const before = new Map<string, string>();
  for (const r of rows) {
    const mine = nodes.filter((n) => n.row === r.row).sort((a, b) => col.get(a.key)! - col.get(b.key)!);
    mine.forEach((n, i) => i > 0 && before.set(n.key, mine[i - 1]!.key));
  }
  for (const l of links) before.set(l.to, before.has(l.to) ? before.get(l.to)! : l.from);
  // Push nodes right until every rule holds; the keys are sorted, so this settles quickly.
  for (let changed = true, rounds = 0; changed && rounds < nodes.length + 1; rounds++) {
    changed = false;
    for (const n of order) {
      const rules = [before.get(n.key), ...links.filter((l) => l.to === n.key).map((l) => l.from)];
      for (const r of rules) {
        if (r !== undefined && col.get(n.key)! <= col.get(r)!) {
          col.set(n.key, col.get(r)! + 1);
          changed = true;
        }
      }
    }
  }
  // Close up the gaps so the columns are 0, 1, 2… in order.
  const used = [...new Set(col.values())].sort((a, b) => a - b);
  const packed = new Map(used.map((c, i) => [c, i]));
  const placed: TreeNode[] = nodes
    .map(({ at: _at, ...n }) => ({ ...n, col: packed.get(col.get(n.key)!)! }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return { rows, nodes: placed, links, cols: used.length };
}
