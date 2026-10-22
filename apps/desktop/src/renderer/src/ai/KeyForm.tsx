import { useState } from 'react';
import type { ChatStatus, KeyProvider } from '../../../shared/ipc';
import { COMPANIES } from './companies';

/**
 * Where the user pastes an API key. Fringe checks it with the company before keeping it,
 * encrypted, in the main process; the window never gets it back.
 */
export function KeyForm({
  provider,
  onSaved,
}: {
  provider: KeyProvider;
  onSaved: (status: ChatStatus) => void;
}) {
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const company = COMPANIES[provider];

  const save = async () => {
    if (key.trim() === '' || checking) return;
    setChecking(true);
    setError(null);
    const result = await window.fringe.setApiKey(provider, key.trim());
    setChecking(false);
    if (result.ok) {
      setKey('');
      onSaved(result.status);
    } else setError(result.error);
  };

  return (
    <>
      <div className="ai-code">
        <input
          type="password"
          value={key}
          placeholder={company.placeholder}
          aria-label={`${company.company} API key`}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={key.trim() === '' || checking}
          onClick={() => void save()}
        >
          {checking ? 'Checking…' : 'Save'}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/** "Make a key at console.anthropic.com and paste it here." */
export function KeyWhere({ provider }: { provider: KeyProvider }) {
  const company = COMPANIES[provider];
  return (
    <>
      Make a key at{' '}
      <button type="button" className="link-btn" onClick={() => window.open(company.keyUrl)}>
        {company.keySite}
      </button>{' '}
      and paste it here. It&apos;s kept encrypted on this computer.
    </>
  );
}
