import { describe, expect, it } from 'vitest';
import {
  type Account,
  type Budget,
  DEFAULT_BUDGET_SETTINGS,
  type DetailLine,
  type FringeDef,
  type PostedFringe,
} from './model';
import { unitCount } from './fringes';
import { importReport } from './report';

function line(id: string, amount: string, unit: string, rate: string, fringes: string[]): DetailLine {
  return {
    id,
    description: id,
    amount,
    unit,
    x: '1',
    rate,
    currency: '',
    subtotal: (Number(amount) * Number(rate)).toString(),
    fringes,
    groups: [],
    globalsUsed: [],
    location: '',
    set: '',
    in: '',
    ff1: '',
    ff2: '',
    formulas: {},
    formulasInferred: false,
    importedFringePercent: null,
  };
}

const percent = (name: string, rate: string): FringeDef => ({
  name,
  kind: 'percent',
  rate,
  unit: '',
  cutoff: null,
  cutoffInferred: false,
});
const flat = (name: string, rate: string, unit: string): FringeDef => ({
  name,
  kind: 'flat',
  rate,
  unit,
  cutoff: null,
  cutoffInferred: false,
});
const posted = (f: FringeDef, base: string, total: string): PostedFringe => ({
  kind: f.kind,
  name: f.name,
  rate: f.rate,
  unit: f.unit,
  base,
  total,
});

/** One account that posts its own fringes, as the file reported them. */
function budget(defs: FringeDef[], details: DetailLine[], postings: PostedFringe[], total: string): Budget {
  const account: Account = {
    id: 'a',
    number: '1101',
    description: 'Crew',
    imported: { fringe: null, original: total, total, variance: '0' },
    details,
    postedFringes: postings,
    fringeRanges: [],
  };
  return {
    id: 'b',
    name: 'b',
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      fringes: { ...DEFAULT_BUDGET_SETTINGS.fringes, posting: 'account' },
      fringeDefs: defs,
      units: [
        { name: 'Days', hours: null },
        { name: 'Weeks-40', hours: '40' },
        { name: 'Weeks', hours: null },
      ],
    },
    categories: [
      {
        id: 'c',
        number: '1100',
        description: '',
        imported: { fringe: null, original: total, total, variance: '0' },
        accounts: [account],
      },
    ],
  };
}

const hw = flat('HW', '10', 'Hours');

describe('hours per unit', () => {
  // 5 forty-hour weeks are 200 hours; the posting counts 600, so the 40 days are 400 hours.
  const b = budget(
    [hw],
    [line('w', '5', 'Weeks-40', '2000', ['HW']), line('d', '40', 'Days', '400', ['HW'])],
    [posted(hw, '600', '6000')],
    '32000',
  );

  it('converts between units through hours', () => {
    const units = [
      { name: 'Days', hours: '10' },
      { name: 'Weeks', hours: '50' },
    ];
    expect(unitCount({ amount: '25', unit: 'Day' }, 'Week', units)?.toString()).toBe('5');
    expect(unitCount({ amount: '3', unit: 'Days' }, 'Hours', units)?.toString()).toBe('30');
    expect(unitCount({ amount: '3', unit: 'Days' }, 'Weeks', [])).toBeNull();
    expect(unitCount({ amount: '1', unit: '' }, 'Hours', units)?.toString()).toBe('0');
  });

  it('reports the hours worked out, and the total then matches', () => {
    const days = { name: 'Days', hours: '10', hoursInferred: true };
    const units = [...b.settings.units.filter((u) => u.name !== 'Days'), days];
    const r = importReport({ ...b, settings: { ...b.settings, units } });
    expect(r.unitHours).toEqual([{ name: 'Days', hours: '10' }]);
    expect(r.mismatches).toEqual([]);
    expect(r.calculatedTotal).toBe(r.importedTotal);
  });
});

describe('cutoffs from same-rate lines', () => {
  const p = percent('P', '10');
  // One person over two lines at the same rate, another on their own, with a 250,000 cutoff:
  // 250,000 + 250,000. Taken line by line, no round cutoff gives that.
  const b = budget(
    [p],
    [
      line('a1', '1.0005', 'Weeks', '100000', ['P']),
      line('a2', '2', 'Weeks', '100000', ['P']),
      line('b1', '1', 'Weeks', '300000', ['P']),
    ],
    [posted(p, '500000', '50000')],
    '650050',
  );

  it('says what still differs and why', () => {
    const r = importReport(b);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ number: '1101', difference: '10005.00' });
    expect(r.mismatches[0]!.reasons[0]).toMatch(/P has no cutoff/);
  });

  it('points at ranges when the base is off by a whole cutoff', () => {
    const ranged = { ...b, settings: { ...b.settings, fringeDefs: [{ ...p, cutoff: '250000' }] } };
    const split = {
      ...ranged,
      categories: [
        {
          ...ranged.categories[0]!,
          accounts: [{ ...ranged.categories[0]!.accounts[0]!, fringeRanges: [] }],
        },
      ],
    };
    // Unranged, a1 and a2 each get their own 250,000: 100,050 + 200,000 + 250,000 is 50,050 over.
    // Not a whole cutoff, so the report gives the bases.
    expect(importReport(split).mismatches[0]!.reasons[0]).toMatch(
      /base here is 550,050.00; the file's is 500,000.00/,
    );
  });

  it('lists lines whose fringe has no hours to work from', () => {
    const days = budget([hw], [line('d', '4', 'Days', '400', ['HW'])], [posted(hw, '40', '400')], '2000');
    const r = importReport(days);
    expect(r.unknownFringes).toMatchObject([{ number: '1101', line: 'd', fringe: 'HW' }]);
    expect(r.mismatches[0]!.reasons[0]).toMatch(/Days has no hours set/);
  });
});
