import {
  type Budget,
  DEFAULT_REPORT_OPTIONS,
  budgetTitle,
  buildReports,
  calculateTotals,
  crewFringes,
  crewList,
  formatMoney,
  toDecimal,
} from '@fringe/budget-engine';
import { useState } from 'react';
import type { ReportFormat } from '../../../shared/ipc';
import { ReportPreview } from './ReportPreview';
import { useReportOptions } from './report-options';

const FORMATS: readonly { id: ReportFormat; label: string }[] = [
  { id: 'pdf', label: 'Save PDF…' },
  { id: 'xlsx', label: 'Save Excel…' },
];

/**
 * The budget's labor on one page: every line that pays a person, by department. A line counts
 * when it has one of the crew fringes, workers' comp unless the budget chooses others here.
 */
export function CrewListView({
  budget,
  update,
}: {
  budget: Budget;
  update(budget: Budget, label: string): void;
}) {
  const { landscape } = useReportOptions();
  const [status, setStatus] = useState<{ text: string; error?: true } | null>(null);
  const [busy, setBusy] = useState(false);

  const { settings } = budget;
  const chosen = crewFringes(budget);
  const totals = calculateTotals(budget);
  const crew = crewList(budget, totals, chosen);
  const total = crew.wages.plus(crew.fringeTotal);
  const grand = toDecimal(totals.grand.total);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, settings.displayPrecision);

  const setFringes = (crewFringes: string[], label: string) => {
    update({ ...budget, settings: { ...settings, crewFringes } }, label);
    setStatus(null);
  };
  const toggle = (name: string, on: boolean) =>
    setFringes(
      settings.fringeDefs.map((f) => f.name).filter((f) => (f === name ? on : chosen.includes(f))),
      `Crew list ${on ? 'counts' : 'leaves out'} ${name}`,
    );

  const doc = buildReports(budget, { ...DEFAULT_REPORT_OPTIONS, reports: ['crew'] });
  const title = `${budgetTitle(budget)} Crew List`;
  const save = async (format: ReportFormat) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.fringe.saveReport(format, doc, title, landscape);
      if (result)
        setStatus(result.ok ? { text: `Saved ${result.file}` } : { text: result.error, error: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Couldn’t save the crew list.', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view reports-view">
      <div className="reports-options">
        <h1>Crew List</h1>
        <dl className="crew-summary">
          <dt>Positions</dt>
          <dd>{crew.positions}</dd>
          <dt>Wages</dt>
          <dd>{money(crew.wages)}</dd>
          <dt>Fringes</dt>
          <dd>{money(crew.fringeTotal)}</dd>
          <dt>Labor total</dt>
          <dd>
            {money(total)}
            {!grand.isZero() && (
              <span className="muted"> · {total.dividedBy(grand).times(100).toFixed(1)}% of the budget</span>
            )}
          </dd>
        </dl>

        <fieldset>
          <legend>Who counts as crew</legend>
          <p className="muted small">
            A line is on the crew list when it has one of these fringes. Workers’ comp works best: people on
            payroll and loan-outs pay it, box and kit rentals don’t.
          </p>
          {settings.fringeDefs.length === 0 ? (
            <p className="muted small">This budget has no fringes yet. Add them in Budget Settings.</p>
          ) : (
            settings.fringeDefs.map((f) => (
              <label key={f.name} className="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(f.name)}
                  onChange={(e) => toggle(f.name, e.target.checked)}
                />
                <span>{f.name}</span>
              </label>
            ))
          )}
        </fieldset>

        <div className="reports-save">
          {FORMATS.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className={i === 0 ? 'btn btn-primary' : 'btn'}
              disabled={busy || doc.sections.length === 0}
              onClick={() => void save(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {status && (
          <p className={status.error ? 'warning small' : 'muted small'} role="status">
            {status.text}
          </p>
        )}
      </div>

      <div className="reports-preview">
        {doc.sections.length === 0 ? (
          <p className="muted">
            {chosen.length === 0
              ? 'Choose the fringes that mark crew lines.'
              : 'No lines with those fringes yet.'}
          </p>
        ) : (
          <ReportPreview doc={doc} landscape={landscape} />
        )}
      </div>
    </section>
  );
}
