import {
  type Budget,
  type BudgetPercentage,
  type BudgetTotals,
  EditError,
  budgetTags,
  type TaxIncentive,
  deleteIncentive,
  deletePercentage,
  movePercentage,
  setIncentive,
  setPercentage,
} from '@fringe/budget-engine';
import { useState } from 'react';
import { NameInput, RowDelete } from './BudgetSettingsView';

/**
 * The budget's percentages, under the topsheet: lines worked out from the budget total, such as
 * Contingency 10%, each leaving out the groups ticked.
 */
export function Percentages(props: {
  budget: Budget;
  totals: BudgetTotals;
  money(v: string): string;
  update(budget: Budget, label: string): void;
}) {
  const { budget, totals, money, update } = props;
  const list = budget.settings.percentages;
  const groups = budgetTags(budget).groups;
  const [error, setError] = useState<string | null>(null);

  /** False when the change is refused (the message shows below the table). */
  const change = (p: BudgetPercentage, patch: Partial<BudgetPercentage>, label: string): boolean => {
    try {
      update(setPercentage(budget, { ...p, ...patch }), label);
      setError(null);
      return true;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setError(e.message);
      return false;
    }
  };
  const add = () => {
    const name = ['Contingency', 'Percentage'].find(
      (n) => !list.some((p) => p.name.toLowerCase() === n.toLowerCase()),
    );
    const final = name ?? `Percentage ${list.length + 1}`;
    update(
      setPercentage(budget, {
        name: final,
        percent: '10',
        excludeGroups: [],
      }),
      `Add ${final}`,
    );
  };

  return (
    <section className="percentages" aria-label="Percentages of the budget">
      <h3>Percentages of the budget</h3>
      <p className="muted small">
        Worked out from the categories&apos; total, leaving out the groups ticked, and added to the grand
        total. Use a minus to take something off, e.g. -5. Tax credits go under Tax incentives. The account
        number is what the line shows under on the topsheet.
      </p>
      {list.length > 0 && (
        <table className="grid settings-table settings-table-wide">
          <thead>
            <tr>
              <th>Account</th>
              <th>Name</th>
              <th className="num">Percent</th>
              <th>Leave out groups</th>
              <th className="num">Worked out on</th>
              <th className="num">Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => {
              const t = totals.percentages.find((x) => x.percentage.id === p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <AccountInput
                      key={p.account ?? ''}
                      value={p.account ?? ''}
                      onCommit={(account) =>
                        change(p, { account }, `${p.name} account ${account || 'cleared'}`)
                      }
                    />
                  </td>
                  <td>
                    <NameInput
                      key={p.name}
                      label="Percentage name"
                      value={p.name}
                      onRename={(name) => {
                        update(setPercentage(budget, { ...p, name }), `Rename ${p.name} to ${name.trim()}`);
                      }}
                    />
                  </td>
                  <td className="num">
                    <PercentInput
                      key={p.percent}
                      value={p.percent}
                      onCommit={(percent) => change(p, { percent }, `${p.name} ${percent}%`)}
                    />
                  </td>
                  <td>
                    {groups.length === 0 ? (
                      <span className="muted small">No groups yet</span>
                    ) : (
                      <div className="group-picks">
                        {groups.map((g) => {
                          const out = p.excludeGroups.includes(g);
                          return (
                            <button
                              key={g}
                              type="button"
                              className="group-pick"
                              aria-pressed={out}
                              title={out ? `${g} is left out` : `Leave out ${g}`}
                              onClick={() =>
                                change(
                                  p,
                                  {
                                    excludeGroups: out
                                      ? p.excludeGroups.filter((x) => x !== g)
                                      : [...p.excludeGroups, g],
                                  },
                                  `${p.name}: ${out ? 'count' : 'leave out'} ${g}`,
                                )
                              }
                            >
                              {g}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="num">{t ? money(t.base) : ''}</td>
                  <td className={t?.amount.startsWith('-') ? 'num neg' : 'num'}>
                    {t ? money(t.amount) : ''}
                  </td>
                  <td className="row-actions">
                    {list.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="row-move"
                          aria-label={`Move ${p.name} up`}
                          disabled={i === 0}
                          onClick={() => update(movePercentage(budget, p.id, -1), `Move ${p.name} up`)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="row-move"
                          aria-label={`Move ${p.name} down`}
                          disabled={i === list.length - 1}
                          onClick={() => update(movePercentage(budget, p.id, 1), `Move ${p.name} down`)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <RowDelete
                      label={`Delete ${p.name}`}
                      onClick={() => update(deletePercentage(budget, p.id), `Delete ${p.name}`)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && <p className="warning">{error}</p>}
      <button type="button" className="btn btn-small" onClick={add}>
        Add a percentage
      </button>
    </section>
  );
}

/** The account number a row shows under on the topsheet; commits on Enter or leaving the box. */
function AccountInput(props: { value: string; onCommit(value: string): boolean | void }) {
  const [draft, setDraft] = useState(props.value);
  const commit = () => {
    // A refused number goes back to the one saved; the message says why.
    if (draft.trim() !== props.value && props.onCommit(draft.trim()) === false) setDraft(props.value);
  };
  return (
    <input
      className="text-input account-input"
      aria-label="Account number"
      placeholder="None"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

/** A percent typed in place; commits on Enter or leaving the box, Esc puts it back. */
function PercentInput(props: { value: string; onCommit(value: string): boolean | void }) {
  const [draft, setDraft] = useState(props.value);
  const commit = () => {
    if (draft.trim() !== props.value && props.onCommit(draft) === false) setDraft(props.value);
  };
  return (
    <span className="percent-input">
      <input
        className="text-input num"
        aria-label="Percent"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.-]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(props.value);
        }}
      />
      %
    </span>
  );
}

/**
 * The budget's tax incentives: credits and rebates worked out on the lines in the groups that
 * qualify, at the program's rate and then the share received (e.g. 80% when sold at 80¢).
 */
export function TaxIncentives(props: {
  budget: Budget;
  totals: BudgetTotals;
  money(v: string): string;
  update(budget: Budget, label: string): void;
}) {
  const { budget, totals, money, update } = props;
  const list = budget.settings.incentives;
  const groups = budgetTags(budget).groups;
  const [error, setError] = useState<string | null>(null);

  /** False when the change is refused (the message shows below the table). */
  const change = (p: TaxIncentive, patch: Partial<TaxIncentive>, label: string): boolean => {
    try {
      update(setIncentive(budget, { ...p, ...patch }), label);
      setError(null);
      return true;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      setError(e.message);
      return false;
    }
  };
  const add = () => {
    let name = 'Tax credit';
    for (let n = 2; list.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++)
      name = `Tax credit ${n}`;
    update(setIncentive(budget, { name, rate: '30', groups: [], realized: '100' }), `Add ${name}`);
  };

  return (
    <section className="percentages" aria-label="Tax incentives">
      <h3>Tax incentives</h3>
      <p className="muted small">
        Tag the lines that qualify with a group (Budget Settings › Groups), then pick those groups here. The
        credit is the qualifying lines, with the fringes ticked, at the rate; &ldquo;Received&rdquo; is the
        share you actually get, e.g. 80 if the credit is sold at 80¢ on the dollar.
      </p>
      {list.length > 0 && (
        <table className="grid settings-table settings-table-wide">
          <thead>
            <tr>
              <th>Account</th>
              <th>Name</th>
              <th className="num">Rate</th>
              <th>Qualifying groups</th>
              <th>Fringes</th>
              <th className="num">Received</th>
              <th className="num">Qualifying spend</th>
              <th className="num">Credit</th>
              <th className="num">Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const t = totals.incentives.find((x) => x.incentive.id === p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <AccountInput
                      key={p.account ?? ''}
                      value={p.account ?? ''}
                      onCommit={(account) =>
                        change(p, { account }, `${p.name} account ${account || 'cleared'}`)
                      }
                    />
                  </td>
                  <td>
                    <NameInput
                      key={p.name}
                      label="Incentive name"
                      value={p.name}
                      onRename={(name) => change(p, { name }, `Rename ${p.name} to ${name.trim()}`)}
                    />
                  </td>
                  <td className="num">
                    <PercentInput
                      key={p.rate}
                      value={p.rate}
                      onCommit={(rate) => change(p, { rate }, `${p.name} rate ${rate}%`)}
                    />
                  </td>
                  <td>
                    {groups.length === 0 ? (
                      <span className="muted small">No groups yet</span>
                    ) : (
                      <div className="group-picks">
                        {groups.map((g) => {
                          const on = p.groups.includes(g);
                          return (
                            <button
                              key={g}
                              type="button"
                              className="group-pick pick-in"
                              aria-pressed={on}
                              title={on ? `${g} qualifies` : `${g} doesn't qualify`}
                              onClick={() =>
                                change(
                                  p,
                                  { groups: on ? p.groups.filter((x) => x !== g) : [...p.groups, g] },
                                  `${p.name}: ${g} ${on ? "doesn't qualify" : 'qualifies'}`,
                                )
                              }
                            >
                              {g}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td>
                    <IncentiveFringes
                      incentive={p}
                      names={fringesOn(budget, p.groups, p.excludeFringes ?? [])}
                      change={(patch, label) => change(p, patch, label)}
                    />
                  </td>
                  <td className="num">
                    <PercentInput
                      key={p.realized}
                      value={p.realized}
                      onCommit={(realized) => change(p, { realized }, `${p.name} received at ${realized}%`)}
                    />
                  </td>
                  <td className="num">{t ? money(t.base) : ''}</td>
                  <td className="num">{t ? money(t.credit) : ''}</td>
                  <td className={t?.amount.startsWith('-') ? 'num neg' : 'num'}>
                    {t ? money(t.amount) : ''}
                  </td>
                  <td className="row-actions">
                    <RowDelete
                      label={`Delete ${p.name}`}
                      onClick={() => update(deleteIncentive(budget, p.id), `Delete ${p.name}`)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && <p className="warning">{error}</p>}
      <button type="button" className="btn btn-small" onClick={add}>
        Add a tax incentive
      </button>
    </section>
  );
}

/** The fringes on lines in these groups, plus any already left out, sorted. */
function fringesOn(budget: Budget, groups: string[], leftOut: string[]): string[] {
  const names = new Set(leftOut);
  const qualifying = new Set(groups);
  for (const c of budget.categories)
    for (const a of c.accounts)
      for (const d of a.details)
        if (d.groups.some((g) => qualifying.has(g))) d.fringes.forEach((f) => names.add(f));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Whether an incentive counts the qualifying lines' fringes, and which; highlighted ones count. */
function IncentiveFringes(props: {
  incentive: TaxIncentive;
  names: string[];
  change(patch: Partial<TaxIncentive>, label: string): void;
}) {
  const { incentive: p, names, change } = props;
  const on = p.includeFringes !== false;
  const out = p.excludeFringes ?? [];
  return (
    <div className="incentive-fringes">
      <label className="check small">
        <input
          type="checkbox"
          checked={on}
          onChange={() =>
            change({ includeFringes: !on }, `${p.name}: fringes ${on ? "don't count" : 'count'}`)
          }
        />
        Include fringes
      </label>
      {on &&
        (names.length === 0 ? (
          <span className="muted small">
            {p.groups.length ? 'No fringes on these lines' : 'Pick groups first'}
          </span>
        ) : (
          <div className="group-picks">
            {names.map((f) => {
              const counts = !out.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  className="group-pick pick-in"
                  aria-pressed={counts}
                  title={counts ? `${f} counts` : `${f} is left out`}
                  onClick={() =>
                    change(
                      { excludeFringes: counts ? [...out, f] : out.filter((x) => x !== f) },
                      `${p.name}: ${f} ${counts ? 'left out' : 'counts'}`,
                    )
                  }
                >
                  {f}
                </button>
              );
            })}
          </div>
        ))}
    </div>
  );
}
