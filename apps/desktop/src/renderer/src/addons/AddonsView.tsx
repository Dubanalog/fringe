import { useState } from 'react';
import type { AddonInfo } from '../../../shared/ipc';

/** Ideas to start from; each puts a message in the AI panel for the user to change and send. */
const IDEAS: readonly { name: string; ask: string }[] = [
  {
    name: 'Cash Flow',
    ask: 'Please build me a Cash Flow add-on: spread each account’s total over the production weeks (prep, shoot, wrap, post), with a weekly and monthly table and a PDF/Excel report.',
  },
  {
    name: 'Hiring Plan',
    ask: 'Please build me a Hiring Plan add-on: for each labor line, the start and end week and headcount, with a week-by-week crew count.',
  },
  {
    name: 'Deal Memos',
    ask: 'Please build me a Deal Memos add-on: track each crew deal (name, position, rate, status, notes) against its budget line, and flag deals over budget.',
  },
  {
    name: 'Spend Chart',
    ask: 'Please build me a Spend Chart add-on: a chart of the budget by category and by production level, with the largest accounts.',
  },
];

/** Add-ons: what's installed, and building more with Claude. */
export function AddonsView({
  addons,
  open,
  build,
}: {
  addons: AddonInfo[];
  open(id: string): void;
  /** Opens the AI panel with `text` ready to send. */
  build(text: string): void;
}) {
  const [status, setStatus] = useState<{ text: string; error?: true } | null>(null);

  const addFile = async () => {
    setStatus(null);
    const result = await window.fringe.addAddonFile();
    if (!result) return;
    if (result.ok) {
      setStatus({ text: `Added ${result.addon.name}.` });
      open(result.addon.id);
    } else setStatus({ text: result.error, error: true });
  };

  const remove = async (addon: AddonInfo) => {
    if (!window.confirm(`Remove ${addon.name}? It goes to the trash. What it saved in budgets stays there.`))
      return;
    await window.fringe.removeAddon(addon.id);
    setStatus({ text: `Removed ${addon.name}.` });
  };

  return (
    <section className="view view-scroll addons-view">
      <h1>Add-ons</h1>
      <p className="muted">
        Pages Claude builds for you on top of Fringe, like a cash flow or a deal-memo tracker. They work on
        every budget; what each keeps for a budget is saved in that budget, with undo.
      </p>

      <h2>Build one with Claude</h2>
      <p>Say what you need in the AI panel, or start from one of these:</p>
      <div className="addon-ideas">
        {IDEAS.map((idea) => (
          <button key={idea.name} type="button" className="btn" onClick={() => build(idea.ask)}>
            {idea.name}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => build('Please build me an add-on that ')}
        >
          Something else…
        </button>
      </div>

      <h2>Your add-ons</h2>
      {addons.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="addon-list">
          {addons.map((a) => (
            <li key={a.id}>
              <div className="addon-info">
                <button type="button" className="link-btn addon-name" onClick={() => open(a.id)}>
                  {a.name}
                </button>
                {a.description && <span>{a.description}</span>}
                <span className="muted">
                  Version {a.version}
                  {a.updated && `, ${new Date(a.updated).toLocaleDateString()}`}
                </span>
              </div>
              <div className="addon-actions">
                <button type="button" className="btn btn-small" onClick={() => open(a.id)}>
                  Open
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => build(`Please change the ${a.name} add-on (id ${a.id}) so that `)}
                >
                  Change with Claude
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  onClick={() => void window.fringe.revealAddon(a.id)}
                >
                  Show file
                </button>
                <button type="button" className="btn btn-small btn-quiet" onClick={() => void remove(a)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="actions-left">
        <button type="button" className="btn" onClick={() => void addFile()}>
          Add from file…
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void window.fringe.revealAddon(null)}>
          Open add-ons folder
        </button>
      </div>
      {status && (
        <p className={status.error ? 'error' : 'muted'} role="status">
          {status.text}
        </p>
      )}
      <p className="muted addon-safety">
        Add-ons run walled off: no internet, no files, and they can’t change your budget’s lines. Only add
        files you trust.
      </p>
    </section>
  );
}
