import { type ProjectFile, readProjectFile } from '@fringe/budget-engine';
import { strFromU8, unzipSync, zipSync } from 'fflate';

/**
 * A .fringe file: one budget project in a single file to send or back up. It's a plain ZIP of the
 * project folder (project.json, budget.json, history/, knowledge/, versions/, README.md), so any unzip tool
 * opens it too. Opening one unpacks it into a new project folder.
 *
 * Files come from other people, so unpacking only keeps the project's own files, refuses paths
 * that could land outside the folder, and caps the size.
 */

export const FRINGE_EXTENSION = 'fringe';

/** The parts of a project folder that go in the file. */
const TOP_FILES = new Set(['project.json', 'budget.json', 'readme.md']);
const TOP_FOLDERS = new Set(['history', 'knowledge', 'versions']);

export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 200_000;

/** Whether a folder-relative path ('/'-separated) belongs in the file. */
export function isProjectPath(path: string): boolean {
  const [top, ...rest] = path.split('/');
  if (!top) return false;
  const name = path.split('/').pop() ?? '';
  if (name.endsWith('.tmp') || name === '.DS_Store' || name.toLowerCase() === 'thumbs.db') return false;
  return rest.length === 0 ? TOP_FILES.has(top.toLowerCase()) : TOP_FOLDERS.has(top.toLowerCase());
}

/** Packs a project's files, keyed by folder-relative '/'-separated path. */
export function packProject(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of files) if (isProjectPath(path)) entries[path] = data;
  if (!entries['project.json']) throw new Error("This project has no project.json, so it can't be exported.");
  return zipSync(entries, { level: 6 });
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A safe folder-relative path, or null for one that could escape the folder or isn't valid. */
export function safePath(name: string): string | null {
  const path = name.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return null;
  const parts = path.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) return null;
  for (const p of parts) {
    if (p === '..' || /[<>:"|?*]/.test(p) || [...p].some((c) => c.charCodeAt(0) < 32)) return null;
    if (/[. ]$/.test(p) || WINDOWS_RESERVED.test(p)) return null;
  }
  return parts.join('/');
}

export interface UnpackedProject {
  project: ProjectFile;
  /** Folder-relative '/'-separated paths. */
  files: Map<string, Uint8Array>;
}

export function unpackProject(data: Uint8Array): UnpackedProject {
  if (data.length > MAX_FILE_BYTES) throw new Error('This file is too large to open.');
  let count = 0;
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter: (f) => {
        if (++count > MAX_ENTRIES) throw new Error('This file has too many files in it.');
        total += f.originalSize;
        if (total > MAX_UNPACKED_BYTES) throw new Error('This file is too large to open.');
        return !f.name.endsWith('/');
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('This file')) throw err;
    throw new Error("This isn't a .fringe file, or it's damaged.", { cause: err });
  }

  const paths = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(raw)) {
    const path = safePath(name);
    if (path && !path.startsWith('__MACOSX/')) paths.set(path, bytes);
  }

  // A project folder zipped by hand has the folder at the top: look inside it.
  let prefix = '';
  if (!paths.has('project.json')) {
    const tops = new Set([...paths.keys()].map((p) => p.split('/')[0]));
    const [only] = tops;
    if (tops.size === 1 && only && paths.has(`${only}/project.json`)) prefix = `${only}/`;
  }

  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of paths) {
    if (!path.startsWith(prefix)) continue;
    const inner = path.slice(prefix.length);
    if (isProjectPath(inner)) files.set(inner, bytes);
  }

  const projectJson = files.get('project.json');
  if (!projectJson) throw new Error("This file doesn't hold a Fringe budget (it has no project.json).");
  let project: ProjectFile;
  try {
    project = readProjectFile(JSON.parse(strFromU8(projectJson)));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error("This file's project.json is damaged.", { cause: err });
    throw err;
  }
  if (!files.has('budget.json')) throw new Error("This file doesn't hold a budget (it has no budget.json).");
  return { project, files };
}
