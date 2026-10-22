import { BUDGET_TOOLS } from '@fringe/budget-engine';
import { useEffect, useState } from 'react';
import type { McpStatus } from '../../../shared/ipc';

/** One tool call a connected AI made, newest first in the activity list. */
export interface AiActivity {
  id: string;
  at: string;
  tool: string;
  budget: string | null;
  ok: boolean;
  /** The history label for an edit, or the error. */
  note: string | null;
}

/**
 * The AI, explained: the AI panel is how most people use it. Connecting another AI app to the
 * app's MCP server is tucked away under Advanced; its token is copied, never shown.
 */
export function AssistantView({
  activity,
  onOpenPanel,
}: {
  activity: readonly AiActivity[];
  onOpenPanel: () => void;
}) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    void window.fringe.mcpStatus().then(setStatus);
  }, []);

  const run = async (action: () => Promise<McpStatus>) => {
    setBusy(true);
    setCopied(false);
    try {
      setStatus(await action());
    } finally {
      setBusy(false);
    }
  };

  const renew = async () => {
    const sure = window.confirm(
      'Make a new token? Any AI app you connected with the old one will stop working until you connect it again with the new command.',
    );
    if (!sure) return;
    await run(() => window.fringe.newMcpToken());
    setRenewed(true);
  };

  const command =
    status?.url && status.token
      ? `claude mcp add --transport http fringe ${status.url} --header "Authorization: Bearer ${status.token}"`
      : null;
  const copy = () => {
    if (command) void window.fringe.copyText(command).then(() => setCopied(true));
  };

  return (
    <section className="view view-scroll assistant-view">
      <h1>AI</h1>
      <p className="muted">
        Ask an AI about your budgets, or have it do the work: build accounts and lines, set fringes, globals
        and cutoffs, check an import, compare two budgets. Every change it makes goes into the budget&apos;s
        history, so you can see it and undo it.
      </p>
      <p>
        The AI works in the <strong>AI panel</strong>. Use your own Claude Pro or Max plan through Claude
        Code, or an API key from Anthropic, OpenAI or Google. You choose in the panel&apos;s settings.
      </p>
      <div className="actions actions-left">
        <button type="button" className="btn btn-primary" onClick={onOpenPanel}>
          Open the AI Panel
        </button>
      </div>

      <h2>Activity</h2>
      {activity.length === 0 ? (
        <p className="muted">Nothing yet. What the AI reads and changes shows here.</p>
      ) : (
        <table className="report-table">
          <tbody>
            {activity.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.at).toLocaleTimeString()}</td>
                <td>
                  <code>{a.tool}</code>
                </td>
                <td>{a.budget ?? ''}</td>
                <td className={a.ok ? '' : 'error'}>{a.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="assistant-more">
        <summary>What the AI can do</summary>
        <ul className="tool-list">
          {BUDGET_TOOLS.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code> {t.edits ? <span className="badge">Edits</span> : null}
              <div className="muted">{t.description}</div>
            </li>
          ))}
        </ul>
      </details>

      <details className="assistant-more">
        <summary>Advanced: connect another AI app</summary>
        <p className="muted">
          You don&apos;t need this for the AI panel. It&apos;s for AI apps you run yourself, such as Claude
          Code in your own terminal, or any app that supports MCP.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={!status || busy}
            onChange={(e) => void run(() => window.fringe.setMcpEnabled(e.target.checked))}
          />
          Let AI apps on this computer connect to Fringe
        </label>
        {status?.error && <p className="error">Couldn&apos;t start: {status.error}</p>}
        {status?.enabled && status.running && command && (
          <>
            <p>
              Copy the command and run it once in a terminal to add Fringe to Claude Code. Other apps: the
              server is <code>{status.url}</code>, with the header <code>Authorization: Bearer</code> and the
              token in the command.
            </p>
            <div className="actions actions-left">
              <button type="button" className="btn" disabled={busy} onClick={copy}>
                {copied ? 'Copied' : 'Copy Command'}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void renew()}>
                Make a New Token
              </button>
            </div>
            {renewed && <p className="muted">New token made. Copy the command again for your apps.</p>}
            <p className="muted">
              The command holds a token Fringe made on this computer. It isn&apos;t from your Claude, OpenAI
              or Google account. It lets an app read and change your budgets, so keep it private like a
              password. Only apps on this computer can use it. If you think someone else has it, make a new
              one.
            </p>
          </>
        )}
      </details>
    </section>
  );
}
