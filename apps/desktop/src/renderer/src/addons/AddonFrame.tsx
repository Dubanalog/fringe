import {
  type Budget,
  addonData,
  addonReport,
  budgetTitle,
  plainTotals,
  setAddonData,
} from '@fringe/budget-engine';
import { useEffect, useRef, useState } from 'react';
import type { AddonInfo } from '../../../shared/ipc';
import { useTheme } from '../theme/ThemeProvider';

/** The theme colours an add-on gets, as CSS variables (docs/ai/addons.md). */
const THEME_VARS = [
  '--bg',
  '--surface',
  '--surface-alt',
  '--hover',
  '--border',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-text',
  '--positive',
  '--negative',
  '--focus',
] as const;

interface Call {
  fringe: 1;
  id: number;
  call: string;
  args: unknown[];
}

/** What an add-on sees of the budget: the budget (without other add-ons' data) and its totals. */
function budgetFor(budget: Budget | null) {
  if (!budget) return null;
  const { addonData: _all, ...settings } = budget.settings;
  return { budget: { ...budget, settings }, totals: plainTotals(budget) };
}

const postTo = (frame: HTMLIFrameElement | null, message: object) =>
  frame?.contentWindow?.postMessage({ fringe: 1, ...message }, '*');

/** The app's colours as they are now, to the add-on. */
function postTheme(frame: HTMLIFrameElement | null, dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const vars = Object.fromEntries(THEME_VARS.map((v) => [v, style.getPropertyValue(v).trim()]));
  postTo(frame, { event: 'theme', theme: { vars, dark } });
}

/**
 * Shows an add-on, sandboxed, and answers its `window.fringe` calls (the bridge in
 * main/addons.ts). It only listens to its own frame, and only changes the budget through
 * `update`, so every save is a step in History.
 */
export function AddonFrame({
  addon,
  budget,
  update,
  askClaude,
}: {
  addon: AddonInfo;
  budget: Budget | null;
  update: ((budget: Budget, label: string) => void) | null;
  askClaude(text: string): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();

  // The handler outlives renders; it reads what's current from here.
  const now = useRef({ budget, update, askClaude, addon, dark: theme.scheme === 'dark' });
  useEffect(() => {
    now.current = { budget, update, askClaude, addon, dark: theme.scheme === 'dark' };
  });

  const post = (message: object) => postTo(frame.current, message);
  const sendTheme = () => postTheme(frame.current, now.current.dark);

  useEffect(() => {
    const answer = async (m: Call): Promise<unknown> => {
      const { budget, update, askClaude, addon } = now.current;
      const args = Array.isArray(m.args) ? m.args : [];
      switch (m.call) {
        case 'budget':
          return budgetFor(budget);
        case 'data':
          return budget ? addonData(budget, addon.id) : null;
        case 'saveData': {
          if (!budget || !update) throw new Error('Open a budget first.');
          const label =
            typeof args[1] === 'string' && args[1].trim()
              ? args[1].trim().slice(0, 120)
              : `${addon.name} changed`;
          update(setAddonData(budget, addon.id, args[0] ?? null), label);
          return null;
        }
        case 'saveReport': {
          if (!budget) throw new Error('Open a budget first.');
          const doc = addonReport(budget, args[0]);
          const asked = (args[0] as { title?: unknown } | null)?.title;
          const own = budgetTitle(budget);
          // The file is named after the budget; drop it if the add-on put it in its title too.
          const title = (typeof asked === 'string' ? asked.trim() : '')
            .replace(own, '')
            .replace(/^[\s—–:-]+/, '')
            .trim();
          const name = `${own} ${title || addon.name}`;
          const result = await window.fringe.saveReport(
            args[1] === 'xlsx' ? 'xlsx' : 'pdf',
            doc,
            name.slice(0, 120),
            args[2] === true,
          );
          if (!result) return null;
          if (!result.ok) throw new Error(result.error);
          return result.file;
        }
        case 'askClaude':
          if (typeof args[0] !== 'string' || !args[0].trim()) throw new Error('Say what to ask.');
          askClaude(args[0].trim().slice(0, 4000));
          return null;
        default:
          throw new Error(`fringe.${String(m.call)} isn't something add-ons can do.`);
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as Partial<Call> & {
        ready?: true;
        key?: { key: unknown; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
      };
      if (!m || typeof m !== 'object' || m.fringe !== 1) return;
      if (m.ready) {
        // Loaded (or reloaded itself): it needs the colours and the budget.
        sendTheme();
        post({ event: 'budget', budget: budgetFor(now.current.budget) });
        setReady(true);
        return;
      }
      if (m.key && typeof m.key === 'object') {
        // A shortcut pressed in the add-on: the app's own handler takes it from here.
        const { key, shiftKey, ctrlKey, metaKey } = m.key;
        if (typeof key === 'string')
          window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, ctrlKey, metaKey }));
        return;
      }
      if (typeof m.id !== 'number') return;
      const id = m.id;
      answer(m as Call).then(
        (result) => post({ reply: id, ok: true, result }),
        (err: unknown) =>
          post({ reply: id, ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // The app's colours, again whenever the theme changes.
  // The provider sets the new theme after this runs (parents' effects run last), so wait a frame.
  useEffect(() => {
    if (!ready) return;
    const dark = theme.scheme === 'dark';
    const frameId = requestAnimationFrame(() => postTheme(frame.current, dark));
    return () => cancelAnimationFrame(frameId);
  }, [ready, theme]);

  // The budget, again whenever it changes or another one is shown.
  useEffect(() => {
    if (ready) postTo(frame.current, { event: 'budget', budget: budgetFor(budget) });
  }, [ready, budget]);

  return (
    <iframe
      ref={frame}
      className="addon-frame"
      title={addon.name}
      src={`fringe-addon://${addon.id}/`}
      sandbox="allow-scripts"
    />
  );
}
