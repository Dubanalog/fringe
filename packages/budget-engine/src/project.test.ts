import { describe, expect, it } from 'vitest';
import {
  type BudgetHistory,
  MAIN_BRANCH,
  createBranch,
  currentBudget,
  openBranch,
  recordChange,
  renameBranch,
  saveVersion,
  setNotPicked,
  startHistory,
  undo,
} from './history';
import { insertCategory } from './edit';
import { type Budget } from './model';
import {
  type HistoryEvent,
  branchFileNames,
  branchFilesToSave,
  historyEvents,
  mainBudget,
  newBudget,
  packBudget,
  projectFolderName,
  readProjectFile,
  newProjectFile,
  replayHistory,
  storeEvent,
  unpackBudget,
} from './project';

// The app uses SHA-256; any stable hash does for the tests.
const hash = (text: string) => {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    a = (a * 33) ^ text.charCodeAt(i);
    b = (b * 31) ^ text.charCodeAt(i);
  }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16) + text.length.toString(16);
};

/** An in-memory project folder: the event log and the pieces store. */
function store() {
  const pieces = new Map<string, string>();
  const lines: string[] = [];
  const save = (events: HistoryEvent[]) => {
    for (const e of events) {
      const stored = storeEvent(e, hash);
      stored.pieces.forEach((v, k) => pieces.set(k, v));
      lines.push(JSON.stringify(stored.line));
    }
  };
  const cache = new Map<string, unknown>();
  const read = (key: string) => {
    if (!cache.has(key)) cache.set(key, JSON.parse(pieces.get(key)!));
    return cache.get(key);
  };
  return { pieces, lines, save, load: (s: string) => unpackBudget(s, read) };
}

function withCategories(n: number): Budget {
  let b = newBudget('Test');
  for (let i = 0; i < n; i++) b = insertCategory(b, { position: 'after' }).budget;
  return b;
}

describe('project storage', () => {
  it('packs and unpacks a budget unchanged', () => {
    const b = withCategories(2);
    const s = store();
    const { snapshot, pieces } = packBudget(b, hash);
    pieces.forEach((v, k) => s.pieces.set(k, v));
    expect(s.load(snapshot)).toEqual(b);
  });

  it('shares unchanged pieces between snapshots', () => {
    const a = withCategories(1);
    const b = { ...a, name: 'Renamed' };
    const pa = packBudget(a, hash).pieces;
    const pb = packBudget(b, hash).pieces;
    const shared = [...pb.keys()].filter((k) => pa.has(k));
    expect(shared.length).toBe(pb.size - 1); // only the outline differs
  });

  it('replays changes and undo into the same history', () => {
    const s = store();
    let h = startHistory(newBudget('Test'), 'Created');
    const events: HistoryEvent[] = [{ type: 'change', entry: h.entries[0]! }];
    h = recordChange(h, withCategories(1), 'Add category');
    events.push({ type: 'change', entry: h.entries[1]! });
    h = undo(h);
    events.push({ type: 'move', at: 'now', to: h.entries[0]!.id });
    s.save(events);
    const replayed = replayHistory(s.lines, s.load)!;
    expect(replayed.current).toBe(0);
    expect(replayed.entries.map((e) => e.label)).toEqual(['Created', 'Add category']);
    expect(replayed.entries[1]!.budget.categories).toHaveLength(1);
  });

  it('keeps undone entries when a change follows, and skips a cut-short line', () => {
    const s = store();
    const h = startHistory(newBudget('Test'), 'Created');
    const second = recordChange(h, withCategories(1), 'A');
    s.save([
      { type: 'change', entry: h.entries[0]! },
      { type: 'change', entry: second.entries[1]! },
      { type: 'move', at: 'now', to: h.entries[0]!.id },
    ]);
    const third = recordChange(h, withCategories(2), 'B');
    s.save([{ type: 'change', entry: third.entries[1]! }]);
    s.lines.push('{"type":"chan');
    const replayed = replayHistory(s.lines, s.load)!;
    expect(replayed.entries.map((e) => e.label)).toEqual(['Created', 'A', 'B']);
    expect(replayed.entries.map((e) => e.parent)).toEqual([null, h.entries[0]!.id, h.entries[0]!.id]);
    expect(replayed.current).toBe(2);
  });

  it('works out branches from saves made before changes named their parent', () => {
    const s = store();
    const h = startHistory(newBudget('Test'), 'Created');
    const a = recordChange(h, withCategories(1), 'A');
    const b = recordChange(h, withCategories(2), 'B');
    s.save([
      { type: 'change', entry: h.entries[0]! },
      { type: 'change', entry: a.entries[1]! },
      { type: 'move', at: 'now', to: h.entries[0]!.id },
      { type: 'change', entry: b.entries[1]! },
    ]);
    s.lines.forEach((line, i) => {
      const { parent: _parent, ...old } = JSON.parse(line) as { parent?: unknown };
      s.lines[i] = JSON.stringify(old);
    });
    const replayed = replayHistory(s.lines, s.load)!;
    expect(replayed.entries.map((e) => e.parent)).toEqual([null, h.entries[0]!.id, h.entries[0]!.id]);
  });

  it('replays versions: saved, changed and deleted', () => {
    const s = store();
    let h = startHistory(newBudget('Test'), 'Created');
    const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
    const v1 = saveVersion(h, { ...fields, number: '1.0' });
    const v2 = saveVersion(v1.history, { ...fields, number: '1.1' });
    h = v2.history;
    s.save([
      { type: 'change', entry: h.entries[0]! },
      { type: 'version', at: 'now', version: v1.version },
      { type: 'version', at: 'now', version: v2.version },
      { type: 'version', at: 'now', version: { ...v1.version, name: 'Studio' } },
      { type: 'version-deleted', at: 'now', id: v2.version.id },
    ]);
    const replayed = replayHistory(s.lines, s.load)!;
    expect(replayed.versions.map((v) => [v.number, v.name])).toEqual([['1.0', 'Studio']]);
  });

  it('checks project.json', () => {
    expect(readProjectFile(JSON.parse(JSON.stringify(newProjectFile('X')))).name).toBe('X');
    expect(() => readProjectFile({ format: 'other' })).toThrow(/isn't a budget project/);
    expect(() => readProjectFile({ ...newProjectFile('X'), schemaVersion: 99 })).toThrow(/newer version/);
  });

  it('makes safe folder names', () => {
    expect(projectFolderName('Show: Ep 101 / Pilot.')).toBe('Show- Ep 101 - Pilot');
    expect(projectFolderName('  ')).toBe('Budget');
    expect(projectFolderName('CON')).toBe('CON budget');
    expect(projectFolderName('.hidden')).toBe('hidden');
  });
});

const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };
/** A different budget each time, as an edit makes. */
const edit = (h: BudgetHistory, label: string) =>
  recordChange(h, { ...currentBudget(h), name: label }, label);
const ofBranch = (h: BudgetHistory) => h.entries.map((e) => [e.label, e.branch, e.parent]);
const heads = (h: BudgetHistory) => h.branches.map((b) => [b.id, b.name, b.from, b.head, b.notPicked]);

/** Removes what an app from before branches didn't write. */
function asOld(lines: string[]): string[] {
  return lines.map((line) => {
    const event = JSON.parse(line) as Record<string, unknown>;
    delete event.branch;
    if (event.version) delete (event.version as Record<string, unknown>).branch;
    return JSON.stringify(event);
  });
}

describe('branches on disk', () => {
  /** Main: v1.0, then a branch from it with two changes (one undone), then a change on main. */
  function worked() {
    const events: HistoryEvent[] = [];
    const change = (h: BudgetHistory) => {
      events.push({ type: 'change', entry: h.entries.at(-1)! });
      return h;
    };
    let h = startHistory(newBudget('Pilot'), 'Created');
    events.push({ type: 'change', entry: h.entries[0]! });
    h = change(edit(h, 'A'));
    const v10 = saveVersion(h, { ...fields, number: '1.0' });
    h = v10.history;
    events.push({ type: 'version', at: 'now', version: v10.version });
    const made = createBranch(h, '25-day shoot', v10.version.entryId);
    const { head: _head, ...info } = made.branch;
    events.push({ type: 'branch', at: 'now', branch: info });
    h = change(edit(made.history, 'B'));
    h = change(edit(h, 'C'));
    h = undo(h);
    events.push({ type: 'move', at: 'now', to: h.entries[h.current]!.id, branch: h.branch });
    h = openBranch(h, MAIN_BRANCH);
    events.push({ type: 'show', at: 'now', branch: MAIN_BRANCH });
    h = change(edit(h, 'D'));
    return { h, events, branch: made.branch };
  }

  it('replays branches, their ends and the branch showing', () => {
    const { h, events } = worked();
    const s = store();
    s.save(events);
    const replayed = replayHistory(s.lines, s.load)!;
    expect(ofBranch(replayed)).toEqual(ofBranch(h));
    expect(heads(replayed)).toEqual(heads(h));
    expect(replayed.branch).toBe(MAIN_BRANCH);
    expect(replayed.current).toBe(h.current);
    expect(replayed.versions).toEqual(h.versions);
  });

  it('writes a whole history as events that replay the same', () => {
    const { h: start, branch } = worked();
    let h = renameBranch(start, branch.id, '30-day shoot');
    h = setNotPicked(h, branch.id, true);
    h = openBranch(h, branch.id);
    const s = store();
    s.save(historyEvents(h, 'now'));
    const replayed = replayHistory(s.lines, s.load)!;
    expect(ofBranch(replayed)).toEqual(ofBranch(h));
    expect(heads(replayed)).toEqual(heads(h));
    expect(replayed.branch).toBe(branch.id);
    expect(replayed.current).toBe(h.current);
    // The branch's end is B: C was undone.
    expect(currentBudget(replayed).name).toBe('B');
  });

  it('sorts a history from before branches into Alternates, the same way each time', () => {
    const s = store();
    const h0 = startHistory(newBudget('Pilot'), 'Created');
    const v10 = saveVersion(h0, { ...fields, number: '1.0' }).version;
    const a = edit(h0, 'A');
    const v11 = saveVersion(a, { ...fields, number: '1.1' }).version;
    const d = edit(a, 'D');
    const b = edit(h0, 'B');
    const u = edit(b, 'U'); // undone, with no version: stays with the main line
    const b2 = edit(b, 'B2');
    s.save([
      { type: 'change', entry: h0.entries[0]! },
      { type: 'version', at: 'now', version: v10 },
      { type: 'change', entry: a.entries[1]! },
      { type: 'version', at: 'now', version: v11 },
      { type: 'change', entry: d.entries[2]! },
      { type: 'move', at: 'now', to: h0.entries[0]!.id },
      { type: 'change', entry: b.entries[1]! },
      { type: 'change', entry: u.entries[2]! },
      { type: 'move', at: 'now', to: b.entries[1]!.id },
      { type: 'change', entry: b2.entries[2]! },
    ]);
    s.lines.splice(0, s.lines.length, ...asOld(s.lines));
    const replayed = replayHistory(s.lines, s.load)!;
    const alt = `alt-${a.entries[1]!.id}`;
    expect(heads(replayed)).toEqual([
      [MAIN_BRANCH, '', null, b2.entries[2]!.id, false],
      [alt, 'Alternate 1', h0.entries[0]!.id, d.entries[2]!.id, false],
    ]);
    expect(replayed.entries.map((e) => [e.label, e.branch])).toEqual([
      ['Created', MAIN_BRANCH],
      ['A', alt],
      ['D', alt],
      ['B', MAIN_BRANCH],
      ['U', MAIN_BRANCH],
      ['B2', MAIN_BRANCH],
    ]);
    expect(replayed.versions.map((v) => [v.number, v.branch])).toEqual([
      ['1.0', MAIN_BRANCH],
      ['1.1', alt],
    ]);
    expect(replayed.branch).toBe(MAIN_BRANCH);
    expect(currentBudget(replayed).name).toBe('B2');

    // Reopening sorts it the same way, and so does reopening after a branch-aware line is added.
    expect(replayHistory(s.lines, s.load)).toEqual(replayed);
    const next = edit(replayed, 'E');
    s.save([{ type: 'change', entry: next.entries.at(-1)! }]);
    const again = replayHistory(s.lines, s.load)!;
    expect(heads(again)).toEqual(heads(next));
    expect(ofBranch(again)).toEqual(ofBranch(next));
  });

  it('names branch files after their branches, never twice', () => {
    const { h: start, branch } = worked();
    let h = createBranch(start, 'Union: crew', branch.from!).history;
    h = createBranch(h, 'Union- crew', branch.from!).history;
    expect([...branchFileNames(h).values()]).toEqual([
      '25-day shoot.json',
      'Union- crew.json',
      'Union- crew (2).json',
    ]);
  });

  it('writes only the branch files that changed, and keeps the others', () => {
    const { h, branch } = worked();
    const first = branchFilesToSave(h, {});
    expect(first.files.keep).toEqual(['25-day shoot.json']);
    expect(first.files.write.map((w) => [w.file, w.budget.name])).toEqual([['25-day shoot.json', 'B']]);
    expect(mainBudget(h).name).toBe('D');
    expect(branchFilesToSave(h, first.written).files.write).toEqual([]);
    const renamed = renameBranch(h, branch.id, '30-day shoot');
    const second = branchFilesToSave(renamed, first.written);
    expect(second.files.keep).toEqual(['30-day shoot.json']);
    expect(second.files.write.map((w) => w.file)).toEqual(['30-day shoot.json']);
    const edited = edit(openBranch(renamed, branch.id), 'B again');
    expect(branchFilesToSave(edited, second.written).files.write.map((w) => w.budget.name)).toEqual([
      'B again',
    ]);
  });
});
