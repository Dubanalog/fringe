import {
  type Budget,
  type BudgetHistory,
  type BudgetVersion,
  type ReportDoc,
  type ReportOptions,
  DEFAULT_REPORT_OPTIONS,
  REPORTS,
  activeBranch,
  branchName,
  buildReports,
  sortedLevels,
  versionBudget,
} from '@fringe/budget-engine';
import { showingLabel, sideLabel } from './compare-pick';
import { isBoolean, usePref } from './prefs';

/** The report choices, remembered on this computer: used by Reports and by a version's PDF. */

const isOptions = (v: unknown): v is ReportOptions => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<ReportOptions>;
  return (
    Array.isArray(o.reports) &&
    o.reports.every((r) => REPORTS.some((x) => x.id === r)) &&
    typeof o.hideZero === 'boolean' &&
    Array.isArray(o.levels) &&
    o.levels.every((l) => typeof l === 'string') &&
    (o.fringeDetail === undefined || typeof o.fringeDetail === 'boolean') &&
    (o.order === undefined || (Array.isArray(o.order) && o.order.every((r) => typeof r === 'string')))
  );
};

export function useReportOptions() {
  const [saved, setOptions] = usePref<ReportOptions>('reportOptions', DEFAULT_REPORT_OPTIONS, isOptions);
  const [landscape, setLandscape] = usePref('reportLandscape', false, isBoolean);
  // Options saved before "Show fringe detail" have none: they showed the detail.
  const options = { ...saved, fringeDetail: saved.fringeDetail ?? true };
  return { options, setOptions, landscape, setLandscape };
}

/**
 * Opens Reports on the Comparison report (ticking it if it's off), comparing what's showing with
 * the version `from` (null for the one before it).
 */
export function useOpenComparison(open: (from: string | null) => void): (from: string | null) => void {
  const { options, setOptions } = useReportOptions();
  return (from) => {
    if (!options.reports.includes('changes'))
      setOptions({ ...options, reports: [...options.reports, 'changes'] });
    open(from);
  };
}

/** Options with only the production levels this budget has (they're remembered across budgets). */
export function optionsFor(budget: Budget, options: ReportOptions): ReportOptions {
  const levels = sortedLevels(budget.settings.coa.levels);
  return { ...options, levels: options.levels.filter((id) => levels.some((l) => l.id === id)) };
}

/** "v1.0 · Studio draft". */
export const versionLabel = (v: BudgetVersion) => `v${v.number}${v.name ? ` · ${v.name}` : ''}`;

/**
 * The reports for the budget showing, with the Comparison report comparing it with `since`.
 * `version` is the version it is, which goes in the title; its "What changed" goes above the
 * comparison when `since` is the version before it.
 */
export function reportsWith(
  budget: Budget,
  history: BudgetHistory,
  options: ReportOptions,
  since: BudgetVersion | null,
  version?: { number: string; changes: string },
): ReportDoc {
  const before = since ? versionBudget(history, since) : null;
  let to = version ? `v${version.number}` : showingLabel(history, budget.name);
  if (since && since.branch !== history.branch && to.startsWith('v'))
    to = `${branchName(activeBranch(history), budget.name)} ${to}`;
  return buildReports(budget, options, new Date(), {
    ...(version ? { version: version.number } : {}),
    ...(since && before
      ? {
          compare: {
            label: sideLabel(history, since, budget.name),
            budget: before,
            notes: version?.changes ?? '',
            // At the latest the report reads "since v1.1" with a Now column.
            ...(to === 'Now' ? {} : { to: { label: to, budget } }),
          },
        }
      : {}),
  });
}
