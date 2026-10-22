import { newProjectFile } from '@fringe/budget-engine';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packProject, safePath, unpackProject } from './fringe-file';

const project = newProjectFile('My Show');
const text = (s: string) => strToU8(s);
const folder = () =>
  new Map<string, Uint8Array>([
    ['project.json', text(JSON.stringify(project))],
    ['budget.json', text('{}')],
    ['README.md', text('# readme')],
    ['history/events.jsonl', text('{}\n')],
    ['history/objects/abc.json', text('{}')],
    ['knowledge/instructions.md', text('# rules')],
    ['knowledge/rates.pdf', new Uint8Array([1, 2, 3])],
    ['budget.json.123.tmp', text('half')],
    ['notes.txt', text('not part of the project')],
  ]);

describe('.fringe files', () => {
  it('round-trips a project, leaving out temporary and stray files', () => {
    const { project: back, files } = unpackProject(packProject(folder()));
    expect(back.projectId).toBe(project.projectId);
    expect([...files.keys()].sort()).toEqual([
      'README.md',
      'budget.json',
      'history/events.jsonl',
      'history/objects/abc.json',
      'knowledge/instructions.md',
      'knowledge/rates.pdf',
      'project.json',
    ]);
    expect([...files.get('knowledge/rates.pdf')!]).toEqual([1, 2, 3]);
  });

  it('opens a project folder zipped by hand, with the folder at the top', () => {
    const zip = zipSync({
      'My Show/project.json': text(JSON.stringify(project)),
      'My Show/budget.json': text('{}'),
      'My Show/knowledge/a.md': text('a'),
      '__MACOSX/My Show/._budget.json': text('x'),
    });
    expect([...unpackProject(zip).files.keys()].sort()).toEqual([
      'budget.json',
      'knowledge/a.md',
      'project.json',
    ]);
  });

  it('never keeps a path that could land outside the folder', () => {
    const zip = zipSync({
      'project.json': text(JSON.stringify(project)),
      'budget.json': text('{}'),
      'knowledge/../../evil.exe': text('x'),
      'knowledge/C:/evil': text('x'),
    });
    expect([...unpackProject(zip).files.keys()].sort()).toEqual(['budget.json', 'project.json']);
    for (const bad of ['../x', '/etc/passwd', 'C:\\x', 'knowledge/..\\..\\x', 'knowledge/con.txt', 'a/b:c'])
      expect(safePath(bad)).toBeNull();
    expect(safePath('knowledge\\a b.pdf')).toBe('knowledge/a b.pdf');
  });

  it('says what is wrong with a file that is not a budget', () => {
    expect(() => unpackProject(text('hello'))).toThrow(/isn't a .fringe file/);
    expect(() => unpackProject(zipSync({ 'a.txt': text('a') }))).toThrow(/no project.json/);
    expect(() => unpackProject(zipSync({ 'project.json': text(JSON.stringify(project)) }))).toThrow(
      /no budget.json/,
    );
  });
});
