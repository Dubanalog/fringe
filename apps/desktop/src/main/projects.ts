import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  type Budget,
  type BudgetHistory,
  type HistoryEvent,
  type ProjectFile,
  newProjectFile,
  normalizeBudget,
  projectFolderName,
  readProjectFile,
  replayHistory,
  startHistory,
  storeEvent,
  unpackBudget,
} from '@fringe/budget-engine';
import { app } from 'electron';
import type { OpenedProject, RecentProject } from '../shared/ipc';
import { MAX_FILE_BYTES, isProjectPath, packProject, unpackProject } from './fringe-file';

/**
 * Budget project folders on disk (layout in packages/budget-engine/src/project.ts and
 * docs/project-folder.md). Every write is atomic: a file is written in full to a temporary name,
 * flushed, then renamed over the old one, so a crash leaves the old file or the new, never half.
 * The event log is only ever appended to, after the pieces it names are safely written.
 */

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Folders the renderer may save to: only ones this process created or opened. */
const allowed = new Map<string, { known: Set<string>; queue: Promise<void>; name: string }>();

export function projectsRoot(): string {
  return join(app.getPath('documents'), 'Fringe Budgets');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  const file = await open(temp, 'w');
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}

const README = `# Budget project

This folder is one budget, complete on its own. Copy it, back it up or move it anywhere; open it
from the app with Open Project.

- \`project.json\`: what this folder is (format, version, project id, name).
- \`budget.json\`: the budget as it is now. Plain JSON, readable without the app.
- \`history/events.jsonl\`: every change, undo and go-back, one line each, oldest first.
- \`history/objects/\`: the budget at each change, stored in pieces named by their content's
  SHA-256 hash, so unchanged parts are stored once.
- \`knowledge/\`: everything kept with the budget: instructions, rules and decisions, rate sheets,
  contracts, deal memos, schedules. \`knowledge/instructions.md\` is read by the AI first.

Don't edit the history files by hand: the app checks them, and skips anything it can't read.
`;

/** A folder for a new project under the projects folder, named after the budget, not yet made. */
async function newProjectPath(name: string): Promise<string> {
  const root = projectsRoot();
  await mkdir(root, { recursive: true });
  const base = projectFolderName(name);
  let path = join(root, base);
  for (let n = 2; await exists(path); n++) path = join(root, `${base} (${n})`);
  return path;
}

/** Creates a new project folder under the projects folder, named after the budget. */
export async function createProject(name: string): Promise<{ path: string; project: ProjectFile }> {
  const path = await newProjectPath(name);
  await mkdir(join(path, 'history', 'objects'), { recursive: true });
  await mkdir(join(path, 'knowledge'), { recursive: true });
  const project = newProjectFile(name);
  await writeAtomic(join(path, 'README.md'), README);
  await writeAtomic(join(path, 'knowledge', 'instructions.md'), '# Instructions for this budget\n');
  await writeAtomic(join(path, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  allowed.set(path, { known: new Set(), queue: Promise.resolve(), name });
  await addRecent(path, name);
  return { path, project };
}

/** Opens a project folder: its budget and its history as it was left. */
export async function openProject(folder: string): Promise<OpenedProject> {
  const path = resolve(folder);
  let project: ProjectFile;
  try {
    project = readProjectFile(JSON.parse(await readFile(join(path, 'project.json'), 'utf8')));
  } catch (err) {
    if (!(await exists(path))) throw new Error('The folder has been moved or deleted.', { cause: err });
    if (err instanceof SyntaxError)
      throw new Error("This project's project.json is damaged.", { cause: err });
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error("This folder isn't a budget project (it has no project.json).", { cause: err });
    }
    throw err;
  }

  const objects = join(path, 'history', 'objects');
  await mkdir(objects, { recursive: true });
  const known = new Set(
    (await readdir(objects)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
  );
  const texts = new Map<string, string>();
  await Promise.all(
    [...known].map(async (k) => texts.set(k, await readFile(join(objects, `${k}.json`), 'utf8'))),
  );
  const parsed = new Map<string, unknown>();
  const read = (key: string) => {
    if (!parsed.has(key)) {
      const text = texts.get(key);
      if (text === undefined) throw new Error(`Missing history piece ${key}`);
      parsed.set(key, JSON.parse(text));
    }
    return parsed.get(key);
  };

  let history: BudgetHistory | null = null;
  const log = join(path, 'history', 'events.jsonl');
  if (await exists(log)) {
    const lines = (await readFile(log, 'utf8')).split('\n').filter((l) => l.trim());
    try {
      history = replayHistory(lines, (snapshot) => unpackBudget(snapshot, read));
    } catch {
      history = null;
    }
  }
  let warning: string | null = null;
  if (!history) {
    // No usable history: start one from budget.json.
    const budget = normalizeBudget(JSON.parse(await readFile(join(path, 'budget.json'), 'utf8')) as Budget);
    history = startHistory(budget, 'Opened');
    if (await exists(log)) warning = "This project's history couldn't be read, so it starts again from here.";
  }
  await mergeDocuments(path);
  allowed.set(path, { known, queue: Promise.resolve(), name: project.name });
  await addRecent(path, project.name);
  return { path, project, history, warning, isNew: false };
}

/**
 * Projects used to keep a `documents/` folder next to `knowledge/`. They're one thing, so its files
 * move into `knowledge/` (a name already there gets a number), and the README says so.
 */
async function mergeDocuments(path: string): Promise<void> {
  const from = join(path, 'documents');
  let names: string[];
  try {
    names = await readdir(from);
  } catch {
    return;
  }
  const to = join(path, 'knowledge');
  await mkdir(to, { recursive: true });
  const taken = new Set((await readdir(to)).map((n) => n.toLowerCase()));
  for (const name of names) {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let target = name;
    for (let n = 2; taken.has(target.toLowerCase()); n++) target = `${stem} (${n})${ext}`;
    taken.add(target.toLowerCase());
    await rename(join(from, name), join(to, target));
  }
  await rmdir(from).catch(() => undefined);
  await writeAtomic(join(path, 'README.md'), README).catch(() => undefined);
}

/**
 * Saves a project's new history events and its current budget. Saves to one folder run in order.
 * Pieces first, then the event lines that name them, then budget.json.
 */
export function saveProject(folder: unknown, budget: Budget, events: HistoryEvent[]): Promise<void> {
  const entry = typeof folder === 'string' ? allowed.get(folder) : undefined;
  if (!entry) return Promise.reject(new Error('That project is not open.'));
  const path = folder as string;
  const run = async () => {
    const lines: string[] = [];
    for (const event of events) {
      const { line, pieces } = storeEvent(event, hash);
      for (const [key, text] of pieces) {
        if (entry.known.has(key)) continue;
        await writeAtomic(join(path, 'history', 'objects', `${key}.json`), text);
        entry.known.add(key);
      }
      lines.push(JSON.stringify(line) + '\n');
    }
    if (lines.length) {
      const log = await open(join(path, 'history', 'events.jsonl'), 'a');
      try {
        await log.appendFile(lines.join(''), 'utf8');
        await log.sync();
      } finally {
        await log.close();
      }
    }
    await writeAtomic(join(path, 'budget.json'), JSON.stringify(budget, null, 1) + '\n');
    if (budget.name !== entry.name) {
      // Renamed: project.json and Recent show the new name. The folder keeps its own.
      const file = join(path, 'project.json');
      const project = JSON.parse(await readFile(file, 'utf8')) as ProjectFile;
      await writeAtomic(file, JSON.stringify({ ...project, name: budget.name }, null, 2) + '\n');
      await renameRecent(path, budget.name);
      entry.name = budget.name;
    }
  };
  const next = entry.queue.then(run);
  entry.queue = next.catch(() => undefined);
  return next;
}

/** Every file of a project folder that goes in a .fringe file, by '/'-separated relative path. */
async function projectFiles(path: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(path, full).split(sep).join('/');
      if (entry.isDirectory()) {
        if (isProjectPath(`${rel}/x`)) await walk(full);
      } else if (entry.isFile() && isProjectPath(rel)) {
        files.set(rel, await readFile(full));
      }
    }
  };
  await walk(path);
  return files;
}

/** Saves an open project, as it is once its saves finish, to a .fringe file. */
export async function exportProject(folder: unknown, file: string): Promise<void> {
  const entry = typeof folder === 'string' ? allowed.get(folder) : undefined;
  if (!entry) throw new Error('That project is not open.');
  await entry.queue;
  await mkdir(dirname(file), { recursive: true });
  await writeAtomic(file, packProject(await projectFiles(folder as string)));
}

/** Unpacks a .fringe file into a new project folder and opens it. */
export async function importFringeFile(file: string): Promise<OpenedProject> {
  if ((await stat(file)).size > MAX_FILE_BYTES) throw new Error('This file is too large to open.');
  const { project, files } = unpackProject(await readFile(file));
  const path = await newProjectPath(project.name);
  // Unpacked to a temporary folder first, so a failure never leaves half a project behind.
  const temp = `${path}.${process.pid}.tmp`;
  try {
    for (const [rel, data] of files) {
      const target = resolve(temp, ...rel.split('/'));
      if (!target.startsWith(resolve(temp) + sep)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeAtomic(target, data);
    }
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return openProject(path);
}

export function closeProject(folder: unknown): void {
  if (typeof folder === 'string') allowed.delete(folder);
}

export function isOpenProject(folder: unknown): folder is string {
  return typeof folder === 'string' && allowed.has(folder);
}

// Recently opened projects, newest first.

const recentFile = () => join(app.getPath('userData'), 'recent-projects.json');
const RECENT_LIMIT = 20;

export async function recentProjects(): Promise<RecentProject[]> {
  let list: RecentProject[];
  try {
    list = JSON.parse(await readFile(recentFile(), 'utf8')) as RecentProject[];
  } catch {
    return [];
  }
  return Promise.all(
    list.map(async (r) => ({ ...r, missing: !(await exists(join(r.path, 'project.json'))) })),
  );
}

async function addRecent(path: string, name: string): Promise<void> {
  const list = (await recentProjects()).filter((r) => r.path !== path);
  const next = [{ path, name, openedAt: new Date().toISOString(), missing: false }, ...list].slice(
    0,
    RECENT_LIMIT,
  );
  await writeAtomic(recentFile(), JSON.stringify(next, null, 2));
}

async function renameRecent(path: string, name: string): Promise<void> {
  const list = await recentProjects();
  if (!list.some((r) => r.path === path)) return;
  const next = list.map((r) => (r.path === path ? { ...r, name } : r));
  await writeAtomic(recentFile(), JSON.stringify(next, null, 2));
}

export async function forgetRecent(path: unknown): Promise<void> {
  const list = (await recentProjects()).filter((r) => r.path !== path);
  await writeAtomic(recentFile(), JSON.stringify(list, null, 2));
}
