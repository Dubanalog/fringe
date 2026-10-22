import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import icon from '../../build/icon.png?asset';
import { ENGINE_VERSION } from '@fringe/budget-engine';
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import {
  type AppInfo,
  type ExportProjectResult,
  IpcChannel,
  type NativeThemeSource,
  type McpStatus,
  type OpenProjectResult,
  type SaveReportResult,
  type ToolReply,
  KEY_PROVIDERS,
  type KeyProvider,
} from '../shared/ipc';
import { type ToolCaller, mcpStatus, newMcpToken, startMcpServer, stopMcpServer } from './mcp';
import {
  checkedReport,
  isReportFormat,
  revealVersionPdf,
  saveBudgetCsv,
  saveReport,
  saveVersionPdf,
} from './reports';
import { resizeTerminal, startTerminal, stopTerminal, writeTerminal } from './terminal';
import { clearApiKey, setApiKey } from './apichat';
import {
  addonIdForDraft,
  addonProblem,
  isAddonUrl,
  listAddons,
  registerAddonScheme,
  removeAddon,
  revealAddon,
  saveAddon,
  serveAddons,
} from './addons';

const isKeyProvider = (p: unknown): p is KeyProvider => KEY_PROVIDERS.includes(p as KeyProvider);
import {
  cancelSignIn,
  chatSettings,
  chatStatus,
  newChat,
  sendChat,
  setChatSettings,
  signIn,
  signInCode,
  stopChat,
} from './chat';
import { addKnowledgeFiles, budgetFilePath, isDocument, listBudgetFiles } from './knowledge';
import { FRINGE_EXTENSION } from './fringe-file';
import { type WindowCaller, allInstructionsPath, routeBudgetTools, setOpenBudgets } from './ai-tools';
import {
  closeProject,
  createProject,
  exportProject,
  forgetRecent,
  importFringeFile,
  isOpenProject,
  openProject,
  projectsRoot,
  recentProjects,
  saveProject,
  writeAtomic,
} from './projects';

const isDev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] !== undefined;

const repoUrl = 'https://github.com/Dubanalog/fringe';

// Everything happens in the window, so the menu bar is only File > Exit and Help, whose links open
// in the user's browser. The Mac keeps its app, Edit and Window menus: there, copy and paste in
// text boxes go through the Edit menu, and About is in the app menu. Development keeps Electron's
// full menu, for reload and the developer tools.
function setMenu(): void {
  if (isDev) return;
  const mac = process.platform === 'darwin';
  app.setAboutPanelOptions({
    applicationName: 'Fringe',
    applicationVersion: app.getVersion(),
    copyright: 'Free software under the GNU AGPL-3.0',
    website: repoUrl,
  });
  const help: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      { label: 'Fringe Manual', click: () => void shell.openExternal(`${repoUrl}/blob/main/docs/manual.md`) },
      { label: 'Fringe on GitHub', click: () => void shell.openExternal(repoUrl) },
      { label: 'Report a Problem', click: () => void shell.openExternal(`${repoUrl}/issues`) },
      ...(mac
        ? []
        : [
            { type: 'separator' } as const,
            {
              label: 'About Fringe',
              click: () =>
                void dialog.showMessageBox({
                  title: 'About Fringe',
                  message: `Fringe ${app.getVersion()}`,
                  detail: `Production budgeting for film and television.\nFree software under the GNU AGPL-3.0.\n${repoUrl}`,
                  icon,
                }),
            },
          ]),
    ],
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      mac
        ? [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }, help]
        : [{ role: 'fileMenu' }, help],
    ),
  );
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Fringe',
    // Installed apps get theirs from the installer; this one shows in development and on Linux.
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // The renderer never navigates or opens windows. External http(s) links open
  // in the user's browser; everything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // Frames inside: the report previews (srcdoc) and add-ons, which stay on their own pages.
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (!isAddonUrl(event.url) && !/^about:(srcdoc|blank)$/.test(event.url)) event.preventDefault();
  });
  // No peer-to-peer connections around the add-ons' no-network rule.
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    engineVersion: ENGINE_VERSION,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  }));

  ipcMain.handle(IpcChannel.setNativeTheme, (_event, source: unknown) => {
    const allowed: readonly NativeThemeSource[] = ['system', 'light', 'dark'];
    if (typeof source !== 'string' || !allowed.includes(source as NativeThemeSource)) {
      throw new Error('Invalid theme source');
    }
    nativeTheme.themeSource = source as NativeThemeSource;
  });
}

function registerProjectIpc(): void {
  const opened = async (path: string): Promise<OpenProjectResult> => {
    try {
      return { ok: true, ...(await openProject(path)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not open the project.' };
    }
  };

  ipcMain.handle(IpcChannel.createProject, (_event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Invalid project name');
    return createProject(name);
  });

  ipcMain.handle(IpcChannel.openProject, async (event): Promise<OpenProjectResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Open budget project folder',
      defaultPath: projectsRoot(),
      properties: ['openDirectory'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return null;
    return opened(path);
  });

  // Recent projects come from the app's own list, so only paths on it are opened.
  ipcMain.handle(IpcChannel.openRecentProject, async (_event, path: unknown) => {
    const recent = await recentProjects();
    if (!recent.some((r) => r.path === path)) throw new Error('Not a recent project');
    return opened(path as string);
  });

  ipcMain.handle(IpcChannel.saveProject, (_event, path: unknown, budget: unknown, events: unknown) => {
    if (!budget || typeof budget !== 'object' || !Array.isArray(events)) throw new Error('Invalid save');
    return saveProject(path, budget as never, events as never);
  });

  ipcMain.handle(IpcChannel.closeProject, (_event, path: unknown) => closeProject(path));
  ipcMain.handle(IpcChannel.recentProjects, () => recentProjects());
  ipcMain.handle(IpcChannel.forgetRecentProject, (_event, path: unknown) => forgetRecent(path));
  ipcMain.handle(IpcChannel.revealProject, (_event, path: unknown) => {
    if (isOpenProject(path)) shell.showItemInFolder(join(path, 'project.json'));
  });

  ipcMain.handle(
    IpcChannel.exportProject,
    async (event, path: unknown): Promise<ExportProjectResult | null> => {
      if (!isOpenProject(path)) throw new Error('That project is not open.');
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: SaveDialogOptions = {
        title: 'Export budget',
        defaultPath: join(app.getPath('documents'), `${basename(path)}.${FRINGE_EXTENSION}`),
        filters: [{ name: 'Fringe budget', extensions: [FRINGE_EXTENSION] }],
      };
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      let file = picked.filePath;
      if (extname(file).toLowerCase() !== `.${FRINGE_EXTENSION}`) file += `.${FRINGE_EXTENSION}`;
      try {
        await exportProject(path, file);
        return { ok: true, file };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Couldn't export the budget." };
      }
    },
  );

  ipcMain.handle(IpcChannel.saveBudgetCsv, async (event, csv: unknown, name: unknown) => {
    if (typeof csv !== 'string') throw new Error('That isn’t a CSV.');
    const win = BrowserWindow.fromWebContents(event.sender);
    return saveBudgetCsv(win, csv, typeof name === 'string' ? name : 'Budget');
  });

  ipcMain.handle(
    IpcChannel.saveReport,
    async (event, format: unknown, doc: unknown, name: unknown, landscape: unknown) => {
      if (!isReportFormat(format)) throw new Error('Unknown report format.');
      return saveReport(
        BrowserWindow.fromWebContents(event.sender),
        format,
        checkedReport(doc),
        typeof name === 'string' ? name : 'Reports',
        landscape === true,
      );
    },
  );

  ipcMain.handle(
    IpcChannel.saveVersionPdf,
    async (
      _event,
      path: unknown,
      name: unknown,
      doc: unknown,
      landscape: unknown,
    ): Promise<SaveReportResult> => {
      try {
        const file = await saveVersionPdf(
          path,
          typeof name === 'string' ? name : '',
          checkedReport(doc),
          landscape === true,
        );
        return { ok: true, file };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Couldn’t save the PDF.' };
      }
    },
  );
  ipcMain.handle(IpcChannel.revealVersionPdf, (_event, path: unknown, name: unknown) =>
    revealVersionPdf(path, name),
  );

  const unpacked = async (file: string): Promise<OpenProjectResult> => {
    try {
      return { ok: true, ...(await importFringeFile(file)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't open the file." };
    }
  };

  ipcMain.handle(IpcChannel.openFringeFile, async (event): Promise<OpenProjectResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Import a .fringe file',
      defaultPath: app.getPath('documents'),
      filters: [
        { name: 'Fringe budget', extensions: [FRINGE_EXTENSION, 'zip'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    return unpacked(file);
  });

  ipcMain.handle(IpcChannel.pickBudgetToConvert, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Convert a budget from another program',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    return picked.canceled || !file ? null : file;
  });

  ipcMain.handle(
    IpcChannel.openDropped,
    async (_event, path: unknown): Promise<OpenProjectResult | { convert: string }> => {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Not a file.');
      const info = await stat(path).catch(() => null);
      if (!info) return { ok: false, error: 'That file is no longer there.' };
      if (info.isDirectory()) {
        if (await stat(join(path, 'project.json')).catch(() => null)) return opened(path);
        return { ok: false, error: 'That folder isn’t a Fringe project. Drop a budget file instead.' };
      }
      if (extname(path).toLowerCase() === `.${FRINGE_EXTENSION}`) return unpacked(path);
      return { convert: path };
    },
  );

  ipcMain.handle(IpcChannel.takeOpenedFiles, async () => {
    const files = openedFiles.splice(0);
    const results: OpenProjectResult[] = [];
    for (const file of files) results.push(await unpacked(file));
    return results;
  });
}

/** .fringe files the system handed the app (double-clicked, or dropped on its icon), not yet opened. */
const openedFiles: string[] = [];

function fringeFilesIn(argv: readonly string[]): string[] {
  return argv
    .filter((a) => !a.startsWith('-') && extname(a).toLowerCase() === `.${FRINGE_EXTENSION}`)
    .map((a) => resolve(a));
}

function filesOpened(files: readonly string[]): void {
  if (files.length === 0) return;
  openedFiles.push(...files);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.filesOpened);
}

// ---- AI connection (MCP) ----

const aiSettingsFile = () => join(app.getPath('userData'), 'ai-settings.json');

async function mcpEnabled(): Promise<boolean> {
  try {
    return (JSON.parse(await readFile(aiSettingsFile(), 'utf8')) as { mcp?: boolean }).mcp === true;
  } catch {
    return false;
  }
}

/** Tool calls waiting for the window's reply. */
const pendingTools = new Map<string, (reply: ToolReply) => void>();
const TOOL_TIMEOUT_MS = 60_000;

/** Runs a tool in the window, on one of its open budgets. */
const callWindow: WindowCaller = (name, input, { confirm, tab }) =>
  new Promise((resolve) => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) {
      resolve({ ok: false, error: 'The app has no window open.' });
      return;
    }
    const id = randomUUID();
    // An edit waiting for the user's OK in the panel can take as long as they like.
    const timer = setTimeout(
      () => {
        pendingTools.delete(id);
        resolve({ ok: false, error: "The app didn't answer in time." });
      },
      confirm ? 24 * 60 * 60_000 : TOOL_TIMEOUT_MS,
    );
    pendingTools.set(id, (reply) => {
      clearTimeout(timer);
      pendingTools.delete(id);
      resolve(reply);
    });
    win.webContents.send(IpcChannel.toolCall, { id, name, input, confirm, tab });
  });

/** Runs a budget tool on the budget it names: open ones in the window, others read from disk. */
const callTool: ToolCaller = routeBudgetTools(callWindow);

async function currentMcpStatus(): Promise<McpStatus> {
  return { enabled: await mcpEnabled(), ...mcpStatus() };
}

/** Turns on the AI connection (remembered) for the side panel, and gives its address. */
async function connectAi(): Promise<{ url: string; token: string }> {
  if (!(await mcpEnabled())) await writeAtomic(aiSettingsFile(), JSON.stringify({ mcp: true }));
  const server = await startMcpServer(callTool);
  if (!server.url || !server.token) throw new Error(server.error ?? "The app's AI connection didn't start.");
  return { url: server.url, token: server.token };
}

function registerAddonIpc(): void {
  ipcMain.handle(IpcChannel.addonsList, () => listAddons());
  ipcMain.handle(IpcChannel.addonsRemove, (_event, id: unknown) => removeAddon(id));
  ipcMain.handle(IpcChannel.addonsReveal, (_event, id: unknown) => revealAddon(id));
  ipcMain.handle(IpcChannel.addonsAddFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Add an Add-on',
      filters: [{ name: 'Add-on page', extensions: ['html', 'htm'] }],
      properties: ['openFile'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    try {
      const html = await readFile(file, 'utf8');
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      const description =
        /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '';
      const draft = { name: title || basename(file, extname(file)), description, html };
      const problem = addonProblem(draft);
      if (problem) return { ok: false, error: problem };
      return { ok: true, addon: await saveAddon(await addonIdForDraft(draft), draft) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Couldn’t add that file.' };
    }
  });
}

function registerAiIpc(): void {
  ipcMain.handle(IpcChannel.mcpStatus, () => currentMcpStatus());
  ipcMain.handle(IpcChannel.setMcpEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid setting');
    await writeAtomic(aiSettingsFile(), JSON.stringify({ mcp: enabled }));
    if (enabled) await startMcpServer(callTool);
    else {
      stopTerminal();
      await stopMcpServer();
    }
    return currentMcpStatus();
  });
  ipcMain.handle(IpcChannel.newMcpToken, async () => {
    // The panel's Claude reconnects with the new token on its next message.
    stopTerminal();
    stopChat();
    await newMcpToken(callTool);
    return currentMcpStatus();
  });
  ipcMain.handle(IpcChannel.terminalStart, async (event, size: unknown) => {
    const s = size as { cols?: unknown; rows?: unknown } | null;
    const cols = typeof s?.cols === 'number' ? Math.max(20, Math.floor(s.cols)) : 80;
    const rows = typeof s?.rows === 'number' ? Math.max(5, Math.floor(s.rows)) : 24;
    try {
      if (!(await chatSettings()).noticeAccepted)
        throw new Error('Read and accept the note about AI in the panel first.');
      const server = await connectAi();
      await startTerminal(event.sender, { cols, rows }, server);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.on(IpcChannel.terminalInput, (_event, data: unknown) => {
    if (typeof data === 'string') writeTerminal(data);
  });
  ipcMain.on(IpcChannel.terminalResize, (_event, cols: unknown, rows: unknown) => {
    if (typeof cols === 'number' && typeof rows === 'number')
      resizeTerminal(Math.floor(cols), Math.floor(rows));
  });
  ipcMain.handle(IpcChannel.terminalStop, () => stopTerminal());

  ipcMain.handle(IpcChannel.chatSend, async (event, text: unknown) => {
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'Nothing to send.' };
    try {
      await sendChat(event.sender, text, connectAi, callTool);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IpcChannel.chatStop, () => stopChat());
  ipcMain.handle(IpcChannel.chatNew, () => newChat());
  ipcMain.handle(IpcChannel.chatStatus, () => chatStatus());
  ipcMain.handle(IpcChannel.chatSignIn, (event) => signIn(event.sender));
  ipcMain.handle(IpcChannel.chatSignInCode, (_event, code: unknown) => {
    if (typeof code === 'string' && code.trim() !== '' && code.length < 2000) signInCode(code);
  });
  ipcMain.handle(IpcChannel.chatSignInCancel, () => cancelSignIn());
  ipcMain.handle(IpcChannel.chatSettings, (_event, change: unknown) =>
    setChatSettings(typeof change === 'object' && change ? change : {}),
  );
  ipcMain.handle(IpcChannel.chatSetKey, async (_event, provider: unknown, key: unknown) => {
    if (!isKeyProvider(provider)) return { ok: false, error: 'Unknown AI company.' };
    const problem = await setApiKey(provider, typeof key === 'string' ? key.trim() : '');
    if (problem) return { ok: false, error: problem };
    return { ok: true, status: await setChatSettings({ provider }) };
  });
  ipcMain.handle(IpcChannel.chatClearKey, async (_event, provider: unknown) => {
    if (isKeyProvider(provider)) await clearApiKey(provider);
    return chatStatus();
  });
  ipcMain.on(IpcChannel.setOpenBudgets, (_event, list: unknown) => setOpenBudgets(list));
  ipcMain.handle(IpcChannel.openAllInstructions, async () => {
    await shell.openPath(await allInstructionsPath());
  });
  ipcMain.handle(IpcChannel.budgetFiles, (_event, project: unknown) =>
    isOpenProject(project) ? listBudgetFiles(project) : [],
  );
  ipcMain.handle(IpcChannel.addBudgetFiles, async (event, project: unknown) => {
    if (!isOpenProject(project)) return [];
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Add Files for This Budget',
      properties: ['openFile', 'multiSelections'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : addKnowledgeFiles(project, result.filePaths);
  });
  ipcMain.handle(IpcChannel.addBudgetFilePaths, async (_event, project: unknown, paths: unknown) => {
    if (!isOpenProject(project) || !Array.isArray(paths)) return [];
    const files: string[] = [];
    for (const p of paths) {
      if (typeof p === 'string' && p !== '' && (await stat(p).catch(() => null))?.isFile()) files.push(p);
    }
    return addKnowledgeFiles(project, files);
  });
  ipcMain.handle(IpcChannel.openBudgetFile, async (_event, project: unknown, name: unknown) => {
    const full = isOpenProject(project) ? budgetFilePath(project, name) : null;
    if (!full) return;
    // Files can come inside a .fringe file from someone else, so only documents open; a program
    // (or a shortcut to one) is shown in its folder instead of being run.
    if (isDocument(full)) await shell.openPath(full);
    else shell.showItemInFolder(full);
  });
  ipcMain.handle(IpcChannel.copyText, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  ipcMain.handle(IpcChannel.readText, () => clipboard.readText());
  ipcMain.handle(IpcChannel.toolResult, (_event, id: unknown, reply: unknown) => {
    const r = reply as ToolReply | null;
    if (typeof id !== 'string' || !r || typeof r !== 'object' || typeof r.ok !== 'boolean') return;
    pendingTools.get(id)?.(r.ok ? { ok: true, result: r.result } : { ok: false, error: String(r.error) });
  });
}

// Refuse any webview, and any window or permission request we did not create ourselves.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});

registerAddonScheme();

// The end-to-end tests (e2e/) run the app against a throwaway folder, so they never touch a real
// install's settings or budgets, and can run while Fringe is open.
const testHome = process.env['FRINGE_TEST_HOME'];
if (testHome) {
  app.setPath('userData', join(testHome, 'app-data'));
  app.setPath('documents', join(testHome, 'Documents'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows and Linux pass a double-clicked file on the command line; macOS sends open-file.
  openedFiles.push(...fringeFilesIn(process.argv.slice(1)));
  app.on('open-file', (event, file) => {
    event.preventDefault();
    filesOpened(fringeFilesIn([file]));
  });
  app.on('second-instance', (_event, argv) => {
    filesOpened(fringeFilesIn(argv.slice(1)));
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    registerIpc();
    registerProjectIpc();
    registerAiIpc();
    registerAddonIpc();
    serveAddons();
    setMenu();
    createMainWindow();
    void mcpEnabled().then((on) => (on ? startMcpServer(callTool) : null));
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('will-quit', () => {
    stopTerminal();
    stopChat();
    cancelSignIn();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
