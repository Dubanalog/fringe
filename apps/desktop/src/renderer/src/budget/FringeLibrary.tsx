import {
  type Budget,
  type LibraryFringe,
  addLibraryFringes,
  budgetFringeFor,
  libraryFromBudget,
  mergeIntoLibrary,
} from '@fringe/budget-engine';
import { useEffect, useRef, useState } from 'react';
import { AddName, RowDelete, decimalText } from './BudgetSettingsView';

const today = () => new Date().toLocaleDateString('en-CA');

/** A rate with its unit or cutoff, as one short phrase: "6.2% to 184,500", "7.50 per Hours". */
function rateText(f: {
  kind: 'percent' | 'flat';
  rate: string;
  unit: string;
  cutoff: string | null;
}): string {
  if (f.kind === 'flat') return `${f.rate} per ${f.unit || 'unit'}`;
  return f.cutoff ? `${f.rate}% to ${Number(f.cutoff).toLocaleString()}` : `${f.rate}%`;
}

/** The library, loaded once; `save` writes it and keeps what the main process stored. */
function useLibrary() {
  const [library, setLibrary] = useState<LibraryFringe[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    void window.fringe.fringeLibrary().then(setLibrary, () => setLibrary([]));
    return () => window.clearTimeout(timer.current);
  }, []);
  // Typing changes it on every key, so it's written once the typing stops.
  const save = (next: LibraryFringe[], now = false) => {
    setLibrary(next);
    window.clearTimeout(timer.current);
    // Not while a name is blank or taken twice, mid-edit; the next good change saves.
    const names = next.map((f) => f.name.trim().toLowerCase());
    if (names.some((n) => !n) || new Set(names).size < names.length) return;
    const write = () => void window.fringe.saveFringeLibrary(next);
    if (now) write();
    else timer.current = window.setTimeout(write, 400);
  };
  return [library, save, setLibrary] as const;
}

/**
 * Settings → Fringe Rates: the user's own rates for every budget. Fringe comes with none, since
 * there's no public rate sheet; each rate keeps when it was right and where it came from.
 */
export function FringeLibrarySettings() {
  const [library, save, setLibrary] = useLibrary();
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  if (!library) return null;
  const setFringe = (i: number, patch: Partial<LibraryFringe>) =>
    save(library.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const importFile = async () => {
    const result = await window.fringe.importFringeLibrary();
    if (!result) return;
    if (!result.ok) return setNote({ text: result.error, warn: true });
    setLibrary(result.library);
    const parts = [
      result.added && `${result.added} added`,
      result.replaced && `${result.replaced} replaced`,
    ].filter(Boolean);
    setNote({ text: `Imported: ${parts.join(', ') || 'nothing new'}.`, warn: false });
  };
  const exportFile = async () => {
    const result = await window.fringe.exportFringeLibrary();
    if (result)
      setNote(result.ok ? { text: `Saved ${result.file}`, warn: false } : { text: result.error, warn: true });
  };

  return (
    <>
      <p>
        Your own fringe rates, ready to add to any budget from its Budget Settings → Fringes. Fringe comes
        with none: there&apos;s no public rate sheet, and rates change every year. Save them from a budget you
        trust, type them in from your payroll company&apos;s or union&apos;s sheet, or import a file a
        colleague exported. Adding rates to a budget copies them; changing them here never changes a budget.
      </p>
      {library.length > 0 && (
        <table className="grid settings-table settings-table-wide">
          <thead>
            <tr>
              <th>Fringe</th>
              <th>Type</th>
              <th className="num">Rate</th>
              <th>Per unit</th>
              <th className="num">Cutoff</th>
              <th>As of</th>
              <th>Source</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {library.map((f, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="text-input"
                    aria-label="Library fringe name"
                    value={f.name}
                    onChange={(e) => setFringe(i, { name: e.target.value })}
                    onBlur={() => {
                      const name = f.name.trim();
                      const clash = library.some(
                        (g, j) => j !== i && g.name.toLowerCase() === name.toLowerCase(),
                      );
                      if (!name || clash) {
                        setNote({ text: `Each rate needs its own name.`, warn: true });
                      } else if (name !== f.name) setFringe(i, { name });
                    }}
                  />
                </td>
                <td>
                  <select
                    className="text-input"
                    aria-label={`Type of library ${f.name}`}
                    value={f.kind}
                    onChange={(e) =>
                      e.target.value === 'flat'
                        ? setFringe(i, { kind: 'flat', cutoff: null })
                        : setFringe(i, { kind: 'percent', unit: '' })
                    }
                  >
                    <option value="percent">Percent</option>
                    <option value="flat">Flat</option>
                  </select>
                </td>
                <td className="num">
                  <input
                    className="text-input num-input"
                    aria-label={`Library rate of ${f.name}`}
                    inputMode="decimal"
                    value={f.rate}
                    onChange={(e) => setFringe(i, { rate: decimalText(e.target.value) || '0' })}
                  />
                  {f.kind === 'percent' ? ' %' : ''}
                </td>
                <td>
                  {f.kind === 'flat' && (
                    <input
                      className="text-input"
                      aria-label={`Library unit of ${f.name}`}
                      placeholder="e.g. Hours"
                      value={f.unit}
                      onChange={(e) => setFringe(i, { unit: e.target.value })}
                    />
                  )}
                </td>
                <td className="num">
                  {f.kind === 'percent' && (
                    <input
                      className="text-input num-input"
                      aria-label={`Library cutoff of ${f.name}`}
                      inputMode="decimal"
                      placeholder="none"
                      value={f.cutoff ?? ''}
                      onChange={(e) => {
                        const v = decimalText(e.target.value);
                        setFringe(i, { cutoff: v === '' ? null : v });
                      }}
                    />
                  )}
                </td>
                <td>
                  <input
                    className="text-input"
                    type="date"
                    aria-label={`${f.name} rate as of`}
                    value={f.asOf}
                    onChange={(e) => setFringe(i, { asOf: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="text-input"
                    aria-label={`Source of ${f.name}`}
                    placeholder="e.g. Payroll company, 2026"
                    value={f.note}
                    onChange={(e) => setFringe(i, { note: e.target.value })}
                  />
                </td>
                <td className="row-actions">
                  <RowDelete
                    label={`Delete library fringe ${f.name}`}
                    onClick={() =>
                      save(
                        library.filter((_, j) => j !== i),
                        true,
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddName
        noun="rate"
        taken={library.map((f) => f.name)}
        onAdd={(name) =>
          save(
            [
              ...library,
              { name, kind: 'percent', rate: '0', unit: '', cutoff: null, asOf: today(), note: '' },
            ],
            true,
          )
        }
      />
      <div className="actions actions-left">
        <button type="button" className="btn" onClick={() => void importFile()}>
          Import Rates…
        </button>
        <button
          type="button"
          className="btn"
          disabled={library.length === 0}
          onClick={() => void exportFile()}
        >
          Export Rates…
        </button>
        {note && <span className={note.warn ? 'warning' : 'muted'}>{note.text}</span>}
      </div>
    </>
  );
}

/** Budget Settings → Fringes: copy rates in from the library, or save this budget's rates to it. */
export function FringeLibraryPicker({
  budget,
  update,
}: {
  budget: Budget;
  update(b: Budget, label?: string): void;
}) {
  const [library, save] = useLibrary();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  if (!library) return null;

  const saveBudget = () => {
    const incoming = libraryFromBudget(budget, today());
    const { library: next, added, replaced } = mergeIntoLibrary(library, incoming);
    if (replaced > 0) {
      const names = incoming.filter((f) =>
        library.some((g) => g.name.toLowerCase() === f.name.toLowerCase()),
      );
      const ok = window.confirm(
        `Replace ${names.map((f) => f.name).join(', ')} in the library with this budget's rates?`,
      );
      if (!ok) return;
    }
    save(next, true);
    setNote(
      `Saved to the library: ${[added && `${added} added`, replaced && `${replaced} replaced`].filter(Boolean).join(', ')}.`,
    );
  };
  const add = () => {
    const picks = library.filter((f) => picked.has(f.name));
    const n = picks.length;
    update(addLibraryFringes(budget, picks), `Added ${n} fringe${n === 1 ? '' : 's'} from the library`);
    setOpen(false);
    setPicked(new Set());
    setNote(null);
  };
  const toggle = (name: string) => {
    const next = new Set(picked);
    if (!next.delete(name)) next.add(name);
    setPicked(next);
  };

  return (
    <>
      <div className="actions actions-left">
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          Add from Library…
        </button>
        <button
          type="button"
          className="btn"
          disabled={budget.settings.fringeDefs.length === 0}
          onClick={saveBudget}
        >
          Save These to Library
        </button>
        {note && <span className="muted">{note}</span>}
      </div>
      {open &&
        (library.length === 0 ? (
          <p className="muted">
            The library is empty. Save this budget&apos;s rates to it, or set rates up in Settings → Fringe
            Rates.
          </p>
        ) : (
          <>
            <table className="grid settings-table settings-table-wide" aria-label="Fringe rate library">
              <thead>
                <tr>
                  <th aria-label="Add" />
                  <th>Fringe</th>
                  <th className="num">Rate</th>
                  <th>As of</th>
                  <th>Source</th>
                  <th>In this budget</th>
                </tr>
              </thead>
              <tbody>
                {library.map((f) => {
                  const mine = budgetFringeFor(budget, f);
                  return (
                    <tr key={f.name}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Add ${f.name}`}
                          checked={picked.has(f.name)}
                          onChange={() => toggle(f.name)}
                        />
                      </td>
                      <td>{f.name}</td>
                      <td className="num">{rateText(f)}</td>
                      <td>{f.asOf && new Date(`${f.asOf}T00:00`).toLocaleDateString()}</td>
                      <td>{f.note}</td>
                      <td className={mine && rateText(mine) !== rateText(f) ? 'warning' : 'muted'}>
                        {!mine ? '' : rateText(mine) === rateText(f) ? 'Same' : `Replaces ${rateText(mine)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="actions actions-left">
              <button type="button" className="btn btn-primary" disabled={picked.size === 0} onClick={add}>
                Add {picked.size || ''} to Budget
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        ))}
    </>
  );
}
