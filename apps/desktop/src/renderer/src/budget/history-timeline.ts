import type { BudgetVersion, HistoryEntry } from '@fringe/budget-engine';

export type TimelineItem =
  | { kind: 'entry'; e: HistoryEntry; i: number; at: string }
  | { kind: 'version'; version: BudgetVersion; at: string };

/**
 * The changes on a branch, newest first, with each of its saved versions placed where it was saved:
 * above the change it was saved at, and above any change made before it was saved. When older changes
 * are still hidden (`allShown` false), versions saved before the oldest change shown are left out too.
 */
export function withVersions(
  rows: readonly { e: HistoryEntry; i: number }[],
  versions: readonly BudgetVersion[],
  entryAt: (entryId: string) => string | undefined,
  allShown: boolean,
): TimelineItem[] {
  // A version never sorts below its own change, even if the clock says otherwise.
  const placed = versions
    .map((version) => {
      const at = entryAt(version.entryId);
      return { version, at: at && at > version.savedAt ? at : version.savedAt };
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out: TimelineItem[] = [];
  let n = 0;
  for (const { e, i } of rows) {
    while (n < placed.length && (placed[n]!.at > e.at || placed[n]!.version.entryId === e.id)) {
      out.push({ kind: 'version', ...placed[n++]! });
    }
    out.push({ kind: 'entry', e, i, at: e.at });
  }
  if (allShown) for (; n < placed.length; n++) out.push({ kind: 'version', ...placed[n]! });
  return out;
}
