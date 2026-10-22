import { EditError } from './edit';
import { type Account, type Budget, type FringeRange, newId } from './model';

/** The range a line is in, if any. */
export function rangeOf(account: Account, lineId: string): FringeRange | undefined {
  return account.fringeRanges.find((r) => r.lineIds.includes(lineId));
}

/**
 * Puts two or more lines in a new range (taking them out of any other), kept in line order.
 * Returns the new range's id.
 */
export function createFringeRange(
  budget: Budget,
  accountId: string,
  lineIds: readonly string[],
): { budget: Budget; id: string } {
  if (new Set(lineIds).size < 2) throw new EditError('A fringe range needs two or more lines.');
  const id = newId();
  const next = mapAccount(budget, accountId, (a) => {
    const order = a.details.map((d) => d.id).filter((d) => lineIds.includes(d));
    const fringeRanges = withoutLines(a.fringeRanges, order);
    // Keep ranges in the order of their first line.
    const first = a.details.findIndex((d) => d.id === order[0]);
    const at = fringeRanges.findIndex((r) => a.details.findIndex((d) => d.id === r.lineIds[0]) > first);
    fringeRanges.splice(at < 0 ? fringeRanges.length : at, 0, { id, lineIds: order });
    return { ...a, fringeRanges };
  });
  return { budget: next, id };
}

/** Removes every range any of the lines is in. */
export function removeFringeRanges(budget: Budget, accountId: string, lineIds: readonly string[]): Budget {
  return mapAccount(budget, accountId, (a) => ({
    ...a,
    fringeRanges: a.fringeRanges.filter((r) => !r.lineIds.some((l) => lineIds.includes(l))),
  }));
}

function withoutLines(ranges: readonly FringeRange[], lineIds: readonly string[]): FringeRange[] {
  return ranges
    .map((r) => ({ ...r, lineIds: r.lineIds.filter((l) => !lineIds.includes(l)) }))
    .filter((r) => r.lineIds.length > 1);
}

function mapAccount(budget: Budget, accountId: string, fn: (a: Account) => Account): Budget {
  let found = false;
  const next = {
    ...budget,
    categories: budget.categories.map((c) => ({
      ...c,
      accounts: c.accounts.map((a) => {
        if (a.id !== accountId) return a;
        found = true;
        return fn(a);
      }),
    })),
  };
  if (!found) throw new EditError('That account no longer exists.');
  return next;
}
