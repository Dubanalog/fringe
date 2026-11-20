import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { BudgetFile } from '../shared/ipc';

/**
 * The files kept for the AI and the user: each budget's in its project's `knowledge/` folder
 * (instructions, rules, rate sheets, contracts, deal memos, schedules, anything the user hands the
 * assistant), and the Global Knowledge folder for every budget, in the budgets folder. The AI
 * reads them through the file tools in ai-tools.ts.
 */

/** The budget's own folder, in its project. */
const BUDGET_FOLDER = 'knowledge';
/** The folder for every budget, in the budgets folder (Documents/Fringe Budgets). */
export const GLOBAL_FOLDER = 'Global Knowledge';

async function walk(dir: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) out.push(...(await walk(full, depth - 1)));
    } else if (e.isFile()) out.push(full);
  }
  return out;
}

/** The files in `root`/`folder`, named from `root`, e.g. "knowledge/rates.csv". */
async function listFiles(root: string, folder: string): Promise<BudgetFile[]> {
  const files: BudgetFile[] = [];
  for (const full of await walk(join(root, folder), 3)) {
    const s = await stat(full);
    files.push({
      name: relative(root, full).split(sep).join('/'),
      size: s.size,
      modified: s.mtime.toISOString(),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export const listBudgetFiles = (project: string): Promise<BudgetFile[]> => listFiles(project, BUDGET_FOLDER);

/** The Global Knowledge files, named like "Global Knowledge/rates.pdf". `root` is the budgets folder. */
export const listGlobalFiles = (root: string): Promise<BudgetFile[]> => listFiles(root, GLOBAL_FOLDER);

/** A file in `root`/`folder`, or null for anything outside it. */
function fileIn(root: string, folder: string, name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return null;
  const full = resolve(root, name);
  return full.startsWith(join(root, folder) + sep) ? full : null;
}

/** A file in the project's knowledge folder, or null for anything outside it. */
export const budgetFilePath = (project: string, name: unknown): string | null =>
  fileIn(project, BUDGET_FOLDER, name);

/** A file in the Global Knowledge folder, or null for anything outside it. */
export const globalFilePath = (root: string, name: unknown): string | null => fileIn(root, GLOBAL_FOLDER, name);

/** Whether a file name, as the AI got it from a listing, is a Global Knowledge one. */
export const isGlobalName = (name: unknown): boolean =>
  typeof name === 'string' && name.replace(/\\/g, '/').startsWith(`${GLOBAL_FOLDER}/`);

/** Kinds of file the system opens as documents, in an app that shows them, never as a program. */
const DOCUMENTS = new Set(
  (
    'pdf txt md csv tsv json xml rtf doc docx odt xls xlsx ods ppt pptx odp pages numbers key ' +
    'png jpg jpeg gif webp bmp tif tiff heic mp3 m4a wav mp4 mov m4v eml msg'
  ).split(' '),
);

/** Whether a file is a document that's safe to open by double-click, by its extension. */
export const isDocument = (file: string): boolean => DOCUMENTS.has(extname(file).slice(1).toLowerCase());

/** Copies files into `root`/`folder`; a name already there gets a number. Returns their names. */
async function addFiles(root: string, folder: string, paths: readonly string[]): Promise<string[]> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  const taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
  const added: string[] = [];
  for (const path of paths) {
    const ext = extname(path);
    const stem = basename(path, ext);
    let name = `${stem}${ext}`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    taken.add(name.toLowerCase());
    await copyFile(path, join(dir, name));
    added.push(`${folder}/${name}`);
  }
  return added;
}

/** Copies files into the project's knowledge folder. */
export const addKnowledgeFiles = (project: string, paths: readonly string[]): Promise<string[]> =>
  addFiles(project, BUDGET_FOLDER, paths);

/** Copies files into the Global Knowledge folder. */
export const addGlobalFiles = (root: string, paths: readonly string[]): Promise<string[]> =>
  addFiles(root, GLOBAL_FOLDER, paths);
