import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  type ChatEvent,
  type ChatProvider,
  type ChatStatus,
  KEY_PROVIDERS,
  type KeyProvider,
} from '../../../shared/ipc';
import { COMPANIES } from './companies';
import { KeyForm, KeyWhere } from './KeyForm';

/** A change Claude wants to make, waiting for the user to allow it. */
/** A message put ready in the chat for the user to send, with files already added to the budget. */
export interface ChatSeed {
  id: number;
  text: string;
  files: string[];
}

export interface Approval {
  id: string;
  /** The change in plain words, e.g. "Set global SW to 22". */
  text: string;
  /** The budget it changes. */
  budget: string;
  /** The text being written, for a change to a file; it always asks, as History can't undo it. */
  detail?: string;
}

type Part = { type: 'text'; text: string } | { type: 'step'; label: string };

type Item =
  | { kind: 'user'; text: string; files: string[] }
  | { kind: 'assistant'; parts: Part[]; error: string | null; stopped: boolean };

const SUGGESTIONS = [
  'Help me build this budget',
  'Give me a quick overview of this budget',
  "What's missing or looks off in this budget?",
  'Read the files I added and tell me what applies',
];

/** Adds to the answer being written (the last item). */
function addPart(items: Item[], part: Part): Item[] {
  const last = items.at(-1);
  if (last?.kind !== 'assistant') return items;
  const parts = [...last.parts];
  const prev = parts.at(-1);
  if (part.type === 'text' && prev?.type === 'text')
    parts[parts.length - 1] = { ...prev, text: prev.text + part.text };
  else parts.push(part);
  return [...items.slice(0, -1), { ...last, parts }];
}

function endAnswer(items: Item[], change: { error?: string; stopped?: boolean }): Item[] {
  const last = items.at(-1);
  if (last?.kind !== 'assistant') return items;
  return [
    ...items.slice(0, -1),
    { ...last, error: change.error ?? last.error, stopped: change.stopped ?? false },
  ];
}

/**
 * A chat with Claude about the budget showing. Claude reads the budget and the budget's files, and
 * each change it wants to make waits here for the user to allow it.
 */
export function ChatView({
  project,
  approvals,
  onDecide,
  allowAll,
  onAllowAll,
  onStarted,
  status,
  onStatus,
  seed,
}: {
  /** The project folder of the budget showing, for adding files. */
  project: string | null;
  approvals: Approval[];
  onDecide: (id: string, allow: boolean) => void;
  /** Claude's changes go through without asking, for the rest of this chat. */
  allowAll: boolean;
  onAllowAll: (on: boolean) => void;
  /** Called once a conversation is under way, for the status bar. */
  onStarted: (started: boolean) => void;
  /** How the panel reaches Claude, and whether that's set up; null while checking. */
  status: ChatStatus | null;
  onStatus: (status: ChatStatus) => void;
  /** A message to put ready to send. */
  seed: ChatSeed | null;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState(seed);
  if (seed !== seen) {
    setSeen(seed);
    if (seed) {
      setDraft(seed.text);
      setAttached(seed.files);
      setFileNote(null);
    }
  }
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // A problem Claude reported while answering, for the status it was reported against.
  const [problem, setProblem] = useState<{ status: ChatStatus | null; account: Account } | null>(null);
  const name = status?.assistant ?? 'Claude';
  const account = problem && problem.status === status ? problem.account : accountOf(status);
  const [signIn, setSignIn] = useState<SignInState>({ state: 'idle', url: null, error: null });
  // A message that couldn't go because Claude wasn't set up; sent again once it is.
  const retry = useRef<string | null>(null);
  const sendLatest = useRef<(text: string) => Promise<void>>(async () => {});
  const latest = useRef({ status, onStatus });
  useEffect(() => {
    latest.current = { status, onStatus };
  });

  /** Claude is set up now: send the message that was waiting, if any. */
  const ready = (next: ChatStatus) => {
    onStatus(next);
    const text = retry.current;
    retry.current = null;
    if (text && accountOf(next) === 'ready') void sendLatest.current(text);
  };
  const readyLatest = useRef(ready);
  useEffect(() => {
    readyLatest.current = ready;
  });

  useEffect(
    () =>
      window.fringe.onChatEvent((event: ChatEvent) => {
        switch (event.type) {
          case 'text':
            setThinking(false);
            setItems((s) => addPart(s, { type: 'text', text: event.text }));
            break;
          case 'thinking':
            setThinking(true);
            break;
          case 'step':
            setThinking(true);
            setItems((s) => addPart(s, { type: 'step', label: event.label }));
            break;
          case 'turn-end':
            setBusy(false);
            setThinking(false);
            if (event.error) setItems((s) => endAnswer(s, { error: event.error ?? '' }));
            break;
          case 'setup':
            // Take back the message that couldn't go; it goes again once Claude is set up.
            setBusy(false);
            setThinking(false);
            setProblem({ status: latest.current.status, account: event.problem });
            setItems((s) => {
              const last = s.at(-1);
              const user = s.at(-2);
              if (last?.kind !== 'assistant' || last.parts.length > 0 || user?.kind !== 'user') return s;
              retry.current = user.text;
              return s.slice(0, -2);
            });
            break;
          case 'sign-in':
            if (event.state === 'signed-in') {
              setSignIn({ state: 'idle', url: null, error: null });
              void window.fringe.chatStatus().then((next) => readyLatest.current(next));
            } else setSignIn({ state: event.state, url: event.url, error: event.error });
            break;
        }
      }),
    [],
  );

  useEffect(() => onStarted(items.length > 0), [items.length, onStarted]);

  // Keep the latest message (or approval) in view.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, approvals, thinking]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const files = attached;
    const full =
      files.length > 0
        ? `${message}\n\n(I've just added ${files.length === 1 ? 'this file' : 'these files'} to the budget's knowledge folder: ${files.join(', ')})`
        : message;
    setItems((s) => [
      ...s,
      { kind: 'user', text: message, files },
      { kind: 'assistant', parts: [], error: null, stopped: false },
    ]);
    setDraft('');
    setAttached([]);
    setBusy(true);
    setThinking(true);
    const result = await window.fringe.sendChat(full);
    if (!result.ok) {
      setBusy(false);
      setThinking(false);
      setItems((s) => endAnswer(s, { error: result.error }));
    }
  };

  useEffect(() => {
    sendLatest.current = send;
  });

  const stop = async () => {
    await window.fringe.stopChat();
    setBusy(false);
    setThinking(false);
    setItems((s) => endAnswer(s, { stopped: true }));
  };

  const newChat = async () => {
    if (busy) await window.fringe.stopChat();
    await window.fringe.newChat();
    onAllowAll(false);
    setItems([]);
    setBusy(false);
    setThinking(false);
    input.current?.focus();
  };

  const added = (names: string[]) => {
    if (names.length > 0) setAttached((a) => [...a, ...names.filter((n) => !a.includes(n))]);
    input.current?.focus();
  };

  const addFiles = async () => {
    if (!project) {
      setFileNote('Open a budget to add files to it.');
      return;
    }
    setFileNote(null);
    added(await window.fringe.addBudgetFiles(project));
  };

  const drop = async (e: DragEvent) => {
    e.preventDefault();
    // Files dropped here are for this budget, not for the window to open.
    e.stopPropagation();
    setDragging(false);
    if (!project) {
      setFileNote('Open a budget to add files to it.');
      return;
    }
    const paths = [...e.dataTransfer.files].map((f) => window.fringe.pathForFile(f)).filter(Boolean);
    if (paths.length === 0) return;
    setFileNote(null);
    added(await window.fringe.addBudgetFilePaths(project, paths));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const last = items.at(-1);
  const waiting = busy && thinking && approvals.length === 0;

  return (
    <div
      className={dragging ? 'ai-chat dragging' : 'ai-chat'}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => void drop(e)}
    >
      <div className="ai-messages" ref={list}>
        {items.length === 0 && (account === 'ready' || account === 'checking') && (
          <div className="ai-empty">
            <h3>Ask {name} about this budget</h3>
            <p className="muted">
              {name} can read the budget and the files you add for it: rate sheets, deal memos, union rules.
              Before it changes anything, it asks you here, and every change can be undone.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="ai-suggestion" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item, i) =>
          item.kind === 'user' ? (
            <div key={i} className="ai-msg ai-msg-user">
              <div className="ai-bubble">{item.text}</div>
              {item.files.length > 0 && (
                <div className="ai-files">
                  {item.files.map((f) => (
                    <span key={f} className="ai-file">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : item.kind === 'assistant' ? (
            <div key={i} className="ai-msg ai-msg-claude">
              {item.parts.map((part, j) =>
                part.type === 'step' ? (
                  <div key={j} className="ai-step">
                    {part.label}
                  </div>
                ) : (
                  <div key={j} className="ai-text">
                    <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
                  </div>
                ),
              )}
              {item.stopped && <div className="ai-step">Stopped</div>}
              {item.error && <p className="error">{item.error}</p>}
            </div>
          ) : null,
        )}
        {account !== 'ready' && account !== 'checking' && (
          <SetupCard
            account={account}
            provider={status?.provider ?? 'claude-code'}
            signIn={signIn}
            onStatus={onStatus}
            onKeySaved={ready}
          />
        )}
        {approvals.map((a) => (
          <div key={a.id} className="ai-approval" role="group" aria-label="Change waiting for you">
            <div className="ai-approval-title">
              {name} wants to change {a.budget}
            </div>
            <div className="ai-approval-text">{a.text}</div>
            {a.detail && <pre className="ai-approval-detail">{a.detail}</pre>}
            <div className="ai-approval-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => onDecide(a.id, true)}
              >
                Allow
              </button>
              <button type="button" className="btn btn-small" onClick={() => onDecide(a.id, false)}>
                Don&apos;t Allow
              </button>
              {!a.detail && (
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  title={`Let ${name} make changes without asking for the rest of this chat. Every change is still in History, to undo.`}
                  onClick={() => onAllowAll(true)}
                >
                  Allow all in this chat
                </button>
              )}
            </div>
          </div>
        ))}
        {allowAll && (
          <div className="ai-allow-all" role="status">
            {name}&apos;s changes go straight in for this chat. Each one is in History.
            <button type="button" className="link-btn" onClick={() => onAllowAll(false)}>
              Ask me again
            </button>
          </div>
        )}
        {waiting && last?.kind === 'assistant' && (
          <div className="ai-thinking" aria-live="polite">
            <span className="ai-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Working…
          </div>
        )}
      </div>

      <div className="ai-composer">
        {(attached.length > 0 || fileNote) && (
          <div className="ai-files">
            {attached.map((f) => (
              <span key={f} className="ai-file">
                {f}
                <button
                  type="button"
                  aria-label={`Don't mention ${f}`}
                  onClick={() => setAttached((a) => a.filter((n) => n !== f))}
                >
                  ×
                </button>
              </span>
            ))}
            {fileNote && <span className="muted">{fileNote}</span>}
          </div>
        )}
        <div className="ai-input">
          <textarea
            ref={input}
            rows={2}
            value={draft}
            placeholder="Ask about this budget…"
            aria-label={`Message to ${name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="ai-input-actions">
            <button
              type="button"
              className="ai-icon-btn"
              title="Add files for this budget"
              aria-label="Add files for this budget"
              onClick={() => void addFiles()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M21 11.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="status-spacer" />
            {items.length > 0 && !busy && (
              <button type="button" className="btn btn-small" onClick={() => void newChat()}>
                New Chat
              </button>
            )}
            {busy ? (
              <button type="button" className="btn btn-small" onClick={() => void stop()}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={draft.trim() === '' || account !== 'ready'}
                onClick={() => void send(draft)}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
      {dragging && <div className="ai-drop">Drop files to add them to this budget</div>}
    </div>
  );
}

/** Anthropic's own page for installing Claude Code; the app never runs an installer itself. */
const INSTALL_PAGE = 'https://docs.claude.com/en/docs/claude-code/setup';

type Account = 'checking' | 'ready' | 'not-installed' | 'signed-out' | 'needs-key';

function accountOf(status: ChatStatus | null): Account {
  if (!status) return 'checking';
  if (status.provider !== 'claude-code') return status.hasKey ? 'ready' : 'needs-key';
  return !status.installed ? 'not-installed' : status.signedIn ? 'ready' : 'signed-out';
}

interface SignInState {
  state: 'idle' | 'waiting' | 'failed';
  url: string | null;
  error: string | null;
}

function PlanLink({ onStatus }: { onStatus: (s: ChatStatus) => void }) {
  return (
    <button
      type="button"
      className="link-btn"
      onClick={() => void window.fringe.setChatSettings({ provider: 'claude-code' }).then(onStatus)}
    >
      Use my Claude plan instead
    </button>
  );
}

/** "Anthropic, OpenAI or Google": switches the chat to that company's API key. */
function KeyLinks({ onStatus }: { onStatus: (s: ChatStatus) => void }) {
  return KEY_PROVIDERS.map((p, i) => (
    <span key={p}>
      {i > 0 && (i === KEY_PROVIDERS.length - 1 ? ' or ' : ', ')}
      <button
        type="button"
        className="link-btn"
        onClick={() => void window.fringe.setChatSettings({ provider: p }).then(onStatus)}
      >
        {COMPANIES[p].company}
      </button>
    </span>
  ));
}

/** Shown when Claude can't answer yet: not installed, not signed in, or no API key. */
function SetupCard({
  account,
  provider,
  signIn,
  onStatus,
  onKeySaved,
}: {
  account: 'not-installed' | 'signed-out' | 'needs-key';
  provider: ChatProvider;
  signIn: SignInState;
  onStatus: (status: ChatStatus) => void;
  onKeySaved: (status: ChatStatus) => void;
}) {
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);
  const checkAgain = async () => {
    const next = await window.fringe.chatStatus();
    setChecked(!next.installed);
    onStatus(next);
  };
  if (account === 'needs-key') {
    const keyProvider: KeyProvider = provider === 'claude-code' ? 'anthropic' : provider;
    const company = COMPANIES[keyProvider];
    return (
      <div className="ai-setup">
        <strong>Add your {company.company} API key</strong>
        <p>{company.note}</p>
        <p>
          <KeyWhere provider={keyProvider} />
        </p>
        <KeyForm key={keyProvider} provider={keyProvider} onSaved={onKeySaved} />
        <p className="small">
          <PlanLink onStatus={onStatus} />
        </p>
      </div>
    );
  }
  if (account === 'not-installed') {
    return (
      <div className="ai-setup">
        <strong>Set up Claude on this computer</strong>
        <p>
          Fringe uses Claude Code, Anthropic&apos;s app, with your own Claude Pro or Max plan. Install it from
          Anthropic&apos;s page, then come back here.
        </p>
        {checked && <p className="muted small">Claude Code isn&apos;t installed yet.</p>}
        <div className="actions actions-left">
          <button type="button" className="btn btn-primary" onClick={() => window.open(INSTALL_PAGE)}>
            Get Claude Code
          </button>
          <button type="button" className="btn" onClick={() => void checkAgain()}>
            I&apos;ve Installed It
          </button>
        </div>
        <p className="small">
          Or use an API key from <KeyLinks onStatus={onStatus} />
        </p>
      </div>
    );
  }
  if (signIn.state === 'waiting') {
    const sendCode = () => {
      if (code.trim() === '') return;
      void window.fringe.signInCode(code);
      setCode('');
    };
    return (
      <div className="ai-setup">
        <strong>Finish signing in in your browser</strong>
        <p>
          Approve Fringe&apos;s access on Claude&apos;s page. This panel carries on by itself when you&apos;re
          done.
        </p>
        {signIn.url && (
          <p className="small">
            <button type="button" className="link-btn" onClick={() => window.open(signIn.url ?? '')}>
              Open the sign-in page again
            </button>
          </p>
        )}
        <p className="muted small">If the page shows a code instead, paste it here:</p>
        <div className="ai-code">
          <input
            value={code}
            placeholder="Code from the sign-in page"
            aria-label="Code from the sign-in page"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendCode();
            }}
          />
          <button type="button" className="btn btn-small" disabled={code.trim() === ''} onClick={sendCode}>
            Continue
          </button>
        </div>
        <div className="actions actions-left">
          <button type="button" className="btn btn-small" onClick={() => void window.fringe.cancelSignIn()}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ai-setup">
      <strong>Sign in to Claude</strong>
      <p>
        Sign in once with your Claude Pro or Max plan. It opens Claude&apos;s sign-in page in your browser;
        Fringe never sees your password.
      </p>
      {signIn.error && <p className="error small">{signIn.error}</p>}
      <div className="actions actions-left">
        <button type="button" className="btn btn-primary" onClick={() => void window.fringe.signIn()}>
          Sign In
        </button>
      </div>
      <p className="small">
        Or use an API key from <KeyLinks onStatus={onStatus} />
      </p>
    </div>
  );
}
