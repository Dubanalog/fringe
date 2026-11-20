import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addGlobalFiles,
  budgetFilePath,
  globalFilePath,
  isDocument,
  isGlobalName,
  listGlobalFiles,
} from './knowledge';

describe('budget files', () => {
  it('opens documents, never programs or shortcuts', () => {
    for (const f of ['rates.pdf', 'Deal Memo.DOCX', 'knowledge/sheet.xlsx', 'notes.md'])
      expect(isDocument(f)).toBe(true);
    for (const f of [
      'setup.exe',
      'rates.pdf.exe',
      'run.bat',
      'x.cmd',
      'x.ps1',
      'link.lnk',
      'x.js',
      'x.hta',
      'x.xlsm',
      'x.svg',
      'noext',
    ])
      expect(isDocument(f)).toBe(false);
  });
});

describe('Global Knowledge', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fringe-knowledge-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('only gives paths inside its own folder', () => {
    expect(globalFilePath(root, 'Global Knowledge/rates.pdf')).toBe(
      join(root, 'Global Knowledge', 'rates.pdf'),
    );
    expect(globalFilePath(root, 'Global Knowledge/sub/a.csv')).toBe(
      join(root, 'Global Knowledge', 'sub', 'a.csv'),
    );
    for (const bad of [
      'instructions.md',
      'Global Knowledge',
      'Global Knowledge/../instructions.md',
      'Demo/project.json',
      '',
      7,
    ])
      expect(globalFilePath(root, bad)).toBeNull();
    // A budget's own files can't reach Global Knowledge through its folder either.
    expect(budgetFilePath(join(root, 'Demo'), '../Global Knowledge/rates.pdf')).toBeNull();
  });

  it("tells Global Knowledge names from a budget's", () => {
    expect(isGlobalName('Global Knowledge/rates.pdf')).toBe(true);
    expect(isGlobalName('Global Knowledge\\rates.pdf')).toBe(true);
    expect(isGlobalName('knowledge/rates.pdf')).toBe(false);
    expect(isGlobalName('Global Knowledgeable.pdf')).toBe(false);
    expect(isGlobalName(undefined)).toBe(false);
  });

  it('adds and lists files, numbering a name that is taken', async () => {
    const src = join(root, 'in');
    await mkdir(src);
    await writeFile(join(src, 'rates.csv'), 'a,b');
    expect(await listGlobalFiles(root)).toEqual([]);
    expect(await addGlobalFiles(root, [join(src, 'rates.csv')])).toEqual(['Global Knowledge/rates.csv']);
    expect(await addGlobalFiles(root, [join(src, 'rates.csv')])).toEqual(['Global Knowledge/rates (2).csv']);
    expect((await listGlobalFiles(root)).map((f) => f.name)).toEqual([
      'Global Knowledge/rates (2).csv',
      'Global Knowledge/rates.csv',
    ]);
    expect(await readFile(join(root, 'Global Knowledge', 'rates.csv'), 'utf8')).toBe('a,b');
  });
});
