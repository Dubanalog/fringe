import type { ColumnLayout } from '@fringe/budget-engine';

/**
 * Applies a budget's saved column layout to the app's columns: saved order first,
 * then any columns the layout doesn't know about (e.g. added in a later version)
 * in their default place. Unknown saved ids are dropped.
 */
export function orderedColumns<T extends { id: string }>(
  all: readonly T[],
  layout: ColumnLayout | null,
  defaultHidden: readonly string[],
): { columns: T[]; hidden: Set<string> } {
  const byId = new Map(all.map((c) => [c.id, c]));
  const saved = (layout?.order ?? []).filter((id) => byId.has(id));
  const columns = saved.map((id) => byId.get(id)!);
  all.forEach((c, i) => {
    if (saved.includes(c.id)) return;
    // Insert after the nearest earlier default-order column already placed.
    const prev = all
      .slice(0, i)
      .reverse()
      .find((p) => columns.includes(p));
    columns.splice(prev ? columns.indexOf(prev) + 1 : 0, 0, c);
  });
  return { columns, hidden: new Set(layout?.hidden ?? defaultHidden) };
}

/** Moves column `id` so it sits just before `beforeId` (or last when null). */
export function moveColumn(order: readonly string[], id: string, beforeId: string | null): string[] {
  const rest = order.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}
