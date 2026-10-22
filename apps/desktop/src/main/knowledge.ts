import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { BudgetFile } from '../shared/ipc';

/**
 * The files a budget's project keeps for the AI and the user, all in `knowledge/`: instructions,
 * rules, rate sheets, contracts, deal memos, schedules, anything the user hands the assistant.
 * The AI reads them through the file tools in ai-tools.ts.
 */

const FOLDERS = ['knowledge'] as const;

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

export async function listBudgetFiles(project: string): Promise<BudgetFile[]> {
  const files: BudgetFile[] = [];
  for (const folder of FOLDERS) {
    for (const full of await walk(join(project, folder), 3)) {
      const s = await stat(full);
      files.push({
        name: relative(project, full).split(sep).join('/'),
        size: s.size,
        modified: s.mtime.toISOString(),
      });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** A file in the project's knowledge folder, or null for anything outside it. */
export function budgetFilePath(project: string, name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return null;
  const full = resolve(project, name);
  const inside = FOLDERS.some((f) => full.startsWith(join(project, f) + sep));
  return inside ? full : null;
}

/** Kinds of file the system opens as documents, in an app that shows them, never as a program. */
const DOCUMENTS = new Set(
  (
    'pdf txt md csv tsv json xml rtf doc docx odt xls xlsx ods ppt pptx odp pages numbers key ' +
    'png jpg jpeg gif webp bmp tif tiff heic mp3 m4a wav mp4 mov m4v eml msg'
  ).split(' '),
);

/** Whether a file is a document that's safe to open by double-click, by its extension. */
export const isDocument = (file: string): boolean => DOCUMENTS.has(extname(file).slice(1).toLowerCase());

/** Copies files into the project's knowledge folder; a name already there gets a number. */
export async function addKnowledgeFiles(project: string, paths: readonly string[]): Promise<string[]> {
  const dir = join(project, 'knowledge');
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
    added.push(`knowledge/${name}`);
  }
  return added;
}
