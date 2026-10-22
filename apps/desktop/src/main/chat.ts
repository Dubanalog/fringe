import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { type WebContents, app } from 'electron';
import {
  type ChatEvent,
  type ChatProvider,
  type ChatSettings,
  type ChatStatus,
  IpcChannel,
  KEY_PROVIDERS,
  type KeyProvider,
} from '../shared/ipc';
import importGuide from '../../../../docs/ai/import-assistant.md?raw';
import { budgetFolders, chatContext, instructionsForAll } from './ai-tools';
import { modelChoices, newApiChat, savedKeys, sendApiChat, stopApiChat } from './apichat';
import { PANEL_CLIENT_HEADER, type ToolCaller } from './mcp';
import { projectsRoot, writeAtomic } from './projects';

/**
 * The chat in the app's side panel. It runs the user's own Claude Code in the background (print
 * mode, JSON in and out) and turns what it says into chat events for the panel. Claude Code is
 * Anthropic's app and signs in with the user's own Claude plan; Fringe never sees that sign-in.
 *
 * Claude gets the app's tools (the budgets, and their files), and Read/Glob/Grep for files in the
 * budgets' project folders. Nothing else: no commands, no writing files. Anything that would
 * need permission is refused, and budget edits wait for the user's OK in the panel.
 */

/** How to convert a budget from another program's file: the import guide, after its notes for us. */
const CONVERSION_GUIDE = importGuide.slice(importGuide.indexOf('\n---\n') + 5).trim();

/** What the assistant is called, for the prompt and the panel. */
function assistantName(provider: ChatProvider): string {
  return provider === 'openai' ? 'GPT' : provider === 'gemini' ? 'Gemini' : 'Claude';
}

/**
 * What the assistant is told about the app and the user; `api` when the app runs the chat itself,
 * `forAll` the user's instructions for every budget.
 */
function systemPrompt(name: string, api: boolean, forAll: string | null): string {
  const files = api
    ? 'read_budget_file reads any file the user gives you: PDFs, pictures, Excel and other spreadsheets, Word documents, CSV, XML and other text.'
    : 'read_budget_file reads Excel and other spreadsheets, Word documents, CSV, XML and other text; use your Read tool for PDFs and pictures.';
  return `You are ${name}, working inside Fringe, a film and TV budgeting app, in its side panel.
The person you're talking to works in film and TV, not in software. Never mention terminals,
command lines, MCP, JSON, tool names or file paths unless they ask. Talk about the budget: accounts,
lines, fringes, globals, cutoffs.

More than one budget can be open. Each message starts with a note from Fringe saying which budget
is showing; "this budget" means that one, and the tools work on it unless you name another.
list_budgets lists the others, including recently opened budgets that aren't open: you can read
those but not change them. Only look at another budget when the user asks about it or names it:
each production's budget is confidential. When you compare budgets, say which is which.

Use the fringe tools to read and change budgets in the app. You can change everything:
categories, accounts, lines (description, amounts, units, rates, fringes, groups, codes), fringes,
globals, units, groups, codes, number formats, budget options, and topsheet percentages such as
contingency or a tax credit (worked out from the budget total, leaving out chosen groups; use these
rather than a category line). You can build a whole budget from
a brief: set up fringes and globals first, then add it a category at a time with its accounts and
lines, using globals for shoot days and weeks, then check the total with get_budget_summary.

The budget's saved versions (v1.0, v1.1…) are on the History tab. To say what changed between them,
use compare_versions, which works it out from the history (never from imported files or the
assumptions). When the user is about to save a version, fill in the History tab's form with
fill_version_form (they check it and click Save version); for a saved version use update_version.
Never put "What changed" in the assumptions.

The app shows the user each change and asks them to allow it (they can allow all for the chat), and
every change can be undone, so propose changes by making them; if the user doesn't allow one, ask
what they'd like instead. On a converted budget, never change a line's numbers just to make a total
match the file.

The user can give you a budget made in another program (an export, a spreadsheet, a PDF) and ask
you to convert it. Fringe has no importer for other programs' files: you read the file and build
the budget with your tools, following the conversion guide at the end.

The files the user gives you are in each budget's knowledge folder (list_budget_files). Read a
budget's knowledge/instructions.md before working on it. When the user asks you to remember something
or always do something a certain way, add it to their instructions with update_instructions (for one
budget or all budgets); say what you'll add first. ${files}

The user can have you build add-ons: pages on top of Fringe, such as a cash flow or a hiring plan,
that work on any budget and keep their own data in it. list_addons lists them and gives the guide
to building them (read it before save_addon). When the user asks about an add-on's figures, read
them with get_addon_data; to fill them in, use set_addon_data.

Keep answers short and plain. Use tables for numbers.${
    forAll ? `\n\nThe user's instructions for all budgets:\n\n${forAll}` : ''
  }

# Converting a budget from another program

${CONVERSION_GUIDE}`;
}

/** Built-in Claude Code tools the chat may use; everything else is switched off. */
const BUILT_IN_TOOLS = ['Read', 'Glob', 'Grep'];

/** Where Claude Code is installed, looking past PATH too (apps opened from the Dock get a short one). */
export function findClaude(): string | null {
  const home = homedir();
  const win = process.platform === 'win32';
  const dirs = [
    ...(process.env['PATH'] ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    ...(win
      ? [join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'npm')]
      : [join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']),
  ].filter(Boolean);
  for (const dir of dirs) {
    if (win) {
      if (existsSync(join(dir, 'claude.exe'))) return join(dir, 'claude.exe');
      // npm's claude.cmd starts this; running it directly avoids cmd's argument quoting.
      const npmExe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(join(dir, 'claude.cmd')) && existsSync(npmExe)) return npmExe;
    } else if (existsSync(join(dir, 'claude'))) return join(dir, 'claude');
  }
  return null;
}

interface Session {
  proc: ChildProcessWithoutNullStreams;
  /** The budget folders it may read; a new one means a restart (the conversation carries on). */
  folders: string;
  busy: boolean;
}

let session: Session | null = null;
/** Claude Code's id for this conversation, to carry it on after a restart. */
let conversationId: string | null = null;
let output: WebContents | null = null;

function emit(event: ChatEvent): void {
  if (output && !output.isDestroyed()) output.send(IpcChannel.chatEvent, event);
}

async function writeConfig(mcp: { url: string; token: string }): Promise<{ mcp: string; prompt: string }> {
  const dir = app.getPath('userData');
  const mcpFile = join(dir, 'chat-mcp.json');
  const promptFile = join(dir, 'chat-prompt.md');
  await writeAtomic(
    mcpFile,
    JSON.stringify({
      mcpServers: {
        fringe: {
          type: 'http',
          url: mcp.url,
          headers: { Authorization: `Bearer ${mcp.token}`, [PANEL_CLIENT_HEADER]: 'panel' },
        },
      },
    }),
  );
  await writeAtomic(promptFile, systemPrompt('Claude', false, await instructionsForAll()));
  return { mcp: mcpFile, prompt: promptFile };
}

/** What a user sees for one of Claude's steps, e.g. "Looked at account 2100". */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const step = describeStep(name, input);
  const budget = input['budget'];
  return typeof budget === 'string' && budget.trim() !== '' ? `${step} (${budget.trim()})` : step;
}

function describeStep(name: string, input: Record<string, unknown>): string {
  const tool = name.replace(/^mcp__fringe__/, '');
  const file = (p: unknown) => (typeof p === 'string' ? (p.split(/[\\/]/).pop() ?? p) : 'a file');
  switch (tool) {
    case 'list_budgets':
      return 'Looked at the list of budgets';
    case 'get_budget_summary':
      return 'Looked over the budget';
    case 'get_account':
      return `Looked at account ${String(input['account'] ?? '')}`.trim();
    case 'get_import_report':
      return 'Checked the import report';
    case 'get_fringe_bases':
      return 'Checked the fringe bases';
    case 'record_file_figures':
      return "Noted the file's totals to check against";
    case 'set_global':
      return `Changed global ${String(input['name'] ?? '')}`.trim();
    case 'set_fringe_cutoff':
      return 'Changed a fringe cutoff';
    case 'set_unit_hours':
      return 'Changed unit hours';
    case 'set_fringe_range':
    case 'remove_fringe_ranges':
      return 'Changed fringe ranges';
    case 'set_fringe_posting':
      return 'Changed where a fringe posts';
    case 'add_category':
      return `Added category ${String(input['description'] ?? '')}`.trim();
    case 'add_account':
      return `Added account ${String(input['description'] ?? '')}`.trim();
    case 'add_lines':
      return `Added lines to ${String(input['account'] ?? '')}`.trim();
    case 'update_lines':
      return `Changed lines in ${String(input['account'] ?? '')}`.trim();
    case 'delete_lines':
      return `Deleted lines in ${String(input['account'] ?? '')}`.trim();
    case 'move_lines':
      return `Moved lines in ${String(input['account'] ?? '')}`.trim();
    case 'delete_accounts':
      return 'Deleted accounts';
    case 'delete_categories':
      return 'Deleted categories';
    case 'move_account':
      return `Moved account ${String(input['account'] ?? '')}`.trim();
    case 'renumber_and_rename':
      return 'Renumbered or renamed';
    case 'set_number_patterns':
      return 'Changed the number format';
    case 'set_fringe':
      return `Set up fringe ${String(input['name'] ?? '')}`.trim();
    case 'delete_fringe':
      return `Deleted fringe ${String(input['name'] ?? '')}`.trim();
    case 'delete_unit':
      return `Deleted unit ${String(input['name'] ?? '')}`.trim();
    case 'rename_global':
      return `Renamed global ${String(input['name'] ?? '')}`.trim();
    case 'delete_global':
      return `Deleted global ${String(input['name'] ?? '')}`.trim();
    case 'set_group':
      return `Set up group ${String(input['name'] ?? '')}`.trim();
    case 'delete_group':
      return `Deleted group ${String(input['name'] ?? '')}`.trim();
    case 'set_code':
      return `Set up code ${String(input['code'] ?? '')}`.trim();
    case 'delete_code':
      return `Deleted code ${String(input['code'] ?? '')}`.trim();
    case 'set_percentage':
      return `Set ${String(input['name'] ?? 'a percentage')}`;
    case 'delete_percentage':
      return `Took off ${String(input['name'] ?? 'a percentage')}`;
    case 'set_budget_options':
      return 'Changed budget options';
    case 'list_budget_files':
      return "Looked at the budget's files";
    case 'list_addons':
      return 'Looked at the add-ons';
    case 'read_addon':
      return `Read the add-on ${String(input['addon'] ?? '')}`.trim();
    case 'save_addon':
      return `${input['addon'] ? 'Changed' : 'Built'} the add-on ${String(input['name'] ?? '')}`.trim();
    case 'open_addon':
      return 'Opened the add-on';
    case 'get_addon_data':
      return `Read the ${String(input['addon'] ?? 'add-on')} figures`;
    case 'set_addon_data':
      return `Filled in ${String(input['addon'] ?? 'the add-on')}`;
    case 'read_budget_file':
      return `Read ${file(input['name'])}`;
    case 'Read':
      return `Read ${file(input['file_path'])}`;
    case 'Glob':
    case 'Grep':
      return 'Searched the files';
    default:
      return tool.replace(/_/g, ' ');
  }
}

/** Claude Code's output, a JSON object per line. */
function handleLine(line: string, s: Session): void {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof m['session_id'] === 'string') conversationId = m['session_id'];
  switch (m['type']) {
    case 'stream_event': {
      const ev = m['event'] as { type?: string; delta?: { type?: string; text?: string } } | undefined;
      if (m['parent_tool_use_id']) return; // A helper's own steps.
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        emit({ type: 'text', text: ev.delta.text });
      } else if (ev?.type === 'content_block_start') {
        const block = (ev as { content_block?: { type?: string } }).content_block;
        if (block?.type === 'thinking') emit({ type: 'thinking' });
      }
      return;
    }
    case 'assistant': {
      if (m['parent_tool_use_id']) return;
      const content = (m['message'] as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (block.type === 'tool_use' && block.name) {
          emit({ type: 'step', name: block.name, label: describeTool(block.name, block.input ?? {}) });
        }
      }
      return;
    }
    case 'result': {
      s.busy = false;
      const text = typeof m['result'] === 'string' ? m['result'] : '';
      if (m['is_error'] === true || m['subtype'] !== 'success') {
        if (/log ?in|logged in|\/login|authenticat|api key/i.test(text)) {
          emit({ type: 'setup', problem: 'signed-out', detail: text });
        } else emit({ type: 'turn-end', error: text || 'Claude stopped with an error.' });
      } else emit({ type: 'turn-end', error: null });
      return;
    }
  }
}

function startSession(
  exe: string,
  cwd: string,
  folders: string[],
  files: { mcp: string; prompt: string },
): Session {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config',
    files.mcp,
    '--strict-mcp-config',
    '--tools',
    BUILT_IN_TOOLS.join(','),
    '--allowedTools',
    [...BUILT_IN_TOOLS, 'mcp__fringe'].join(','),
    '--permission-prompts',
    'none',
    '--append-system-prompt-file',
    files.prompt,
  ];
  for (const folder of folders) args.push('--add-dir', folder);
  if (conversationId) args.push('--resume', conversationId);
  const proc = spawn(exe, args, {
    cwd,
    env: { ...process.env, MCP_TOOL_TIMEOUT: String(24 * 60 * 60_000) },
    windowsHide: true,
  });
  const s: Session = { proc, folders: folders.join('\n'), busy: false };
  let pending = '';
  let errors = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    pending += chunk;
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (line) handleLine(line, s);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    errors = (errors + chunk).slice(-4000);
  });
  proc.on('error', (err) => {
    if (session === s) session = null;
    emit({ type: 'turn-end', error: `Claude couldn't start: ${err.message}` });
  });
  proc.on('exit', () => {
    const wasBusy = s.busy;
    if (session === s) session = null;
    if (wasBusy) {
      const detail = errors.trim().split('\n').pop() ?? '';
      if (/log ?in|logged in|authenticat/i.test(errors))
        emit({ type: 'setup', problem: 'signed-out', detail });
      else emit({ type: 'turn-end', error: detail || 'Claude stopped.' });
    }
  });
  return s;
}

const settingsFile = () => join(app.getPath('userData'), 'chat-settings.json');

interface SavedSettings {
  provider: ChatProvider;
  /** The model chosen for each company's key. */
  models: Partial<Record<KeyProvider, string>>;
  /** The user has read what the AI sees and sends (the panel's first-use notice). */
  noticeAccepted: boolean;
}

const isProvider = (p: unknown): p is ChatProvider =>
  p === 'claude-code' || KEY_PROVIDERS.includes(p as KeyProvider);

async function savedSettings(): Promise<SavedSettings> {
  let saved: { provider?: unknown; model?: unknown; models?: unknown; noticeAccepted?: unknown } = {};
  try {
    saved = JSON.parse(await readFile(settingsFile(), 'utf8')) as typeof saved;
  } catch {
    // Defaults.
  }
  const models: Partial<Record<KeyProvider, string>> = {};
  if (typeof saved.models === 'object' && saved.models) {
    for (const p of KEY_PROVIDERS) {
      const m = (saved.models as Record<string, unknown>)[p];
      if (typeof m === 'string' && m) models[p] = m;
    }
  }
  const noticeAccepted = saved.noticeAccepted === true;
  // Before OpenAI and Gemini, an Anthropic key was just "api-key", with one model.
  if (saved.provider === 'api-key') {
    if (typeof saved.model === 'string' && !models.anthropic) models.anthropic = saved.model;
    return { provider: 'anthropic', models, noticeAccepted };
  }
  return { provider: isProvider(saved.provider) ? saved.provider : 'claude-code', models, noticeAccepted };
}

/** The model a company's key uses: the one chosen, if the key can still use it, or the best one. */
async function modelFor(provider: KeyProvider, saved: SavedSettings): Promise<string> {
  const choices = await modelChoices(provider);
  const chosen = saved.models[provider];
  if (chosen && (choices.length === 0 || choices.some((m) => m.id === chosen))) return chosen;
  return choices[0]?.id ?? chosen ?? '';
}

/** How the panel's chat reaches the AI: Claude Code (the user's plan) or one of their API keys. */
export async function chatSettings(): Promise<ChatSettings> {
  const saved = await savedSettings();
  return {
    provider: saved.provider,
    model: saved.provider === 'claude-code' ? '' : await modelFor(saved.provider, saved),
    noticeAccepted: saved.noticeAccepted,
  };
}

export async function setChatSettings(change: {
  provider?: unknown;
  model?: unknown;
  noticeAccepted?: unknown;
}): Promise<ChatStatus> {
  const saved = await savedSettings();
  const provider = isProvider(change.provider) ? change.provider : saved.provider;
  const models = { ...saved.models };
  if (provider !== 'claude-code' && typeof change.model === 'string') {
    if ((await modelChoices(provider)).some((m) => m.id === change.model)) models[provider] = change.model;
  }
  if (provider !== saved.provider) newChat();
  const noticeAccepted = saved.noticeAccepted || change.noticeAccepted === true;
  await writeAtomic(settingsFile(), JSON.stringify({ provider, models, noticeAccepted }));
  return chatStatus();
}

/**
 * Sends the user's message. With an API key the app runs the chat itself; otherwise it starts
 * Claude Code if it isn't running, or again in the right folder if the budget showing has changed
 * (the conversation carries on).
 */
export async function sendChat(
  contents: WebContents,
  text: string,
  connect: () => Promise<{ url: string; token: string }>,
  callTool: ToolCaller,
): Promise<void> {
  output = contents;
  const settings = await chatSettings();
  if (!settings.noticeAccepted) throw new Error('Read and accept the note about AI in the panel first.');
  const message = `${chatContext()}\n\n${text}`;
  if (settings.provider !== 'claude-code') {
    if (!settings.model) {
      emit({ type: 'turn-end', error: "Couldn't find a model to use. Check the internet connection." });
      return;
    }
    await sendApiChat(contents, message, {
      provider: settings.provider,
      model: settings.model,
      system: systemPrompt(assistantName(settings.provider), true, await instructionsForAll()),
      callTool,
      describe: describeTool,
    });
    return;
  }
  const mcp = await connect();
  const exe = findClaude();
  if (!exe) {
    emit({ type: 'setup', problem: 'not-installed', detail: '' });
    return;
  }
  // Claude Code starts in the budgets folder and may read every budget's folder the AI can see.
  const cwd = projectsRoot();
  await mkdir(cwd, { recursive: true });
  const folders = await budgetFolders();
  if (session && (session.folders !== folders.join('\n') || session.proc.exitCode !== null)) stopChat();
  if (!session) session = startSession(exe, cwd, folders, await writeConfig(mcp));
  session.busy = true;
  session.proc.stdin.write(
    `${JSON.stringify({ type: 'user', message: { role: 'user', content: message } })}\n`,
  );
}

/** Stops Claude mid-answer. The conversation carries on with the next message. */
export function stopChat(): void {
  stopApiChat();
  const s = session;
  session = null;
  if (s) {
    s.busy = false;
    s.proc.kill();
  }
}

/** Starts a new conversation. */
export function newChat(): void {
  stopChat();
  newApiChat();
  conversationId = null;
}

/** How the chat is set up, and whether it's ready: Claude Code installed and signed in, or a key. */
export async function chatStatus(): Promise<ChatStatus> {
  const settings = await chatSettings();
  const keys = await savedKeys();
  const p = settings.provider;
  const base = {
    ...settings,
    keys,
    hasKey: p !== 'claude-code' && keys[p],
    models: p === 'claude-code' ? [] : await modelChoices(p),
    assistant: assistantName(p),
  };
  return { ...base, ...(await claudeCodeStatus()) };
}

async function claudeCodeStatus(): Promise<{ installed: boolean; signedIn: boolean }> {
  const exe = findClaude();
  if (!exe) return { installed: false, signedIn: false };
  const out = await new Promise<string>((resolve) => {
    execFile(exe, ['auth', 'status'], { windowsHide: true, timeout: 20_000 }, (_err, stdout) =>
      resolve(String(stdout)),
    );
  });
  try {
    return { installed: true, signedIn: (JSON.parse(out) as { loggedIn?: unknown }).loggedIn === true };
  } catch {
    // Can't tell; let the first message find out.
    return { installed: true, signedIn: true };
  }
}

let signingIn: ChildProcessWithoutNullStreams | null = null;

/**
 * Signs in to Claude Code with the user's Claude plan, without a terminal: Claude Code opens
 * Anthropic's sign-in page in the user's browser and finishes by itself once they approve. If the
 * browser can't hand back to it, the page shows a code for the user to paste (signInCode).
 */
export function signIn(contents: WebContents): void {
  output = contents;
  const exe = findClaude();
  if (!exe) {
    emit({ type: 'setup', problem: 'not-installed', detail: '' });
    return;
  }
  cancelSignIn();
  const proc = spawn(exe, ['auth', 'login', '--claudeai'], { windowsHide: true });
  signingIn = proc;
  let said = '';
  let url: string | null = null;
  const read = (chunk: Buffer) => {
    said = (said + chunk.toString('utf8')).slice(-8000);
    const found = /https:\/\/\S+/.exec(said)?.[0] ?? null;
    if (found && found !== url) {
      url = found;
      emit({ type: 'sign-in', state: 'waiting', url, error: null });
    }
  };
  proc.stdout.on('data', read);
  proc.stderr.on('data', read);
  emit({ type: 'sign-in', state: 'waiting', url: null, error: null });
  proc.on('error', (err) => {
    if (signingIn === proc) signingIn = null;
    emit({ type: 'sign-in', state: 'failed', url: null, error: err.message });
  });
  proc.on('exit', (code) => {
    if (signingIn !== proc) return; // Cancelled.
    signingIn = null;
    void chatStatus().then(({ signedIn }) => {
      if (signedIn) {
        stopChat(); // The next message starts Claude Code again, signed in.
        emit({ type: 'sign-in', state: 'signed-in', url: null, error: null });
      } else {
        const last = said.trim().split('\n').pop() ?? '';
        emit({
          type: 'sign-in',
          state: 'failed',
          url: null,
          error: code === 0 ? "You aren't signed in yet." : last || "Signing in didn't finish.",
        });
      }
    });
  });
}

/** The code from Anthropic's sign-in page, when the browser couldn't hand back by itself. */
export function signInCode(code: string): void {
  signingIn?.stdin.write(`${code.trim()}\n`);
}

export function cancelSignIn(): void {
  const p = signingIn;
  signingIn = null;
  if (!p) return;
  p.kill();
  emit({ type: 'sign-in', state: 'failed', url: null, error: null });
}
