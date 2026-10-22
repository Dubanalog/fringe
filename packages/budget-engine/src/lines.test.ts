import { describe, expect, it } from 'vitest';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine } from './model';
import {
  codeList,
  codeUseCount,
  deleteCode,
  renameCode,
  budgetTags,
  deleteLineTag,
  orderLineTags,
  renameLineTag,
  setLineTag,
  summarizeLines,
  tagUseCount,
  unitsFromLines,
} from './lines';
import { createFringeRange, removeFringeRanges } from './ranges';
import { accountFringes, fringeTotal, unitCount } from './fringes';
import { EditError } from './edit';

function line(
  id: string,
  subtotal: string,
  pct: string | null,
  fringes: string[],
  groups: string[] = [],
): DetailLine {
  return {
    id,
    description: id,
    amount: '1',
    unit: '',
    x: '1',
    rate: subtotal,
    currency: '',
    subtotal,
    fringes,
    groups,
    globalsUsed: [],
    location: '',
    set: '',
    in: '',
    ff1: '',
    ff2: '',
    formulas: {},
    formulasInferred: false,
    importedFringePercent: pct === null ? null : { line: pct, cumulative: pct },
  };
}

const budget: Budget = {
  id: 'b',
  name: 'b',
  settings: DEFAULT_BUDGET_SETTINGS,
  categories: [
    {
      id: 'c',
      number: '1100',
      description: '',
      imported: null,
      accounts: [
        {
          id: 'a',
          number: '1101',
          description: '',
          imported: null,
          details: [
            line('l1', '1000', '10%', ['FICA'], ['SHOOT']),
            line('l2', '500', '20%', ['FICA', 'WGA']),
          ],
          postedFringes: [{ kind: 'percent', name: 'FICA', rate: '6.2', unit: '', base: '0', total: '0' }],
          fringeRanges: [],
        },
      ],
    },
  ],
};

describe('detail line tags', () => {
  it('applies a fringe to lines that lack it and removes it again', () => {
    const on = setLineTag(budget, ['l1', 'l2'], 'fringes', 'WGA', true);
    expect(on.categories[0]!.accounts[0]!.details.map((d) => d.fringes)).toEqual([
      ['FICA', 'WGA'],
      ['FICA', 'WGA'],
    ]);
    const off = setLineTag(on, ['l1'], 'fringes', 'FICA', false);
    expect(off.categories[0]!.accounts[0]!.details[0]!.fringes).toEqual(['WGA']);
  });

  it('lists every fringe with its rate, and every group', () => {
    const { fringes, groups } = budgetTags(budget);
    expect([...fringes.keys()]).toEqual(['FICA', 'WGA']);
    expect(fringes.get('FICA')).toEqual({ kind: 'percent', rate: '6.2', unit: '' });
    expect(fringes.get('WGA')).toBeNull();
    expect(groups).toEqual(['SHOOT']);
  });

  it('sums selected lines and reports the fringe % range', () => {
    const s = summarizeLines(budget.categories[0]!.accounts[0]!.details);
    expect(s.subtotal.toFixed()).toBe('1500');
    expect(s.fringe?.toFixed()).toBe('200');
    expect([s.fringePercent?.min.toFixed(), s.fringePercent?.max.toFixed()]).toEqual(['10', '20']);
    expect(s.fringes.get('FICA')).toBe(2);
    expect(s.fringes.get('WGA')).toBe(1);
  });
});

describe('group order', () => {
  it("reorders a line's groups, keeping any not named at the end", () => {
    const two = setLineTag(budget, ['l1'], 'groups', 'STAFF', true);
    const next = orderLineTags(two, 'l1', 'groups', ['STAFF']);
    expect(next.categories[0]!.accounts[0]!.details[0]!.groups).toEqual(['STAFF', 'SHOOT']);
  });
});

describe('units', () => {
  it('collects units used, most used first, reading hours from the name', () => {
    const l = (unit: string) => ({ unit });
    expect(unitsFromLines([l('Weeks'), l('Weeks-45 Hours'), l('Weeks'), l('Days-8'), l('')])).toEqual([
      { name: 'Weeks', hours: null },
      { name: 'Days-8', hours: '8' },
      { name: 'Weeks-45 Hours', hours: '45' },
    ]);
  });
});

describe('fringe ranges', () => {
  it('makes a range from two or more lines, in line order, and removes it', () => {
    const account = (b: Budget) => b.categories[0]!.accounts[0]!;
    expect(() => createFringeRange(budget, 'a', ['l1'])).toThrow(EditError);
    const made = createFringeRange(budget, 'a', ['l2', 'l1']);
    expect(account(made.budget).fringeRanges).toEqual([{ id: made.id, lineIds: ['l1', 'l2'] }]);
    expect(account(removeFringeRanges(made.budget, 'a', ['l2'])).fringeRanges).toEqual([]);
  });
});

describe('fringe calculation', () => {
  const capped = (cutoff: string | null) => ({
    ...budget,
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      fringeDefs: [
        { name: 'FICA', kind: 'percent' as const, rate: '6.2', unit: '', cutoff, cutoffInferred: false },
        { name: 'WGA', kind: 'percent' as const, rate: '10', unit: '', cutoff: null, cutoffInferred: false },
      ],
    },
  });
  const amounts = (b: Budget) => {
    const m = accountFringes(b.categories[0]!.accounts[0]!, b.settings);
    return ['l1', 'l2'].map((id) => Object.fromEntries([...m.get(id)!].map(([k, v]) => [k, v?.toString()])));
  };

  it('gives each line outside a range its own cutoff', () => {
    expect(amounts(capped('700'))).toEqual([{ FICA: '43.4' }, { FICA: '31', WGA: '50' }]);
  });

  it('shares the cutoff across a range, line by line', () => {
    const b = createFringeRange(capped('1200'), 'a', ['l1', 'l2']).budget;
    // l1 uses 1,000 of the 1,200; l2 is taxed on the 200 left.
    expect(amounts(b)).toEqual([{ FICA: '62' }, { FICA: '12.4', WGA: '50' }]);
    const l2 = accountFringes(b.categories[0]!.accounts[0]!, b.settings).get('l2');
    expect(fringeTotal(l2)?.toString()).toBe('62.4');
  });

  it('counts a flat fringe in its unit, using unit hours', () => {
    const units = [{ name: 'Weeks-45 Hours', hours: '45' }];
    expect(unitCount({ amount: '44', unit: 'Weeks-45 Hours' }, 'Weeks', units)?.toString()).toBe('44');
    expect(unitCount({ amount: '2', unit: 'Weeks-45 Hours' }, 'Hours', units)?.toString()).toBe('90');
    expect(unitCount({ amount: '5', unit: 'Days' }, 'Weeks', units)).toBeNull();
  });
});

describe('setting up fringes and groups', () => {
  const lines = (b: Budget) => b.categories[0]!.accounts[0]!.details;
  const withSetup: Budget = {
    ...budget,
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      groups: ['SHOOT', 'PREP'],
      groupColors: { SHOOT: '#ff0000' },
      fringeDefs: [
        { name: 'FICA', kind: 'percent', rate: '6.2', unit: '', cutoff: null, cutoffInferred: false },
      ],
    },
  };

  it('lists groups no line uses yet', () => {
    expect(budgetTags(withSetup).groups).toEqual(['PREP', 'SHOOT']);
  });

  it('renames a group on every line, keeping its colour', () => {
    const next = renameLineTag(withSetup, 'groups', 'SHOOT', 'PRINCIPAL');
    expect(lines(next)[0]!.groups).toEqual(['PRINCIPAL']);
    expect(next.settings.groupColors).toEqual({ PRINCIPAL: '#ff0000' });
    expect(() => renameLineTag(withSetup, 'groups', 'SHOOT', 'PREP')).toThrow(EditError);
  });

  it('renames and deletes a fringe on every line', () => {
    const renamed = renameLineTag(withSetup, 'fringes', 'FICA', 'FICA SS');
    expect(lines(renamed).map((d) => d.fringes)).toEqual([['FICA SS'], ['FICA SS', 'WGA']]);
    expect(renamed.settings.fringeDefs[0]!.name).toBe('FICA SS');
    expect(tagUseCount(renamed, 'fringes', 'FICA SS')).toBe(2);
    const gone = deleteLineTag(renamed, 'fringes', 'FICA SS');
    expect(lines(gone).map((d) => d.fringes)).toEqual([[], ['WGA']]);
    expect(gone.settings.fringeDefs).toEqual([]);
  });
});

describe('code lists', () => {
  const coded = (b: Budget, values: string[]) => ({
    ...b,
    categories: [
      {
        ...b.categories[0]!,
        accounts: [
          {
            ...b.categories[0]!.accounts[0]!,
            details: b.categories[0]!.accounts[0]!.details.map((d, i) => ({ ...d, in: values[i]! })),
          },
        ],
      },
    ],
  });
  const ins = (b: Budget) => b.categories[0]!.accounts[0]!.details.map((d) => d.in);

  it('lists set-up codes first, then ones lines use', () => {
    const b = coded(
      { ...budget, settings: { ...budget.settings, codes: { ...budget.settings.codes, in: ['NY'] } } },
      ['LA', 'NY'],
    );
    expect(codeList(b, 'in')).toEqual(['NY', 'LA']);
    expect(codeUseCount(b, 'in', 'LA')).toBe(1);
  });

  it('renames a code on its lines, refuses a duplicate, and deletes', () => {
    const b = coded(budget, ['LA', 'NY']);
    const renamed = renameCode(b, 'in', 'LA', 'ATL');
    expect(ins(renamed)).toEqual(['ATL', 'NY']);
    expect(() => renameCode(renamed, 'in', 'ATL', 'NY')).toThrow(EditError);
    const gone = deleteCode(renamed, 'in', 'ATL');
    expect(ins(gone)).toEqual(['', 'NY']);
    expect(codeList(gone, 'in')).toEqual(['NY']);
  });
});
