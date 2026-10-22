import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { addonIdFor, isAddonId } from '@fringe/budget-engine';
import { BrowserWindow, app, protocol, session, shell } from 'electron';
import { type AddonInfo, IpcChannel } from '../shared/ipc';
import { writeAtomic } from './projects';

/**
 * Add-ons: pages the user has Claude build on top of Fringe (a cash flow, a deal-memo tracker…).
 * Each is one HTML file kept with the app, not with a budget, so it works on every budget.
 *
 * They run locked down. The app shows one in a sandboxed frame from its own fringe-addon://
 * address, with a content security policy that allows no network, and the app blocks any request
 * such a frame makes anywhere else. An add-on can't reach files, Node or the app; it gets the
 * budget showing, keeps its own data in it, and saves reports, all through `window.fringe` (the
 * bridge below), which asks the app by message. See docs/ai/addons.md.
 */

export const ADDON_SCHEME = 'fringe-addon';
const MANIFEST = 'addon.json';
const PAGE = 'index.html';
/** The most an add-on's page can be. */
export const MAX_ADDON_HTML = 900_000;

export const addonsRoot = () => join(app.getPath('userData'), 'add-ons');
const folder = (id: string) => join(addonsRoot(), id);

interface Manifest {
  id: string;
  name: string;
  description: string;
  /** What it keeps in a budget (for the AI, which reads and changes it). */
  aboutData: string;
  /** Goes up by one each time it's saved. */
  version: number;
  updated: string;
}

const cleanText = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function readManifest(id: string): Promise<Manifest | null> {
  try {
    const m = JSON.parse(await readFile(join(folder(id), MANIFEST), 'utf8')) as Partial<Manifest>;
    if (!(await stat(join(folder(id), PAGE)).catch(() => null))?.isFile()) return null;
    return {
      id,
      name: cleanText(m.name, 80) || id,
      description: cleanText(m.description, 400),
      aboutData: typeof m.aboutData === 'string' ? m.aboutData.trim().slice(0, 4000) : '',
      version: typeof m.version === 'number' && m.version > 0 ? Math.floor(m.version) : 1,
      updated: typeof m.updated === 'string' ? m.updated : '',
    };
  } catch {
    return null;
  }
}

/** Every add-on, by name. */
export async function listAddons(): Promise<AddonInfo[]> {
  const names = await readdir(addonsRoot()).catch(() => [] as string[]);
  const found = await Promise.all(names.filter(isAddonId).map(readManifest));
  return found
    .filter((m): m is Manifest => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name, description, aboutData, version, updated }) => ({
      id,
      name,
      description,
      aboutData,
      version,
      updated,
    }));
}

export async function readAddon(id: unknown): Promise<{ info: AddonInfo; html: string } | null> {
  if (!isAddonId(id)) return null;
  const info = await readManifest(id);
  if (!info) return null;
  return { info, html: await readFile(join(folder(id), PAGE), 'utf8') };
}

export interface AddonDraft {
  /** Leave out for a new add-on; its id comes from the name. */
  id?: string;
  name: string;
  description: string;
  aboutData?: string;
  html: string;
}

/** Checks a new or changed add-on; a problem to tell the AI, or null. */
export function addonProblem(draft: AddonDraft): string | null {
  if (!cleanText(draft.name, 80)) return 'Give the add-on a name.';
  if (typeof draft.html !== 'string' || draft.html.trim() === '') return 'Give the add-on its html page.';
  if (draft.html.length > MAX_ADDON_HTML) return 'The page is too big: keep it under 900 KB.';
  if (draft.id !== undefined && !isAddonId(draft.id)) return `"${String(draft.id)}" isn't an add-on id.`;
  return null;
}

/** The id a draft is saved under: its own, or a new one from its name that no add-on has yet. */
export async function addonIdForDraft(draft: AddonDraft): Promise<string> {
  if (draft.id) return draft.id;
  const base = addonIdFor(draft.name);
  const taken = new Set((await listAddons()).map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 44)}-${n}`;
  return id;
}

/** Saves an add-on, new or changed, and tells every window. */
export async function saveAddon(id: string, draft: AddonDraft): Promise<AddonInfo> {
  const before = await readManifest(id);
  const manifest: Manifest = {
    id,
    name: cleanText(draft.name, 80),
    description: cleanText(draft.description, 400),
    aboutData:
      typeof draft.aboutData === 'string' ? draft.aboutData.trim().slice(0, 4000) : (before?.aboutData ?? ''),
    version: (before?.version ?? 0) + 1,
    updated: new Date().toISOString(),
  };
  await mkdir(folder(id), { recursive: true });
  await writeAtomic(join(folder(id), PAGE), draft.html);
  await writeAtomic(join(folder(id), MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  addonsChanged();
  return manifest;
}

/** Moves an add-on to the trash (it can be put back from there). */
export async function removeAddon(id: unknown): Promise<void> {
  if (!isAddonId(id) || !(await readManifest(id))) return;
  try {
    await shell.trashItem(folder(id));
  } catch {
    // No trash (some Linux desktops): set it aside instead of deleting it.
    await rename(folder(id), join(addonsRoot(), `.removed-${id}-${Date.now()}`));
  }
  addonsChanged();
}

export async function revealAddon(id: unknown): Promise<void> {
  if (isAddonId(id) && (await readManifest(id))) shell.showItemInFolder(join(folder(id), PAGE));
  else {
    await mkdir(addonsRoot(), { recursive: true });
    await shell.openPath(addonsRoot());
  }
}

function addonsChanged() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.addonsChanged);
}

/** No network, no plugins, no forms; only the page's own inline script and style. */
const ADDON_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join('; ');

/**
 * `window.fringe` inside every add-on. It talks to the app only by message, to the window that
 * shows it; the app answers only that frame. Every call returns a promise.
 */
const BRIDGE = `<script>(() => {
  const waiting = new Map();
  const listeners = { budget: [], theme: [] };
  let next = 1;
  const call = (call, ...args) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ fringe: 1, id, call, args }, '*');
  });
  const applyTheme = (t) => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v);
    root.style.colorScheme = t.dark ? 'dark' : 'light';
    root.dataset.theme = t.dark ? 'dark' : 'light';
  };
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.fringe !== 1) return;
    if (m.reply) {
      const w = waiting.get(m.reply);
      waiting.delete(m.reply);
      if (w) m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
    } else if (m.event === 'theme') {
      applyTheme(m.theme);
      for (const f of listeners.theme) try { f(m.theme); } catch (err) { console.error(err); }
    } else if (m.event === 'budget') {
      for (const f of listeners.budget) try { f(m.budget); } catch (err) { console.error(err); }
    }
  });
  Object.defineProperty(window, 'fringe', { value: Object.freeze({
    budget: () => call('budget'),
    data: () => call('data'),
    saveData: (value, label) => call('saveData', value, label),
    saveReport: (report, format, landscape) => call('saveReport', report, format, landscape),
    askClaude: (text) => call('askClaude', text),
    onBudgetChange: (f) => { listeners.budget.push(f); },
    onThemeChange: (f) => { listeners.theme.push(f); },
  }) });
  // The app's shortcuts (undo, the AI panel, tabs…) work here too, except in the page's own fields.
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
    if (!['j', 'tab', 'o', 'i', 'z', 'y'].includes(key) || (typing && 'ziy'.includes(key))) return;
    e.preventDefault();
    parent.postMessage({ fringe: 1, key: { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey } }, '*');
  });
  parent.postMessage({ fringe: 1, ready: true }, '*');
})();</script>`;

/** Before the app is ready: fringe-addon:// is a real (standard, secure) origin. */
export function registerAddonScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ADDON_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

const headers = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': ADDON_CSP };

/** Serves each add-on's page at fringe-addon://<id>/, with the bridge, and blocks its network. */
export function serveAddons(): void {
  protocol.handle(ADDON_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.hostname;
    if (!isAddonId(id) || (url.pathname !== '/' && url.pathname !== `/${PAGE}`))
      return new Response('Not found', { status: 404 });
    const addon = await readAddon(id).catch(() => null);
    if (!addon) return new Response('Not found', { status: 404, headers });
    const html = addon.html;
    // The bridge goes first, so the page's own scripts can use it.
    const at = html.search(/<head[^>]*>/i);
    const page =
      at >= 0
        ? html.replace(/<head[^>]*>/i, (head) => `${head}${BRIDGE}`)
        : `<!doctype html><head>${BRIDGE}</head>${html}`;
    return new Response(page, { headers });
  });

  // Belt and braces for the policy above: nothing a frame of an add-on asks for leaves the app.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const from = details.frame?.url ?? '';
    const fromAddon = from.startsWith(`${ADDON_SCHEME}:`);
    const allowed = /^(fringe-addon|data|blob|devtools|chrome-extension):/i.test(details.url);
    callback({ cancel: fromAddon && !allowed });
  });
}

export const isAddonUrl = (url: string) => url.startsWith(`${ADDON_SCHEME}://`);
