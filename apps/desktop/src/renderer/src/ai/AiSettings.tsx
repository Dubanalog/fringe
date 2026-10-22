import { type ChatProvider, type ChatStatus, KEY_PROVIDERS } from '../../../shared/ipc';
import { COMPANIES } from './companies';
import { KeyForm, KeyWhere } from './KeyForm';

const CHOICES: { id: ChatProvider; title: string; text: string }[] = [
  {
    id: 'claude-code',
    title: 'My Claude plan',
    text: "Uses Claude Code, Anthropic's app, signed in with your Claude Pro or Max plan. No extra cost.",
  },
  ...KEY_PROVIDERS.map((p) => ({ id: p, title: COMPANIES[p].title, text: COMPANIES[p].note })),
];

function choiceState(status: ChatStatus, id: ChatProvider): string {
  if (id === 'claude-code') {
    if (!status.installed) return 'Not installed yet';
    return status.signedIn ? 'Signed in' : 'Not signed in';
  }
  return status.keys[id] ? 'Key saved' : 'No key yet';
}

/** How the panel reaches the AI: the user's own Claude plan, or one of their own API keys. */
export function AiSettings({
  status,
  onStatus,
  onDone,
}: {
  status: ChatStatus | null;
  onStatus: (status: ChatStatus) => void;
  onDone: () => void;
}) {
  if (!status) return <div className="ai-settings muted">Checking…</div>;
  const choose = (provider: ChatProvider) => {
    if (provider !== status.provider) void window.fringe.setChatSettings({ provider }).then(onStatus);
  };
  const provider = status.provider;

  return (
    <div className="ai-settings">
      <h3>Which AI Fringe uses</h3>
      <div className="ai-choices" role="radiogroup" aria-label="Which AI Fringe uses">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={provider === c.id}
            className={provider === c.id ? 'ai-choice selected' : 'ai-choice'}
            onClick={() => choose(c.id)}
          >
            <span className="ai-choice-title">{c.title}</span>
            <span className="ai-choice-text">{c.text}</span>
            <span className="ai-choice-state">{choiceState(status, c.id)}</span>
          </button>
        ))}
      </div>

      {provider !== 'claude-code' && (
        <section className="ai-settings-section">
          <h4>{COMPANIES[provider].company} API key</h4>
          {status.hasKey ? (
            <div className="ai-key-row">
              <span>A key is saved, encrypted on this computer.</span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void window.fringe.clearApiKey(provider).then(onStatus)}
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="muted small">
              <KeyWhere provider={provider} />
            </p>
          )}
          <KeyForm key={provider} provider={provider} onSaved={onStatus} />

          {status.hasKey && (
            <>
              <h4>Model</h4>
              {status.models.length === 0 ? (
                <p className="muted small">
                  Couldn&apos;t get the list of models from {COMPANIES[provider].company}. Check the internet
                  connection.
                </p>
              ) : (
                <select
                  className="text-input"
                  value={status.model}
                  aria-label="Model"
                  onChange={(e) =>
                    void window.fringe.setChatSettings({ model: e.target.value }).then(onStatus)
                  }
                >
                  {status.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </section>
      )}

      <p className="muted small">Switching starts a new chat.</p>
      <div className="actions actions-left">
        <button type="button" className="btn btn-primary btn-small" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
