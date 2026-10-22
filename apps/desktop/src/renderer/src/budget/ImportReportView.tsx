import { type Budget, formatMoney, formatRate, importReport } from '@fringe/budget-engine';

interface Props {
  budget: Budget;
  openAccount(categoryId: string, accountId: string): void;
}

/**
 * How a budget converted from another program's file compares with the figures the AI recorded from
 * it (record_file_figures): where it doesn't come to the file's totals, with the likely reason, and
 * what was worked out that the file doesn't say. Recalculated as the budget changes, so fixing a range
 * or setting a cutoff shows straight away.
 */
export function ImportReportView({ budget, openAccount }: Props) {
  // The React Compiler memoizes this on the budget.
  const r = importReport(budget);
  const precision = budget.settings.displayPrecision;
  const money = (v: string) => formatMoney(v, precision);
  const difference = Number(r.calculatedTotal) - Number(r.importedTotal);
  const matched = r.accounts - r.mismatches.length - r.rounding;

  return (
    <section className="view view-scroll">
      <h1>Import Report</h1>
      <p className="muted">
        How this budget compares with {budget.source?.fileName}, the file it was converted from, and what was
        worked out that the file doesn&apos;t say. Click an account to go to it; this report updates as you
        fix things.
      </p>

      <dl className="about">
        <dt>Total in the file</dt>
        <dd>{money(r.importedTotal)}</dd>
        <dt>Total here</dt>
        <dd>
          {money(r.calculatedTotal)}
          {Math.abs(difference) >= 0.005 && (
            <span className="muted"> ({money((difference > 0 ? '+' : '') + difference.toFixed(2))})</span>
          )}
        </dd>
        <dt>Accounts</dt>
        <dd>
          {matched} of {r.accounts} match
          {r.rounding > 0 && `, ${r.rounding} within a dollar (rounding)`}
          {r.mismatches.length > 0 && `, ${r.mismatches.length} don't`}
        </dd>
      </dl>

      <h2>Still doesn&apos;t match</h2>
      {r.mismatches.length === 0 && r.unknownFringes.length === 0 ? (
        <p>Everything matches the file.</p>
      ) : (
        <>
          {r.mismatches.length > 0 && (
            <table className="grid settings-table report-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">File</th>
                  <th className="num">Here</th>
                  <th className="num">Difference</th>
                  <th>Likely reason</th>
                </tr>
              </thead>
              <tbody>
                {r.mismatches.map((m) => (
                  <tr key={m.accountId}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => openAccount(m.categoryId, m.accountId)}
                      >
                        {m.number} {m.description}
                      </button>
                    </td>
                    <td className="num">{money(m.imported)}</td>
                    <td className="num">{money(m.calculated)}</td>
                    <td className="num">{money(m.difference)}</td>
                    <td>
                      {m.reasons.map((reason) => (
                        <div key={reason}>{reason}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.unknownFringes.length > 0 && (
            <>
              <h3>Fringes that can&apos;t be worked out (counted as zero)</h3>
              <ul>
                {r.unknownFringes.map((u, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => openAccount(u.categoryId, u.accountId)}
                    >
                      {u.number}
                    </button>{' '}
                    {u.line}: {u.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h2>Worked out</h2>
      <ul>
        <li>
          {r.globals.length} global value{r.globals.length === 1 ? '' : 's'}, placed in {r.linesWithGlobals}{' '}
          line{r.linesWithGlobals === 1 ? '' : 's'}.
          {r.globalsMissing.length > 0 && (
            <> Still without a value: {r.globalsMissing.join(', ')}. Set them in Budget Settings → Globals.</>
          )}
        </li>
        <li>
          {r.ranges} fringe range{r.ranges === 1 ? '' : 's'} (lines sharing one person&apos;s cutoffs).
        </li>
        {r.cutoffs.length > 0 && (
          <li>
            Cutoffs:{' '}
            {r.cutoffs.map((c, i) => (
              <span key={c.name}>
                {i > 0 && ', '}
                {c.name} at {money(c.cutoff)}
              </span>
            ))}
            .
          </li>
        )}
        {r.unitHours.length > 0 && (
          <li>
            Hours per unit:{' '}
            {r.unitHours.map((u, i) => (
              <span key={u.name}>
                {i > 0 && ', '}
                {u.name} = {formatRate(u.hours).replace(/\.?0+$/, '')} hours
              </span>
            ))}
            .
          </li>
        )}
      </ul>
      <p className="muted">
        Cutoffs and hours are in Budget Settings. Change them there if they&apos;re wrong, or ask the AI.
      </p>
    </section>
  );
}
