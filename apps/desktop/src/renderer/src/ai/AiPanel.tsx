import { type PointerEvent, useEffect, useState } from 'react';
import type { ChatStatus } from '../../../shared/ipc';
import { AiNotice } from './AiNotice';
import { AiSettings } from './AiSettings';
import { type Approval, type ChatSeed, ChatView } from './ChatView';
import { TerminalView } from './TerminalView';
import { keys } from '../keys';

type Mode = 'chat' | 'terminal' | 'settings';

const WIDTH_KEY = 'fringe.panelWidth';
const USUAL_WIDTH = 400;
const MIN_WIDTH = 300;

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : USUAL_WIDTH;
  } catch {
    return USUAL_WIDTH;
  }
}

function saveWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Not saved; the panel opens at its usual width next time.
  }
}

/** Keeps the panel narrower than the window, leaving room for the budget beside it. */
function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, window.innerWidth - 480)));
}

/**
 * The AI side panel, docked on the right like a browser's; drag its left edge to resize it. A chat
 * with the AI about the budget showing, through the user's own Claude plan (Claude Code) or their
 * own API key. The terminal is there for anyone who'd rather use Claude Code directly. Chat and
 * terminal stay mounted while hidden, so a conversation carries on.
 */
export function AiPanel({
  open,
  onClose,
  project,
  approvals,
  onDecide,
  allowAll,
  onAllowAll,
  onConnectedChange,
  seed,
}: {
  open: boolean;
  onClose: () => void;
  project: string | null;
  approvals: Approval[];
  onDecide: (id: string, allow: boolean) => void;
  allowAll: boolean;
  onAllowAll: (on: boolean) => void;
  /** Which AI is in use in the panel (Claude, GPT, Gemini), or null; for the status bar. */
  onConnectedChange: (assistant: string | null) => void;
  /** A message to put ready in the chat (it switches to the chat). */
  seed: ChatSeed | null;
}) {
  const [mode, setMode] = useState<Mode>('chat');
  const [seen, setSeen] = useState(seed);
  if (seed !== seen) {
    setSeen(seed);
    if (seed) setMode('chat');
  }
  const [terminalUsed, setTerminalUsed] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const name = status?.assistant ?? 'Claude';
  // The first-use note comes before anything else in the panel.
  const notice = status !== null && !status.noticeAccepted;
  const [width, setWidth] = useState(savedWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(
    () => onConnectedChange(chatStarted ? name : terminalUsed ? 'Claude Code' : null),
    [chatStarted, terminalUsed, name, onConnectedChange],
  );

  useEffect(() => {
    let current = true;
    void window.fringe.chatStatus().then((s) => {
      if (current) setStatus(s);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const apply = () => document.documentElement.style.setProperty('--panel-width', `${clampWidth(width)}px`);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [width]);

  // Drag the panel's left edge to make it wider or narrower.
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    let latest = width;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampWidth(window.innerWidth - ev.clientX);
      setWidth(latest);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setResizing(false);
      saveWidth(latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const showTerminal = () => {
    setTerminalUsed(true);
    setMode('terminal');
  };

  return (
    <aside className={resizing ? 'ai-panel resizing' : 'ai-panel'} hidden={!open} aria-label={name}>
      <div
        className="ai-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${name} panel`}
        title="Drag to resize. Double-click for the usual width."
        onPointerDown={startResize}
        onDoubleClick={() => {
          setWidth(USUAL_WIDTH);
          saveWidth(null);
        }}
      />
      <header className="ai-panel-header">
        <strong>{name}</strong>
        {status && status.provider !== 'claude-code' && <span className="ai-badge">API key</span>}
        <span className="status-spacer" />
        {notice ? null : mode !== 'chat' ? (
          <button type="button" className="btn btn-small" onClick={() => setMode('chat')}>
            Back to Chat
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ai-icon-btn"
              title="Which AI Fringe uses"
              aria-label="AI settings"
              onClick={() => setMode('settings')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M4 7h10M18 7h2M4 17h4M12 17h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
            <button
              type="button"
              className="ai-icon-btn"
              title="Open Claude Code in a terminal (if you prefer it)"
              aria-label="Open Claude Code in a terminal"
              onClick={showTerminal}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M4 6l6 6-6 6M12 18h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
        <button
          type="button"
          className="ai-icon-btn"
          onClick={onClose}
          aria-label="Close panel"
          title={`Close (${keys('Ctrl+J')})`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      {notice && (
        <div className="ai-panel-body">
          <AiNotice
            onAccept={() => void window.fringe.setChatSettings({ noticeAccepted: true }).then(setStatus)}
            onClose={onClose}
          />
        </div>
      )}
      <div className="ai-panel-body" hidden={notice || mode !== 'chat'}>
        <ChatView
          project={project}
          approvals={approvals}
          onDecide={onDecide}
          allowAll={allowAll}
          onAllowAll={onAllowAll}
          onStarted={setChatStarted}
          status={status}
          onStatus={setStatus}
          seed={seed}
        />
      </div>
      {!notice && mode === 'settings' && (
        <div className="ai-panel-body">
          <AiSettings status={status} onStatus={setStatus} onDone={() => setMode('chat')} />
        </div>
      )}
      {!notice && terminalUsed && <TerminalView shown={open && mode === 'terminal'} />}
    </aside>
  );
}
