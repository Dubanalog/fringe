import { describe, expect, it } from 'vitest';
import { crewFringes, crewList, defaultCrewFringes } from './crew';
import { deleteLineTag, renameLineTag } from './lines';
import { setPercentage } from './percentages';
import { type Budget, DEFAULT_BUDGET_SETTINGS, type DetailLine, type FringeDef } from './model';
import { buildReports, DEFAULT_REPORT_OPTIONS } from './reports';

const fringe = (name: string, rate: string): FringeDef => ({
  name,
  kind: 'percent',
  rate,
  unit: '',
  cutoff: null,
  cutoffInferred: false,
});

const line = (id: string, rate: string, fringes: string[]): DetailLine => ({
  id,
  description: id,
  amount: '1',
  unit: 'Weeks',
  x: '1',
  rate,
  currency: '',
  subtotal: rate,
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
});

/** A director above the line; below it a DP (two lines, one person), a loan-out operator and a box rental. */
function budget(): Budget {
  const account = (id: string, number: string, details: DetailLine[], ranges: string[][] = []) => ({
    id,
    number,
    description: id,
    imported: null,
    details,
    postedFringes: [],
    fringeRanges: ranges.map((lineIds, i) => ({ id: `${id}-r${i}`, lineIds })),
  });
  return {
    id: 'b',
    name: 'Pilot',
    settings: {
      ...DEFAULT_BUDGET_SETTINGS,
      fringeDefs: [fringe('DGA', '10'), fringe('W/C', '5'), fringe('PR Fee', '1')],
    },
    categories: [
      {
        id: 'c1',
        number: '1300',
        description: 'DIRECTION',
        imported: null,
        accounts: [account('Director', '1301', [line('director', '10000', ['DGA', 'W/C', 'PR Fee'])])],
      },
      {
        id: 'c2',
        number: '2100',
        description: 'CAMERA',
        imported: null,
        accounts: [
          account(
            'DP',
            '2101',
            [line('dp prep', '2000', ['W/C', 'PR Fee']), line('dp shoot', '6000', ['W/C', 'PR Fee'])],
            [['dp prep', 'dp shoot']],
          ),
          account('Operator', '2102', [line('operator loan-out', '4000', ['W/C', 'PR Fee'])]),
          account('Box', '2103', [line('box rental', '500', ['PR Fee']), line('unused', '0', ['W/C'])]),
        ],
      },
    ],
  };
}

describe('crew list', () => {
  it('finds workers’ comp however it’s named', () => {
    const names = [
      'WC',
      'W/C',
      'W.C.',
      'Workers Comp',
      "Worker's Comp",
      'Work Comp',
      'FICA',
      'PR Fee',
      'WGA',
    ];
    expect(defaultCrewFringes(names.map((n) => fringe(n, '1')))).toEqual([
      'WC',
      'W/C',
      'W.C.',
      'Workers Comp',
      "Worker's Comp",
      'Work Comp',
    ]);
  });

  it('counts lines with workers’ comp as labor, loan-outs in and box rentals out', () => {
    const crew = crewList(budget());
    expect(crew.fringes).toEqual(['W/C']);
    expect(
      crew.levels.map((l) => [l.level?.name, l.categories.map((c) => c.lines.map((x) => x.line.id))]),
    ).toEqual([
      ['Above-The-Line', [['director']]],
      ['Below-The-Line', [['dp prep', 'dp shoot', 'operator loan-out']]],
    ]);
    expect(crew.positions).toBe(3);
    expect(crew.wages.toString()).toBe('22000');
    // Director 16%, everyone else 6%.
    expect(crew.fringeTotal.toString()).toBe('2320');
  });

  it('uses the fringes the budget chose instead', () => {
    const b = budget();
    b.settings.crewFringes = ['DGA'];
    expect(crewFringes(b)).toEqual(['DGA']);
    expect(crewList(b).positions).toBe(1);
  });

  it('follows a fringe renamed or deleted', () => {
    let b = budget();
    b.settings.crewFringes = ['W/C', 'DGA'];
    b = renameLineTag(b, 'fringes', 'W/C', 'Workers Comp');
    expect(b.settings.crewFringes).toEqual(['Workers Comp', 'DGA']);
    b = deleteLineTag(b, 'fringes', 'DGA');
    expect(b.settings.crewFringes).toEqual(['Workers Comp']);
  });

  it('is a report', () => {
    const doc = buildReports(budget(), { ...DEFAULT_REPORT_OPTIONS, reports: ['crew'] });
    const [table] = doc.sections[0]!.blocks;
    const text = JSON.stringify(table);
    expect(text).toContain('operator loan-out');
    expect(text).not.toContain('box rental');
    expect(text).toContain('Total Labor');
    expect(text).toContain('3 positions. Lines with W/C.');
  });
});

describe('report order', () => {
  it('prints reports in the chosen order, the rest after in their usual order', () => {
    const doc = buildReports(budget(), {
      ...DEFAULT_REPORT_OPTIONS,
      reports: ['topsheet', 'crew', 'summary'],
      order: ['crew', 'summary'],
    });
    expect(doc.sections.map((s) => s.id)).toEqual(['crew', 'summary', 'topsheet']);
  });
});

describe('leaving out zero', () => {
  it('leaves zero percentages off the topsheet', () => {
    const b = setPercentage(budget(), {
      name: 'Contingency',
      percent: '0',
      account: '9999',
      excludeGroups: [],
    });
    const topsheet = (hideZero: boolean) =>
      JSON.stringify(buildReports(b, { ...DEFAULT_REPORT_OPTIONS, reports: ['topsheet'], hideZero }));
    expect(topsheet(false)).toContain('9999');
    expect(topsheet(true)).not.toContain('9999');
  });
});
