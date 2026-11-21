import { createHash } from 'node:crypto';
import {
  MAIN_BRANCH,
  branchFilesToSave,
  historyEvents,
  mainBudget,
  replayHistory,
  storeEvent,
  unpackBudget,
} from '@fringe/budget-engine';
import { describe, expect, it } from 'vitest';
import { SAMPLE_KNOWLEDGE, SAMPLE_NAME, sampleHistory } from './sample-budget';

describe('the sample budget', () => {
  const history = sampleHistory();

  it('has history, versions and three branches, one not picked', () => {
    expect(mainBudget(history).name).toBe(SAMPLE_NAME);
    expect(history.entries.length).toBeGreaterThan(30);
    expect(history.versions.length).toBeGreaterThan(2);
    expect(history.branches).toHaveLength(3);
    expect(history.branches.filter((b) => b.notPicked)).toHaveLength(1);
    expect(history.branch).toBe(MAIN_BRANCH);
  });

  it('says its rates are made up', () => {
    expect(mainBudget(history).settings.assumptions).toContain('made-up');
    expect(SAMPLE_KNOWLEDGE['instructions.md']).toContain('made-up');
  });

  it('opens again as it was written, with a file for each other branch', () => {
    const pieces = new Map<string, string>();
    const lines = historyEvents(history, history.entries.at(-1)!.at).map((event) => {
      const stored = storeEvent(event, (t) => createHash('sha256').update(t).digest('hex'));
      for (const [key, text] of stored.pieces) pieces.set(key, text);
      return JSON.stringify(stored.line);
    });
    const opened = replayHistory(lines, (snapshot) =>
      unpackBudget(snapshot, (key) => JSON.parse(pieces.get(key)!)),
    )!;
    expect(opened.entries.map((e) => e.id)).toEqual(history.entries.map((e) => e.id));
    expect(opened.versions).toEqual(history.versions);
    expect(opened.branches).toEqual(history.branches);
    expect(mainBudget(opened)).toEqual(mainBudget(history));
    expect(branchFilesToSave(history, {}).files.write).toHaveLength(2);
  });
});
