import {
  type Budget,
  branchFilesToSave,
  calculateTotals,
  canRedo,
  canUndo,
  copyName,
  findBranch,
  forkBudget,
  formatMoney,
  MAIN_BRANCH,
  mainBudget,
  newBudget,
  readOnlyNote,
  runTool,
  runVersionTool,
} from '@fringe/budget-engine';
import { type DragEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  APPROVE_CALL,
  type AddonInfo,
  type AppInfo,
  type ApprovalRequest,
  type OpenBudget,
  type OpenProjectResult,
  OPEN_ADDON_CALL,
  type RecentProject,
} from '../../shared/ipc';
import { AddonFrame } from './addons/AddonFrame';
import { AddonsView } from './addons/AddonsView';
import { AiPanel } from './ai/AiPanel';
import { type AiActivity, AssistantView } from './ai/AssistantView';
import type { Approval, ChatSeed } from './ai/ChatView';
import { BudgetSettingsView } from './budget/BudgetSettingsView';
import { FringeLibrarySettings } from './budget/FringeLibrary';
import { BudgetWorkspace } from './budget/BudgetWorkspace';
import { HistoryView } from './budget/HistoryView';
import { LockBar, needsLockBar } from './budget/LockBar';
import { ImportReportView } from './budget/ImportReportView';
import { CrewListView } from './budget/CrewListView';
import { ReportsView } from './budget/ReportsView';
import { GlobalKnowledge, KnowledgeView } from './budget/KnowledgeView';
import { TabStrip } from './budget/TabStrip';
import { type BudgetTab, type TabsAction, initialTabs, tabsReducer } from './budget/tabs';
import { FringeMark } from './FringeMark';
import { SlidingHighlight } from './SlidingHighlight';
import { ThemePicker } from './theme/ThemePicker';
import { keys } from './keys';

type ViewId =
  | 'budget'
  | 'budget-settings'
  | 'import-report'
  | 'reports'
  | 'crew'
  | 'knowledge'
  | 'history'
  | 'addons'
  | 'addon'
  | 'assistant'
  | 'settings';

interface NavItem {
  id: ViewId;
  label: string;
  /** What this area will hold; shown until it is built. */
  planned: string;
  /** Shown only while a budget is open. */
  perBudget?: true;
  /** Shown only for an imported budget. */
  imported?: true;
  /** Planned for a later release, not the current one. */
  comingSoon?: true;
}

const NAV: readonly NavItem[] = [
  { id: 'budget', label: 'Budget', planned: 'Topsheet, categories, accounts and detail lines.' },
  {
    id: 'budget-settings',
    label: 'Budget Settings',
    planned: 'Display, chart of accounts, units, groups and fringes for this budget.',
    perBudget: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    planned: 'Topsheet, account summary, detail and more, saved as PDF, Excel or JSON.',
    perBudget: true,
  },
  {
    id: 'crew',
    label: 'Crew List',
    planned: 'The budget’s labor on one page.',
    perBudget: true,
  },
  {
    id: 'import-report',
    label: 'Import Report',
    planned: 'How a converted budget compares with the file it came from.',
    perBudget: true,
    imported: true,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    planned:
      'Rules, assumptions and decisions for this budget. Knowledge shared across all budgets lives in Settings → Global Knowledge.',
    perBudget: true,
  },
  {
    id: 'history',
    label: 'Versions',
    planned: 'Versions and branches of the budget, and every change.',
    perBudget: true,
  },
  {
    id: 'assistant',
    label: 'AI',
    planned: 'The AI panel, what the AI did, and connecting other AI apps.',
  },
];

export function App() {
  const [view, setView] = useState<ViewId>('budget');
  /** The version the Comparison report compares what's showing with; null for the one before it. */
  const [compareFrom, setCompareFrom] = useState<string | null>(null);
  // Opens Reports on the Comparison report, from this version.
  const showComparison = (from: string | null) => {
    setCompareFrom(from);
    setView('reports');
  };
  const [info, setInfo] = useState<AppInfo | null>(null);
  // Each budget is a project folder; changes are saved there as they happen.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs);
  const [openError, setOpenError] = useState<string | null>(null);
  /** A short message in the status bar, e.g. where a budget was exported. */
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 15_000 : 8_000);
    return () => clearTimeout(timer);
  }, [notice]);
  const active = state.tabs.find((t) => t.id === state.activeId) ?? null;
  const shown = (item: NavItem) => (active || !item.perBudget) && (active?.budget.source || !item.imported);
  // Per-budget views fall back to Budget (the start page) when no budget is open.
  const shownView = NAV.some((n) => n.id === view && !shown(n)) ? 'budget' : view;
  // A version or an earlier point is showing: the views that edit the budget say so, and why.
  const lockShown =
    !!active && needsLockBar(active) && ['budget', 'budget-settings', 'crew', 'addon'].includes(shownView);
  const currentNav = NAV.find((n) => n.id === shownView);

  // Add-ons are the app's, not a budget's: the sidebar lists them under Add-ons.
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [addonsOpen, setAddonsOpen] = useState(true);
  const [openAddon, setOpenAddon] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void window.fringe.listAddons().then(setAddons);
    load();
    return window.fringe.onAddonsChanged(load);
  }, []);
  const shownAddon = shownView === 'addon' ? (addons.find((a) => a.id === openAddon) ?? null) : null;
  const showAddon = (id: string) => {
    setOpenAddon(id);
    setView('addon');
    setAddonsOpen(true);
  };

  useEffect(() => {
    void window.fringe.getAppInfo().then(setInfo);
  }, []);

  // A connected AI's tool calls run on the budget showing. Edits go in through the reducer, so they
  // land in history and are saved like the user's own. `latest` also carries an edit forward
  // straight away, so a second call arriving before React re-renders sees the first.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const [aiActivity, setAiActivity] = useState<AiActivity[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [connectedAi, setConnectedAi] = useState<string | null>(null);
  // Changes the AI wants to make from the panel's chat, waiting for the user to allow them.
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const deciders = useRef(new Map<string, (allow: boolean) => void>());
  const decide = useCallback((id: string, allow: boolean) => {
    deciders.current.get(id)?.(allow);
    deciders.current.delete(id);
    setApprovals((list) => list.filter((a) => a.id !== id));
  }, []);
  // "Allow all": the AI's changes go through without asking until the user turns it off or starts
  // a new chat. Each is still one step in History, to undo.
  const [allowAll, setAllowAll] = useState(false);
  const allowAllNow = useRef(false);
  useEffect(() => {
    allowAllNow.current = allowAll;
  }, [allowAll]);
  const changeAllowAll = useCallback((on: boolean) => {
    setAllowAll(on);
    allowAllNow.current = on;
    if (!on) return;
    // Budget changes waiting go through; file changes still wait, as History can't undo them.
    setApprovals((list) => {
      for (const a of list) {
        if (a.detail) continue;
        deciders.current.get(a.id)?.(true);
        deciders.current.delete(a.id);
      }
      return list.filter((a) => a.detail);
    });
  }, []);

  // The AI sees every open budget and knows which one is showing. Only names, folders and the
  // showing tab count, so edits don't resend it.
  const openBudgets = JSON.stringify(
    state.tabs.map((t) => ({
      tab: t.id,
      name: t.budget.name,
      project: t.project,
      showing: t.id === state.activeId,
    })),
  );
  const openList = useMemo(() => JSON.parse(openBudgets) as OpenBudget[], [openBudgets]);
  useEffect(() => window.fringe.setOpenBudgets(openList), [openList]);
  // The tab the AI chat is working on, for its dot in the tab strip.
  const [chatWorking, setChatWorking] = useState<string | null>(null);

  useEffect(
    () =>
      window.fringe.onToolCall(async (call) => {
        if (call.name === APPROVE_CALL) {
          // A file the app changes for the AI: always asked, as History can't undo it.
          const ask = call.input as ApprovalRequest;
          setPanelOpen(true);
          const allowed = await new Promise<boolean>((resolve) => {
            deciders.current.set(call.id, resolve);
            setApprovals((list) => [
              ...list,
              {
                id: call.id,
                text: ask.text,
                budget: ask.budget,
                ...(ask.detail ? { detail: ask.detail } : {}),
              },
            ]);
          });
          return { ok: true, result: { allowed } };
        }
        if (call.name === OPEN_ADDON_CALL) {
          const id = (call.input as { addon: string }).addon;
          setOpenAddon(id);
          setView('addon');
          setAddonsOpen(true);
          return { ok: true, result: { opened: id } };
        }
        let s = latest.current;
        let tab = s.tabs.find((t) => t.id === (call.tab ?? s.activeId));
        const log = (ok: boolean, note: string | null) =>
          setAiActivity((list) =>
            [
              {
                id: call.id,
                at: new Date().toISOString(),
                tool: call.name,
                budget: tab?.budget.name ?? null,
                ok,
                note,
              },
              ...list,
            ].slice(0, 200),
          );
        if (!tab) {
          log(false, 'No budget open');
          return {
            ok: false,
            error: call.tab
              ? "That budget isn't open any more. Use list_budgets to see what is."
              : 'No budget is open in the app. Ask the user to open or import one.',
          };
        }
        try {
          let versionOutcome = runVersionTool(tab.history, call.name, call.input);
          if (versionOutcome) {
            if ((versionOutcome.version || versionOutcome.branch) && call.confirm && !allowAllNow.current) {
              const text = (versionOutcome.label ?? call.name).replace(/^AI:\s*/, '');
              setPanelOpen(true);
              const allowed = await new Promise<boolean>((resolve) => {
                deciders.current.set(call.id, resolve);
                setApprovals((list) => [...list, { id: call.id, text, budget: tab!.budget.name }]);
              });
              if (!allowed) {
                log(false, 'Not allowed');
                return {
                  ok: false,
                  error: "The user didn't allow this change. Ask what they'd like instead.",
                };
              }
              const now = latest.current.tabs.find((t) => t.id === tab!.id);
              if (!now) {
                log(false, 'Budget closed');
                return { ok: false, error: 'The budget was closed before the change was allowed.' };
              }
              // Again on the history as it is now, as the user may have edited the version meanwhile.
              versionOutcome = runVersionTool(now.history, call.name, call.input)!;
            }
            if (versionOutcome.version) {
              dispatch({ type: 'saveVersion', id: tab.id, version: versionOutcome.version });
            }
            if (versionOutcome.branch) {
              const action: TabsAction = { type: 'createBranch', id: tab.id, ...versionOutcome.branch };
              dispatch(action);
              // At once, so the AI's next change goes on the new branch.
              latest.current = tabsReducer(latest.current, action);
            }
            if (versionOutcome.draft) {
              // Shows the filled-in form for the user to check and save.
              dispatch({ type: 'draftVersion', id: tab.id, draft: versionOutcome.draft });
              dispatch({ type: 'activate', id: tab.id });
              setView('history');
            }
            log(true, versionOutcome.label ?? null);
            return { ok: true, result: versionOutcome.result };
          }
          let outcome = runTool(tab.budget, call.name, call.input);
          const locked = outcome.budget ? readOnlyNote(tab.history) : null;
          if (locked) {
            log(false, 'Read-only');
            return { ok: false, error: locked };
          }
          if (outcome.budget && call.confirm && !allowAllNow.current) {
            // The panel's chat asks before each change. Run again afterwards, on the budget as it
            // is then, since the user may have changed it while deciding.
            const tabId = tab.id;
            const text = (outcome.label ?? call.name).replace(/^AI:\s*/, '');
            const budgetName = tab.budget.name;
            setPanelOpen(true);
            const allowed = await new Promise<boolean>((resolve) => {
              deciders.current.set(call.id, resolve);
              setApprovals((list) => [...list, { id: call.id, text, budget: budgetName }]);
            });
            if (!allowed) {
              log(false, 'Not allowed');
              return { ok: false, error: "The user didn't allow this change. Ask what they'd like instead." };
            }
            s = latest.current;
            tab = s.tabs.find((t) => t.id === tabId);
            if (!tab) {
              log(false, 'Budget closed');
              return { ok: false, error: 'The budget was closed before the change was allowed.' };
            }
            // The user may have opened a version meanwhile.
            const lockedNow = readOnlyNote(tab.history);
            if (lockedNow) {
              log(false, 'Read-only');
              return { ok: false, error: lockedNow };
            }
            outcome = runTool(tab.budget, call.name, call.input);
          }
          if (outcome.budget) {
            const budget = outcome.budget;
            dispatch({ type: 'update', id: tab.id, budget, label: outcome.label ?? `AI: ${call.name}` });
            const tabId = tab.id;
            latest.current = { ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, budget } : t)) };
          }
          log(true, outcome.label ?? null);
          return { ok: true, result: outcome.result };
        } catch (err) {
          log(false, message(err));
          return { ok: false, error: message(err) };
        }
      }),
    [],
  );

  /**
   * Makes a project folder for a budget and opens it there; its first history entry is `label`.
   * The folder, or null if it couldn't be made.
   */
  const openInNewProject = useCallback(async (budget: Budget, label: string) => {
    try {
      const { path } = await window.fringe.createProject(budget.name);
      setOpenError(null);
      dispatch({ type: 'open', budget, project: path, label });
      return path;
    } catch (err) {
      setOpenError(`Couldn't create a project folder for ${budget.name}: ${message(err)}`);
      return null;
    }
  }, []);

  // The tab whose name is being edited (double-click, F2, or a new copy, ready to name).
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const renameBudget = (tab: BudgetTab, name: string) =>
    dispatch({ type: 'update', id: tab.id, budget: { ...tab.budget, name }, label: `Renamed to ${name}` });

  // A budget from another program: a new budget named after the file, with the file in its
  // knowledge folder and a message ready in the AI panel asking to convert it. The AI does the
  // converting; the user sends the message when they're ready.
  const [chatSeed, setChatSeed] = useState<ChatSeed | null>(null);
  /** Opens the AI panel with `text` ready for the user to send. */
  const askClaude = (text: string) => {
    setChatSeed({ id: seedId(), text, files: [] });
    setPanelOpen(true);
  };
  const convertBudget = async (dropped?: string) => {
    const file = dropped ?? (await window.fringe.pickBudgetToConvert());
    if (!file) return;
    const fileName = fileNameOf(file);
    const name = fileName.replace(/\.[^.]+$/, '') || fileName;
    const project = await openInNewProject(newBudget(name), `Started from ${fileName}`);
    if (!project) return;
    const files = await window.fringe.addBudgetFilePaths(project, [file]);
    setChatSeed({
      id: seedId(),
      text: `Please convert the budget in ${fileName} into this one. It was made in another program. Check the totals against the file and tell me what you couldn't settle.`,
      files,
    });
    setPanelOpen(true);
  };

  const opened = useCallback((result: OpenProjectResult | null) => {
    if (!result) return;
    if (!result.ok) {
      setOpenError(`Couldn't open the project: ${result.error}`);
      return;
    }
    setOpenError(result.warning);
    const budget = result.history.entries[result.history.current]!.budget;
    dispatch({ type: 'open', budget, project: result.path, history: result.history });
    setView('budget');
  }, []);

  const openProject = useCallback(async () => opened(await window.fringe.openProject()), [opened]);

  // Anything dropped on the window (outside the AI panel and Knowledge, which keep files for the
  // budget): a project folder or .fringe file opens. Any other file goes in the open budget's
  // Knowledge; with no budget open, it's a budget from another program to convert.
  const [dropping, setDropping] = useState(false);
  const isFileDrag = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const dropOnWindow = async (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const paths = [...e.dataTransfer.files].map((f) => window.fringe.pathForFile(f)).filter(Boolean);
    const project = active?.project;
    const kept: string[] = [];
    for (const path of paths) {
      const result = await window.fringe.openDropped(path);
      if ('convert' in result) {
        if (project) kept.push(result.convert);
        else await convertBudget(result.convert);
      } else if (!result.ok)
        setNotice({ text: `Couldn't open ${fileNameOf(path)}: ${result.error}`, error: true });
      else opened(result);
    }
    if (project && kept.length > 0) {
      const added = await window.fringe.addBudgetFilePaths(project, kept);
      setNotice({
        text: `Added ${added.length === 1 ? fileNameOf(kept[0]!) : `${added.length} files`} to this budget's Knowledge.`,
        error: false,
      });
    }
  };

  /** A .fringe file opened: its budget in a new tab, or why it couldn't be. */
  const openedFile = useCallback(
    (result: OpenProjectResult | null) => {
      if (result && !result.ok) setNotice({ text: `Couldn't open the file: ${result.error}`, error: true });
      opened(result);
    },
    [opened],
  );
  const openFringeFile = useCallback(
    async () => openedFile(await window.fringe.openFringeFile()),
    [openedFile],
  );

  // Files double-clicked in the system's file manager.
  useEffect(() => {
    const take = () => void window.fringe.takeOpenedFiles().then((results) => results.forEach(openedFile));
    take();
    return window.fringe.onFilesOpened(take);
  }, [openedFile]);

  const exportProject = async (path: string) => {
    const result = await window.fringe.exportProject(path);
    if (!result) return;
    setNotice(
      result.ok
        ? { text: `Exported to ${result.file}`, error: false }
        : { text: `Couldn't export: ${result.error}`, error: true },
    );
  };

  // Saves each tab's changes as they happen, one save per tab at a time. A tab closed with
  // changes still saving closes once they're saved.
  const saving = useRef(new Set<string>());
  const closing = useRef(new Set<string>());
  useEffect(() => {
    for (const t of state.tabs) {
      if (!t.project || saving.current.has(t.id)) continue;
      if (t.unsaved.length === 0 || t.saveError) {
        if (closing.current.has(t.id) && t.unsaved.length === 0) {
          closing.current.delete(t.id);
          void window.fringe.closeProject(t.project);
          dispatch({ type: 'close', id: t.id });
        }
        continue;
      }
      const count = t.unsaved.length;
      // budget.json is the main line; each other branch that changed goes to its own file.
      const { files, written } = branchFilesToSave(t.history, t.branchFiles);
      saving.current.add(t.id);
      window.fringe
        .saveProject(t.project, mainBudget(t.history), t.unsaved, files)
        .then(
          () => dispatch({ type: 'saved', id: t.id, count, branchFiles: written }),
          (err: unknown) => dispatch({ type: 'saveFailed', id: t.id, error: message(err) }),
        )
        .finally(() => saving.current.delete(t.id));
    }
  }, [state.tabs]);

  const closeTab = (tab: BudgetTab) => {
    if (tab.project && tab.saveError) {
      if (!window.confirm(`${tab.budget.name} couldn't be saved (${tab.saveError}). Close it anyway?`))
        return;
    } else if (tab.project && (tab.unsaved.length > 0 || saving.current.has(tab.id))) {
      closing.current.add(tab.id);
      return;
    } else if (!tab.project && tab.dirty && !window.confirm(`Close ${tab.budget.name}? It isn't saved.`)) {
      return;
    }
    if (tab.project) void window.fringe.closeProject(tab.project);
    dispatch({ type: 'close', id: tab.id });
  };

  const activeId = active?.id ?? null;
  // Ctrl+Tab / Ctrl+Shift+Tab switch budgets; Ctrl+O opens a project, Ctrl+I imports a .fringe file;
  // Ctrl+J shows or hides the AI panel; Ctrl+Z / Ctrl+Y undo and redo
  // (outside text boxes, which keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const typing =
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable]') !== null;
      // The terminal has its own keys; only the panel toggle reaches past it.
      const inTerminal = e.target instanceof HTMLElement && e.target.closest('.ai-terminal') !== null;
      if (key === 'j' && !e.shiftKey) setPanelOpen((o) => !o);
      else if (inTerminal) return;
      else if (e.key === 'Tab') dispatch({ type: 'cycle', step: e.shiftKey ? -1 : 1 });
      else if (key === 'o' && !e.shiftKey) void openProject();
      else if (key === 'i' && !e.shiftKey && !typing) void openFringeFile();
      else if (activeId && !typing && key === 'z' && !e.shiftKey) dispatch({ type: 'undo', id: activeId });
      else if (activeId && !typing && (key === 'y' || (key === 'z' && e.shiftKey))) {
        dispatch({ type: 'redo', id: activeId });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFringeFile, openProject, activeId]);

  // The React Compiler memoizes this on the budget.
  const totals = active ? calculateTotals(active.budget) : null;
  const total = totals?.grand.total ?? null;
  // With incentives shown under the grand total, the footer also gives the net cost after them.
  const netCost =
    totals && active?.budget.settings.incentivePlacement === 'net' && totals.incentives.length > 0
      ? totals.net
      : null;

  return (
    <div
      className={`shell${panelOpen ? ' panel-open' : ''}${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        // Over the AI chat, files go to the budget's files instead (the chat shows that).
        const overChat = e.target instanceof Element && e.target.closest('.ai-chat') !== null;
        if (!overChat) e.dataTransfer.dropEffect = 'copy';
        setDropping(!overChat);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => void dropOnWindow(e)}
    >
      {dropping && (
        <div className="drop-overlay" aria-hidden="true">
          {active?.project ? (
            <>
              <strong>Drop files to add them to this budget</strong>
              <span>
                They go in its Knowledge, for the AI to read. A Fringe project or .fringe file opens instead.
              </span>
            </>
          ) : (
            <>
              <strong>Drop a budget to open it</strong>
              <span>
                A Fringe project or .fringe file opens. A budget from another program (PDF, Excel, CSV, XML…)
                is converted by the AI.
              </span>
            </>
          )}
        </div>
      )}
      <header className="titlebar">
        <span className="brand">
          <FringeMark />
          Fringe
        </span>
        <TabStrip
          tabs={state.tabs}
          activeId={state.activeId}
          onActivate={(id) => {
            dispatch({ type: 'activate', id });
            if (id === null) setView('budget');
          }}
          onClose={closeTab}
          renaming={renamingTab}
          onRenaming={setRenamingTab}
          onRename={renameBudget}
          working={chatWorking}
        />
        <button
          type="button"
          className="btn btn-small titlebar-ai"
          aria-pressed={panelOpen}
          title={`Ask the AI about this budget (${keys('Ctrl+J')})`}
          onClick={() => setPanelOpen((o) => !o)}
        >
          AI
        </button>
      </header>

      <nav className="sidebar" aria-label="Main">
        <SlidingHighlight selector=".nav-item[aria-current='page']" className="nav-slider" />
        <ul>
          {NAV.filter(shown).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={shownView === item.id ? 'page' : undefined}
                onClick={() => setView(item.id)}
              >
                {item.label}
                {item.comingSoon && <span className="badge">Soon</span>}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="nav-item nav-group"
              aria-expanded={addonsOpen}
              aria-current={shownView === 'addons' ? 'page' : undefined}
              onClick={() => {
                // The first click shows the page; then it opens and closes the list.
                if (shownView !== 'addons') {
                  setView('addons');
                  setAddonsOpen(true);
                } else setAddonsOpen((o) => !o);
              }}
            >
              <span className="nav-caret" aria-hidden="true" />
              Add-ons
            </button>
            {addonsOpen && addons.length > 0 && (
              <ul className="nav-sub">
                {addons.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="nav-item"
                      title={a.description || a.name}
                      aria-current={shownAddon?.id === a.id ? 'page' : undefined}
                      onClick={() => showAddon(a.id)}
                    >
                      {a.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
        <button
          type="button"
          className="nav-item nav-settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          Settings
        </button>
      </nav>

      <main className={lockShown ? 'workspace read-only' : 'workspace'}>
        {lockShown && active && <LockBar key={`lock ${active.id}`} tab={active} dispatch={dispatch} />}
        {shownView === 'settings' ? (
          <SettingsView info={info} />
        ) : shownView === 'budget' ? (
          active ? (
            <BudgetWorkspace
              key={active.id}
              tab={active}
              dispatch={dispatch}
              compare={() => showComparison(null)}
            />
          ) : (
            <StartView
              error={openError}
              onNew={(name) => void openInNewProject(newBudget(name), 'Created')}
              onOpen={() => void openProject()}
              onOpenRecent={(path) => void window.fringe.openRecentProject(path).then(opened)}
              onImport={() => void openFringeFile()}
              onConvert={() => void convertBudget()}
            />
          )
        ) : shownView === 'budget-settings' && active ? (
          <BudgetSettingsView
            key={active.id}
            budget={active.budget}
            update={(budget, label) =>
              dispatch({ type: 'update', id: active.id, budget, label: label ?? 'Budget settings' })
            }
          />
        ) : shownView === 'crew' && active ? (
          <CrewListView
            key={active.id}
            budget={active.budget}
            update={(budget, label) => dispatch({ type: 'update', id: active.id, budget, label })}
          />
        ) : shownView === 'reports' && active ? (
          <ReportsView
            key={active.id}
            budget={active.budget}
            history={active.history}
            compareFrom={compareFrom}
            setCompareFrom={setCompareFrom}
          />
        ) : shownView === 'import-report' && active ? (
          <ImportReportView
            key={active.id}
            budget={active.budget}
            openAccount={(categoryId, accountId) => {
              dispatch({ type: 'navigate', id: active.id, nav: { categoryId, accountId } });
              setView('budget');
            }}
          />
        ) : shownView === 'history' && active ? (
          <HistoryView
            tab={active}
            open={({ branchId, entryId, end }) => {
              dispatch(
                end
                  ? { type: 'openBranch', id: active.id, branchId }
                  : { type: 'goTo', id: active.id, entryId },
              );
              setView('budget');
            }}
            startBranch={(name, fromEntryId) => {
              dispatch({ type: 'createBranch', id: active.id, name, fromEntryId });
              setView('budget');
            }}
            renameBranch={(branchId, name) =>
              dispatch({ type: 'renameBranch', id: active.id, branchId, name })
            }
            setNotPicked={(branchId, notPicked) =>
              dispatch({ type: 'setNotPicked', id: active.id, branchId, notPicked })
            }
            saveVersion={(version) => dispatch({ type: 'saveVersion', id: active.id, version })}
            deleteVersion={(versionId) => dispatch({ type: 'deleteVersion', id: active.id, versionId })}
            clearDraft={() => dispatch({ type: 'draftVersion', id: active.id, draft: null })}
            showComparison={showComparison}
            copyToNew={(entryId, version, branchId) => {
              void (async () => {
                const taken = [
                  ...state.tabs.map((t) => t.budget.name),
                  ...(await window.fringe.recentProjects()).map((r) => r.name),
                ];
                const branch = branchId ? findBranch(active.history, branchId) : null;
                const name = copyName(
                  active.budget.name,
                  taken,
                  version,
                  branch && branch.id !== MAIN_BRANCH ? branch.name : undefined,
                );
                const copy = forkBudget(active.history, name, entryId);
                if (await openInNewProject(copy, `Copied from ${active.budget.name}`)) {
                  setView('budget');
                  // Ready to name: type over it, or Enter to keep it.
                  setRenamingTab(copy.id);
                }
              })();
            }}
          />
        ) : shownView === 'knowledge' && active?.project ? (
          <KnowledgeView key={active.id} project={active.project} />
        ) : shownView === 'addons' || (shownView === 'addon' && !shownAddon) ? (
          <AddonsView addons={addons} open={showAddon} build={askClaude} />
        ) : shownView === 'addon' && shownAddon ? (
          <AddonFrame
            key={`${shownAddon.id} ${shownAddon.version}`}
            addon={shownAddon}
            budget={active?.budget ?? null}
            update={
              active ? (budget, label) => dispatch({ type: 'update', id: active.id, budget, label }) : null
            }
            askClaude={askClaude}
          />
        ) : shownView === 'assistant' ? (
          <AssistantView activity={aiActivity} onOpenPanel={() => setPanelOpen(true)} />
        ) : (
          <PlannedView item={currentNav ?? NAV[0]!} />
        )}
      </main>

      <AiPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        budgets={openList}
        onWorking={setChatWorking}
        approvals={approvals}
        onDecide={decide}
        allowAll={allowAll}
        onAllowAll={changeAllowAll}
        onConnectedChange={setConnectedAi}
        seed={chatSeed}
      />

      <footer className="statusbar">
        <span>{info ? `v${info.version}` : ''}</span>
        <span>{info ? `Engine ${info.engineVersion}` : ''}</span>
        {active && (
          <span className="status-history">
            <button
              type="button"
              className="btn btn-small"
              disabled={!canUndo(active.history)}
              title={`Undo (${keys('Ctrl+Z')})`}
              onClick={() => dispatch({ type: 'undo', id: active.id })}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={!canRedo(active.history)}
              title={`Redo (${keys('Ctrl+Y')})`}
              onClick={() => dispatch({ type: 'redo', id: active.id })}
            >
              Redo
            </button>
          </span>
        )}
        <span className="status-spacer" />
        {active?.project && (
          <span className="status-save" title={active.project}>
            {active.saveError ? (
              <span className="error">Not saved: {active.saveError}</span>
            ) : active.unsaved.length > 0 ? (
              'Saving…'
            ) : (
              'Saved'
            )}{' '}
            <button
              type="button"
              className="btn btn-small"
              title="Show the project folder"
              onClick={() => void window.fringe.revealProject(active.project!)}
            >
              Show Folder
            </button>{' '}
            <button
              type="button"
              className="btn btn-small"
              title="Save this budget as one .fringe file, to send or back up"
              disabled={active.unsaved.length > 0}
              onClick={() => void exportProject(active.project!)}
            >
              Export…
            </button>
          </span>
        )}
        {notice && (
          <span className={notice.error ? 'error' : ''} role="status">
            {notice.text}
          </span>
        )}
        <span>{connectedAi ? `${connectedAi} connected` : 'Offline · No AI connected'}</span>
        {active && total !== null && (
          <span className="status-total" title="Budget total, including fringes">
            Budget total <strong>{formatMoney(total, active.budget.settings.displayPrecision)}</strong>
          </span>
        )}
        {active && netCost !== null && (
          <span className="status-total" title="The budget total less tax incentives">
            Net cost <strong>{formatMoney(netCost, active.budget.settings.displayPrecision)}</strong>
          </span>
        )}
      </footer>
    </div>
  );
}

function StartView({
  error,
  onNew,
  onOpen,
  onOpenRecent,
  onImport,
  onConvert,
}: {
  error: string | null;
  onNew(name: string): void;
  onOpen(): void;
  onOpenRecent(path: string): void;
  /** Opens a .fringe file. */
  onImport(): void;
  /** A budget from another program, for the AI to convert. */
  onConvert(): void;
}) {
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => {
    void window.fringe.recentProjects().then(setRecent);
  }, []);
  const forget = (path: string) =>
    void window.fringe.forgetRecentProject(path).then(() => window.fringe.recentProjects().then(setRecent));

  return (
    <section className="view view-scroll start">
      <div className="start-page">
        <header className="start-head">
          <div className="brand-lockup">
            <FringeMark size={44} />
            Fringe
          </div>
          <p className="start-tagline">Production budgets for film and television.</p>
        </header>

        <form
          className="start-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onNew(name.trim());
            else nameInput.current?.focus();
          }}
        >
          <label htmlFor="new-budget-name" className="start-label">
            New budget
          </label>
          <div className="start-new-row">
            <input
              id="new-budget-name"
              ref={nameInput}
              className="text-input"
              placeholder="Name it after the show"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary">
              Create
            </button>
          </div>
          <p className="start-hint">A project folder, saved as you work.</p>
        </form>

        <div className="start-tiles">
          <button type="button" className="start-tile" onClick={onOpen}>
            <strong>Open project…</strong>
            <span>A budget folder on this computer</span>
            <kbd>{keys('Ctrl+O')}</kbd>
          </button>
          <button type="button" className="start-tile" onClick={onImport}>
            <strong>Import .fringe file…</strong>
            <span>A budget someone sent you</span>
            <kbd>{keys('Ctrl+I')}</kbd>
          </button>
          <button type="button" className="start-tile" onClick={onConvert}>
            <strong>Convert a budget…</strong>
            <span>Made in another program; the AI converts it</span>
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {recent.length > 0 && (
          <section className="start-recent">
            <h2 className="start-label">Recent</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  {r.missing ? (
                    <div className="start-recent-row missing">
                      <span className="start-recent-name">{r.name}</span>
                      <span className="start-recent-path">Moved or deleted: {r.path}</span>
                      <button type="button" className="link-button" onClick={() => forget(r.path)}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="start-recent-row" onClick={() => onOpenRecent(r.path)}>
                      <span className="start-recent-name">{r.name}</span>
                      <span className="start-recent-path">{r.path}</span>
                      <span className="start-recent-when">{openedWhen(r.openedAt)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

/** A new id for a message waiting in the AI panel (only ever made in event handlers). */
const seedId = () => Date.now();

/** When a recent project was last opened: "Today", "Yesterday", or a date. */
function openedWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const message = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err);

function PlannedView({ item }: { item: NavItem }) {
  return (
    <section className="view">
      <div className="empty-state">
        <h1>{item.label}</h1>
        <p>{item.planned}</p>
        <p className="muted">{item.comingSoon ? 'Coming soon, in a later release.' : 'Not built yet.'}</p>
      </div>
    </section>
  );
}

function SettingsView({ info }: { info: AppInfo | null }) {
  return (
    <section className="view view-scroll">
      <h1>Settings</h1>

      <h2>Appearance</h2>
      <ThemePicker />

      <h3>Preview</h3>
      <p className="muted">Sample numbers, for checking theme legibility only.</p>
      <ThemePreviewGrid />

      <h2>Fringe Rates</h2>
      <FringeLibrarySettings />

      <h2>Global Knowledge</h2>
      <GlobalKnowledge />

      <h2>About</h2>
      {info && (
        <dl className="about">
          <dt>Version</dt>
          <dd>{info.version}</dd>
          <dt>Calculation engine</dt>
          <dd>{info.engineVersion}</dd>
          <dt>Platform</dt>
          <dd>
            {info.platform} {info.arch}
          </dd>
          <dt>License</dt>
          <dd>AGPL-3.0</dd>
        </dl>
      )}
    </section>
  );
}

const PREVIEW_ROWS = [
  { acct: '1100', desc: 'Writing', total: '150,000.00' },
  { acct: '1200', desc: 'Producers', total: '210,500.00' },
  { acct: '2000', desc: 'Production Staff', total: '384,212.50', changed: true },
  { acct: '2100', desc: 'Extra Talent', total: '12,400.00', excluded: true },
];

function ThemePreviewGrid() {
  return (
    <table className="grid preview-grid">
      <thead>
        <tr>
          <th className="num">Acct</th>
          <th>Description</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {PREVIEW_ROWS.map((r) => (
          <tr key={r.acct} className={r.excluded ? 'row-excluded' : r.changed ? 'row-changed' : undefined}>
            <td className="num">{r.acct}</td>
            <td>{r.desc}</td>
            <td className="num">{r.total}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td />
          <td>Total</td>
          <td className="num">744,712.50</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** The file's name from its path, whichever separator the system uses. */
const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;
