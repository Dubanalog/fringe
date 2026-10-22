import type {
  Budget,
  BudgetHistory,
  HistoryEvent,
  LibraryFringe,
  ProjectFile,
  ReportDoc,
} from '@fringe/budget-engine';

/**
 * The complete IPC surface between the renderer and the main process.
 * The renderer gets no Node.js access; everything it can do is listed here,
 * and every handler validates its input in the main process.
 */

export const IpcChannel = {
  getAppInfo: 'app:get-info',
  setNativeTheme: 'app:set-native-theme',
  createProject: 'project:create',
  openProject: 'project:open',
  openRecentProject: 'project:open-recent',
  saveProject: 'project:save',
  closeProject: 'project:close',
  recentProjects: 'project:recent',
  forgetRecentProject: 'project:forget-recent',
  revealProject: 'project:reveal',
  exportProject: 'project:export',
  openFringeFile: 'project:open-fringe-file',
  pickBudgetToConvert: 'project:pick-convert',
  openDropped: 'project:open-dropped',
  takeOpenedFiles: 'project:take-opened-files',
  /** Main → renderer: .fringe files were opened from the system (double-clicked), ready to take. */
  filesOpened: 'project:files-opened',
  mcpStatus: 'ai:mcp-status',
  setMcpEnabled: 'ai:mcp-enable',
  newMcpToken: 'ai:mcp-new-token',
  copyText: 'app:copy-text',
  readText: 'app:read-text',
  /** Main → renderer: run a budget tool for a connected AI. */
  toolCall: 'ai:tool-call',
  toolResult: 'ai:tool-result',
  terminalStart: 'terminal:start',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalStop: 'terminal:stop',
  /** Main → renderer: terminal output. */
  terminalData: 'terminal:data',
  /** Main → renderer: the terminal's shell ended, with its exit code. */
  terminalExit: 'terminal:exit',
  chatSend: 'chat:send',
  chatStop: 'chat:stop',
  chatNew: 'chat:new',
  chatStatus: 'chat:status',
  chatSignIn: 'chat:sign-in',
  chatSignInCode: 'chat:sign-in-code',
  chatSignInCancel: 'chat:sign-in-cancel',
  chatSettings: 'chat:settings',
  chatSetKey: 'chat:set-key',
  chatClearKey: 'chat:clear-key',
  /** Main → renderer: what Claude is saying and doing. */
  chatEvent: 'chat:event',
  setOpenBudgets: 'project:open-budgets',
  openAllInstructions: 'files:open-all-instructions',
  budgetFiles: 'files:list',
  addBudgetFiles: 'files:add',
  addBudgetFilePaths: 'files:add-paths',
  openBudgetFile: 'files:open',
  saveReport: 'reports:save',
  saveBudgetCsv: 'reports:save-csv',
  saveVersionPdf: 'versions:save-pdf',
  revealVersionPdf: 'versions:reveal-pdf',
  fringeLibrary: 'fringe-library:get',
  saveFringeLibrary: 'fringe-library:save',
  exportFringeLibrary: 'fringe-library:export',
  importFringeLibrary: 'fringe-library:import',
  addonsList: 'addons:list',
  addonsRemove: 'addons:remove',
  addonsReveal: 'addons:reveal',
  addonsAddFile: 'addons:add-file',
  /** Main → renderer: an add-on was added, changed or removed. */
  addonsChanged: 'addons:changed',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  engineVersion: string;
  platform: string;
  arch: string;
  electron: string;
}

/** Controls native UI (menus, scrollbars, title bar) to match the app theme. */
export type NativeThemeSource = 'system' | 'light' | 'dark';

export interface FringeApi {
  getAppInfo(): Promise<AppInfo>;
  setNativeTheme(source: NativeThemeSource): Promise<void>;
  /** Makes a new project folder for a budget, named after it, in the projects folder. */
  createProject(name: string): Promise<{ path: string; project: ProjectFile }>;
  /** Shows a folder picker and opens the project. Resolves null if the user cancels. */
  openProject(): Promise<OpenProjectResult | null>;
  openRecentProject(path: string): Promise<OpenProjectResult>;
  /** Writes new history events and the current budget to an open project. */
  saveProject(path: string, budget: Budget, events: HistoryEvent[]): Promise<void>;
  closeProject(path: string): Promise<void>;
  recentProjects(): Promise<RecentProject[]>;
  forgetRecentProject(path: string): Promise<void>;
  /** Shows the project folder in the system file manager. */
  revealProject(path: string): Promise<void>;
  /** Asks where, then saves an open project as one .fringe file. Null if the user cancels. */
  exportProject(path: string): Promise<ExportProjectResult | null>;
  /** Asks where to save the reports, then writes them as a PDF, Excel workbook or JSON. Null if cancelled. */
  saveReport(
    format: ReportFormat,
    doc: ReportDoc,
    name: string,
    landscape: boolean,
  ): Promise<SaveReportResult | null>;
  /** Asks where to save the budget's CSV (accounts and topsheet), then writes it. Null if cancelled. */
  saveBudgetCsv(csv: string, name: string): Promise<SaveReportResult | null>;
  /**
   * Saves a version's reports as a PDF in the project's versions folder, named `name` (e.g.
   * "Pilot v1.0"). On success, `file` is the file name in that folder.
   */
  saveVersionPdf(path: string, name: string, doc: ReportDoc, landscape: boolean): Promise<SaveReportResult>;
  /** Shows a version's PDF in the system file manager; false when it isn't there any more. */
  revealVersionPdf(path: string, file: string): Promise<boolean>;
  /** The fringe rate library: the user's own rates, kept on this computer. */
  fringeLibrary(): Promise<LibraryFringe[]>;
  /** Replaces the library; resolves with it as saved (names trimmed, unusable values refused). */
  saveFringeLibrary(fringes: LibraryFringe[]): Promise<LibraryFringe[]>;
  /** Asks where, then saves the library as a file to share. Null if the user cancels. */
  exportFringeLibrary(): Promise<SaveReportResult | null>;
  /** Asks for a rate library file and merges it in: same names are replaced. Null if cancelled. */
  importFringeLibrary(): Promise<ImportLibraryResult | null>;
  /** Asks for a .fringe file, unpacks it into a new project folder and opens it. */
  openFringeFile(): Promise<OpenProjectResult | null>;
  /** Asks for a budget made in another program, for the AI to convert. Its path, or null. */
  pickBudgetToConvert(): Promise<string | null>;
  /**
   * Something dropped on the window: a project folder or .fringe file opens; anything else is a
   * budget from another program, to convert.
   */
  openDropped(path: string): Promise<OpenProjectResult | { convert: string }>;
  /** Opens the .fringe files the system handed the app (e.g. double-clicked), once each. */
  takeOpenedFiles(): Promise<OpenProjectResult[]>;
  /** Tells the window when the system hands the app more files; returns a function that stops it. */
  onFilesOpened(handler: () => void): () => void;
  /** Whether AI apps can connect to this app (its MCP server), and how. */
  mcpStatus(): Promise<McpStatus>;
  setMcpEnabled(enabled: boolean): Promise<McpStatus>;
  /** Replaces the connection token; apps given the old one are cut off. */
  newMcpToken(): Promise<McpStatus>;
  copyText(text: string): Promise<void>;
  /** The clipboard's text, e.g. cells copied from a spreadsheet. */
  readText(): Promise<string>;
  /**
   * Runs budget tools for a connected AI. The handler runs each call on the budget showing and
   * replies; returns a function that stops listening.
   */
  onToolCall(handler: (call: ToolCall) => Promise<ToolReply>): () => void;
  /**
   * Starts the side panel's terminal running Claude Code, connected to the app (this turns on
   * the connection). If it is already running, picks it up again.
   */
  startTerminal(size: TerminalStart): Promise<{ ok: true } | { ok: false; error: string }>;
  terminalInput(data: string): void;
  resizeTerminal(cols: number, rows: number): void;
  stopTerminal(): Promise<void>;
  /** Terminal output; returns a function that stops listening. */
  onTerminalData(handler: (data: string) => void): () => void;
  onTerminalExit(handler: (code: number) => void): () => void;
  /** Sends a message to Claude in the side panel's chat; replies arrive through onChatEvent. */
  sendChat(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Stops Claude mid-answer. */
  stopChat(): Promise<void>;
  /** Forgets the conversation; the next message starts a new one. */
  newChat(): Promise<void>;
  /** Whether Claude Code is installed and signed in. */
  chatStatus(): Promise<ChatStatus>;
  /** Signs in to Claude in the user's browser; progress arrives as 'sign-in' chat events. */
  signIn(): Promise<void>;
  /** The code from the sign-in page, if it shows one. */
  signInCode(code: string): Promise<void>;
  cancelSignIn(): Promise<void>;
  /** Chooses how the chat reaches the AI (Claude Code or an API key) and which model a key uses. */
  setChatSettings(change: Partial<ChatSettings>): Promise<ChatStatus>;
  /** Checks the user's API key with its company and keeps it, encrypted; the chat then uses it. */
  setApiKey(
    provider: KeyProvider,
    key: string,
  ): Promise<{ ok: true; status: ChatStatus } | { ok: false; error: string }>;
  clearApiKey(provider: KeyProvider): Promise<ChatStatus>;
  onChatEvent(handler: (event: ChatEvent) => void): () => void;
  /** Tells the app which budgets are open and which is showing, for the AI's tools. */
  setOpenBudgets(budgets: OpenBudget[]): void;
  /** Opens the instructions the AI follows for every budget, making the file if needed. */
  openAllInstructions(): Promise<void>;
  /** The files kept with a project: its knowledge folder. */
  budgetFiles(project: string): Promise<BudgetFile[]>;
  /** Shows a file picker and copies the chosen files into the project's knowledge folder. */
  addBudgetFiles(project: string): Promise<string[]>;
  /** Copies files (dropped on the window) into the project's knowledge folder. */
  addBudgetFilePaths(project: string, paths: string[]): Promise<string[]>;
  /** Opens a project file in the program the system uses for it. */
  openBudgetFile(project: string, name: string): Promise<void>;
  /** The path of a file dropped on the window. */
  pathForFile(file: File): string;
  /** The add-ons, for every budget. */
  listAddons(): Promise<AddonInfo[]>;
  /** Moves an add-on to the trash. */
  removeAddon(id: string): Promise<void>;
  /** Shows an add-on's file in the system file manager (or the add-ons folder, given no id). */
  revealAddon(id: string | null): Promise<void>;
  /** Asks for an add-on's .html file (one shared by someone else) and adds it. Null if cancelled. */
  addAddonFile(): Promise<{ ok: true; addon: AddonInfo } | { ok: false; error: string } | null>;
  /** Tells the window when add-ons change; returns a function that stops it. */
  onAddonsChanged(handler: () => void): () => void;
}

/** An add-on: a page built on top of Fringe that works on any budget (see main/addons.ts). */
export interface AddonInfo {
  /** e.g. "cash-flow"; also where it keeps its data in a budget. */
  id: string;
  name: string;
  description: string;
  /** What it keeps in a budget, for the AI. */
  aboutData: string;
  version: number;
  /** When it was last saved (ISO). */
  updated: string;
}

export type ChatEvent =
  /** More of Claude's answer. */
  | { type: 'text'; text: string }
  /** Claude is thinking before it answers. */
  | { type: 'thinking' }
  /** Something Claude did, in plain words, e.g. "Looked at account 2100". */
  | { type: 'step'; name: string; label: string }
  /** Claude has finished answering. */
  | { type: 'turn-end'; error: string | null }
  /** Claude Code isn't installed or signed in, or the API key is missing or was refused. */
  | { type: 'setup'; problem: 'not-installed' | 'signed-out' | 'needs-key'; detail: string }
  /** Signing in: waiting for the browser (with the page's address, once known), done, or failed. */
  | { type: 'sign-in'; state: 'waiting' | 'signed-in' | 'failed'; url: string | null; error: string | null };

/** The companies whose API keys the chat can use. */
export const KEY_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
/** Claude Code (the user's Claude plan), or one company's API key. */
export type ChatProvider = 'claude-code' | KeyProvider;

export interface ChatSettings {
  provider: ChatProvider;
  /** The model the chosen API key uses. */
  model: string;
  /** The user has read the panel's first-use note on what the AI sees and where it goes. */
  noticeAccepted: boolean;
}

export interface ChatStatus extends ChatSettings {
  /** Claude Code is installed, and signed in. */
  installed: boolean;
  signedIn: boolean;
  /** Which companies have a key saved. */
  keys: Record<KeyProvider, boolean>;
  /** The chosen company has a key saved. */
  hasKey: boolean;
  /** The models the chosen key can use, best first; empty when that isn't known yet. */
  models: { id: string; label: string }[];
  /** What the assistant is called: Claude, GPT or Gemini. */
  assistant: string;
}

export interface TerminalStart {
  cols: number;
  rows: number;
}

export interface McpStatus {
  /** The user has let AI apps connect. */
  enabled: boolean;
  running: boolean;
  /** e.g. http://127.0.0.1:47615/mcp */
  url: string | null;
  /** The bearer token clients send. */
  token: string | null;
  error: string | null;
}

/**
 * Not a tool: main asks the window to have the user allow a change it makes itself (a file), shown
 * in the chat panel. Input: ApprovalRequest. The reply's result is `{ allowed: boolean }`.
 */
export const APPROVE_CALL = 'fringe:approve';

/** Not a tool: main asks the window to show an add-on. Input: `{ addon: id }`. */
export const OPEN_ADDON_CALL = 'fringe:open-addon';

export interface ApprovalRequest {
  /** What changes, e.g. "your instructions". */
  budget: string;
  text: string;
  /** The text being written, shown under it. */
  detail?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** From the app's chat panel: an edit waits for the user to allow it. */
  confirm: boolean;
  /** The tab of the budget to work on; null for the one showing. */
  tab: string | null;
}

/** A budget open in the window, as the window tells the app. */
export interface OpenBudget {
  tab: string;
  name: string;
  /** Its project folder; null when it isn't saved anywhere. */
  project: string | null;
  showing: boolean;
}

/** A file kept with a budget, named from its project folder, e.g. "knowledge/rates.csv". */
export interface BudgetFile {
  name: string;
  size: number;
  modified: string;
}

export type ToolReply = { ok: true; result: unknown } | { ok: false; error: string };

export interface OpenedProject {
  path: string;
  project: ProjectFile;
  history: BudgetHistory;
  /** Something the user should know, e.g. history that couldn't be read. */
  warning: string | null;
  isNew: boolean;
}

export type OpenProjectResult = ({ ok: true } & OpenedProject) | { ok: false; error: string };

export type ExportProjectResult = { ok: true; file: string } | { ok: false; error: string };

export type ReportFormat = 'pdf' | 'xlsx' | 'json';
export type SaveReportResult = { ok: true; file: string } | { ok: false; error: string };

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  /** The folder is no longer there (moved or deleted). */
  missing: boolean;
}

export type ImportLibraryResult =
  { ok: true; library: LibraryFringe[]; added: number; replaced: number } | { ok: false; error: string };
