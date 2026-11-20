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

/** The budget the chat panel works on: its tab, and its name for when that tab is closed. */
export interface ChatBudget {
  tab: string;
  name: string;
}

/**
 * The budget the AI means: `wanted` as list_budgets names it (or by its plain name, when only
 * one has it). Left out, it's the chat's budget for the chat panel (`chat`), so the user can look
 * at other tabs while it works, or the budget showing otherwise. Throws with what to ask instead.
 */
export function findBudget(
  choices: readonly BudgetChoice[],
  wanted: unknown,
  chat: ChatBudget | null = null,
): BudgetChoice {
  if (wanted === undefined || wanted === null || (typeof wanted === 'string' && wanted.trim() === '')) {
    if (chat) {
      const mine = choices.find((b) => b.tab === chat.tab);
      if (!mine)
        throw new Error(
          `"${chat.name}", the budget this chat works on, was closed. Stop and ask the user which budget to work on.`,
        );
      return mine;
    }
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

/**
 * The note sent with each chat message: the budget the chat works on (where tools go when none is
 * named), the one the user is looking at when that's another, and the other open budgets.
 */
export function chatNote(open: readonly OpenBudget[], chat: ChatBudget | null): string {
  const mine = chat ? open.find((b) => b.tab === chat.tab) : undefined;
  const showing = open.find((b) => b.showing);
  const quoted = (list: readonly OpenBudget[]) => list.map((b) => `"${b.name}"`).join(', ');
  const start = '(From Fringe, not typed by the user:';
  if (!mine) {
    const others = open.filter((b) => !b.showing);
    const also = others.length ? ` Also open: ${quoted(others)}.` : '';
    return showing
      ? `${start} the budget showing is "${showing.name}".${also})`
      : `${start} no budget is showing.${also})`;
  }
  const looking = showing && showing.tab !== mine.tab ? ` The user is looking at "${showing.name}".` : '';
  const others = open.filter((b) => b.tab !== mine.tab && b.tab !== showing?.tab);
  const also = others.length ? ` Also open: ${quoted(others)}.` : '';
  return `${start} this chat works on "${mine.name}"; tools you call without naming a budget go to it.${looking}${also})`;
}
