import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';

type TerminalState = 'idle' | 'starting' | 'running' | 'ended';

/** The terminal's colors, from the app theme in force where the terminal sits. */
function terminalTheme(el: HTMLElement) {
  const style = getComputedStyle(el);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: color('--surface', '#1e1e1e'),
    foreground: color('--text', '#e6e6e6'),
    cursor: color('--accent', '#e6e6e6'),
    selectionBackground: color('--hover', '#444444'),
  };
}

/**
 * Claude Code in a terminal, for signing in to Claude and for people who like a terminal. It
 * starts the first time it is shown and stays mounted while hidden, so the session carries on.
 */
export function TerminalView({ shown }: { shown: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [state, setState] = useState<TerminalState>('idle');
  const [error, setError] = useState<string | null>(null);

  // The terminal itself: made once, fed by the main process, sized to the panel.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const t = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, Menlo, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: terminalTheme(el),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;
    const input = t.onData((data) => window.fringe.terminalInput(data));
    const offData = window.fringe.onTerminalData((data) => t.write(data));
    const offExit = window.fringe.onTerminalExit(() => setState('ended'));
    const resized = new ResizeObserver(() => {
      if (el.offsetWidth === 0) return; // Hidden.
      f.fit();
      window.fringe.resizeTerminal(t.cols, t.rows);
    });
    resized.observe(el);
    return () => {
      resized.disconnect();
      offData();
      offExit();
      input.dispose();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
  }, []);

  const start = async () => {
    const t = term.current;
    if (!t) return;
    setError(null);
    setState('starting');
    fit.current?.fit();
    t.reset();
    const result = await window.fringe.startTerminal({ cols: t.cols, rows: t.rows });
    if (result.ok) {
      setState('running');
      t.focus();
    } else {
      setState('ended');
      setError(result.error);
    }
  };

  // Starts the first time it is shown; picks up a theme change made while it was hidden.
  useEffect(() => {
    if (!shown || !term.current || !host.current) return;
    term.current.options.theme = terminalTheme(host.current);
    if (state === 'idle') void start();
    else if (state === 'running') term.current.focus();
  }, [shown, state]);

  return (
    <div className="ai-terminal-view" hidden={!shown}>
      {state === 'ended' && (
        <div className="ai-terminal-bar">
          <span className="muted">{error ?? 'Claude Code has stopped.'}</span>
          <button type="button" className="btn btn-small" onClick={() => void start()}>
            Start Again
          </button>
        </div>
      )}
      <div className="ai-terminal" ref={host} />
    </div>
  );
}
