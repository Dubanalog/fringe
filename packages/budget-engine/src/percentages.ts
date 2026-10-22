import { EditError } from './edit';
import { budgetTags } from './lines';
import { type Budget, type BudgetPercentage, type TaxIncentive, newId } from './model';
import { fitsPattern } from './numbering';

/**
 * The budget's percentages: topsheet lines worked out from its total, e.g. Contingency 10% or a
 * tax credit at -25%, each leaving out the groups chosen (see BudgetPercentage).
 */

/** Adds a percentage, or changes the one with this id. */
export function setPercentage(
  budget: Budget,
  percentage: Omit<BudgetPercentage, 'id'> & { id?: string },
): Budget {
  const name = percentage.name.trim();
  if (!name) throw new EditError('A percentage needs a name, e.g. Contingency.');
  const percent = percentage.percent.trim().replace(/%$/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(percent)) throw new EditError('Type the percent as a number, e.g. 10 or -25.');
  const list = budget.settings.percentages;
  if (list.some((p) => p.id !== percentage.id && p.name.toLowerCase() === name.toLowerCase()))
    throw new EditError(`There's already a percentage called ${name}.`);
  const known = new Set(budgetTags(budget).groups);
  const missing = percentage.excludeGroups.filter((g) => !known.has(g));
  if (missing.length > 0) throw new EditError(`There's no group ${missing.join(', ')}.`);
  const next: BudgetPercentage = {
    id: percentage.id ?? newId(),
    name,
    percent,
    excludeGroups: [...new Set(percentage.excludeGroups)],
    ...accountField(budget, percentage.account, percentage.id),
  };
  const percentages = list.some((p) => p.id === next.id)
    ? list.map((p) => (p.id === next.id ? next : p))
    : [...list, next];
  return {
    ...budget,
    settings: { ...budget.settings, groups: withGroups(budget, next.excludeGroups), percentages },
  };
}

export function deletePercentage(budget: Budget, id: string): Budget {
  return {
    ...budget,
    settings: { ...budget.settings, percentages: budget.settings.percentages.filter((p) => p.id !== id) },
  };
}

/** Moves a percentage up or down the topsheet. */
export function movePercentage(budget: Budget, id: string, by: -1 | 1): Budget {
  const list = [...budget.settings.percentages];
  const i = list.findIndex((p) => p.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return budget;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...budget, settings: { ...budget.settings, percentages: list } };
}

/** How a percentage reads on the topsheet, e.g. "Contingency 10% (less POST)". */
export function percentageLabel(p: BudgetPercentage): string {
  const less = p.excludeGroups.length > 0 ? ` (less ${p.excludeGroups.join(', ')})` : '';
  return `${p.name} ${p.percent}%${less}`;
}

const percentText = (v: string) => v.trim().replace(/%$/, '').trim();
const isPercent = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

/** Adds a tax incentive, or changes the one with this id. */
export function setIncentive(budget: Budget, incentive: Omit<TaxIncentive, 'id'> & { id?: string }): Budget {
  const name = incentive.name.trim();
  if (!name) throw new EditError('An incentive needs a name, e.g. Georgia Film Tax Credit.');
  const rate = percentText(incentive.rate);
  if (!isPercent(rate) || Number(rate) < 0) throw new EditError('Type the rate as a number, e.g. 30.');
  const realized = percentText(incentive.realized) || '100';
  if (!isPercent(realized) || Number(realized) < 0 || Number(realized) > 100)
    throw new EditError('Type the share received as a percent from 0 to 100, e.g. 80.');
  const list = budget.settings.incentives;
  if (list.some((p) => p.id !== incentive.id && p.name.toLowerCase() === name.toLowerCase()))
    throw new EditError(`There's already an incentive called ${name}.`);
  const known = new Set(budgetTags(budget).groups);
  const missing = incentive.groups.filter((g) => !known.has(g));
  if (missing.length > 0) throw new EditError(`There's no group ${missing.join(', ')}.`);
  const fringes = budgetTags(budget).fringes;
  const excludeFringes = [...new Set(incentive.excludeFringes ?? [])];
  const unknown = excludeFringes.filter((f) => !fringes.has(f));
  if (unknown.length > 0) throw new EditError(`There's no fringe ${unknown.join(', ')}.`);
  const next: TaxIncentive = {
    id: incentive.id ?? newId(),
    name,
    rate,
    groups: [...new Set(incentive.groups)],
    realized,
    includeFringes: incentive.includeFringes !== false,
    ...(excludeFringes.length > 0 ? { excludeFringes } : {}),
    ...accountField(budget, incentive.account, incentive.id),
  };
  const incentives = list.some((p) => p.id === next.id)
    ? list.map((p) => (p.id === next.id ? next : p))
    : [...list, next];
  return { ...budget, settings: { ...budget.settings, groups: withGroups(budget, next.groups), incentives } };
}

export function deleteIncentive(budget: Budget, id: string): Budget {
  return {
    ...budget,
    settings: { ...budget.settings, incentives: budget.settings.incentives.filter((p) => p.id !== id) },
  };
}

/** How an incentive reads on the topsheet, e.g. "Less: GA Tax Credit 30% (at 80%)". */
export function incentiveLabel(p: TaxIncentive): string {
  const at = Number(p.realized) === 100 ? '' : ` (at ${p.realized}%)`;
  return `Less: ${p.name} ${p.rate}%${at}`;
}

/** The account number field, left off when blank. */
function accountField(
  budget: Budget,
  account: string | undefined,
  id: string | undefined,
): { account?: string } {
  const a = account?.trim() ?? '';
  if (!a) return {};
  // They sit with the categories on the topsheet, so they're numbered like them.
  const pattern = budget.settings.coa.categoryPattern;
  if (!fitsPattern(a, pattern)) {
    throw new EditError(
      `Category numbers look like ${pattern} in this budget, # for each digit (Budget Settings → Chart of Accounts).`,
    );
  }
  const { percentages, incentives } = budget.settings;
  if (
    budget.categories.some((c) => c.number === a) ||
    [...percentages, ...incentives].some((p) => p.id !== id && p.account === a)
  ) {
    throw new EditError(`${a} is already used on the topsheet.`);
  }
  return { account: a };
}

/** The budget's groups plus any picked that were only on lines so far, so they show in Budget Settings. */
function withGroups(budget: Budget, picked: string[]): string[] {
  const groups = budget.settings.groups;
  const added = picked.filter((g) => !groups.includes(g));
  return added.length > 0 ? [...groups, ...added] : groups;
}
