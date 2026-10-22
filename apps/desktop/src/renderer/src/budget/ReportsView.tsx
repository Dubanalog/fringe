import {
  type Budget,
  type BudgetHistory,
  type ReportId,
  type ReportOptions,
  REPORTS,
  budgetCsv,
  budgetTitle,
  reportOrder,
  sortedLevels,
  versionsNewestFirst,
} from '@fringe/budget-engine';
import { useState } from 'react';
import type { ReportFormat } from '../../../shared/ipc';
import { ReportPreview } from './ReportPreview';
import { reportsWith, useReportOptions, versionLabel } from './report-options';

const FORMATS: readonly { id: ReportFormat; label: string }[] = [
  { id: 'pdf', label: 'Save PDF…' },
  { id: 'xlsx', label: 'Save Excel…' },
  { id: 'json', label: 'Save JSON…' },
];

/**
 * Reports for the open budget: pick which ones and how, see them as they'll print, and save
 * them as a PDF, an Excel workbook or JSON. Every format comes from the same report data.
 */
export function ReportsView({
  budget,
  history,
  changesFrom,
  setChangesFrom,
}: {
  budget: Budget;
  history: BudgetHistory;
  /** The version the Changes report compares with; the latest when null. */
  changesFrom: string | null;
  setChangesFrom(versionId: string): void;
}) {
  const { options: saved, setOptions, landscape, setLandscape } = useReportOptions();
  const [status, setStatus] = useState<{ text: string; error?: true } | null>(null);
  const [busy, setBusy] = useState(false);

  const levels = sortedLevels(budget.settings.coa.levels);
  // Remembered across budgets, so only levels this budget has count.
  const options: ReportOptions = {
    ...saved,
    levels: saved.levels.filter((id) => levels.some((l) => l.id === id)),
  };
  const set = (patch: Partial<ReportOptions>) => {
    setOptions({ ...options, ...patch });
    setStatus(null);
  };
  const toggle = (id: ReportId, on: boolean) =>
    set({ reports: REPORTS.map((r) => r.id).filter((r) => (r === id ? on : options.reports.includes(r))) });
  const toggleLevel = (id: string, on: boolean) =>
    set({ levels: levels.map((l) => l.id).filter((l) => (l === id ? on : options.levels.includes(l))) });

  // The order while a report is being dragged; saved when it's dropped.
  const [draft, setDraft] = useState<ReportId[] | null>(null);
  const [dragging, setDragging] = useState<ReportId | null>(null);
  const order = draft ?? reportOrder(options).map((r) => r.id);
  const moved = (id: ReportId, to: number) => {
    const ids = order.filter((r) => r !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    return ids;
  };
  const endDrag = (save: boolean) => {
    if (save && draft) set({ order: draft });
    setDraft(null);
    setDragging(null);
  };

  const versions = versionsNewestFirst(history.versions);
  const since = versions.find((v) => v.id === changesFrom) ?? versions[0] ?? null;
  const doc = reportsWith(budget, history, options, since);
  const title = budgetTitle(budget);

  const save = async (format: ReportFormat) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.fringe.saveReport(format, doc, title, landscape);
      if (result)
        setStatus(result.ok ? { text: `Saved ${result.file}` } : { text: result.error, error: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Couldn’t save the reports.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.fringe.saveBudgetCsv(budgetCsv(budget), title);
      if (result)
        setStatus(result.ok ? { text: `Saved ${result.file}` } : { text: result.error, error: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Couldn’t save the CSV.', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view reports-view">
      <div className="reports-options">
        <h1>Reports</h1>
        <p className="muted small">
          Printed as <strong>{title}</strong>
          {budget.settings.title ? '' : ' (set a report title in Budget Settings)'}.
        </p>

        <fieldset>
          <legend>Reports</legend>
          <p className="muted small">Drag to change the order they print in.</p>
          <ol className="report-order">
            {order.map((id, i) => {
              const r = REPORTS.find((x) => x.id === id)!;
              return (
                <li
                  key={id}
                  className={dragging === id ? 'dragging' : undefined}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', r.name);
                    setDragging(id);
                    setDraft(order);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dragging !== id) setDraft(moved(dragging, i));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    endDrag(true);
                  }}
                  onDragEnd={() => endDrag(false)}
                  onKeyDown={(e) => {
                    // Alt+↑/↓ moves the focused report, for the keyboard.
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    set({ order: moved(id, i + (e.key === 'ArrowUp' ? -1 : 1)) });
                  }}
                >
                  <span className="drag-grip" aria-hidden="true">
                    ⠿
                  </span>
                  <label className="check" title={`${r.description} Alt+↑/↓ moves it.`}>
                    <input
                      type="checkbox"
                      checked={options.reports.includes(r.id)}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                    />
                    <span>{r.name}</span>
                  </label>
                </li>
              );
            })}
          </ol>
          {options.reports.includes('changes') && (
            <div className="reports-since">
              {since ? (
                <label>
                  <span>Changes since</span>
                  <select
                    className="text-input"
                    value={since.id}
                    onChange={(e) => {
                      setChangesFrom(e.target.value);
                      setStatus(null);
                    }}
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {versionLabel(v)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="muted small">Save a version on the History page to see what changed since.</p>
              )}
            </div>
          )}
          <div className="reports-quick">
            <button
              type="button"
              className="link-btn"
              onClick={() => set({ reports: REPORTS.map((r) => r.id) })}
            >
              All
            </button>
            <button type="button" className="link-btn" onClick={() => set({ reports: [] })}>
              None
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Options</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={options.hideZero}
              onChange={(e) => set({ hideZero: e.target.checked })}
            />
            <span>Leave out what comes to zero</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.lineFringes === 'per-line'}
              onChange={(e) => set({ lineFringes: e.target.checked ? 'per-line' : 'rolled-up' })}
            />
            <span>Detail: fringes on each line</span>
          </label>
          <p className="muted small">
            {options.lineFringes === 'per-line'
              ? 'Each line shows its fringes in a column.'
              : 'Fringes are added up under each account’s lines, one row per fringe.'}
          </p>
          <label className="check">
            <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} />
            <span>Landscape (PDF)</span>
          </label>
        </fieldset>

        {levels.length > 0 && (
          <fieldset>
            <legend>Production levels</legend>
            <p className="muted small">For the Account Summary and Detail. None ticked prints them all.</p>
            {levels.map((l) => (
              <label key={l.id} className="check">
                <input
                  type="checkbox"
                  checked={options.levels.includes(l.id)}
                  onChange={(e) => toggleLevel(l.id, e.target.checked)}
                />
                <span>{l.name}</span>
              </label>
            ))}
          </fieldset>
        )}

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
        <div className="reports-export">
          <button type="button" className="btn" disabled={busy} onClick={() => void exportCsv()}>
            Export CSV…
          </button>
          <span className="muted small">
            Every account’s number, name and total, then the topsheet: fringes, percentages, grand total and
            incentives. For importing into another program.
          </span>
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
            {options.reports.length === 0
              ? 'Choose a report to see it here.'
              : 'Nothing to print in these reports.'}
          </p>
        ) : (
          <ReportPreview doc={doc} landscape={landscape} />
        )}
      </div>
    </section>
  );
}
