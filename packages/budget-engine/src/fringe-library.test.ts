import { describe, expect, it } from 'vitest';
import { EditError } from './edit';
import {
  type LibraryFringe,
  addLibraryFringes,
  libraryFile,
  libraryFromBudget,
  mergeIntoLibrary,
  parseFringeLibrary,
} from './fringe-library';
import { newBudget } from './project';

const fica: LibraryFringe = {
  name: 'FICA',
  kind: 'percent',
  rate: '6.2',
  unit: '',
  cutoff: '184500',
  asOf: '2026-01-01',
  note: 'Payroll company sheet',
};
const health: LibraryFringe = {
  name: 'Health',
  kind: 'flat',
  rate: '7.50',
  unit: 'Hours',
  cutoff: null,
  asOf: '',
  note: '',
};

describe('parseFringeLibrary', () => {
  it('reads back what Export writes', () => {
    expect(parseFringeLibrary(JSON.parse(JSON.stringify(libraryFile([fica, health]))))).toEqual([
      fica,
      health,
    ]);
  });

  it('refuses files that are not rate libraries', () => {
    expect(() => parseFringeLibrary({ fringes: [] })).toThrow(EditError);
    expect(() => parseFringeLibrary(null)).toThrow(EditError);
    expect(() => parseFringeLibrary({ ...libraryFile([]), version: 2 })).toThrow(/newer Fringe/);
  });

  it('refuses fringes without a usable rate, and names them', () => {
    const file = libraryFile([{ ...fica, rate: 'lots' }]);
    expect(() => parseFringeLibrary(file)).toThrow(/FICA has no rate/);
    expect(() => parseFringeLibrary(libraryFile([fica, { ...fica, name: 'fica' }]))).toThrow(/twice/);
  });

  it('drops what does not apply to the kind, and dates that are not dates', () => {
    const [f] = parseFringeLibrary(libraryFile([{ ...health, cutoff: '100', asOf: 'last July' }]));
    expect(f).toMatchObject({ cutoff: null, asOf: '' });
  });
});

describe('mergeIntoLibrary', () => {
  it('adds new names and replaces ones already there, ignoring case', () => {
    const newer = { ...fica, name: 'fica', rate: '6.3' };
    const { library, added, replaced } = mergeIntoLibrary([fica], [newer, health]);
    expect(library).toEqual([newer, health]);
    expect({ added, replaced }).toEqual({ added: 1, replaced: 1 });
  });
});

describe('budgets and the library', () => {
  it("copies a budget's fringes out, dated and noted", () => {
    const budget = addLibraryFringes(newBudget('Test Show'), [fica]);
    expect(libraryFromBudget(budget, '2026-10-21')).toEqual([
      { ...fica, asOf: '2026-10-21', note: 'From Test Show' },
    ]);
  });

  it("adds new fringes and updates matching ones, keeping the budget's name", () => {
    const budget = addLibraryFringes(newBudget('Test Show'), [{ ...fica, name: 'fica', rate: '5' }]);
    const next = addLibraryFringes(budget, [fica, health]);
    expect(next.settings.fringeDefs.map((f) => [f.name, f.rate])).toEqual([
      ['fica', '6.2'],
      ['Health', '7.50'],
    ]);
    expect(budget.settings.fringeDefs[0]!.rate).toBe('5');
  });
});
