import {
  type Budget,
  type BudgetSettings,
  type CodeField,
  type CurrencyDef,
  type FringeDef,
  type FringePosting,
  type LineTag,
  type ProductionLevel,
  type UnitDef,
  CODE_FIELDS,
  EditError,
  currencyUseCount,
  deleteCurrency,
  missingCurrencies,
  setBudgetCurrency,
  setCurrency,
  addGlobal,
  budgetTags,
  calculateTotals,
  categoryFringeAccount,
  codeList,
  codeUseCount,
  deleteCode,
  deleteGlobal,
  deleteLineTag,
  formatMoney,
  fringeAccountMoves,
  globalUseCount,
  groupTotals,
  newId,
  renameCode,
  renameLineTag,
  resolveGlobals,
  setNumberPatterns,
  setFringeAccountEnding,
  setRounding,
  sortedLevels,
  tagUseCount,
  unitsFromLines,
  updateGlobal,
  updateSettings,
} from '@fringe/budget-engine';
import { useState } from 'react';
import { SlidingHighlight } from '../SlidingHighlight';
import { AssumptionsEditor } from './AssumptionsEditor';
import { Percentages, TaxIncentives } from './Percentages';
import { ColorPick } from './ColorPick';
import { usePref } from './prefs';
import { ThemePicker } from '../theme/ThemePicker';

interface Props {
  budget: Budget;
  /** `label` names the change in history. */
  update(budget: Budget, label?: string): void;
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'coa', label: 'Chart of Accounts' },
  { id: 'units', label: 'Units' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'groups', label: 'Groups' },
  { id: 'fringes', label: 'Fringes' },
  { id: 'globals', label: 'Globals' },
  { id: 'percentages', label: 'Percentages' },
  { id: 'codes', label: 'Codes' },
  { id: 'assumptions', label: 'Assumptions' },
] as const;

const CODE_LABELS: Record<CodeField, string> = {
  set: 'Set',
  location: 'Location',
  in: 'In',
  ff1: 'FF1',
  ff2: 'FF2',
};
type Tab = (typeof TABS)[number]['id'];
const isTab = (v: unknown): v is Tab => TABS.some((t) => t.id === v);

const POSTING_OPTIONS: readonly { value: FringePosting; label: string; help: string }[] = [
  {
    value: 'account',
    label: 'Each account',
    help: 'Fringes show in the Fringes column of the account they come from.',
  },
  {
    value: 'category',
    label: 'One account per category',
    help: 'Each category has a fringe account, e.g. 1199 "Total Fringes" in category 1100.',
  },
  {
    value: 'production-level',
    label: 'One account per production level',
    help: 'Each production level (Above-The-Line, Below-The-Line, …) gets a fringe row on the topsheet.',
  },
  {
    value: 'budget',
    label: 'One account for the whole budget',
    help: 'Every fringe goes on one fringe row at the bottom of the topsheet.',
  },
];

/** Settings that belong to one budget, in tabs: display, chart of accounts, units, groups and fringes. */
export function BudgetSettingsView({ budget, update }: Props) {
  const s = budget.settings;
  const [tab, setTab] = usePref<Tab>('budgetSettingsTab', 'general', isTab);
  const set = <K extends keyof BudgetSettings>(key: K, value: BudgetSettings[K]) =>
    update(updateSettings(budget, { ...s, [key]: value }));
  const setFringe = (i: number, patch: Partial<FringeDef>) =>
    set(
      'fringeDefs',
      s.fringeDefs.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  const rename = (tag: LineTag, from: string, to: string) => update(renameLineTag(budget, tag, from, to));
  const remove = (tag: LineTag, name: string) => {
    const n = tagUseCount(budget, tag, name);
    if (n === 0 || window.confirm(`Delete ${name}? It comes off ${n} line${n === 1 ? '' : 's'}.`)) {
      update(deleteLineTag(budget, tag, name));
    }
  };
  const [numberNote, setNumberNote] = useState<{ text: string; warn: boolean } | null>(null);
  const setNumberPattern = (
    noun: 'Category' | 'Account',
    pattern: Parameters<typeof setNumberPatterns>[1],
  ): boolean => {
    try {
      const { budget: next, left } = setNumberPatterns(budget, pattern);
      const value = Object.values(pattern)[0] ?? null;
      update(next, value ? `${noun} numbers now ${value}` : `${noun} numbers can be anything`);
      setNumberNote(
        left.length === 0
          ? null
          : {
              warn: true,
              text: `${left.length} number${left.length === 1 ? " doesn't" : "s don't"} have the right count of digits and stayed as ${left.length === 1 ? 'it was' : 'they were'}: ${left.slice(0, 8).join(', ')}${left.length > 8 ? '…' : ''}. Change ${left.length === 1 ? 'it' : 'them'} by hand.`,
            },
      );
      return true;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setNumberNote({ warn: true, text: e.message });
      return false;
    }
  };
  const setCoa = (patch: Partial<BudgetSettings['coa']>) => set('coa', { ...s.coa, ...patch });
  const setFringes = (patch: Partial<BudgetSettings['fringes']>) =>
    set('fringes', { ...s.fringes, ...patch });
  const setEnding = (ending: string): boolean => {
    const moves = fringeAccountMoves(budget, ending);
    if (moves.length === 0) {
      setFringes({ categoryAccountSuffix: ending });
      return true;
    }
    const shown = moves.slice(0, 3).map((m) => `${m.number} → ${m.newNumber}`);
    const more = moves.length > 3 ? `, and ${moves.length - 3} more` : '';
    const ok = window.confirm(
      `Renumber the fringe accounts to end in ${ending}? (${shown.join(', ')}${more})`,
    );
    if (!ok) return false;
    try {
      update(setFringeAccountEnding(budget, ending), `Fringe accounts now end in ${ending}`);
      return true;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      window.alert(e.message);
      return false;
    }
  };
  const unposted = s.fringes.posting === 'category' ? calculateTotals(budget).unpostedCategories : [];
  const setLevel = (id: string, patch: Partial<ProductionLevel>) =>
    setCoa({ levels: s.coa.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const setUnit = (i: number, patch: Partial<UnitDef>) =>
    set(
      'units',
      s.units.map((u, j) => (j === i ? { ...u, ...patch } : u)),
    );
  const allLines = budget.categories.flatMap((c) => c.accounts.flatMap((a) => a.details));
  const unitNames = new Set(s.units.map((u) => u.name.toLowerCase()));
  const missingUnits = unitsFromLines(allLines).filter((u) => !unitNames.has(u.name.toLowerCase()));
  const groups = budgetTags(budget).groups;
  const groupSums = new Map(groupTotals(budget).map((t) => [t.group, t]));
  const setGroupColor = (name: string, color: string | null) => {
    const groupColors = { ...s.groupColors };
    if (color) groupColors[name] = color;
    else delete groupColors[name];
    set('groupColors', groupColors);
  };

  const categoryNumbers = budget.categories.map((c) => c.number);
  const accountNumbers = budget.categories.flatMap((c) => c.accounts.map((a) => a.number));

  return (
    <section className="view view-scroll settings-form">
      <h1>Budget Settings</h1>
      <p className="muted">These settings apply to {budget.name} only.</p>

      <div className="settings-tabs" role="tablist">
        <SlidingHighlight selector="[aria-selected='true']" className="tab-slider" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <BudgetNameField
            key={budget.name}
            value={budget.name}
            onCommit={(name) => update({ ...budget, name }, `Renamed to ${name}`)}
          />
          <TitleField
            key={s.title}
            value={s.title}
            name={budget.name}
            onCommit={(title) => update(updateSettings(budget, { ...s, title }), 'Report title')}
          />
          <fieldset>
            <legend>Theme</legend>
            <ThemePicker />
            <p className="muted small">The theme applies to every budget. It&apos;s also in Settings.</p>
          </fieldset>
          <fieldset>
            <legend>Show money as</legend>
            <Radio
              name="precision"
              checked={s.displayPrecision === 'cents'}
              onChange={() => set('displayPrecision', 'cents')}
              label="Dollars and cents"
              help="1,234,567.89"
            />
            <Radio
              name="precision"
              checked={s.displayPrecision === 'dollars'}
              onChange={() => set('displayPrecision', 'dollars')}
              label="Whole dollars"
              help="1,234,568. Rounded for display only; the budget still calculates in cents."
            />
          </fieldset>

          <fieldset>
            <legend>Calculation rounding</legend>
            <Radio
              name="rounding"
              checked={s.rounding === 'per-line'}
              onChange={() => update(setRounding(budget, 'per-line'), 'Round each line to cents')}
              label="Round each line to cents"
              help="Each detail line and fringe amount is rounded, and totals add the rounded amounts."
            />
            <Radio
              name="rounding"
              checked={s.rounding === 'display-only'}
              onChange={() => update(setRounding(budget, 'display-only'), 'Full precision')}
              label="Full precision"
              help="Totals carry every fraction of a cent; only what you see is rounded."
            />
            <p className="muted">
              Changing this works every line and fringe out again. Lines kept as the imported file had them
              (ones that don&apos;t add up) are left alone.
            </p>
          </fieldset>
        </>
      )}
      {tab === 'percentages' && (
        <>
          <Percentages
            budget={budget}
            totals={calculateTotals(budget)}
            money={(v) => formatMoney(v, s.displayPrecision)}
            update={update}
          />
          <TaxIncentives
            budget={budget}
            totals={calculateTotals(budget)}
            money={(v) => formatMoney(v, s.displayPrecision)}
            update={update}
          />
          <fieldset>
            <legend>Show tax incentives</legend>
            <Radio
              name="incentivePlacement"
              checked={s.incentivePlacement === 'net'}
              onChange={() =>
                update(
                  updateSettings(budget, { ...s, incentivePlacement: 'net' }),
                  'Incentives under the grand total',
                )
              }
              label="Under the grand total, with a Net Cost line"
              help="The grand total stays the full cost; the incentives and the net cost after them follow it."
            />
            <Radio
              name="incentivePlacement"
              checked={s.incentivePlacement === 'grand-total'}
              onChange={() =>
                update(
                  updateSettings(budget, { ...s, incentivePlacement: 'grand-total' }),
                  'Incentives in the grand total',
                )
              }
              label="Taken off the grand total"
              help="The incentives come before the grand total, which is then the net cost."
            />
          </fieldset>
        </>
      )}
      {tab === 'assumptions' && (
        <>
          <p className="muted">
            What the budget assumes: shoot days, locations, union agreements, rates. Printed with the reports
            (choose Assumptions in Reports). The AI assistant can write and format these too: ask it to
            &ldquo;draft assumptions for this budget&rdquo;.
          </p>
          <AssumptionsEditor
            value={s.assumptions}
            onChange={(assumptions) => update(updateSettings(budget, { ...s, assumptions }), 'Assumptions')}
          />
        </>
      )}
      {tab === 'coa' && (
        <>
          <div className="field-row">
            <PatternField
              key={`c${s.coa.categoryPattern}`}
              label="Category numbers look like"
              value={s.coa.categoryPattern}
              example={categoryNumbers[0]}
              onCommit={(categoryPattern) => setNumberPattern('Category', { categoryPattern })}
            />
            <PatternField
              key={`a${s.coa.accountPattern}`}
              label="Account numbers look like"
              value={s.coa.accountPattern}
              example={accountNumbers[0]}
              onCommit={(accountPattern) => setNumberPattern('Account', { accountPattern })}
            />
          </div>
          <p className="muted">
            Type a pattern with # for each digit. Anything else, such as a dash, dot or space, appears in
            every number: #### is 1102, ##-## is 11-02, ## ## is 11 02. Changing it renumbers every number
            with the right count of digits, in one step you can undo. Leave it blank to allow any number.
          </p>
          {numberNote && <p className={numberNote.warn ? 'warning' : 'muted'}>{numberNote.text}</p>}

          <h3>Production totals</h3>
          <p className="muted">
            Topsheet subtotals such as Above-The-Line. A category belongs to the total whose starting number
            is the highest at or below its own.
          </p>
          <table className="grid settings-table">
            <thead>
              <tr>
                <th>Name (shown as &ldquo;Total …&rdquo;)</th>
                <th>Starts at category</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {s.coa.levels.map((level) => (
                <tr key={level.id}>
                  <td>
                    <input
                      className="text-input"
                      aria-label="Production total name"
                      value={level.name}
                      onChange={(e) => setLevel(level.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="text-input num-input"
                      aria-label="Starting category number"
                      value={level.from}
                      onChange={(e) => setLevel(level.id, { from: e.target.value.replace(/[^\d .-]/g, '') })}
                    />
                  </td>
                  <td className="row-actions">
                    <RowDelete
                      label={`Remove ${level.name || 'production total'}`}
                      disabled={s.coa.levels.length === 1}
                      onClick={() => setCoa({ levels: s.coa.levels.filter((l) => l.id !== level.id) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions actions-left">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setCoa({ levels: [...s.coa.levels, { id: newId(), name: 'New Total', from: '' }] })
              }
            >
              Add Production Total
            </button>
          </div>
        </>
      )}
      {tab === 'units' && (
        <>
          <p className="muted">
            Units offered as you type in a line&apos;s Units column, with the hours each one stands for (e.g.
            a 45-hour week). On a converted budget, hours may have been worked out from the file; check them.
          </p>
          <table className="grid settings-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Hours</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {s.units.map((u, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="text-input"
                      aria-label="Unit name"
                      value={u.name}
                      onChange={(e) => setUnit(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="text-input num-input"
                      aria-label={`Hours in ${u.name || 'unit'}`}
                      inputMode="decimal"
                      placeholder="—"
                      value={u.hours ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.]/g, '');
                        setUnit(i, { hours: v === '' ? null : v, hoursInferred: false });
                      }}
                    />
                  </td>
                  <td className="row-actions">
                    <RowDelete
                      label={`Remove ${u.name || 'unit'}`}
                      onClick={() =>
                        set(
                          'units',
                          s.units.filter((_, j) => j !== i),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions actions-left">
            <button
              type="button"
              className="btn"
              onClick={() => set('units', [...s.units, { name: '', hours: null }])}
            >
              Add Unit
            </button>
            {missingUnits.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => set('units', [...s.units, ...missingUnits])}
              >
                Add {missingUnits.length} unit{missingUnits.length === 1 ? '' : 's'} used in lines (
                {missingUnits
                  .slice(0, 3)
                  .map((u) => u.name)
                  .join(', ')}
                {missingUnits.length > 3 ? '…' : ''})
              </button>
            )}
          </div>
        </>
      )}
      {tab === 'groups' && (
        <>
          <p className="muted">
            Groups tag lines, e.g. SHOOT or DARK. Tick them on lines in the line details. A line takes the
            colour of its first coloured group. Totals include fringes; a line in two groups counts in both.
          </p>
          {groups.length > 0 && (
            <table className="grid settings-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Colour</th>
                  <th className="num">Lines</th>
                  <th className="num">Fringes</th>
                  <th className="num">Total</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g}>
                    <td>
                      <NameInput label="Group name" value={g} onRename={(to) => rename('groups', g, to)} />
                    </td>
                    <td>
                      <ColorPick
                        label={`Colour for group ${g}`}
                        value={s.groupColors[g] ?? null}
                        onChange={(color) => setGroupColor(g, color)}
                      />
                    </td>
                    <td className="num">{tagUseCount(budget, 'groups', g)}</td>
                    <td className="num">
                      {formatMoney(groupSums.get(g)?.fringe ?? '0', s.displayPrecision)}
                    </td>
                    <td className="num">{formatMoney(groupSums.get(g)?.total ?? '0', s.displayPrecision)}</td>
                    <td className="row-actions">
                      <RowDelete label={`Delete group ${g}`} onClick={() => remove('groups', g)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <AddName noun="group" taken={groups} onAdd={(name) => set('groups', [...s.groups, name])} />
        </>
      )}
      {tab === 'currencies' && <Currencies budget={budget} update={update} />}
      {tab === 'globals' && <Globals budget={budget} update={update} />}
      {tab === 'codes' && (
        <>
          <p className="muted">
            Codes for the Set, Location, In, FF1 and FF2 columns. They&apos;re offered as you type in those
            columns; codes already on lines are listed too.
          </p>
          <div className="code-lists">
            {CODE_FIELDS.map((field) => (
              <CodeList key={field} budget={budget} field={field} update={update} />
            ))}
          </div>
        </>
      )}
      {tab === 'fringes' && (
        <>
          <fieldset>
            <legend>Post fringes to</legend>
            {POSTING_OPTIONS.map((o) => (
              <Radio
                key={o.value}
                name="posting"
                checked={s.fringes.posting === o.value}
                onChange={() => setFringes({ posting: o.value })}
                label={o.label}
                help={o.help}
              />
            ))}
          </fieldset>
          {s.fringes.posting === 'category' && (
            <label className="field">
              <span>Fringe account number ends in</span>
              <EndingInput
                key={s.fringes.categoryAccountSuffix}
                value={s.fringes.categoryAccountSuffix}
                onCommit={setEnding}
              />
              <span className="muted">
                e.g. {s.fringes.categoryAccountSuffix || '99'} →{' '}
                {firstCategoryAccount(budget, s.fringes.categoryAccountSuffix || '99')}
              </span>
              {unposted.length > 0 && (
                <span className="warning">
                  {unposted.length === 1 ? 'Category' : 'Categories'} {unposted.join(', ')}{' '}
                  {unposted.length === 1 ? 'has' : 'have'} fringes but no account ending in{' '}
                  {s.fringes.categoryAccountSuffix}, so {unposted.length === 1 ? 'its' : 'their'} fringes stay
                  on each account.
                </span>
              )}
            </label>
          )}
          {s.fringes.posting === 'production-level' && (
            <div className="field">
              <span>Fringe account number on the topsheet, for each level</span>
              {sortedLevels(s.coa.levels).map((l) => (
                <FringeRowNumber
                  key={l.id}
                  label={`${l.name} Fringes`}
                  value={s.fringes.levelAccounts[l.id] ?? ''}
                  taken={accountNumbers}
                  onChange={(v) => setFringes({ levelAccounts: { ...s.fringes.levelAccounts, [l.id]: v } })}
                />
              ))}
            </div>
          )}
          {s.fringes.posting === 'budget' && (
            <div className="field">
              <span>Fringe account number on the topsheet</span>
              <FringeRowNumber
                label="Total Fringes"
                value={s.fringes.budgetAccount}
                taken={accountNumbers}
                onChange={(v) => setFringes({ budgetAccount: v })}
              />
            </div>
          )}

          <h3>Fringes</h3>
          <p className="muted">
            A cutoff stops a percent fringe once a person&apos;s pay reaches it; lines in one fringe range
            count as one person. On a converted budget, cutoffs may have been worked out from the file&apos;s
            fringe totals; check them.
          </p>
          {s.fringeDefs.length > 0 && (
            <table className="grid settings-table settings-table-wide">
              <thead>
                <tr>
                  <th>Fringe</th>
                  <th>Type</th>
                  <th className="num">Rate</th>
                  <th>Per unit</th>
                  <th className="num">Cutoff</th>
                  <th className="num">Lines</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {s.fringeDefs.map((f, i) => (
                  <tr key={f.name}>
                    <td>
                      <NameInput
                        label="Fringe name"
                        value={f.name}
                        onRename={(to) => rename('fringes', f.name, to)}
                      />
                    </td>
                    <td>
                      <select
                        className="text-input"
                        aria-label={`Type of ${f.name}`}
                        value={f.kind}
                        onChange={(e) =>
                          setFringe(i, { kind: e.target.value === 'flat' ? 'flat' : 'percent' })
                        }
                      >
                        <option value="percent">Percent</option>
                        <option value="flat">Flat</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className="text-input num-input"
                        aria-label={`Rate of ${f.name}`}
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
                          aria-label={`Unit of ${f.name}`}
                          list="fringe-units"
                          placeholder="e.g. Hours"
                          value={f.unit}
                          onChange={(e) => setFringe(i, { unit: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="num">
                      {f.kind === 'percent' && (
                        <>
                          <input
                            className="text-input num-input"
                            aria-label={`Cutoff of ${f.name}`}
                            inputMode="decimal"
                            placeholder="none"
                            value={f.cutoff ?? ''}
                            onChange={(e) => {
                              const v = decimalText(e.target.value);
                              setFringe(i, { cutoff: v === '' ? null : v, cutoffInferred: false });
                            }}
                          />
                        </>
                      )}
                    </td>
                    <td className="num">{tagUseCount(budget, 'fringes', f.name)}</td>
                    <td className="row-actions">
                      <RowDelete
                        label={`Delete fringe ${f.name}`}
                        onClick={() => remove('fringes', f.name)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <datalist id="fringe-units">
            {s.units.map((u) => (
              <option key={u.name} value={u.name} />
            ))}
          </datalist>
          <AddName
            noun="fringe"
            taken={s.fringeDefs.map((f) => f.name)}
            onAdd={(name) =>
              set('fringeDefs', [
                ...s.fringeDefs,
                { name, kind: 'percent', rate: '0', unit: '', cutoff: null, cutoffInferred: false },
              ])
            }
          />
        </>
      )}
    </section>
  );
}

/** One code column's list: rename in place, delete, add. */
function CodeList({ budget, field, update }: { budget: Budget; field: CodeField; update(b: Budget): void }) {
  const codes = codeList(budget, field);
  const label = CODE_LABELS[field];
  const remove = (code: string) => {
    const n = codeUseCount(budget, field, code);
    if (
      n === 0 ||
      window.confirm(`Delete ${label} ${code}? It's cleared from ${n} line${n === 1 ? '' : 's'}.`)
    ) {
      update(deleteCode(budget, field, code));
    }
  };
  return (
    <section className="code-list">
      <h3>{label}</h3>
      {codes.length > 0 ? (
        <table className="grid settings-table">
          <thead>
            <tr>
              <th>Code</th>
              <th className="num">Lines</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code}>
                <td>
                  <NameInput
                    label={`${label} code`}
                    value={code}
                    onRename={(to) => update(renameCode(budget, field, code, to))}
                  />
                </td>
                <td className="num">{codeUseCount(budget, field, code)}</td>
                <td className="row-actions">
                  <RowDelete label={`Delete ${label} ${code}`} onClick={() => remove(code)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">None yet</p>
      )}
      <AddName
        noun="code"
        taken={codes}
        onAdd={(code) =>
          update(
            updateSettings(budget, {
              ...budget.settings,
              codes: { ...budget.settings.codes, [field]: [...budget.settings.codes[field], code] },
            }),
          )
        }
      />
    </section>
  );
}

/**
 * The budget's currency and the others lines can be in, each with what one unit of it is worth in
 * the budget's currency. Totals, fringes and reports convert at these rates.
 */
function Currencies({ budget, update }: { budget: Budget; update(b: Budget, label?: string): void }) {
  const s = budget.settings;
  const [error, setError] = useState<string | null>(null);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setError(e.message);
    }
  };
  // Typed straight in, so a half-typed rate (0.) is kept; it counts as no rate until it's a number.
  const edit = (code: string, patch: Partial<CurrencyDef>) =>
    update(
      updateSettings(budget, {
        ...s,
        currencies: s.currencies.map((c) => (c.code === code ? { ...c, ...patch } : c)),
      }),
    );
  const missing = missingCurrencies(budget).filter((c) => !s.currencies.some((d) => d.code === c));
  return (
    <>
      <p className="muted">
        Type a currency code in a line&apos;s Currency column to budget it in that currency; leave it blank
        for the budget&apos;s own. The line keeps its own numbers, and totals, fringes and reports convert it
        at the rate below. A line in a currency with no rate counts as nothing until you set one.
      </p>
      <label className="field">
        <span>Budget currency</span>
        <NameInput
          label="Budget currency"
          value={s.currency}
          onRename={(to) => update(setBudgetCurrency(budget, to), `Budget currency now ${to.toUpperCase()}`)}
        />
      </label>
      {s.currencies.length > 0 && (
        <table className="grid settings-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Rate</th>
              <th className="num">Lines</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {s.currencies.map((c) => (
              <tr key={c.code}>
                <td>{c.code}</td>
                <td>
                  <input
                    className="text-input"
                    aria-label={`Name of ${c.code}`}
                    placeholder="e.g. Canadian dollar"
                    value={c.name}
                    onChange={(e) => edit(c.code, { name: e.target.value })}
                  />
                </td>
                <td className="num">
                  1 {c.code} ={' '}
                  <input
                    className="text-input num-input"
                    aria-label={`What 1 ${c.code} is worth in ${s.currency}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={c.rate}
                    onChange={(e) => edit(c.code, { rate: decimalText(e.target.value) })}
                  />{' '}
                  {s.currency}
                </td>
                <td className="num">{currencyUseCount(budget, c.code)}</td>
                <td className="row-actions">
                  <RowDelete
                    label={`Delete ${c.code}`}
                    onClick={() => attempt(() => update(deleteCurrency(budget, c.code), `Deleted ${c.code}`))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="warning">{error}</p>}
      <AddName
        noun="currency"
        taken={[s.currency, ...s.currencies.map((c) => c.code)]}
        onAdd={(code) =>
          update(setCurrency(budget, { code, name: '', rate: '' }), `Added ${code.toUpperCase()}`)
        }
      />
      {missing.length > 0 && (
        <div className="actions actions-left">
          <button
            type="button"
            className="btn"
            onClick={() =>
              update(
                missing.reduce((b, code) => setCurrency(b, { code, name: '', rate: '' }), budget),
                `Added ${missing.join(', ')}`,
              )
            }
          >
            Add {missing.length} currenc{missing.length === 1 ? 'y' : 'ies'} used in lines (
            {missing.join(', ')})
          </button>
        </div>
      )}
    </>
  );
}

/** Keeps digits and one decimal point. */
function decimalText(v: string): string {
  const [whole = '', ...rest] = v.replace(/[^\d.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

/** A name edited in place; renames on Enter or leaving the box, and shows why a name is refused. */
export function NameInput(props: { label: string; value: string; onRename(to: string): void }) {
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === props.value) return;
    try {
      props.onRename(draft);
      setError(null);
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setError(e.message);
    }
  };
  return (
    <>
      <input
        className="text-input"
        aria-label={props.label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(props.value);
            setError(null);
          }
        }}
      />
      {error && <span className="warning">{error}</span>}
    </>
  );
}

/** A box and button to add a new fringe or group. */
function AddName(props: { noun: string; taken: readonly string[]; onAdd(name: string): void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = draft.trim();
  const clash = props.taken.includes(name);
  return (
    <form
      className="actions actions-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || clash) return;
        try {
          props.onAdd(name);
        } catch (err) {
          if (!(err instanceof EditError)) throw err;
          setError(err.message);
          return;
        }
        setDraft('');
        setError(null);
      }}
    >
      <input
        className="text-input"
        aria-label={`New ${props.noun} name`}
        placeholder={`New ${props.noun} name`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="btn" disabled={!name || clash}>
        Add {props.noun[0]!.toUpperCase() + props.noun.slice(1)}
      </button>
      {clash && (
        <span className="warning">
          There&apos;s already a {props.noun} called {name}.
        </span>
      )}
      {error && <span className="warning">{error}</span>}
    </form>
  );
}

type GlobalColumn = 'name' | 'value' | 'worksOut' | 'description' | 'lines';
type GlobalSort = { column: GlobalColumn; descending: boolean } | null;

const GLOBAL_COLUMNS: { id: GlobalColumn; title: string; num?: boolean }[] = [
  { id: 'name', title: 'Global' },
  { id: 'value', title: 'Value or formula' },
  { id: 'worksOut', title: 'Works out to', num: true },
  { id: 'description', title: 'Description' },
  { id: 'lines', title: 'Lines', num: true },
];

const isGlobalSort = (v: unknown): v is GlobalSort =>
  v === null ||
  (typeof v === 'object' &&
    GLOBAL_COLUMNS.some((c) => c.id === (v as { column?: unknown }).column) &&
    typeof (v as { descending?: unknown }).descending === 'boolean');

const byText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Globals: named numbers lines use, e.g. SW = 22 shoot weeks. Change one and every line using it
 * follows. A value can be a formula of other globals, e.g. SW+2. Click a heading to sort by it.
 */
function Globals({ budget, update }: { budget: Budget; update(b: Budget, label?: string): void }) {
  const [sort, setSort] = usePref<GlobalSort>('globalsSort', null, isGlobalSort);
  const globals = budget.settings.globals;
  const values = resolveGlobals(globals);
  const uses = new Map(globals.map((g) => [g.name, globalUseCount(budget, g.name)]));
  const change = (name: string, patch: Parameters<typeof updateGlobal>[2], label: string) =>
    update(updateGlobal(budget, name, patch), label);
  const remove = (name: string) => {
    const n = uses.get(name) ?? 0;
    if (
      n === 0 ||
      window.confirm(
        `Delete ${name}? ${n} line${n === 1 ? '' : 's'} keep their numbers but stop following it.`,
      )
    ) {
      update(deleteGlobal(budget, name), `Delete global ${name}`);
    }
  };

  type Global = (typeof globals)[number];
  const rows = [...globals];
  if (sort) {
    const compare = (a: Global, b: Global): number => {
      switch (sort.column) {
        case 'name':
          return byText(a.name, b.name);
        case 'value':
          return byText(a.value, b.value);
        case 'description':
          return byText(a.description, b.description);
        case 'lines':
          return (uses.get(a.name) ?? 0) - (uses.get(b.name) ?? 0);
        case 'worksOut': {
          const va = values.get(a.name);
          const vb = values.get(b.name);
          return va == null || vb == null ? 0 : va.comparedTo(vb);
        }
      }
    };
    const unset = (g: Global) => sort.column === 'worksOut' && values.get(g.name) == null;
    rows.sort((a, b) => {
      // Globals with no value stay at the bottom either way.
      if (unset(a) !== unset(b)) return unset(a) ? 1 : -1;
      const c = compare(a, b);
      return sort.descending ? -c : c;
    });
  }
  // Click once to sort, again to reverse, a third time for the order they were added.
  const sortBy = (column: GlobalColumn) => {
    if (sort?.column !== column) setSort({ column, descending: false });
    else if (!sort.descending) setSort({ column, descending: true });
    else setSort(null);
  };

  return (
    <>
      <p className="muted">
        Named numbers for Amount, X and Rate, e.g. SW = 22 shoot weeks. Type a global (or a formula like SW*5)
        in those columns, and the line follows when the global changes. On a converted budget, values may have
        been worked out from the lines; check them.
      </p>
      <table className="grid settings-table settings-table-wide">
        <thead>
          <tr>
            {GLOBAL_COLUMNS.map((c) => {
              const active = sort?.column === c.id;
              const descending = active && sort.descending;
              return (
                <th
                  key={c.id}
                  className={c.num ? 'num' : undefined}
                  aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    className={active ? 'sort-btn active' : 'sort-btn'}
                    title={
                      !active
                        ? `Sort by ${c.title.toLowerCase()}`
                        : descending
                          ? 'Back to the order they were added'
                          : 'Sort the other way'
                    }
                    onClick={() => sortBy(c.id)}
                  >
                    {c.title}
                    <span className="sort-arrow" aria-hidden="true">
                      {descending ? '▼' : '▲'}
                    </span>
                  </button>
                </th>
              );
            })}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const v = values.get(g.name);
            return (
              <tr key={g.name}>
                <td>
                  <NameInput
                    label="Global name"
                    value={g.name}
                    onRename={(to) => change(g.name, { name: to }, `Rename global ${g.name}`)}
                  />
                </td>
                <td>
                  <NameInput
                    key={g.value}
                    label={`Value of ${g.name}`}
                    value={g.value}
                    onRename={(to) => change(g.name, { value: to }, `Global ${g.name}`)}
                  />
                </td>
                <td className="num">
                  {v == null ? (
                    <span className="warning">not set</span>
                  ) : (
                    formatMoney(v, 'cents').replace(/\.00$/, '')
                  )}
                </td>
                <td>
                  <NameInput
                    key={g.description}
                    label={`Description of ${g.name}`}
                    value={g.description}
                    onRename={(to) => change(g.name, { description: to }, `Global ${g.name}`)}
                  />
                </td>
                <td className="num">{uses.get(g.name)}</td>
                <td className="row-actions">
                  <RowDelete label={`Delete global ${g.name}`} onClick={() => remove(g.name)} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <AddGlobalRow budget={budget} update={update} />
      </table>
    </>
  );
}

/** The last row of the globals table: type a name, value and description, then Add (or Enter). */
function AddGlobalRow({ budget, update }: { budget: Budget; update(b: Budget, label?: string): void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const clash = budget.settings.globals.some((g) => g.name.toLowerCase() === trimmed.toLowerCase());
  const form = 'add-global';
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setError(null);
  };
  const add = () => {
    if (!trimmed || clash) return;
    try {
      let next = addGlobal(budget, { name: trimmed, value: '', description: description.trim() });
      // Setting the value on its own checks a formula works out (and isn't a loop).
      if (value.trim()) next = updateGlobal(next, trimmed, { value: value.trim() });
      update(next, `Add global ${trimmed}`);
    } catch (err) {
      if (!(err instanceof EditError)) throw err;
      setError(err.message);
      return;
    }
    setName('');
    setValue('');
    setDescription('');
    setError(null);
  };
  return (
    <tfoot>
      <tr className="add-row">
        <td>
          <form
            id={form}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          />
          <input
            form={form}
            className="text-input"
            aria-label="New global name"
            placeholder="New global"
            value={name}
            onChange={edit(setName)}
          />
          {clash && <span className="warning">There&apos;s already a global called {trimmed}.</span>}
          {error && <span className="warning">{error}</span>}
        </td>
        <td>
          <input
            form={form}
            className="text-input"
            aria-label="New global value or formula"
            placeholder="Value or formula"
            value={value}
            onChange={edit(setValue)}
          />
        </td>
        <td />
        <td>
          <input
            form={form}
            className="text-input"
            aria-label="New global description"
            placeholder="Description"
            value={description}
            onChange={edit(setDescription)}
          />
        </td>
        <td colSpan={2} className="row-actions">
          <button type="submit" form={form} className="btn btn-small" disabled={!trimmed || clash}>
            Add
          </button>
        </td>
      </tr>
    </tfoot>
  );
}

/** "99" with category 1100 → "1199" (or 11-99, whatever the account is numbered). */
function firstCategoryAccount(budget: Budget, suffix: string): string {
  for (const c of budget.categories) {
    const found = categoryFringeAccount(c, suffix);
    if (found) return found.number;
  }
  const first = budget.categories.find((c) => c.number.length > suffix.length)?.number ?? '1100';
  return first.slice(0, first.length - suffix.length) + suffix;
}

function Radio(props: { name: string; checked: boolean; onChange(): void; label: string; help: string }) {
  return (
    <label className="radio">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} />
      <span>
        {props.label}
        <span className="muted radio-help">{props.help}</span>
      </span>
    </label>
  );
}

/** A number pattern, typed freely and applied on Enter or leaving the field. */
/** The fringe account ending: digits only, applied on Enter or leaving the field (Escape undoes). */
function EndingInput(props: { value: string; onCommit(value: string): boolean }) {
  const [draft, setDraft] = useState(props.value);
  const commit = () => {
    if (draft !== '' && draft !== props.value && !props.onCommit(draft)) setDraft(props.value);
    if (draft === '') setDraft(props.value);
  };
  return (
    <input
      className="text-input num-input"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

/** A topsheet fringe row's account number, warning when an account already has it. */
function FringeRowNumber(props: {
  label: string;
  value: string;
  taken: readonly string[];
  onChange(value: string): void;
}) {
  return (
    <label className="fringe-row-number">
      <input
        className="text-input num-input"
        aria-label={`${props.label} account number`}
        placeholder="e.g. 1999"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.trim())}
      />
      <span>{props.label}</span>
      {props.value !== '' && props.taken.includes(props.value) && (
        <span className="warning">Account {props.value} already exists; pick a number no account uses.</span>
      )}
    </label>
  );
}

function PatternField(props: {
  label: string;
  value: string | null;
  example: string | undefined;
  onCommit(value: string | null): boolean;
}) {
  const [draft, setDraft] = useState(props.value ?? '');
  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== props.value && !props.onCommit(next)) setDraft(props.value ?? '');
  };
  const digits = (props.example ?? '1102').replace(/\D/g, '');
  let i = 0;
  const preview = draft.includes('#') ? draft.replace(/#/g, () => digits[i++] ?? '0') : null;
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        className="text-input"
        value={draft}
        placeholder="Any"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(props.value ?? '');
        }}
      />
      <span className="muted small">{preview ? `e.g. ${preview}` : 'Any number'}</span>
    </label>
  );
}

/** The budget's name, as its tab and Recent show it. Can't be blank. */
function BudgetNameField(props: { value: string; onCommit(name: string): void }) {
  const [draft, setDraft] = useState(props.value);
  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(props.value);
    else if (next !== props.value) props.onCommit(next);
  };
  return (
    <label className="field">
      <span>Budget name</span>
      <input
        className="text-input"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(props.value);
        }}
      />
      <span className="muted small">
        As it shows on its tab and in Recent. You can also double-click the tab to rename it. The project
        folder keeps its name.
      </span>
    </label>
  );
}

/** The title printed at the top of every report page; blank uses the budget's name. */
function TitleField(props: { value: string; name: string; onCommit(title: string): void }) {
  const [draft, setDraft] = useState(props.value);
  const commit = () => {
    const next = draft.trim();
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <label className="field">
      <span>Report title</span>
      <input
        className="text-input"
        value={draft}
        placeholder={props.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(props.value);
        }}
      />
      <span className="muted small">
        Printed at the top of every report page, e.g. &ldquo;Night Shift — Shooting Budget&rdquo;. Blank uses
        the budget&apos;s name.
      </span>
    </label>
  );
}

/** A row's delete button: a quiet bin icon that shows when the row is hovered or focused. */
export function RowDelete(props: { label: string; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="row-delete"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
