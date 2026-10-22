import { describe, expect, it } from 'vitest';
import {
  addonData,
  addonReport,
  addonIdFor,
  cleanAddonData,
  isAddonId,
  plainTotals,
  setAddonData,
} from './addons';
import { type Budget, DEFAULT_BUDGET_SETTINGS } from './model';
import { normalizeBudget } from './project';
import { ToolError, runTool } from './tools';

const budget = (): Budget => ({
  id: 'b',
  name: 'Pilot',
  settings: { ...DEFAULT_BUDGET_SETTINGS },
  categories: [],
});

describe('add-ons', () => {
  it('makes ids from names', () => {
    expect(addonIdFor('Cash Flow')).toBe('cash-flow');
    expect(addonIdFor('  Résumé / Crew Deals!  ')).toBe('resume-crew-deals');
    expect(addonIdFor('!!!')).toBe('add-on');
    expect(isAddonId('cash-flow')).toBe(true);
    expect(isAddonId('../x')).toBe(false);
    expect(isAddonId('Cash')).toBe(false);
  });

  it('keeps data per add-on in the budget, and clears it', () => {
    let b = setAddonData(budget(), 'cash-flow', { weeks: 12 });
    b = setAddonData(b, 'notes', ['a']);
    expect(addonData(b, 'cash-flow')).toEqual({ weeks: 12 });
    b = setAddonData(b, 'cash-flow', null);
    expect(addonData(b, 'cash-flow')).toBeNull();
    b = setAddonData(b, 'notes', null);
    expect(b.settings.addonData).toBeUndefined();
  });

  it('refuses data that is too big or not JSON', () => {
    expect(() => setAddonData(budget(), 'x', 'a'.repeat(2_100_000))).toThrow(ToolError);
    expect(() => setAddonData(budget(), 'x', 10n)).toThrow(ToolError);
    expect(() => setAddonData(budget(), 'Bad Id', 1)).toThrow(ToolError);
  });

  it('drops saved data under ids that aren’t add-on ids', () => {
    expect(cleanAddonData({ 'cash-flow': 1, '../evil': 2, empty: null })).toEqual({ 'cash-flow': 1 });
    expect(cleanAddonData([1])).toBeUndefined();
    const b = budget();
    b.settings = { ...b.settings, addonData: { __proto__x: 1, ok: 2 } as Record<string, unknown> };
    expect(normalizeBudget(b).settings.addonData).toEqual({ ok: 2 });
  });

  it('lets the AI read and change an add-on’s data', () => {
    const set = runTool(budget(), 'set_addon_data', {
      addon: 'cash-flow',
      data: { weeks: 10 },
      summary: 'ten weeks',
    });
    expect(set.label).toBe('AI: cash-flow ten weeks');
    expect(runTool(set.budget!, 'get_addon_data', { addon: 'cash-flow' }).result).toEqual({
      addon: 'cash-flow',
      data: { weeks: 10 },
    });
  });

  it('gives totals as plain data', () => {
    const t = plainTotals(budget());
    expect(t.grand.total).toBe('0');
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });

  it('makes an add-on’s report into the app’s own', () => {
    const doc = addonReport(budget(), {
      title: 'Cash Flow',
      sections: [
        {
          columns: ['Week', { label: 'Spend', kind: 'money' }, { label: 'Odd', kind: 'bogus' }],
          rows: [
            ['1', 1000.5],
            ['2', '2000', 'x', 'extra'],
          ],
          totals: [['Total', '3000.5']],
          note: 'Estimates.',
        },
      ],
    });
    const [section] = doc.sections;
    expect(section!.title).toBe('Cash Flow');
    const table = section!.blocks[0]!;
    expect(table.kind === 'table' && table.columns.map((c) => c.kind)).toEqual(['text', 'money', 'text']);
    expect(table.kind === 'table' && table.rows.map((r) => [r.style, r.cells])).toEqual([
      ['normal', ['1', '1000.5', null]],
      ['normal', ['2', '2000', 'x']],
      ['total', ['Total', '3000.5', null]],
      ['note', ['Estimates.', null, null]],
    ]);
    const single = addonReport(budget(), {
      sections: [
        {
          columns: ['Level', { label: 'Total', kind: 'money' }, { label: '%', kind: 'percent' }],
          rows: [['ATL', 1234.5, 100 / 3]],
          totals: ['Total', 1234.5, 100],
        },
      ],
    }).sections[0]!.blocks[0]!;
    expect(single.kind === 'table' && single.rows.map((r) => r.cells)).toEqual([
      ['ATL', '1234.5', '33.33'],
      ['Total', '1234.5', '100'],
    ]);
    expect(() => addonReport(budget(), { sections: [] })).toThrow(ToolError);
    expect(() => addonReport(budget(), { sections: [{ rows: [] }] })).toThrow(ToolError);
  });
});
