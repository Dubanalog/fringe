import type { OpenBudget } from '../shared/ipc';

/**
 * The budgets the AI can work with: every budget open in the window, then recently opened
 * projects that aren't open (read only). Each gets a name the AI can use to pick it; budgets with
 * the same name get their folder's name after it.
 */

export interface BudgetChoice {
  /** What the AI calls it: the budget's name, made unique. */
  label: string;
  name: string;
  /** Its project folder; null for a budget not saved anywhere. */
  project: string | null;
  /** The window's tab, for an open budget; null for one that isn't open. */
  tab: string | null;
  showing: boolean;
}

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function budgetChoices(
  open: readonly OpenBudget[],
  recent: readonly { name: string; path: string }[],
): BudgetChoice[] {
  const openFolders = new Set(open.map((b) => b.project).filter((p) => p !== null));
  const list: BudgetChoice[] = [
    ...open.map((b) => ({ label: b.name, name: b.name, project: b.project, tab: b.tab, showing: b.showing })),
    ...recent
      .filter((r) => !openFolders.has(r.path))
      .map((r) => ({ label: r.name, name: r.name, project: r.path, tab: null, showing: false })),
  ];
  const taken = new Set<string>();
  for (const b of list) {
    const clash = list.filter((o) => same(o.name, b.name)).length > 1;
    let label = clash && b.project ? `${b.name} (${folderName(b.project)})` : b.name;
    for (let n = 2; [...taken].some((t) => same(t, label)); n++) label = `${b.name} (${n})`;
    b.label = label;
    taken.add(label);
  }
  return list;
}

/**
 * The budget the AI means: `wanted` as list_budgets names it (or by its plain name, when only
 * one has it), or the budget showing when it's left out. Throws with what to ask instead.
 */
export function findBudget(choices: readonly BudgetChoice[], wanted: unknown): BudgetChoice {
  if (wanted === undefined || wanted === null || (typeof wanted === 'string' && wanted.trim() === '')) {
    const showing = choices.find((b) => b.showing);
    if (!showing) throw new Error('No budget is showing in the app. Ask the user to open one, or name one.');
    return showing;
  }
  const name = String(wanted).trim();
  const byLabel = choices.find((b) => same(b.label, name));
  if (byLabel) return byLabel;
  const byName = choices.filter((b) => same(b.name, name));
  if (byName.length === 1) return byName[0]!;
  const names = choices.map((b) => `"${b.label}"`).join(', ');
  throw new Error(
    byName.length > 1
      ? `More than one budget is called "${name}": use one of ${names}.`
      : `There's no budget called "${name}". The budgets are: ${names || 'none'}.`,
  );
}
