import { Fragment, useState } from 'react';
import {
  type BudgetVersion,
  type ChangeDetail,
  type HistoryEntry,
  VersionError,
  budgetTitle,
  compareBudgets,
  currentPath,
  describeChange,
  describeComparison,
  findEntry,
  formatMoney,
  grandTotal,
  nextVersionNumber,
  parentEntry,
  previousVersion,
  saveVersion,
  toDecimal,
  versionBudget,
  versionOfEntries,
  versionsNewestFirst,
} from '@fringe/budget-engine';
import { optionsFor, reportsWith, useReportOptions, versionLabel } from './report-options';
import type { BudgetTab } from './tabs';

interface Props {
  tab: BudgetTab;
  goTo(entryId: string): void;
  /** Opens a copy of the budget as it was at this point (from this version, if one), as a new budget. */
  openFork(entryId: string, version?: string): void;
  saveVersion(version: BudgetVersion): void;
  deleteVersion(versionId: string): void;
  /** Opens Reports with the Changes report, comparing the budget now with this version. */
  showChanges(versionId: string): void;
  /** Clears what the AI filled in for the "Save version" form. */
  clearDraft(): void;
}

/** Entries shown at first; older ones are a click away. */
const PAGE = 100;
/** Details listed for one change before "and N more". */
const DETAIL_LIMIT = 40;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' });

/** A YYYY-MM-DD date as the user reads it, e.g. "3 March 2026". */
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString([], { dateStyle: 'medium' }) : ymd;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dayOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const byAI = (e: HistoryEntry) => e.label.startsWith('AI:');

/** The entry's label, or what it changed when the label says nothing more than "Edit". */
function title(e: HistoryEntry, details: ChangeDetail[]): string {
  const label = e.label.replace(/^AI:\s*/, '');
  const first = details[0];
  if (label !== 'Edit' || !first) return label;
  const what = `${first.what} on ${first.where}`;
  return details.length > 1 ? `${what}, and ${details.length - 1} more` : what;
}

/**
 * Every change to the budget, newest first, saved in its project folder, and its versions: the
 * budget as it was sent out, numbered and noted, with the PDF that went. Nothing is ever dropped;
 * changes undone and then replaced stay here to go back to.
 */
export function HistoryView({
  tab,
  goTo,
  openFork,
  saveVersion: save,
  deleteVersion,
  showChanges,
  clearDraft,
}: Props) {
  const { entries, current } = tab.history;
  const from = tab.budget.forkedFrom;
  const precision = tab.budget.settings.displayPrecision;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shownCount, setShownCount] = useState(PAGE);
  /** The version being edited: 'new' for a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const reportPrefs = useReportOptions();
  // The AI filling in the form opens it.
  const adding = editing === 'new' || Boolean(tab.versionDraft);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };

  const path = currentPath(tab.history);
  const versions = versionsNewestFirst(tab.history.versions);
  const versionsAt = new Map<string, BudgetVersion[]>();
  for (const v of versions) versionsAt.set(v.entryId, [...(versionsAt.get(v.entryId) ?? []), v]);
  /** The version each change first went into. */
  const inVersion = versionOfEntries(tab.history);

  const rows = entries
    .map((e, i) => ({ e, i }))
    .reverse()
    .slice(0, shownCount)
    .map((row, n, all) => ({ ...row, day: dayOf(row.e.at), prev: n > 0 ? all[n - 1]!.e.at : null }));

  return (
    <section className="view view-scroll">
      <h1>History</h1>
      <p className="muted">
        Every change to {tab.budget.name}, by you or by the AI, kept for good. Click a change to see exactly
        what it did. Go back to any point (nothing is lost: later changes stay, even ones you undid and
        replaced), or fork a copy from it into a new budget to try something else.
      </p>
      {from && (
        <p>
          Forked from <strong>{from.budgetName}</strong> on {fullTime(from.at)}.
        </p>
      )}

      <div className="versions">
        <div className="versions-head">
          <h2>Versions</h2>
          {!adding && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              Save version…
            </button>
          )}
        </div>
        {adding && (
          <VersionForm
            tab={tab}
            version={null}
            save={save}
            close={() => {
              setEditing(null);
              if (tab.versionDraft) clearDraft();
            }}
          />
        )}
        {versions.length === 0 && !adding ? (
          <p className="muted small">
            When you send the budget out, save it as a version (v1.0, v1.1, …) with who it went to and a PDF
            of the reports. Later you can go back to it, or see everything that changed since.
          </p>
        ) : (
          <ul className="version-list">
            {versions.map((v) =>
              editing === v.id ? (
                <li key={v.id}>
                  <VersionForm tab={tab} version={v} save={save} close={() => setEditing(null)} />
                </li>
              ) : (
                <VersionCard
                  key={v.id}
                  tab={tab}
                  version={v}
                  showing={entries[current]?.id === v.entryId}
                  goTo={() => goTo(v.entryId)}
                  fork={() => {
                    if (versionBudget(tab.history, v)) openFork(v.entryId, v.number);
                  }}
                  edit={() => setEditing(v.id)}
                  remove={() => {
                    if (
                      window.confirm(
                        `Delete v${v.number}? The budget's history stays; only the version goes.`,
                      )
                    )
                      deleteVersion(v.id);
                  }}
                  showChanges={() => {
                    const { options, setOptions } = reportPrefs;
                    if (!options.reports.includes('changes'))
                      setOptions({ ...options, reports: [...options.reports, 'changes'] });
                    showChanges(v.id);
                  }}
                />
              ),
            )}
          </ul>
        )}
      </div>

      <h2>Changes</h2>
      <ol className="history-list">
        {rows.map(({ e, i, day, prev }) => {
          const before = parentEntry(tab.history, e)?.budget ?? null;
          const details = describeChange(before, e.budget);
          const total = grandTotal(e.budget);
          const delta = before ? toDecimal(total).minus(grandTotal(before)) : null;
          const expanded = open.has(e.id);
          const heading = prev === null || dayOf(prev) !== day;
          const state = i === current ? 'now' : path.has(e.id) ? null : 'undone';
          const tags = versionsAt.get(e.id) ?? [];
          const partOf = tags.length === 0 ? inVersion.get(e.id) : undefined;
          return (
            <Fragment key={e.id}>
              {heading && <li className="history-day">{day}</li>}
              <li className={`history-entry${state ? ` ${state}` : ''}${expanded ? ' expanded' : ''}`}>
                <div className="history-row">
                  <button
                    type="button"
                    className="history-summary"
                    aria-expanded={expanded}
                    disabled={details.length === 0}
                    onClick={() => toggle(e.id)}
                  >
                    <time dateTime={e.at} title={fullTime(e.at)}>
                      {time(e.at)}
                    </time>
                    <span className={byAI(e) ? 'history-who ai' : 'history-who'}>
                      {byAI(e) ? 'AI' : 'You'}
                    </span>
                    <span className="history-label">
                      {title(e, details)}
                      {tags.map((v) => (
                        <span key={v.id} className="version-tag" title={versionLabel(v)}>
                          v{v.number}
                        </span>
                      ))}
                      {partOf && (
                        <span
                          className="version-tag in"
                          title={`This change went into ${versionLabel(partOf)}.`}
                        >
                          v{partOf.number}
                        </span>
                      )}
                      {!partOf && tags.length === 0 && versions.length > 0 && state !== 'undone' && (
                        <span
                          className="version-tag next"
                          title="Not in a saved version yet: it will be in the next one."
                        >
                          Not in a version yet
                        </span>
                      )}
                      {state === 'now' && <span className="history-state"> Showing now</span>}
                      {state === 'undone' && (
                        <span
                          className="history-state"
                          title="Not in the budget as it is now: it was undone, or comes after a point you went back to."
                        >
                          {' '}
                          Not in the budget now
                        </span>
                      )}
                    </span>
                    {delta ? (
                      <span
                        className={`history-delta num ${delta.isZero() ? '' : delta.isNegative() ? 'down' : 'up'}`}
                        title={`Total after: ${formatMoney(total, precision)}`}
                      >
                        {delta.isZero()
                          ? 'Total unchanged'
                          : `${delta.isNegative() ? '−' : '+'}${formatMoney(delta.abs(), precision)}`}
                      </span>
                    ) : (
                      <span className="history-delta num" title="Total">
                        {formatMoney(total, precision)}
                      </span>
                    )}
                    {details.length > 0 && (
                      <span className="history-chevron" aria-hidden="true">
                        ▸
                      </span>
                    )}
                  </button>
                  <span className="history-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={i === current}
                      onClick={() => goTo(e.id)}
                    >
                      Go back to here
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => openFork(e.id)}>
                      Fork from here
                    </button>
                  </span>
                </div>
                {expanded && (
                  <div className="history-details">
                    <table className="history-detail-table">
                      <tbody>
                        {details.slice(0, DETAIL_LIMIT).map((d, n) => (
                          <tr key={n}>
                            <td className="history-where">{d.where}</td>
                            <td>{d.what}</td>
                            <td>
                              {d.from !== undefined && (
                                <>
                                  <span className="history-from">{d.from}</span>
                                  <span className="history-arrow" aria-label="changed to">
                                    {' → '}
                                  </span>
                                  <span className="history-to">{d.to}</span>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {details.length > DETAIL_LIMIT && (
                      <p className="muted small">and {details.length - DETAIL_LIMIT} more changes</p>
                    )}
                    <p className="muted small">
                      {fullTime(e.at)}
                      {delta && (
                        <>
                          {' · '}Total {formatMoney(grandTotal(before!), precision)} →{' '}
                          {formatMoney(total, precision)}
                        </>
                      )}
                    </p>
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
      {entries.length > shownCount && (
        <div className="actions actions-left">
          <button type="button" className="btn" onClick={() => setShownCount(shownCount + PAGE)}>
            Show older changes ({entries.length - shownCount} more)
          </button>
        </div>
      )}
    </section>
  );
}

function VersionCard({
  tab,
  version: v,
  showing,
  goTo,
  fork,
  edit,
  remove,
  showChanges,
}: {
  tab: BudgetTab;
  version: BudgetVersion;
  showing: boolean;
  goTo(): void;
  fork(): void;
  edit(): void;
  remove(): void;
  showChanges(): void;
}) {
  const [missing, setMissing] = useState(false);
  const budget = versionBudget(tab.history, v);
  const sent = [v.sentOn && `Sent ${shortDate(v.sentOn)}`, v.sentTo && `to ${v.sentTo}`]
    .filter(Boolean)
    .join(' ');
  return (
    <li className={`version-card${showing ? ' now' : ''}`}>
      <div className="version-title">
        <strong>v{v.number}</strong>
        {v.name && <span>{v.name}</span>}
        {showing && <span className="history-state">Showing now</span>}
        {budget && (
          <span className="version-total num" title="Grand total at this version">
            {formatMoney(grandTotal(budget), tab.budget.settings.displayPrecision)}
          </span>
        )}
      </div>
      <p className="muted small">
        {sent ? `${sent} · ` : 'Not marked as sent · '}saved {fullTime(v.savedAt)}
      </p>
      {v.notes && <p className="version-notes">{v.notes}</p>}
      {v.changes && (
        <details className="version-changes">
          <summary>What changed</summary>
          <p className="version-notes">{v.changes}</p>
        </details>
      )}
      <div className="version-actions">
        <button type="button" className="btn btn-small" onClick={showChanges}>
          Changes since
        </button>
        {v.pdf && tab.project && (
          <button
            type="button"
            className="btn btn-small"
            title={v.pdf}
            onClick={() =>
              void window.fringe.revealVersionPdf(tab.project!, v.pdf!).then((found) => setMissing(!found))
            }
          >
            Show PDF
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={showing || !budget} onClick={goTo}>
          Go back to here
        </button>
        <button type="button" className="btn btn-small" disabled={!budget} onClick={fork}>
          Fork
        </button>
        <button type="button" className="btn btn-small" onClick={edit}>
          Edit
        </button>
        <button type="button" className="btn btn-small" onClick={remove}>
          Delete
        </button>
      </div>
      {missing && <p className="warning small">The PDF isn’t in the project’s versions folder any more.</p>}
    </li>
  );
}

/** Saves a new version (of the budget showing now) or changes one, optionally with its PDF. */
function VersionForm({
  tab,
  version,
  save,
  close,
}: {
  tab: BudgetTab;
  version: BudgetVersion | null;
  save(version: BudgetVersion): void;
  close(): void;
}) {
  const { history } = tab;
  const { options, landscape } = useReportOptions();
  const ai = version ? null : (tab.versionDraft ?? null);
  const [number, setNumber] = useState(ai?.number ?? version?.number ?? nextVersionNumber(history.versions));
  const [name, setName] = useState(ai?.name ?? version?.name ?? '');
  const [sentOn, setSentOn] = useState(ai?.sentOn ?? version?.sentOn ?? today());
  const [sentTo, setSentTo] = useState(ai?.sentTo ?? version?.sentTo ?? '');
  const [notes, setNotes] = useState(ai?.notes ?? version?.notes ?? '');
  const [changes, setChanges] = useState(ai?.whatChanged ?? version?.changes ?? '');
  // The AI can fill it in again while it's open: only the fields it gives change.
  const [filled, setFilled] = useState(ai?.at ?? null);
  if (ai && ai.at !== filled) {
    setFilled(ai.at);
    if (ai.number !== undefined) setNumber(ai.number);
    if (ai.name !== undefined) setName(ai.name);
    if (ai.sentOn !== undefined) setSentOn(ai.sentOn);
    if (ai.sentTo !== undefined) setSentTo(ai.sentTo);
    if (ai.notes !== undefined) setNotes(ai.notes);
    if (ai.whatChanged !== undefined) setChanges(ai.whatChanged);
  }
  const [pdf, setPdf] = useState(version === null && tab.project !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entryId = version?.entryId ?? history.entries[history.current]!.id;
  const budget = findEntry(history, entryId)?.budget ?? tab.budget;
  // The version before this one, to compare with: for a new one, the latest so far.
  const previous = version
    ? previousVersion(history, version)
    : (versionsNewestFirst(history.versions)[0] ?? null);
  const previousBudget = previous ? versionBudget(history, previous) : null;
  const pdfName = `${budgetTitle(budget)} v${number.trim().replace(/^v/i, '')}`;

  const draft = () => {
    if (!previousBudget) return;
    const text = describeComparison(compareBudgets(previousBudget, budget), budget.settings.displayPrecision);
    setChanges(changes.trim() ? `${changes.trimEnd()}\n\n${text}` : text);
  };

  const submit = async () => {
    setError(null);
    let saved: BudgetVersion;
    try {
      saved = saveVersion(history, {
        ...(version ? { id: version.id } : {}),
        entryId,
        number,
        name,
        sentOn,
        sentTo,
        notes,
        changes,
        pdf: version?.pdf ?? null,
      }).version;
    } catch (e) {
      setError(e instanceof VersionError ? e.message : 'Couldn’t save the version.');
      return;
    }
    if (pdf && tab.project) {
      setBusy(true);
      try {
        const doc = reportsWith(budget, history, optionsFor(budget, options), previous, {
          number: saved.number,
          changes: saved.changes,
        });
        if (doc.sections.length === 0) {
          setError('No reports are chosen to go in the PDF. Choose them on the Reports page.');
          return;
        }
        const result = await window.fringe.saveVersionPdf(tab.project, pdfName, doc, landscape);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        saved = { ...saved, pdf: result.file };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t save the PDF.');
        return;
      } finally {
        setBusy(false);
      }
    }
    save(saved);
    close();
  };

  return (
    <form
      className="version-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{version ? `Edit v${version.number}` : 'Save the budget as it is now as a version'}</h3>
      <div className="version-fields">
        <label>
          <span>Version</span>
          <input
            className="text-input version-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
            autoFocus
          />
        </label>
        {!version && history.versions.length > 0 && (
          <span className="version-suggest muted small">
            <button
              type="button"
              className="link-btn"
              onClick={() => setNumber(nextVersionNumber(history.versions))}
            >
              {nextVersionNumber(history.versions)}
            </button>
            {' or '}
            <button
              type="button"
              className="link-btn"
              onClick={() => setNumber(nextVersionNumber(history.versions, true))}
            >
              {nextVersionNumber(history.versions, true)}
            </button>
          </span>
        )}
        <label className="grow">
          <span>Name</span>
          <input
            className="text-input"
            value={name}
            placeholder="e.g. Studio draft"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>Sent on</span>
          <input
            type="date"
            className="text-input"
            value={sentOn}
            onChange={(e) => setSentOn(e.target.value)}
          />
        </label>
        <label className="grow">
          <span>Sent to</span>
          <input
            className="text-input"
            value={sentTo}
            placeholder="e.g. Studio, completion bond"
            onChange={(e) => setSentTo(e.target.value)}
          />
        </label>
      </div>
      <label className="version-text">
        <span>Notes</span>
        <textarea className="text-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="version-text">
        <span>
          What changed{previous ? ` since v${previous.number}` : ''}
          {previousBudget && (
            <>
              {' · '}
              <button type="button" className="link-btn" onClick={draft}>
                Fill in from the figures
              </button>
            </>
          )}
        </span>
        <textarea
          className="text-input"
          rows={4}
          value={changes}
          placeholder={
            previous
              ? `What’s different from v${previous.number}. Fill it in from the figures, or ask the AI in the side panel to write it.`
              : 'What this version is, e.g. first pass from the script.'
          }
          onChange={(e) => setChanges(e.target.value)}
        />
      </label>
      {tab.project && (
        <label className="check">
          <input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} />
          <span>
            {version?.pdf ? 'Save the PDF again' : 'Save a PDF of the reports'} as “{pdfName}.pdf” in the
            project’s versions folder
            {previous && options.reports.includes('changes')
              ? `, with the changes since v${previous.number}`
              : ''}
          </span>
        </label>
      )}
      {pdf && tab.project && (
        <p className="muted small">The PDF has the reports chosen on the Reports page.</p>
      )}
      {error && (
        <p className="warning small" role="alert">
          {error}
        </p>
      )}
      <div className="actions actions-left">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : version ? 'Save' : 'Save version'}
        </button>
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
