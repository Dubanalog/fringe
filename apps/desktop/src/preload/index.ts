import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { type ChatEvent, type FringeApi, IpcChannel, type ToolCall } from '../shared/ipc';

function listen<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.off(channel, listener);
}

// The only bridge into the renderer: named, typed calls. No raw ipcRenderer,
// no filesystem, no shell.
const api: FringeApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  setNativeTheme: (source) => ipcRenderer.invoke(IpcChannel.setNativeTheme, source),
  createProject: (name) => ipcRenderer.invoke(IpcChannel.createProject, name),
  openProject: () => ipcRenderer.invoke(IpcChannel.openProject),
  openRecentProject: (path) => ipcRenderer.invoke(IpcChannel.openRecentProject, path),
  saveProject: (path, budget, events) => ipcRenderer.invoke(IpcChannel.saveProject, path, budget, events),
  closeProject: (path) => ipcRenderer.invoke(IpcChannel.closeProject, path),
  recentProjects: () => ipcRenderer.invoke(IpcChannel.recentProjects),
  forgetRecentProject: (path) => ipcRenderer.invoke(IpcChannel.forgetRecentProject, path),
  revealProject: (path) => ipcRenderer.invoke(IpcChannel.revealProject, path),
  exportProject: (path) => ipcRenderer.invoke(IpcChannel.exportProject, path),
  saveReport: (format, doc, name, landscape) =>
    ipcRenderer.invoke(IpcChannel.saveReport, format, doc, name, landscape),
  saveBudgetCsv: (csv, name) => ipcRenderer.invoke(IpcChannel.saveBudgetCsv, csv, name),
  saveVersionPdf: (path, name, doc, landscape) =>
    ipcRenderer.invoke(IpcChannel.saveVersionPdf, path, name, doc, landscape),
  revealVersionPdf: (path, file) => ipcRenderer.invoke(IpcChannel.revealVersionPdf, path, file),
  openFringeFile: () => ipcRenderer.invoke(IpcChannel.openFringeFile),
  pickBudgetToConvert: () => ipcRenderer.invoke(IpcChannel.pickBudgetToConvert),
  openDropped: (path) => ipcRenderer.invoke(IpcChannel.openDropped, path),
  takeOpenedFiles: () => ipcRenderer.invoke(IpcChannel.takeOpenedFiles),
  onFilesOpened: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(IpcChannel.filesOpened, listener);
    return () => void ipcRenderer.off(IpcChannel.filesOpened, listener);
  },
  mcpStatus: () => ipcRenderer.invoke(IpcChannel.mcpStatus),
  setMcpEnabled: (enabled) => ipcRenderer.invoke(IpcChannel.setMcpEnabled, enabled),
  newMcpToken: () => ipcRenderer.invoke(IpcChannel.newMcpToken),
  copyText: (text) => ipcRenderer.invoke(IpcChannel.copyText, text),
  readText: () => ipcRenderer.invoke(IpcChannel.readText),
  onToolCall: (handler) => {
    const listener = (_event: unknown, call: ToolCall) =>
      void handler(call).then(
        (reply) => ipcRenderer.invoke(IpcChannel.toolResult, call.id, reply),
        (err: unknown) =>
          ipcRenderer.invoke(IpcChannel.toolResult, call.id, { ok: false, error: String(err) }),
      );
    ipcRenderer.on(IpcChannel.toolCall, listener);
    return () => void ipcRenderer.off(IpcChannel.toolCall, listener);
  },
  startTerminal: (size) => ipcRenderer.invoke(IpcChannel.terminalStart, size),
  terminalInput: (data) => ipcRenderer.send(IpcChannel.terminalInput, data),
  resizeTerminal: (cols, rows) => ipcRenderer.send(IpcChannel.terminalResize, cols, rows),
  stopTerminal: () => ipcRenderer.invoke(IpcChannel.terminalStop),
  onTerminalData: (handler) => listen<string>(IpcChannel.terminalData, handler),
  onTerminalExit: (handler) => listen<number>(IpcChannel.terminalExit, handler),
  sendChat: (text) => ipcRenderer.invoke(IpcChannel.chatSend, text),
  stopChat: () => ipcRenderer.invoke(IpcChannel.chatStop),
  newChat: () => ipcRenderer.invoke(IpcChannel.chatNew),
  chatStatus: () => ipcRenderer.invoke(IpcChannel.chatStatus),
  signIn: () => ipcRenderer.invoke(IpcChannel.chatSignIn),
  signInCode: (code) => ipcRenderer.invoke(IpcChannel.chatSignInCode, code),
  cancelSignIn: () => ipcRenderer.invoke(IpcChannel.chatSignInCancel),
  setChatSettings: (change) => ipcRenderer.invoke(IpcChannel.chatSettings, change),
  setApiKey: (provider, key) => ipcRenderer.invoke(IpcChannel.chatSetKey, provider, key),
  clearApiKey: (provider) => ipcRenderer.invoke(IpcChannel.chatClearKey, provider),
  onChatEvent: (handler) => listen<ChatEvent>(IpcChannel.chatEvent, handler),
  setOpenBudgets: (budgets) => ipcRenderer.send(IpcChannel.setOpenBudgets, budgets),
  openAllInstructions: () => ipcRenderer.invoke(IpcChannel.openAllInstructions),
  budgetFiles: (project) => ipcRenderer.invoke(IpcChannel.budgetFiles, project),
  addBudgetFiles: (project) => ipcRenderer.invoke(IpcChannel.addBudgetFiles, project),
  addBudgetFilePaths: (project, paths) => ipcRenderer.invoke(IpcChannel.addBudgetFilePaths, project, paths),
  openBudgetFile: (project, name) => ipcRenderer.invoke(IpcChannel.openBudgetFile, project, name),
  pathForFile: (file) => webUtils.getPathForFile(file),
  listAddons: () => ipcRenderer.invoke(IpcChannel.addonsList),
  removeAddon: (id) => ipcRenderer.invoke(IpcChannel.addonsRemove, id),
  revealAddon: (id) => ipcRenderer.invoke(IpcChannel.addonsReveal, id),
  addAddonFile: () => ipcRenderer.invoke(IpcChannel.addonsAddFile),
  onAddonsChanged: (handler) => listen<void>(IpcChannel.addonsChanged, () => handler()),
};

contextBridge.exposeInMainWorld('fringe', api);
