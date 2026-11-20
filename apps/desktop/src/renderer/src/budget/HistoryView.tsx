import { Fragment, useEffect, useRef, useState } from 'react';
import {
  type BudgetVersion,
  type ChangeDetail,
  type HistoryEntry,
  VersionError,
  activeBranch,
  branchName,
  compareBudgets,
  currentPath,
  describeChange,
  describeComparison,
  findBranch,
  findEntry,
  formatMoney,
  grandTotal,
  isEditable,
  nextVersionNumber,
  parentEntry,
  previousVersion,
  saveVersion,
  toDecimal,
  versionBudget,
  versionOfEntries,
  versionsNewestFirst,
  versionFileName,
  versionsOn,
} from '@fringe/budget-engine';
import { BranchNamer, BranchTreeView } from './BranchTreeView';
import { withVersions } from './history-timeline';
import { optionsFor, reportsWith, useOpenComparison, useReportOptions } from './report-options';
import type { BudgetTab } from './tabs';

interface Props {
  tab: BudgetTab;
  /** Shows a point: a branch's end to work on, or an earlier point to look at. */
  open(point: { branchId: string; entryId: string; end: boolean }): void;
  /** Starts a branch (the name already checked) from a saved version. */
  startBranch(name: string, fromEntryId: string): void;
  renameBranch(branchId: string, name: string): void;
  setNotPicked(branchId: string, notPicked: boolean): void;
  /** Opens a copy of the budget as it was at this point (from this version, if one), as a new budget. */
  copyToNew(entryId: string, version?: string, branchId?: string): void;
  saveVersion(version: BudgetVersion): void;
  deleteVersion(versionId: string): void;
  /** Opens Reports on the Comparison report: what's showing against this version (null: the one before). */
  showComparison(from: string | null): void;
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
 * The budget's versions and branches as a tree, and below it every change on the branch showing,
 * newest first. Nothing is ever dropped: changes undone and then replaced stay here.
 */
export function HistoryView({
  tab,
  open: openPoint,
  startBranch,
  renameBranch,
  setNotPicked,
  copyToNew,
  saveVersion: save,
  deleteVersion,
  showComparison,
  clearDraft,
}: Props) {
  const { history } = tab;
  const { entries, current } = history;
  const from = tab.budget.forkedFrom;
  const precision = tab.budget.settings.displayPrecision;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  /** Versions are shown open in the list; these were closed. */
  const [closedVersions, setClosedVersions] = useState<ReadonlySet<string>>(new Set());
  const [shownCount, setShownCount] = useState(PAGE);
  /** The version being edited: 'new' for a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The new version being saved is for starting a branch from. */
  const [thenBranch, setThenBranch] = useState(false);
  /** The version just saved for a branch, waiting for the branch's name. */
  const [branchFrom, setBranchFrom] = useState<{ entryId: string; label: string } | null>(null);
  const openComparison = useOpenComparison(showComparison);
  const editable = isEditable(history);
  // The AI filling in the form opens it.
  const adding = editing === 'new' || Boolean(tab.versionDraft);
  const branchTitle = branchName(activeBranch(history), tab.budget.name);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };

  const path = currentPath(history);
  const versions = versionsOn(history);
  const versionsAt = new Map<string, BudgetVersion[]>();
  for (const v of history.versions) versionsAt.set(v.entryId, [...(versionsAt.get(v.entryId) ?? []), v]);
  /** The version each change first went into. */
  const inVersion = versionOfEntries(history);
  const editingVersion = history.versions.find((v) => v.id === editing) ?? null;

  // The changes on the branch showing; where it started from is on the tree.
  const mine = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.branch === history.branch);
  const shown = mine.reverse().slice(0, shownCount);
  // Each version saved on this branch has a row of its own, where it was saved.
  const rows = withVersions(
    shown,
    versions,
    (id) => findEntry(history, id)?.at,
    shown.length === mine.length,
  ).map((item, n, all) => ({ item, day: dayOf(item.at), prev: n > 0 ? all[n - 1]!.at : null }));

  return (
    <section className="view view-scroll">
      <h1>Versions</h1>
      <p className="muted">
        Each branch of {tab.budget.name} has its own row, with the versions saved on it and its latest point,
        where work goes on. Click a point to open it, compare it, or start a branch from it. Click a
        branch&rsquo;s name to rename it or mark it not picked. Nothing is ever deleted.
      </p>
      {from && (
        <p>
          Copied from <strong>{from.budgetName}</strong> on {fullTime(from.at)}.
        </p>
      )}

      <div className="versions">
        <div className="versions-head">
          <h2>Branches</h2>
          {/* Hidden while a form is open: editing a saved version's details doesn't save a new one. */}
          {!adding && !editingVersion && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!editable}
              title={editable ? undefined : 'Open the latest point of a branch to save a version of it.'}
              onClick={() => setEditing('new')}
            >
              Save version…
            </button>
          )}
        </div>
        {adding && (
          <VersionForm
            tab={tab}
            version={null}
            thenBranch={thenBranch}
            save={(v) => {
              save(v);
              if (thenBranch) setBranchFrom({ entryId: v.entryId, label: `${branchTitle} v${v.number}` });
            }}
            close={() => {
              setEditing(null);
              setThenBranch(false);
              if (tab.versionDraft) clearDraft();
            }}
          />
        )}
        {branchFrom && (
          <BranchNamer
            history={history}
            from={branchFrom.label}
            close={() => setBranchFrom(null)}
            create={(name) => {
              startBranch(name, branchFrom.entryId);
              setBranchFrom(null);
            }}
          />
        )}
        {editingVersion && (
          <VersionForm tab={tab} version={editingVersion} save={save} close={() => setEditing(null)} />
        )}
        {history.versions.length === 0 && history.branches.length === 1 && !adding && (
          <p className="muted small">
            When you send the budget out, save it as a version (v1.0, v1.1, …) with who it went to and a PDF
            of the reports. Later you can open it again, see everything that changed since, or start a branch
            from it to try something else.
          </p>
        )}
        <BranchTreeView
          tab={tab}
          open={openPoint}
          startBranch={startBranch}
          saveThenBranch={(branchId) => {
            const b = findBranch(history, branchId);
            if (!b) return;
            if (!(history.branch === branchId && editable)) {
              openPoint({ branchId, entryId: b.head, end: true });
            }
            setBranchFrom(null);
            setThenBranch(true);
            setEditing('new');
          }}
          renameBranch={renameBranch}
          setNotPicked={setNotPicked}
          showComparison={openComparison}
          editVersion={(id) => setEditing(id)}
          deleteVersion={(v) => {
            if (window.confirm(`Delete v${v.number}? The budget's history stays; only the version goes.`))
              deleteVersion(v.id);
          }}
          copyToNew={copyToNew}
        />
      </div>

      <h2>Changes on {branchTitle}</h2>
      <ol className="history-list">
        {rows.map(({ item, day, prev }) => {
          const heading = prev === null || dayOf(prev) !== day;
          if (item.kind === 'version') {
            const v = item.version;
            const shut = closedVersions.has(v.id);
            return (
              <Fragment key={v.id}>
                {heading && <li className="history-day">{day}</li>}
                <VersionRow
                  tab={tab}
                  version={v}
                  expanded={!shut}
                  toggle={() => {
                    const next = new Set(closedVersions);
                    if (!next.delete(v.id)) next.add(v.id);
                    setClosedVersions(next);
                  }}
                  edit={() => setEditing(v.id)}
                />
              </Fragment>
            );
          }
          const { e, i } = item;
          const before = parentEntry(tab.history, e)?.budget ?? null;
          const details = describeChange(before, e.budget);
          const total = grandTotal(e.budget);
          const delta = before ? toDecimal(total).minus(grandTotal(before)) : null;
          const expanded = open.has(e.id);
          const state = i === current ? 'now' : path.has(e.id) ? null : 'undone';
          // Each version has a row above the changes that went into it, so only changes in none are marked.
          const inAVersion = (versionsAt.get(e.id)?.length ?? 0) > 0 || inVersion.has(e.id);
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
                      {!inAVersion && versions.length > 0 && state !== 'undone' && (
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
                          title="Not in the budget showing: it was undone, or comes after the point showing."
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
      {mine.length > shownCount && (
        <div className="actions actions-left">
          <button type="button" className="btn" onClick={() => setShownCount(shownCount + PAGE)}>
            Show older changes ({mine.length - shownCount} more)
          </button>
        </div>
      )}
    </section>
  );
}

/** A date typed as YYYY-MM-DD, e.g. "Nov 20" (with the year when it isn't this year). */
function sentDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A saved version in the list of changes: its details, open to read without editing. */
function VersionRow({
  tab,
  version: v,
  expanded,
  toggle,
  edit,
}: {
  tab: BudgetTab;
  version: BudgetVersion;
  expanded: boolean;
  toggle(): void;
  edit(): void;
}) {
  const budget = versionBudget(tab.history, v);
  const total = budget ? grandTotal(budget) : null;
  const before = previousVersion(tab.history, v);
  const sent = v.sentOn
    ? `Sent ${sentDate(v.sentOn)}${v.sentTo ? ` to ${v.sentTo}` : ''}`
    : v.sentTo
      ? `To ${v.sentTo}`
      : 'Not sent';
  return (
    <li className={`history-entry history-version${expanded ? ' expanded' : ''}`}>
      <div className="history-row">
        <button type="button" className="history-summary" aria-expanded={expanded} onClick={toggle}>
          <time dateTime={v.savedAt} title={`Created ${fullTime(v.savedAt)}`}>
            {time(v.savedAt)}
          </time>
          <span className="version-tag">v{v.number}</span>
          <span className="history-label">
            {v.name || `Version ${v.number}`}
            <span className="history-state"> {sent}</span>
          </span>
          {total && (
            <span className="history-delta num" title="Total">
              {formatMoney(total, budget!.settings.displayPrecision)}
            </span>
          )}
          <span className="history-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      </div>
      {expanded && (
        <div className="history-details version-details">
          <dl>
            {v.sentOn && (
              <>
                <dt>Sent on</dt>
                <dd>{sentDate(v.sentOn)}</dd>
              </>
            )}
            {v.sentTo && (
              <>
                <dt>Sent to</dt>
                <dd>{v.sentTo}</dd>
              </>
            )}
            {v.notes.trim() && (
              <>
                <dt>Notes</dt>
                <dd>{v.notes}</dd>
              </>
            )}
            <dt>{before ? `What changed since v${before.number}` : 'What changed'}</dt>
            <dd>{v.changes.trim() || <span className="muted">Not written. Edit details to add it.</span>}</dd>
          </dl>
          <div className="version-details-actions">
            <span className="muted small">Created {fullTime(v.savedAt)}</span>
            <button type="button" className="btn btn-small" onClick={edit}>
              Edit details…
            </button>
            {v.pdf && tab.project && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void window.fringe.revealVersionPdf(tab.project!, v.pdf!)}
              >
                Show PDF
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Saves a new version (of the budget showing now) or changes one, optionally with its PDF. */
function VersionForm({
  tab,
  version,
  thenBranch = false,
  save,
  close,
}: {
  tab: BudgetTab;
  version: BudgetVersion | null;
  /** Saved to start a branch from: the branch's name is asked for next. */
  thenBranch?: boolean;
  save(version: BudgetVersion): void;
  close(): void;
}) {
  const { history } = tab;
  const mine = versionsOn(history, version?.branch);
  const { options, landscape } = useReportOptions();
  const ai = version ? null : (tab.versionDraft ?? null);
  const [number, setNumber] = useState(ai?.number ?? version?.number ?? nextVersionNumber(mine));
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
  // Opened from a version far down the list, the form is brought into view.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // In braces: scrollIntoView can return a promise, which React would take for a cleanup function.
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [version?.id]);

  const entryId = version?.entryId ?? history.entries[history.current]!.id;
  const budget = findEntry(history, entryId)?.budget ?? tab.budget;
  // The version before this one, to compare with: for a new one, the latest so far.
  const previous = version ? previousVersion(history, version) : (versionsNewestFirst(mine)[0] ?? null);
  const previousBudget = previous ? versionBudget(history, previous) : null;
  const pdfName = versionFileName(budget, findBranch(history, version?.branch ?? history.branch), number);

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
      ref={formRef}
      className="version-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>
        {version
          ? `Edit v${version.number}`
          : thenBranch
            ? 'Save the budget as it is now as a version, then start a branch from it'
            : 'Save the budget as it is now as a version'}
      </h3>
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
        {!version && mine.length > 0 && (
          <span className="version-suggest muted small">
            <button type="button" className="link-btn" onClick={() => setNumber(nextVersionNumber(mine))}>
              {nextVersionNumber(mine)}
            </button>
            {' or '}
            <button
              type="button"
              className="link-btn"
              onClick={() => setNumber(nextVersionNumber(mine, true))}
            >
              {nextVersionNumber(mine, true)}
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
              ? `, with the comparison to v${previous.number}`
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
          {busy
            ? 'Saving…'
            : version
              ? 'Save'
              : thenBranch
                ? 'Save version, then name the branch'
                : 'Save version'}
        </button>
        <button type="button" className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
