import {
  type Budget,
  type BudgetHistory,
  type BudgetVersion,
  type ReportDoc,
  type ReportOptions,
  DEFAULT_REPORT_OPTIONS,
  REPORTS,
  buildReports,
  sortedLevels,
  versionBudget,
} from '@fringe/budget-engine';
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
    (o.lineFringes === 'rolled-up' || o.lineFringes === 'per-line') &&
    (o.order === undefined || (Array.isArray(o.order) && o.order.every((r) => typeof r === 'string')))
  );
};

export function useReportOptions() {
  const [options, setOptions] = usePref<ReportOptions>('reportOptions', DEFAULT_REPORT_OPTIONS, isOptions);
  const [landscape, setLandscape] = usePref('reportLandscape', false, isBoolean);
  return { options, setOptions, landscape, setLandscape };
}

/** Options with only the production levels this budget has (they're remembered across budgets). */
export function optionsFor(budget: Budget, options: ReportOptions): ReportOptions {
  const levels = sortedLevels(budget.settings.coa.levels);
  return { ...options, levels: options.levels.filter((id) => levels.some((l) => l.id === id)) };
}

/** "v1.0 · Studio draft". */
export const versionLabel = (v: BudgetVersion) => `v${v.number}${v.name ? ` · ${v.name}` : ''}`;

/**
 * The reports for a budget, with the Changes report comparing it with `since`. `version` is the
 * version these reports are, which goes in the title.
 */
export function reportsWith(
  budget: Budget,
  history: BudgetHistory,
  options: ReportOptions,
  since: BudgetVersion | null,
  version?: { number: string; changes: string },
): ReportDoc {
  const before = since ? versionBudget(history, since) : null;
  const notes = version?.changes ?? '';
  return buildReports(budget, options, new Date(), {
    ...(version ? { version: version.number } : {}),
    ...(since && before ? { compare: { label: `v${since.number}`, budget: before, notes } } : {}),
  });
}
