import { describe, expect, it } from 'vitest';
import { type BudgetHistory, createBranch, goTo, recordChange, saveVersion, startHistory } from './history';
import { setPercentage } from './percentages';
import { newBudget } from './project';
import { readOnlyNote, runVersionTool } from './version-tools';

const fields = { name: '', sentOn: '', sentTo: '', notes: '', changes: '', pdf: null };

/** Pilot: v1.0, then a contingency and v1.1 on the main line; "25-day shoot" from v1.0 with v1.0 of its own. */
function pilot(): BudgetHistory {
  const start = newBudget('Pilot');
  let h = startHistory(start, 'Opened', 't0');
  h = saveVersion(h, { ...fields, number: '1.0' }, 't1').history;
  const v10 = h.entries[h.current]!.id;
  h = recordChange(
    h,
    setPercentage(start, { name: 'Contingency', percent: '10', excludeGroups: [] }),
    'Add Contingency',
    't2',
  );
  h = saveVersion(h, { ...fields, number: '1.1' }, 't3').history;
  h = createBranch(h, '25-day shoot', v10, 't4').history;
  h = recordChange(
    h,
    setPercentage(start, { name: 'Overhead', percent: '5', excludeGroups: [] }),
    'Add Overhead',
    't5',
  );
  h = saveVersion(h, { ...fields, number: '1.0' }, 't6').history;
  return h;
}

const run = (h: BudgetHistory, name: string, input: Record<string, unknown> = {}) =>
  runVersionTool(h, name, input)!;

describe('branch tools for the AI', () => {
  it('lists branches, where each started and what is showing', () => {
    const r = run(pilot(), 'list_branches').result as {
      showing: unknown;
      branches: { branch: string; startedFrom: string | null; versions: string[]; showing: boolean }[];
    };
    expect(r.showing).toEqual({ branch: '25-day shoot', point: 'latest', canChange: true });
    expect(r.branches.map((b) => [b.branch, b.startedFrom, b.versions, b.showing])).toEqual([
      ['Pilot', null, ['v1.1', 'v1.0'], false],
      ['25-day shoot', 'Pilot v1.0', ['v1.0'], true],
    ]);
  });

  it("lists one branch's versions, the one showing by default", () => {
    const h = pilot();
    const mine = run(h, 'list_versions').result as { branch: string; versions: { version: string }[] };
    expect(mine.branch).toBe('25-day shoot');
    expect(mine.versions.map((v) => v.version)).toEqual(['1.0']);
    const main = run(h, 'list_versions', { branch: 'pilot' }).result as { versions: { version: string }[] };
    expect(main.versions.map((v) => v.version)).toEqual(['1.1', '1.0']);
    expect(() => run(h, 'list_versions', { branch: 'Nope' })).toThrow(
      /no branch called "Nope".*"Pilot", "25-day shoot"/,
    );
  });

  it('compares versions across branches', () => {
    const h = pilot();
    const c = run(h, 'compare_versions', { from: '1.1', fromBranch: 'Pilot', toBranch: '25-day shoot' })
      .result as {
      from: string;
      to: string;
      draft: string;
    };
    expect([c.from, c.to]).toEqual(['Pilot v1.1', '25-day shoot latest']);
    expect(c.draft).toMatch(/Contingency/);
    const same = run(h, 'compare_versions', { from: '1.0', fromBranch: 'Pilot', to: '1.0' }).result as {
      to: string;
      history: { change: string }[];
    };
    expect(same.to).toBe('25-day shoot v1.0');
    expect(same.history.map((x) => x.change)).toEqual(['Add Overhead']);
  });

  it('starts a branch for the app to make, after checking it', () => {
    const h = pilot();
    const r = run(h, 'create_branch', { name: '30-day shoot', from: '1.1', fromBranch: 'Pilot' });
    const v11 = h.versions.find((v) => v.number === '1.1')!;
    expect(r.branch).toEqual({ name: '30-day shoot', fromEntryId: v11.entryId });
    expect((r.result as { startedFrom: string }).startedFrom).toBe('Pilot v1.1');
    expect(r.label).toBe('AI: start branch "30-day shoot"');
    expect(run(h, 'create_branch', { name: 'Again' }).branch!.fromEntryId).toBe(h.entries[h.current]!.id);
    expect(() => run(h, 'create_branch', { name: '25-Day Shoot' })).toThrow(/already a branch/);
    expect(() => run(h, 'create_branch', { name: ' ' })).toThrow();
  });

  it('saves a version of the branch showing, for the app to save once the user allows it', () => {
    const h = pilot();
    const r = run(h, 'save_version', {
      name: 'Studio draft',
      whatChanged: 'Added overhead',
      sentOn: '2026-11-20',
    });
    expect(r.version).toMatchObject({
      number: '1.1',
      branch: h.branch,
      entryId: h.entries[h.current]!.id,
      name: 'Studio draft',
      changes: 'Added overhead',
      sentOn: '2026-11-20',
      pdf: null,
    });
    expect(r.label).toBe('AI: save 25-day shoot v1.1');
    expect(r.result).toMatchObject({ version: '1.1', branch: '25-day shoot', comparedWith: 'v1.0' });
    // The history itself is left for the app to change.
    expect(h.versions.filter((v) => v.branch === h.branch)).toHaveLength(1);
    expect(run(h, 'save_version', { number: 'v2.0' }).version!.number).toBe('2.0');
    expect(() => run(h, 'save_version', { number: '1.0' })).toThrow(/already a v1.0/);
    expect(() => run(h, 'save_version', { sentOn: 'Friday' })).toThrow(/YYYY-MM-DD/);
  });

  it('refuses changes to a version or an earlier point', () => {
    let h = pilot();
    expect(readOnlyNote(h)).toBeNull();
    const v10 = h.versions.find((v) => v.number === '1.0' && v.branch === 'main')!;
    h = goTo(h, v10.entryId);
    expect(readOnlyNote(h)).toMatch(/"Pilot" v1.0, which stays as it was.*create_branch/);
    expect(() => run(h, 'fill_version_form', { notes: 'x' })).toThrow(/branch's latest/);
    expect(() => run(h, 'save_version')).toThrow(/branch's latest/);
    // Started from what's showing: the version.
    expect(run(h, 'create_branch', { name: 'Option C' }).branch!.fromEntryId).toBe(v10.entryId);
  });

  it("can't start a branch from an earlier point that isn't a version", () => {
    const start = newBudget('Pilot');
    let h = startHistory(start, 'Opened', 't0');
    h = recordChange(h, { ...start, name: 'Pilot 2' }, 'Rename', 't1');
    h = goTo(h, h.entries[0]!.id);
    expect(readOnlyNote(h)).toMatch(/at an earlier point.*To change the budget, ask the user/);
    expect(() => run(h, 'create_branch', { name: 'Option B' })).toThrow(/Give `from`/);
  });
});
