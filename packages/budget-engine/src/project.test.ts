import { describe, expect, it } from 'vitest';
import { recordChange, saveVersion, startHistory, undo } from './history';
import { insertCategory } from './edit';
import { type Budget } from './model';
import {
  type HistoryEvent,
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
